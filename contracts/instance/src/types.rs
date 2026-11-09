//! Stored state shapes and view return shapes. Part of the frozen interface (H1).

use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId, BorshStorageKey};
use nutus_common::{Filers, LaneId, RecordStep, TokenId};

pub type PayoutId = U64;
pub type StandingId = U64;

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
pub enum StorageKey {
    Council,
    Tokens,
    Lanes,
    Payouts,
    Standing,
    Records,
    RoleMembers,
}

/// Per-token accounting. `available = balance − reserved − committed_notice − standing_buffer`.
/// I1: `balance ≥ reserved + committed_notice + standing_buffer` always.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TokenBook {
    pub balance: U128,
    pub reserved: U128,
    pub committed_notice: U128,
    pub standing_buffer: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct TokenBookView {
    pub token: TokenId,
    pub balance: U128,
    pub reserved: U128,
    pub committed_notice: U128,
    pub standing_buffer: U128,
    pub available: U128,
}

/// A lane with defaults resolved and its period counters.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Lane {
    pub id: LaneId,
    pub name: String,
    pub token: TokenId,
    pub small_max: U128,
    pub medium_max: U128,
    pub period_cap: U128,
    pub period_ns: U64,
    pub window_ns: U64,
    pub medium_timeout_ns: U64,
    pub objectors: Option<Vec<AccountId>>,
    pub filers: Filers,
    pub silent_can_object: bool,
    pub record_steps: Vec<RecordStep>,
    pub period_start_ns: U64,
    pub spent_this_period: U128,
    /// Payouts not yet final (Waiting, Escalating, Objected, Sending).
    /// A lane can't be removed or change token while this is non-zero.
    pub open_payouts: u32,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PeriodUsage {
    pub lane: LaneId,
    pub period_start_ns: U64,
    pub period_ns: U64,
    pub cap: U128,
    pub spent: U128,
    pub remaining: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tier {
    Small,
    Medium,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub enum PayoutStatus {
    /// Small: inside its objection window. Medium: waiting for an approver.
    Waiting,
    /// Escalation is in flight (async `get_policy` → `add_proposal`).
    Escalating {
        objected_by: Option<AccountId>,
        reason: Option<String>,
    },
    /// Objected, but the DAO proposal could not be filed (bond float short or
    /// AddProposal not permitted). Amount stays reserved until `escalate` retries.
    Objected {
        by: AccountId,
        reason: String,
        needs_manual_filing: bool,
    },
    /// Handed to the DAO as a normal proposal. Amount is no longer reserved.
    Escalated {
        proposal_id: U64,
    },
    /// `settle_escalation` read the DAO's final verdict on the proposal.
    Settled {
        proposal_id: U64,
        approved: bool,
    },
    /// Transfer in flight (I3: entered at most once).
    Sending,
    Paid,
    Failed {
        reason: String,
    },
    Cancelled,
}

/// Status without payload, used to filter `get_payouts`.
#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PayoutStatusKind {
    Waiting,
    Escalating,
    Objected,
    Escalated,
    Settled,
    Sending,
    Paid,
    Failed,
    Cancelled,
}

impl PayoutStatus {
    pub fn kind(&self) -> PayoutStatusKind {
        match self {
            PayoutStatus::Waiting => PayoutStatusKind::Waiting,
            PayoutStatus::Escalating { .. } => PayoutStatusKind::Escalating,
            PayoutStatus::Objected { .. } => PayoutStatusKind::Objected,
            PayoutStatus::Escalated { .. } => PayoutStatusKind::Escalated,
            PayoutStatus::Settled { .. } => PayoutStatusKind::Settled,
            PayoutStatus::Sending => PayoutStatusKind::Sending,
            PayoutStatus::Paid => PayoutStatusKind::Paid,
            PayoutStatus::Failed { .. } => PayoutStatusKind::Failed,
            PayoutStatus::Cancelled => PayoutStatusKind::Cancelled,
        }
    }
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Payout {
    pub id: PayoutId,
    pub lane: LaneId,
    pub filer: AccountId,
    pub recipient: AccountId,
    pub token: TokenId,
    pub amount: U128,
    pub link: String,
    pub memo: Option<String>,
    pub tier: Tier,
    pub filed_at_ns: U64,
    /// Small: end of the objection window. Medium: when `escalate` opens.
    /// Fixed at filing, so later lane changes can't move it.
    pub deadline_ns: U64,
    /// Refundable part of the anti-spam deposit (yoctoNEAR), after this payout's
    /// own storage cost. Pays recipient token registration on release; the rest
    /// goes back to the filer when the payout reaches a final state.
    pub deposit: U128,
    pub approved_by: Option<AccountId>,
    /// When the payout entered `Sending`. After `STUCK_AFTER_NS` the DAO may
    /// resolve it with `resolve_stuck_payout` (lost callback).
    pub sending_since_ns: Option<U64>,
    pub status: PayoutStatus,
}

/// What the DAO passes to `add_standing`.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct StandingInput {
    pub recipient: AccountId,
    pub token: TokenId,
    pub amount: U128,
    pub period_ns: U64,
    pub first_due_ns: U64,
    pub ends_at_ns: Option<U64>,
    /// Periods of pay guaranteed after `stop_standing`. Locked on creation.
    pub notice_periods: u32,
    pub memo: Option<String>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub enum StandingState {
    Active,
    Noticed {
        notice_started_ns: U64,
        remaining_periods: u32,
    },
    Ended,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Standing {
    pub id: StandingId,
    pub recipient: AccountId,
    pub token: TokenId,
    pub amount: U128,
    pub period_ns: U64,
    pub next_due_ns: U64,
    pub ends_at_ns: Option<U64>,
    pub notice_periods: u32,
    pub memo: Option<String>,
    /// This payment's share of `TokenBook.standing_buffer`.
    pub buffer: U128,
    /// This payment's share of `TokenBook.committed_notice`.
    pub notice_locked: U128,
    /// The `pay_due` transfer in flight, if any.
    pub in_flight: Option<StandingTransfer>,
    pub state: StandingState,
}

/// A standing transfer awaiting its callback: what to settle either way.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct StandingTransfer {
    pub periods: u32,
    pub amount: U128,
    pub from_notice: bool,
    pub prev_next_due_ns: U64,
    pub since_ns: U64,
}

/// Where a record point came from. Every point traces to a real payment (I5).
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub enum SourceRef {
    DaoProposal { id: U64 },
    NutusPayout { id: PayoutId },
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Record {
    pub paid_jobs: u32,
    pub last_objection_ns: Option<U64>,
    /// `paid_jobs` when the last objection landed. During the cooldown the
    /// record step is computed from this, so step-ups pause.
    pub jobs_at_last_objection: u32,
    pub sources: Vec<SourceRef>,
}

/// One entry of `seed_records`: past DAO proposals that paid this account.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct SeedEntry {
    pub account: AccountId,
    pub proposal_ids: Vec<U64>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct ConfigView {
    pub dao: AccountId,
    pub factory: AccountId,
    pub paused: bool,
    pub council: Vec<AccountId>,
    /// NEAR the DAO wants kept spare for escalation bonds (a warning threshold).
    pub bond_float_target: U128,
    /// Spare NEAR right now: account balance − storage − NEAR budget − held deposits.
    /// Escalation needs this to be ≥ the DAO's proposal bond.
    pub bond_float_available: U128,
    pub filing_deposit: U128,
    pub objection_cooldown_ns: U64,
    pub next_payout_id: U64,
    pub next_standing_id: U64,
    pub version: String,
}
