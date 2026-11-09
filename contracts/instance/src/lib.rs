//! Nutus instance (`<dao>.nutus.near`): one per DAO, deployed from global code by hash.
//!
//! Phase 2: funding, lanes, filing, release, approve, object → escalation,
//! cancel and withdraw are implemented. Standing payments, records seeding,
//! `sync_council` and `settle_escalation` land in Phase 3 (see docs/PROGRESS.md).
//!
//! Gas: `object` and `escalate` start a 3-step chain (get_policy → add_proposal →
//! callback). Attach ≥ 150 TGas. `release` / `approve` / `withdraw`: ≥ 60 TGas.

pub mod events;
pub mod sputnik;
pub mod types;

#[cfg(test)]
mod tests;

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::json;
use near_sdk::store::{IterableMap, IterableSet, LookupMap, Vector};
use near_sdk::{
    env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
    PromiseOrValue,
};
use nutus_common::{
    LaneConfig, LaneId, RecordStep, SetupConfig, TokenId, DEFAULT_FILING_DEPOSIT,
    DEFAULT_MEDIUM_TIMEOUT_NS, DEFAULT_OBJECTION_COOLDOWN_NS, DEFAULT_PERIOD_NS, DEFAULT_WINDOW_NS,
    NEAR_TOKEN_ID,
};

use events::NutusEvent;
use sputnik::{Policy, Proposal, ProposalInput, ProposalKind, SPUTNIK_NEAR_TOKEN};
use types::*;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// NEP-145 registration for USDC / USDT on NEAR is 0.00125 NEAR (Q1).
pub const FT_STORAGE_DEPOSIT: u128 = 1_250_000_000_000_000_000_000;
pub const MAX_ID_LEN: usize = 64;
pub const MAX_NAME_LEN: usize = 128;
pub const MAX_LINK_LEN: usize = 512;
pub const MAX_MEMO_LEN: usize = 256;
pub const MAX_REASON_LEN: usize = 512;

const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_STORAGE_DEPOSIT: Gas = Gas::from_tgas(10);
const GAS_ON_SENT: Gas = Gas::from_tgas(20);
const GAS_ON_WITHDRAWN: Gas = Gas::from_tgas(10);
const GAS_GET_POLICY: Gas = Gas::from_tgas(10);
const GAS_ADD_PROPOSAL: Gas = Gas::from_tgas(30);
const GAS_ON_PROPOSAL_ADDED: Gas = Gas::from_tgas(20);
const GAS_ON_POLICY: Gas = Gas::from_tgas(70);

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    dao: AccountId,
    factory: AccountId,
    paused: bool,
    council: IterableSet<AccountId>,
    /// Role name → members, cached from the DAO policy by `sync_council`.
    role_members: LookupMap<String, Vec<AccountId>>,
    tokens: IterableMap<TokenId, TokenBook>,
    lanes: IterableMap<LaneId, Lane>,
    /// Indexed by payout id.
    payouts: Vector<Payout>,
    /// Indexed by standing id.
    standing: Vector<Standing>,
    records: LookupMap<AccountId, Record>,
    /// Sum of refundable filing deposits on payouts that aren't final yet.
    deposits_held: u128,
    bond_float_target: NearToken,
    filing_deposit: NearToken,
    objection_cooldown_ns: u64,
}

#[near]
impl Contract {
    // ───────────────────────────── init ─────────────────────────────

    /// Called by the factory in the same batch that creates the account.
    /// `dao` is the token sender / caller seen by the factory, so it can't be spoofed.
    #[init]
    pub fn new(dao: AccountId, config: SetupConfig) -> Self {
        let mut this = Self {
            dao: dao.clone(),
            factory: env::predecessor_account_id(),
            paused: false,
            council: IterableSet::new(StorageKey::Council),
            role_members: LookupMap::new(StorageKey::RoleMembers),
            tokens: IterableMap::new(StorageKey::Tokens),
            lanes: IterableMap::new(StorageKey::Lanes),
            payouts: Vector::new(StorageKey::Payouts),
            standing: Vector::new(StorageKey::Standing),
            records: LookupMap::new(StorageKey::Records),
            deposits_held: 0,
            bond_float_target: NearToken::from_yoctonear(0),
            filing_deposit: NearToken::from_yoctonear(
                config
                    .filing_deposit
                    .map_or(DEFAULT_FILING_DEPOSIT, |d| d.0),
            ),
            objection_cooldown_ns: config
                .objection_cooldown_ns
                .map_or(DEFAULT_OBJECTION_COOLDOWN_NS, |c| c.0),
        };
        for member in config.council.unwrap_or_default() {
            this.council.insert(member);
        }
        NutusEvent::InstanceCreated {
            dao,
            factory: this.factory.clone(),
        }
        .emit();
        for lane in config.lanes {
            this.internal_configure_lane(lane);
        }
        this
    }

    // ─────────────────────────── DAO only ───────────────────────────

    /// Adds or replaces a lane. Replacing keeps the period counters; the token
    /// can only change while the lane has no open payouts.
    pub fn configure_lane(&mut self, lane: LaneConfig) {
        self.assert_dao();
        self.internal_configure_lane(lane);
    }

    /// Fails while the lane has open payouts.
    pub fn remove_lane(&mut self, lane_id: LaneId) {
        self.assert_dao();
        let lane = self.lane(&lane_id);
        require!(lane.open_payouts == 0, "LANE_HAS_OPEN_PAYOUTS");
        self.lanes.remove(&lane_id);
        NutusEvent::LaneRemoved { lane: lane_id }.emit();
    }

    /// Per lane, because steps are in that lane's token units.
    pub fn set_record_steps(&mut self, lane_id: LaneId, steps: Vec<RecordStep>) {
        self.assert_dao();
        validate_steps(&steps);
        let mut lane = self.lane(&lane_id);
        lane.record_steps = steps.clone();
        self.lanes.insert(lane_id.clone(), lane);
        NutusEvent::RecordStepsSet {
            lane: lane_id,
            steps,
        }
        .emit();
    }

    pub fn seed_records(&mut self, entries: Vec<SeedEntry>) {
        self.assert_dao();
        let _ = entries;
        todo!("Phase 3")
    }

    /// Locks `amount × notice_periods` into committed notice. Returns the new id.
    pub fn add_standing(&mut self, standing: StandingInput) -> StandingId {
        self.assert_dao();
        let _ = standing;
        todo!("Phase 3")
    }

    /// Starts the notice period; remaining payments come from committed notice.
    pub fn stop_standing(&mut self, standing_id: StandingId) {
        self.assert_dao();
        let _ = standing_id;
        todo!("Phase 3")
    }

    /// While paused: no new filings, releases or approvals. Objections,
    /// escalation, cancel and withdraw still work.
    pub fn pause(&mut self) {
        self.assert_dao();
        require!(!self.paused, "ALREADY_PAUSED");
        self.paused = true;
        NutusEvent::Paused {}.emit();
    }

    pub fn unpause(&mut self) {
        self.assert_dao();
        require!(self.paused, "NOT_PAUSED");
        self.paused = false;
        NutusEvent::Unpaused {}.emit();
    }

    /// Only from `available` (I2: reserved money and committed notice are
    /// untouchable, even by the DAO). `to` defaults to the DAO.
    pub fn withdraw(&mut self, token: TokenId, amount: U128, to: Option<AccountId>) -> Promise {
        self.assert_dao();
        require!(amount.0 > 0, "ZERO_AMOUNT");
        let mut book = self.book(&token);
        require!(available(&book) >= amount.0, "EXCEEDS_AVAILABLE");
        // Debit now so concurrent calls can't spend the same money; the
        // callback credits it back if the transfer fails.
        book.balance = U128(book.balance.0 - amount.0);
        self.put_book(&token, book);
        let to = to.unwrap_or_else(|| self.dao.clone());
        transfer(&token, &to, amount.0, false).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_ON_WITHDRAWN)
                .on_withdrawn(token, amount, to),
        )
    }

    /// Spare NEAR the DAO wants kept for escalation bonds. A threshold for
    /// warnings; send NEAR with `fund_bond_float` to actually top it up.
    pub fn set_bond_float(&mut self, amount: U128) {
        self.assert_dao();
        self.bond_float_target = NearToken::from_yoctonear(amount.0);
        NutusEvent::BondFloatSet { amount }.emit();
    }

    pub fn set_filing_deposit(&mut self, amount: U128) {
        self.assert_dao();
        self.filing_deposit = NearToken::from_yoctonear(amount.0);
        NutusEvent::FilingDepositSet { amount }.emit();
    }

    /// Adds the attached NEAR to the `"near"` payout budget.
    #[payable]
    pub fn fund_near(&mut self) {
        self.assert_dao();
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "ZERO_AMOUNT");
        let token = NEAR_TOKEN_ID.to_string();
        let mut book = self.book(&token);
        book.balance = U128(book.balance.0 + amount);
        self.put_book(&token, book);
        NutusEvent::Funded {
            token,
            amount: U128(amount),
            purpose: "fund".into(),
        }
        .emit();
    }

    /// Anyone may top up the spare NEAR used for escalation bonds. It is not
    /// part of any token book, so it can't be paid out to contributors.
    #[payable]
    pub fn fund_bond_float(&mut self) {
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "ZERO_AMOUNT");
        NutusEvent::Funded {
            token: NEAR_TOKEN_ID.into(),
            amount: U128(amount),
            purpose: "bond_float".into(),
        }
        .emit();
    }

    /// NEP-141 receiver. Only the DAO may fund; anything else is refunded in full.
    /// `msg`: `"fund"` | `"fund_standing:<id>"`.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let token: TokenId = env::predecessor_account_id().into();
        if token == NEAR_TOKEN_ID || sender_id != self.dao || amount.0 == 0 {
            return PromiseOrValue::Value(amount);
        }
        let mut book = self.book(&token);
        if msg == "fund" {
            book.balance = U128(book.balance.0 + amount.0);
            self.put_book(&token, book);
        } else if let Some(id) = msg.strip_prefix("fund_standing:") {
            let Some(idx) = id.parse::<u32>().ok() else {
                return PromiseOrValue::Value(amount);
            };
            let Some(s) = self.standing.get_mut(idx) else {
                return PromiseOrValue::Value(amount);
            };
            if s.token != token || s.state == StandingState::Ended {
                return PromiseOrValue::Value(amount);
            }
            s.buffer = U128(s.buffer.0 + amount.0);
            book.balance = U128(book.balance.0 + amount.0);
            book.standing_buffer = U128(book.standing_buffer.0 + amount.0);
            self.put_book(&token, book);
            NutusEvent::StandingFunded {
                id: U64(idx as u64),
                amount,
            }
            .emit();
        } else {
            return PromiseOrValue::Value(amount);
        }
        NutusEvent::Funded {
            token,
            amount,
            purpose: msg,
        }
        .emit();
        PromiseOrValue::Value(U128(0))
    }

    // ─────────────────────────── council ───────────────────────────

    /// Small payouts only, inside the window, by an objector. Files the payout
    /// as a normal DAO proposal (escalation). Attach ≥ 150 TGas.
    ///
    /// `silent_can_object` is advisory: seat silence is computed off-chain by
    /// seat watch, so the contract lets every listed objector object.
    pub fn object(&mut self, payout_id: PayoutId, reason: String) -> Promise {
        let who = env::predecessor_account_id();
        let now = env::block_timestamp();
        let mut p = self.payout(payout_id);
        require!(p.status == PayoutStatus::Waiting, "NOT_WAITING");
        require!(p.tier == Tier::Small, "NOT_SMALL");
        let lane = self.lane(&p.lane);
        require!(self.is_objector(&lane, &who), "NOT_AN_OBJECTOR");
        require!(now < p.deadline_ns.0, "WINDOW_CLOSED");
        require!(
            !reason.trim().is_empty() && reason.len() <= MAX_REASON_LEN,
            "BAD_REASON"
        );

        let mut rec = self.records.get(&p.recipient).cloned().unwrap_or_default();
        rec.last_objection_ns = Some(U64(now));
        rec.jobs_at_last_objection = rec.paid_jobs;
        self.records.insert(p.recipient.clone(), rec);

        NutusEvent::PayoutObjected {
            id: payout_id,
            by: who.clone(),
            reason: reason.clone(),
        }
        .emit();
        p.status = PayoutStatus::Escalating {
            objected_by: Some(who),
            reason: Some(reason),
        };
        self.put_payout(p);
        self.start_escalation(payout_id)
    }

    /// Medium payouts only. The first approval releases the payout.
    pub fn approve(&mut self, payout_id: PayoutId) -> Promise {
        self.assert_not_paused();
        let who = env::predecessor_account_id();
        let mut p = self.payout(payout_id);
        require_waiting(&p);
        require!(p.tier == Tier::Medium, "NOT_MEDIUM");
        let lane = self.lane(&p.lane);
        require!(self.is_objector(&lane, &who), "NOT_AN_APPROVER");
        require!(who != p.recipient && who != p.filer, "SELF_APPROVAL");
        p.approved_by = Some(who.clone());
        NutusEvent::PayoutApproved {
            id: payout_id,
            by: who,
        }
        .emit();
        self.start_send(p)
    }

    // ─────────────────────────── filers ────────────────────────────

    /// Attach at least `filing_deposit`. Small if `amount ≤ min(small_max,
    /// record step)`, Medium if `≤ medium_max`, otherwise panics `USE_FULL_VOTE`.
    /// The payout's own storage is paid from the deposit; the rest is refunded
    /// when the payout reaches a final state.
    #[payable]
    pub fn file_payout(
        &mut self,
        lane_id: LaneId,
        recipient: AccountId,
        amount: U128,
        link: String,
        memo: Option<String>,
    ) -> PayoutId {
        self.assert_not_paused();
        let filer = env::predecessor_account_id();
        let attached = env::attached_deposit().as_yoctonear();
        let now = env::block_timestamp();
        require!(
            attached >= self.filing_deposit.as_yoctonear(),
            "DEPOSIT_TOO_SMALL"
        );
        require!(amount.0 > 0, "ZERO_AMOUNT");
        require!(link.len() <= MAX_LINK_LEN, "LINK_TOO_LONG");
        require!(
            memo.as_ref().is_none_or(|m| m.len() <= MAX_MEMO_LEN),
            "MEMO_TOO_LONG"
        );
        require!(recipient != env::current_account_id(), "BAD_RECIPIENT");

        let mut lane = self.lane(&lane_id);
        self.assert_can_file(&lane, &filer);
        require!(amount.0 <= lane.medium_max.0, "USE_FULL_VOTE");
        let rec = self.records.get(&recipient).cloned().unwrap_or_default();
        let tier = if amount.0 <= small_limit(&lane, &rec, now, self.objection_cooldown_ns) {
            Tier::Small
        } else {
            Tier::Medium
        };

        roll_period(&mut lane, now);
        let spent = lane.spent_this_period.0 + amount.0;
        require!(spent <= lane.period_cap.0, "PERIOD_CAP_REACHED");
        let mut book = self.book(&lane.token);
        require!(available(&book) >= amount.0, "INSUFFICIENT_BUDGET");

        let storage_before = env::storage_usage();
        book.reserved = U128(book.reserved.0 + amount.0);
        lane.spent_this_period = U128(spent);
        lane.open_payouts += 1;
        let id = U64(self.payouts.len() as u64);
        let deadline = now
            + match tier {
                Tier::Small => lane.window_ns.0,
                Tier::Medium => lane.medium_timeout_ns.0,
            };
        let token = lane.token.clone();
        self.payouts.push(Payout {
            id,
            lane: lane_id.clone(),
            filer: filer.clone(),
            recipient: recipient.clone(),
            token: token.clone(),
            amount,
            link,
            memo,
            tier,
            filed_at_ns: U64(now),
            deadline_ns: U64(deadline),
            deposit: U128(attached),
            approved_by: None,
            status: PayoutStatus::Waiting,
        });
        self.put_book(&token, book);
        self.lanes.insert(lane_id.clone(), lane);
        self.payouts.flush();
        self.lanes.flush();
        self.tokens.flush();

        let storage_fee = u128::from(env::storage_usage().saturating_sub(storage_before))
            * env::storage_byte_cost().as_yoctonear();
        let refundable = attached
            .checked_sub(storage_fee)
            .unwrap_or_else(|| env::panic_str("DEPOSIT_TOO_SMALL"));
        if token != NEAR_TOKEN_ID {
            require!(refundable >= FT_STORAGE_DEPOSIT, "DEPOSIT_TOO_SMALL");
        }
        let mut p = self.payout(id);
        p.deposit = U128(refundable);
        self.put_payout(p);
        self.deposits_held += refundable;

        NutusEvent::PayoutFiled {
            id,
            lane: lane_id,
            filer,
            recipient,
            token,
            amount,
            tier,
            deadline_ns: U64(deadline),
        }
        .emit();
        id
    }

    /// The filer or the DAO may withdraw a Waiting payout; the DAO may also
    /// close an Objected one (e.g. after filing it by hand). Deposit refunded.
    pub fn cancel_payout(&mut self, payout_id: PayoutId) {
        let who = env::predecessor_account_id();
        let mut p = self.payout(payout_id);
        match p.status {
            PayoutStatus::Waiting => {
                require!(who == p.filer || who == self.dao, "NOT_ALLOWED")
            }
            PayoutStatus::Objected { .. } => require!(who == self.dao, "ONLY_DAO"),
            _ => env::panic_str("CANNOT_CANCEL"),
        }
        self.close_unpaid(&p);
        refund(&p.filer, p.deposit.0);
        p.status = PayoutStatus::Cancelled;
        self.put_payout(p);
        NutusEvent::PayoutCancelled {
            id: payout_id,
            by: who,
        }
        .emit();
    }

    // ─────────────────────────── anyone ────────────────────────────

    /// Small, Waiting, window passed → Sending → transfer → `on_sent`.
    pub fn release(&mut self, payout_id: PayoutId) -> Promise {
        self.assert_not_paused();
        let p = self.payout(payout_id);
        require_waiting(&p);
        require!(p.tier == Tier::Small, "NOT_SMALL");
        require!(env::block_timestamp() >= p.deadline_ns.0, "WINDOW_OPEN");
        self.start_send(p)
    }

    /// Medium past its timeout, or an Objected payout with `needs_manual_filing`
    /// (retry after the bond float is topped up) → files the DAO proposal.
    /// Attach ≥ 150 TGas.
    pub fn escalate(&mut self, payout_id: PayoutId) -> Promise {
        let mut p = self.payout(payout_id);
        p.status = match p.status {
            PayoutStatus::Waiting => {
                require!(p.tier == Tier::Medium, "NOT_MEDIUM");
                require!(env::block_timestamp() >= p.deadline_ns.0, "NOT_TIMED_OUT");
                PayoutStatus::Escalating {
                    objected_by: None,
                    reason: None,
                }
            }
            PayoutStatus::Objected {
                by,
                reason,
                needs_manual_filing: true,
            } => PayoutStatus::Escalating {
                objected_by: Some(by),
                reason: Some(reason),
            },
            _ => env::panic_str("CANNOT_ESCALATE"),
        };
        self.put_payout(p);
        self.start_escalation(payout_id)
    }

    /// Pays every due period up to now. Returns `None` when nothing is due.
    pub fn pay_due(&mut self, standing_id: StandingId) -> Option<Promise> {
        let _ = standing_id;
        todo!("Phase 3")
    }

    /// Reads the DAO policy; council = members of roles with `transfer:VoteApprove`.
    pub fn sync_council(&mut self) -> Promise {
        todo!("Phase 3")
    }

    /// Reads the escalated proposal; records a point if Approved.
    pub fn settle_escalation(&mut self, payout_id: PayoutId) -> Promise {
        let _ = payout_id;
        todo!("Phase 3")
    }

    // ────────────────────────── callbacks ──────────────────────────

    #[private]
    pub fn on_sent(&mut self, payout_id: PayoutId) {
        let mut p = self.payout(payout_id);
        require!(p.status == PayoutStatus::Sending, "NOT_SENDING");
        if promise_succeeded() {
            let mut book = self.book(&p.token);
            book.reserved = U128(book.reserved.0 - p.amount.0);
            book.balance = U128(book.balance.0 - p.amount.0);
            self.put_book(&p.token, book);
            if let Some(mut lane) = self.lanes.get(&p.lane).cloned() {
                lane.open_payouts -= 1;
                self.lanes.insert(p.lane.clone(), lane);
            }
            self.deposits_held -= p.deposit.0;
            let mut rec = self.records.get(&p.recipient).cloned().unwrap_or_default();
            rec.paid_jobs += 1;
            rec.sources.push(SourceRef::NutusPayout { id: payout_id });
            self.records.insert(p.recipient.clone(), rec);
            // Token registration was paid from the deposit.
            let used = if p.token == NEAR_TOKEN_ID {
                0
            } else {
                FT_STORAGE_DEPOSIT
            };
            refund(&p.filer, p.deposit.0.saturating_sub(used));
            p.status = PayoutStatus::Paid;
            NutusEvent::PayoutPaid {
                id: payout_id,
                recipient: p.recipient.clone(),
                token: p.token.clone(),
                amount: p.amount,
            }
            .emit();
        } else {
            // The batch reverted, so the registration deposit comes back too.
            self.close_unpaid(&p);
            refund(&p.filer, p.deposit.0);
            let reason = "transfer failed".to_string();
            p.status = PayoutStatus::Failed {
                reason: reason.clone(),
            };
            NutusEvent::PayoutFailed {
                id: payout_id,
                reason,
            }
            .emit();
        }
        self.put_payout(p);
    }

    #[private]
    pub fn on_withdrawn(&mut self, token: TokenId, amount: U128, to: AccountId) {
        if promise_succeeded() {
            NutusEvent::Withdrawn { token, amount, to }.emit();
        } else {
            let mut book = self.book(&token);
            book.balance = U128(book.balance.0 + amount.0);
            self.put_book(&token, book);
        }
    }

    #[private]
    pub fn on_standing_sent(
        &mut self,
        standing_id: StandingId,
        periods: u32,
        amount: U128,
        from_notice: bool,
    ) {
        let _ = (standing_id, periods, amount, from_notice);
        todo!("Phase 3")
    }

    #[private]
    pub fn on_policy_for_escalation(
        &mut self,
        payout_id: PayoutId,
        #[callback_result] policy: Result<Policy, PromiseError>,
    ) -> PromiseOrValue<()> {
        let p = self.payout(payout_id);
        let PayoutStatus::Escalating {
            objected_by,
            reason,
        } = p.status.clone()
        else {
            env::panic_str("NOT_ESCALATING")
        };
        let Ok(policy) = policy else {
            self.escalation_failed(p, "could not read DAO policy");
            return PromiseOrValue::Value(());
        };
        let bond = policy.proposal_bond.0;
        if self.spare_near() < bond {
            self.escalation_failed(p, "bond float short");
            return PromiseOrValue::Value(());
        }
        let lane_name = self
            .lanes
            .get(&p.lane)
            .map_or_else(|| p.lane.clone(), |l| l.name.clone());
        let why = match (objected_by, reason) {
            (Some(by), Some(reason)) => format!("objected by {by}: \"{reason}\""),
            _ => "medium payout not approved in time".to_string(),
        };
        let proposal = ProposalInput {
            description: format!(
                "[Nutus] Escalated payout #{} · lane {} · {} · work: {}",
                payout_id.0, lane_name, why, p.link
            ),
            kind: ProposalKind::Transfer {
                token_id: if p.token == NEAR_TOKEN_ID {
                    SPUTNIK_NEAR_TOKEN.to_string()
                } else {
                    p.token.clone()
                },
                receiver_id: p.recipient.clone(),
                amount: p.amount,
                msg: None,
            },
        };
        Promise::new(self.dao.clone())
            .function_call(
                "add_proposal",
                json!({ "proposal": proposal }).to_string().into_bytes(),
                NearToken::from_yoctonear(bond),
                GAS_ADD_PROPOSAL,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_PROPOSAL_ADDED)
                    .on_proposal_added(payout_id, U128(bond)),
            )
            .into()
    }

    #[private]
    pub fn on_proposal_added(
        &mut self,
        payout_id: PayoutId,
        bond: U128,
        #[callback_result] proposal_id: Result<u64, PromiseError>,
    ) {
        let mut p = self.payout(payout_id);
        require!(
            matches!(p.status, PayoutStatus::Escalating { .. }),
            "NOT_ESCALATING"
        );
        let Ok(proposal_id) = proposal_id else {
            self.escalation_failed(p, "DAO refused the proposal (AddProposal permission?)");
            return;
        };
        // The DAO treasury pays from here; Nutus no longer holds it back.
        self.close_unpaid(&p);
        refund(&p.filer, p.deposit.0);
        p.status = PayoutStatus::Escalated {
            proposal_id: U64(proposal_id),
        };
        self.put_payout(p);
        NutusEvent::PayoutEscalated {
            id: payout_id,
            proposal_id: U64(proposal_id),
            bond,
        }
        .emit();
    }

    #[private]
    pub fn on_council_policy(&mut self, #[callback_result] policy: Result<Policy, PromiseError>) {
        let _ = policy;
        todo!("Phase 3")
    }

    #[private]
    pub fn on_escalation_proposal(
        &mut self,
        payout_id: PayoutId,
        #[callback_result] proposal: Result<Proposal, PromiseError>,
    ) {
        let _ = (payout_id, proposal);
        todo!("Phase 3")
    }

    // ──────────────────────────── views ────────────────────────────

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            dao: self.dao.clone(),
            factory: self.factory.clone(),
            paused: self.paused,
            council: self.council.iter().cloned().collect(),
            bond_float_target: U128(self.bond_float_target.as_yoctonear()),
            bond_float_available: U128(self.spare_near()),
            filing_deposit: U128(self.filing_deposit.as_yoctonear()),
            objection_cooldown_ns: U64(self.objection_cooldown_ns),
            next_payout_id: U64(self.payouts.len() as u64),
            next_standing_id: U64(self.standing.len() as u64),
            version: VERSION.to_string(),
        }
    }

    pub fn get_lanes(&self) -> Vec<Lane> {
        self.lanes.values().cloned().collect()
    }

    pub fn get_lane(&self, lane_id: LaneId) -> Option<Lane> {
        self.lanes.get(&lane_id).cloned()
    }

    pub fn get_payout(&self, payout_id: PayoutId) -> Option<Payout> {
        u32::try_from(payout_id.0)
            .ok()
            .and_then(|i| self.payouts.get(i))
            .cloned()
    }

    /// Ascending by id from `from_index`; `limit` defaults to 50.
    pub fn get_payouts(
        &self,
        from_index: Option<U64>,
        limit: Option<u32>,
        status: Option<PayoutStatusKind>,
    ) -> Vec<Payout> {
        let from = from_index.map_or(0, |i| i.0) as usize;
        let limit = limit.unwrap_or(50) as usize;
        self.payouts
            .iter()
            .skip(from)
            .filter(|p| status.is_none_or(|s| p.status.kind() == s))
            .take(limit)
            .cloned()
            .collect()
    }

    pub fn get_standing(&self, from_index: Option<U64>, limit: Option<u32>) -> Vec<Standing> {
        let from = from_index.map_or(0, |i| i.0) as usize;
        let limit = limit.unwrap_or(50) as usize;
        self.standing
            .iter()
            .skip(from)
            .take(limit)
            .cloned()
            .collect()
    }

    pub fn get_record(&self, account_id: AccountId) -> Option<Record> {
        self.records.get(&account_id).cloned()
    }

    pub fn get_token_books(&self) -> Vec<TokenBookView> {
        self.tokens
            .iter()
            .map(|(token, b)| TokenBookView {
                token: token.clone(),
                balance: b.balance,
                reserved: b.reserved,
                committed_notice: b.committed_notice,
                standing_buffer: b.standing_buffer,
                available: U128(available(b)),
            })
            .collect()
    }

    /// Usage as of now: a period that has already ended reads as empty.
    pub fn get_period_usage(&self, lane_id: LaneId) -> Option<PeriodUsage> {
        self.lanes.get(&lane_id).map(|l| {
            let mut l = l.clone();
            roll_period(&mut l, env::block_timestamp());
            PeriodUsage {
                lane: l.id.clone(),
                period_start_ns: l.period_start_ns,
                period_ns: l.period_ns,
                cap: l.period_cap,
                spent: l.spent_this_period,
                remaining: U128(l.period_cap.0.saturating_sub(l.spent_this_period.0)),
            }
        })
    }
}

// ───────────────────────────── internals ─────────────────────────────

impl Contract {
    fn assert_dao(&self) {
        require!(env::predecessor_account_id() == self.dao, "ONLY_DAO");
    }

    fn assert_not_paused(&self) {
        require!(!self.paused, "PAUSED");
    }

    fn assert_can_file(&self, lane: &Lane, who: &AccountId) {
        let ok = match &lane.filers {
            nutus_common::Filers::Anyone => true,
            nutus_common::Filers::Members(m) => m.contains(who),
            nutus_common::Filers::DaoMembersOfRole(role) => {
                self.role_members.get(role).is_some_and(|m| m.contains(who))
            }
        };
        require!(ok, "NOT_A_FILER");
    }

    fn is_objector(&self, lane: &Lane, who: &AccountId) -> bool {
        match &lane.objectors {
            Some(list) => list.contains(who),
            None => self.council.contains(who),
        }
    }

    fn book(&self, token: &TokenId) -> TokenBook {
        self.tokens.get(token).cloned().unwrap_or_default()
    }

    /// Every write to a token book goes through here, so I1 is checked on
    /// every call and callback that touches money.
    fn put_book(&mut self, token: &TokenId, book: TokenBook) {
        assert_i1(&book);
        self.tokens.insert(token.clone(), book);
    }

    fn lane(&self, lane_id: &LaneId) -> Lane {
        self.lanes
            .get(lane_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("NO_LANE"))
    }

    fn payout(&self, id: PayoutId) -> Payout {
        self.get_payout(id)
            .unwrap_or_else(|| env::panic_str("NO_PAYOUT"))
    }

    fn put_payout(&mut self, p: Payout) {
        let idx = p.id.0 as u32;
        self.payouts.set(idx, p);
    }

    /// NEAR the instance holds beyond storage, the NEAR payout budget and
    /// filers' deposits. Escalation bonds are paid from this.
    fn spare_near(&self) -> u128 {
        let storage = u128::from(env::storage_usage()) * env::storage_byte_cost().as_yoctonear();
        let near_budget = self.tokens.get(NEAR_TOKEN_ID).map_or(0, |b| b.balance.0);
        env::account_balance()
            .as_yoctonear()
            .saturating_sub(storage)
            .saturating_sub(near_budget)
            .saturating_sub(self.deposits_held)
    }

    fn internal_configure_lane(&mut self, cfg: LaneConfig) {
        validate_lane(&cfg);
        let now = env::block_timestamp();
        let (period_start_ns, spent_this_period, open_payouts) = match self.lanes.get(&cfg.id) {
            Some(old) => {
                require!(
                    old.token == cfg.token || old.open_payouts == 0,
                    "LANE_HAS_OPEN_PAYOUTS"
                );
                (old.period_start_ns, old.spent_this_period, old.open_payouts)
            }
            None => (U64(now), U128(0), 0),
        };
        let lane = Lane {
            id: cfg.id.clone(),
            name: cfg.name,
            token: cfg.token,
            small_max: cfg.small_max,
            medium_max: cfg.medium_max,
            period_cap: cfg.period_cap,
            period_ns: cfg.period_ns.unwrap_or(U64(DEFAULT_PERIOD_NS)),
            window_ns: cfg.window_ns.unwrap_or(U64(DEFAULT_WINDOW_NS)),
            medium_timeout_ns: cfg
                .medium_timeout_ns
                .unwrap_or(U64(DEFAULT_MEDIUM_TIMEOUT_NS)),
            objectors: cfg.objectors,
            filers: cfg.filers,
            silent_can_object: cfg.silent_can_object.unwrap_or(true),
            record_steps: cfg.record_steps.unwrap_or_default(),
            period_start_ns,
            spent_this_period,
            open_payouts,
        };
        NutusEvent::LaneConfigured {
            lane: lane.id.clone(),
            token: lane.token.clone(),
            small_max: lane.small_max,
            medium_max: lane.medium_max,
            period_cap: lane.period_cap,
        }
        .emit();
        self.lanes.insert(cfg.id, lane);
    }

    /// Waiting → Sending (I3: only from Waiting, so a second release panics
    /// `ALREADY_SENT` and changes nothing).
    fn start_send(&mut self, mut p: Payout) -> Promise {
        let id = p.id;
        p.status = PayoutStatus::Sending;
        let send = transfer(&p.token, &p.recipient, p.amount.0, true);
        self.put_payout(p);
        NutusEvent::PayoutSending { id }.emit();
        send.then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_ON_SENT)
                .on_sent(id),
        )
    }

    fn start_escalation(&self, payout_id: PayoutId) -> Promise {
        Promise::new(self.dao.clone())
            .function_call(
                "get_policy",
                b"{}".to_vec(),
                NearToken::from_yoctonear(0),
                GAS_GET_POLICY,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_POLICY)
                    .on_policy_for_escalation(payout_id),
            )
    }

    /// Escalation couldn't file the proposal: park it as Objected with
    /// `needs_manual_filing`. The amount stays reserved until `escalate`
    /// retries or the DAO cancels it.
    fn escalation_failed(&mut self, mut p: Payout, why: &str) {
        let PayoutStatus::Escalating {
            objected_by,
            reason,
        } = p.status.clone()
        else {
            env::panic_str("NOT_ESCALATING")
        };
        p.status = PayoutStatus::Objected {
            by: objected_by.unwrap_or_else(env::current_account_id),
            reason: reason.unwrap_or_else(|| "medium payout not approved in time".into()),
            needs_manual_filing: true,
        };
        NutusEvent::EscalationFailed {
            id: p.id,
            reason: why.to_string(),
        }
        .emit();
        self.put_payout(p);
    }

    /// A payout leaves Nutus without being paid by it (failed, escalated,
    /// cancelled): un-reserve the amount, give back the period cap, close the
    /// lane slot and release the held deposit (the caller refunds it).
    fn close_unpaid(&mut self, p: &Payout) {
        let mut book = self.book(&p.token);
        book.reserved = U128(book.reserved.0 - p.amount.0);
        self.put_book(&p.token, book);
        if let Some(mut lane) = self.lanes.get(&p.lane).cloned() {
            if p.filed_at_ns.0 >= lane.period_start_ns.0 {
                lane.spent_this_period = U128(lane.spent_this_period.0.saturating_sub(p.amount.0));
            }
            lane.open_payouts -= 1;
            self.lanes.insert(p.lane.clone(), lane);
        }
        self.deposits_held -= p.deposit.0;
    }
}

// ────────────────────────────── helpers ──────────────────────────────

/// `balance − reserved − committed_notice − standing_buffer` (saturating; I1 keeps it ≥ 0).
pub fn available(b: &TokenBook) -> u128 {
    b.balance
        .0
        .saturating_sub(b.reserved.0)
        .saturating_sub(b.committed_notice.0)
        .saturating_sub(b.standing_buffer.0)
}

/// I1: `balance ≥ reserved + committed_notice + standing_buffer`.
pub fn assert_i1(b: &TokenBook) {
    let locked = b
        .reserved
        .0
        .checked_add(b.committed_notice.0)
        .and_then(|x| x.checked_add(b.standing_buffer.0));
    require!(locked.is_some_and(|l| b.balance.0 >= l), "I1_VIOLATION");
}

/// Largest Small amount for this recipient in this lane.
pub fn small_limit(lane: &Lane, rec: &Record, now: u64, cooldown_ns: u64) -> u128 {
    if lane.record_steps.is_empty() {
        return lane.small_max.0;
    }
    let mut jobs = rec.paid_jobs;
    if let Some(t) = rec.last_objection_ns {
        if now < t.0.saturating_add(cooldown_ns) {
            jobs = jobs.min(rec.jobs_at_last_objection);
        }
    }
    let step = lane
        .record_steps
        .iter()
        .rev()
        .find(|s| s.min_paid_jobs <= jobs)
        .map_or(0, |s| s.small_max.0);
    step.min(lane.small_max.0)
}

/// Moves `period_start` forward by whole periods and resets usage when the
/// current period has ended.
pub fn roll_period(lane: &mut Lane, now: u64) {
    let (start, len) = (lane.period_start_ns.0, lane.period_ns.0);
    if now >= start.saturating_add(len) {
        let periods = (now - start) / len;
        lane.period_start_ns = U64(start + periods * len);
        lane.spent_this_period = U128(0);
    }
}

fn require_waiting(p: &Payout) {
    match p.status {
        PayoutStatus::Waiting => {}
        PayoutStatus::Sending | PayoutStatus::Paid => env::panic_str("ALREADY_SENT"),
        _ => env::panic_str("NOT_WAITING"),
    }
}

fn validate_lane(cfg: &LaneConfig) {
    require!(
        !cfg.id.is_empty() && cfg.id.len() <= MAX_ID_LEN,
        "BAD_LANE_ID"
    );
    require!(cfg.name.len() <= MAX_NAME_LEN, "BAD_LANE_NAME");
    require!(
        cfg.token == NEAR_TOKEN_ID || cfg.token.parse::<AccountId>().is_ok(),
        "BAD_TOKEN"
    );
    require!(cfg.medium_max.0 > 0, "BAD_TIERS");
    require!(cfg.small_max.0 <= cfg.medium_max.0, "BAD_TIERS");
    require!(cfg.period_cap.0 > 0, "BAD_PERIOD_CAP");
    for d in [cfg.period_ns, cfg.window_ns, cfg.medium_timeout_ns]
        .into_iter()
        .flatten()
    {
        require!(d.0 > 0, "BAD_DURATION");
    }
    if let Some(o) = &cfg.objectors {
        require!(!o.is_empty(), "EMPTY_OBJECTORS");
    }
    if let nutus_common::Filers::Members(m) = &cfg.filers {
        require!(!m.is_empty(), "EMPTY_FILERS");
    }
    if let Some(steps) = &cfg.record_steps {
        validate_steps(steps);
    }
}

fn validate_steps(steps: &[RecordStep]) {
    require!(
        steps
            .windows(2)
            .all(|w| w[0].min_paid_jobs < w[1].min_paid_jobs),
        "STEPS_NOT_ASCENDING"
    );
}

/// NEAR: plain transfer. NEP-141: one atomic batch on the token contract —
/// `storage_deposit` (optional, registration only) then `ft_transfer`.
fn transfer(token: &TokenId, to: &AccountId, amount: u128, register: bool) -> Promise {
    if token == NEAR_TOKEN_ID {
        return Promise::new(to.clone()).transfer(NearToken::from_yoctonear(amount));
    }
    let token: AccountId = token
        .parse()
        .unwrap_or_else(|_| env::panic_str("BAD_TOKEN"));
    let mut p = Promise::new(token);
    if register {
        p = p.function_call(
            "storage_deposit",
            json!({ "account_id": to, "registration_only": true })
                .to_string()
                .into_bytes(),
            NearToken::from_yoctonear(FT_STORAGE_DEPOSIT),
            GAS_STORAGE_DEPOSIT,
        );
    }
    p.function_call(
        "ft_transfer",
        json!({ "receiver_id": to, "amount": U128(amount) })
            .to_string()
            .into_bytes(),
        NearToken::from_yoctonear(1),
        GAS_FT_TRANSFER,
    )
}

fn refund(to: &AccountId, amount: u128) {
    if amount > 0 {
        Promise::new(to.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .detach();
    }
}

/// Result of the single promise this callback is attached to. A result too
/// long to read still means the call succeeded.
fn promise_succeeded() -> bool {
    env::promise_results_count() == 1
        && matches!(
            env::promise_result_checked(0, 4096),
            Ok(_) | Err(PromiseError::TooLong(_))
        )
}
