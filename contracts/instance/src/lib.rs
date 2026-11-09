//! Nutus instance (`<dao>.nutus.near`): one per DAO, deployed from global code by hash.
//!
//! Phase 1 status: the public interface (methods, args, return shapes, events) is
//! frozen for H1. Init, access guards, views, pause and simple setters work; the
//! money-moving bodies are `todo!` and land in Phases 2–3 (see docs/PROGRESS.md).

pub mod events;
pub mod sputnik;
pub mod types;

use near_sdk::json_types::{U128, U64};
use near_sdk::store::{IterableMap, IterableSet, LookupMap, Vector};
use near_sdk::{
    env, near, require, AccountId, NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue,
};
use nutus_common::{
    LaneConfig, LaneId, RecordStep, SetupConfig, TokenId, DEFAULT_FILING_DEPOSIT,
    DEFAULT_OBJECTION_COOLDOWN_NS,
};

use events::NutusEvent;
use sputnik::{Policy, Proposal};
use types::*;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    dao: AccountId,
    factory: AccountId,
    paused: bool,
    council: IterableSet<AccountId>,
    tokens: IterableMap<TokenId, TokenBook>,
    lanes: IterableMap<LaneId, Lane>,
    /// Indexed by payout id.
    payouts: Vector<Payout>,
    /// Indexed by standing id.
    standing: Vector<Standing>,
    records: LookupMap<AccountId, Record>,
    bond_float: NearToken,
    filing_deposit: NearToken,
    objection_cooldown_ns: u64,
}

#[near]
impl Contract {
    // ───────────────────────────── init ─────────────────────────────

    /// Called by the factory right after the account is created.
    /// `dao` is the token sender / caller seen by the factory, so it can't be spoofed.
    #[init]
    pub fn new(dao: AccountId, config: SetupConfig) -> Self {
        let mut this = Self {
            dao: dao.clone(),
            factory: env::predecessor_account_id(),
            paused: false,
            council: IterableSet::new(StorageKey::Council),
            tokens: IterableMap::new(StorageKey::Tokens),
            lanes: IterableMap::new(StorageKey::Lanes),
            payouts: Vector::new(StorageKey::Payouts),
            standing: Vector::new(StorageKey::Standing),
            records: LookupMap::new(StorageKey::Records),
            bond_float: NearToken::from_yoctonear(0),
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
        for lane in config.lanes {
            this.internal_set_lane(lane);
        }
        NutusEvent::InstanceCreated {
            dao,
            factory: this.factory.clone(),
        }
        .emit();
        this
    }

    // ─────────────────────────── DAO only ───────────────────────────

    pub fn configure_lane(&mut self, lane: LaneConfig) {
        self.assert_dao();
        let _ = lane;
        todo!("Phase 2: validate tiers, keep period counters when replacing")
    }

    /// Fails while the lane has Waiting payouts.
    pub fn remove_lane(&mut self, lane_id: LaneId) {
        self.assert_dao();
        let _ = lane_id;
        todo!("Phase 2")
    }

    /// Per lane, because steps are in that lane's token units.
    pub fn set_record_steps(&mut self, lane_id: LaneId, steps: Vec<RecordStep>) {
        self.assert_dao();
        let _ = (lane_id, steps);
        todo!("Phase 3")
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

    /// Only from `available` (I2: committed notice is untouchable, even by the DAO).
    pub fn withdraw(&mut self, token: TokenId, amount: U128, to: Option<AccountId>) -> Promise {
        self.assert_dao();
        let _ = (token, amount, to);
        todo!("Phase 2")
    }

    /// Sets how much of the instance's NEAR is kept aside for escalation bonds.
    pub fn set_bond_float(&mut self, amount: U128) {
        self.assert_dao();
        self.bond_float = NearToken::from_yoctonear(amount.0);
        NutusEvent::BondFloatSet { amount }.emit();
    }

    pub fn set_filing_deposit(&mut self, amount: U128) {
        self.assert_dao();
        self.filing_deposit = NearToken::from_yoctonear(amount.0);
        NutusEvent::FilingDepositSet { amount }.emit();
    }

    /// Adds the attached NEAR to the `"near"` token book.
    #[payable]
    pub fn fund_near(&mut self) {
        self.assert_dao();
        todo!("Phase 2")
    }

    /// NEP-141 receiver. Only the DAO may fund; anything else is refunded in full.
    /// `msg`: `"fund"` | `"fund_standing:<id>"`.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let _ = (sender_id, amount, msg);
        todo!("Phase 2")
    }

    // ─────────────────────────── council ───────────────────────────

    /// Small payouts only, inside the window, by an objector. Starts escalation.
    pub fn object(&mut self, payout_id: PayoutId, reason: String) -> Promise {
        let _ = (payout_id, reason);
        todo!("Phase 2 (state) / Phase 3 (escalation)")
    }

    /// Medium payouts only. The first approval releases the payout.
    pub fn approve(&mut self, payout_id: PayoutId) -> Promise {
        let _ = payout_id;
        todo!("Phase 2")
    }

    // ─────────────────────────── filers ────────────────────────────

    /// Attach at least `filing_deposit`. Panics `USE_FULL_VOTE` above `medium_max`.
    #[payable]
    pub fn file_payout(
        &mut self,
        lane_id: LaneId,
        recipient: AccountId,
        amount: U128,
        link: String,
        memo: Option<String>,
    ) -> PayoutId {
        let _ = (lane_id, recipient, amount, link, memo);
        todo!("Phase 2")
    }

    /// The filer or the DAO may withdraw a Waiting payout; the deposit is refunded.
    pub fn cancel_payout(&mut self, payout_id: PayoutId) {
        let _ = payout_id;
        todo!("Phase 2")
    }

    // ─────────────────────────── anyone ────────────────────────────

    /// Small, Waiting, window passed → Sending → transfer → `on_sent`.
    pub fn release(&mut self, payout_id: PayoutId) -> Promise {
        let _ = payout_id;
        todo!("Phase 2")
    }

    /// Medium past its timeout, or an Objected payout with `needs_manual_filing`
    /// (retry after the bond float is topped up) → files the DAO proposal.
    pub fn escalate(&mut self, payout_id: PayoutId) -> Promise {
        let _ = payout_id;
        todo!("Phase 3")
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
    pub fn on_sent(
        &mut self,
        payout_id: PayoutId,
        #[callback_result] result: Result<(), PromiseError>,
    ) {
        let _ = (payout_id, result);
        todo!("Phase 2")
    }

    #[private]
    pub fn on_withdrawn(
        &mut self,
        token: TokenId,
        amount: U128,
        to: AccountId,
        #[callback_result] result: Result<(), PromiseError>,
    ) {
        let _ = (token, amount, to, result);
        todo!("Phase 2")
    }

    #[private]
    pub fn on_standing_sent(
        &mut self,
        standing_id: StandingId,
        periods: u32,
        amount: U128,
        from_notice: bool,
        #[callback_result] result: Result<(), PromiseError>,
    ) {
        let _ = (standing_id, periods, amount, from_notice, result);
        todo!("Phase 3")
    }

    #[private]
    pub fn on_policy_for_escalation(
        &mut self,
        payout_id: PayoutId,
        #[callback_result] policy: Result<Policy, PromiseError>,
    ) -> PromiseOrValue<()> {
        let _ = (payout_id, policy);
        todo!("Phase 3")
    }

    #[private]
    pub fn on_proposal_added(
        &mut self,
        payout_id: PayoutId,
        bond: U128,
        #[callback_result] proposal_id: Result<u64, PromiseError>,
    ) {
        let _ = (payout_id, bond, proposal_id);
        todo!("Phase 3")
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
            bond_float: U128(self.bond_float.as_yoctonear()),
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

    pub fn get_period_usage(&self, lane_id: LaneId) -> Option<PeriodUsage> {
        self.lanes.get(&lane_id).map(|l| PeriodUsage {
            lane: l.id.clone(),
            period_start_ns: l.period_start_ns,
            period_ns: l.period_ns,
            cap: l.period_cap,
            spent: l.spent_this_period,
            remaining: U128(l.period_cap.0.saturating_sub(l.spent_this_period.0)),
        })
    }
}

// ───────────────────────────── internals ─────────────────────────────

impl Contract {
    fn assert_dao(&self) {
        require!(env::predecessor_account_id() == self.dao, "ONLY_DAO");
    }

    /// Stores a lane with defaults resolved. Validation lands with `configure_lane`.
    fn internal_set_lane(&mut self, cfg: LaneConfig) {
        use nutus_common::{DEFAULT_MEDIUM_TIMEOUT_NS, DEFAULT_PERIOD_NS, DEFAULT_WINDOW_NS};
        let lane = Lane {
            id: cfg.id.clone(),
            name: cfg.name,
            token: cfg.token.clone(),
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
            period_start_ns: U64(env::block_timestamp()),
            spent_this_period: U128(0),
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
}

/// `balance − reserved − committed_notice − standing_buffer` (saturating; I1 keeps it ≥ 0).
pub fn available(b: &TokenBook) -> u128 {
    b.balance
        .0
        .saturating_sub(b.reserved.0)
        .saturating_sub(b.committed_notice.0)
        .saturating_sub(b.standing_buffer.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{get_logs, VMContextBuilder};
    use near_sdk::testing_env;
    use nutus_common::Filers;

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn ctx(predecessor: &str) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(acc(predecessor))
            .build());
    }

    fn lane() -> LaneConfig {
        LaneConfig {
            id: "design".into(),
            name: "Design".into(),
            token: "usdc.near".into(),
            small_max: U128(100),
            medium_max: U128(500),
            period_cap: U128(2_000),
            period_ns: None,
            window_ns: None,
            medium_timeout_ns: None,
            objectors: None,
            filers: Filers::Anyone,
            silent_can_object: None,
            record_steps: None,
        }
    }

    fn setup() -> Contract {
        ctx("nutus.near");
        Contract::new(
            acc("dao.sputnik-dao.near"),
            SetupConfig {
                lanes: vec![lane()],
                council: Some(vec![acc("alice.near")]),
                ..Default::default()
            },
        )
    }

    #[test]
    fn init_stores_config_and_emits_events() {
        let c = setup();
        let cfg = c.get_config();
        assert_eq!(cfg.dao, acc("dao.sputnik-dao.near"));
        assert_eq!(cfg.factory, acc("nutus.near"));
        assert_eq!(cfg.council, vec![acc("alice.near")]);
        assert_eq!(cfg.filing_deposit, U128(DEFAULT_FILING_DEPOSIT));
        let l = c.get_lane("design".into()).unwrap();
        assert_eq!(l.window_ns, U64(nutus_common::DEFAULT_WINDOW_NS));
        assert!(l.silent_can_object);
        let logs = get_logs();
        assert!(logs
            .iter()
            .any(|l| l.contains(r#""event":"instance_created""#)));
        assert!(logs
            .iter()
            .any(|l| l.contains(r#""event":"lane_configured""#)));
        assert!(logs.iter().all(|l| l.contains(r#""standard":"nutus""#)));
    }

    #[test]
    fn dao_can_pause_and_unpause() {
        let mut c = setup();
        ctx("dao.sputnik-dao.near");
        c.pause();
        assert!(c.get_config().paused);
        c.unpause();
        assert!(!c.get_config().paused);
    }

    #[test]
    #[should_panic(expected = "ONLY_DAO")]
    fn others_cannot_pause() {
        let mut c = setup();
        ctx("alice.near");
        c.pause();
    }

    #[test]
    fn available_subtracts_all_locks() {
        let b = TokenBook {
            balance: U128(1_000),
            reserved: U128(100),
            committed_notice: U128(300),
            standing_buffer: U128(50),
        };
        assert_eq!(available(&b), 550);
    }
}
