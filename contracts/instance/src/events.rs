//! NEP-297 events: `EVENT_JSON:{"standard":"nutus","version":"1.0.0","event":"<snake_case>","data":{...}}`.
//! Part of the frozen interface (H1). Every state-changing method emits one.

use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId};
use nutus_common::{LaneId, RecordStep, TokenId};

use crate::types::{PayoutId, StandingId, Tier};

#[near(event_json(standard = "nutus"))]
pub enum NutusEvent {
    #[event_version("1.0.0")]
    InstanceCreated { dao: AccountId, factory: AccountId },

    #[event_version("1.0.0")]
    Funded {
        token: TokenId,
        amount: U128,
        purpose: String,
    },

    #[event_version("1.0.0")]
    LaneConfigured {
        lane: LaneId,
        token: TokenId,
        small_max: U128,
        medium_max: U128,
        period_cap: U128,
    },

    #[event_version("1.0.0")]
    LaneRemoved { lane: LaneId },

    #[event_version("1.0.0")]
    RecordStepsSet {
        lane: LaneId,
        steps: Vec<RecordStep>,
    },

    #[event_version("1.0.0")]
    RecordsSeeded { accounts: u32, points: u32 },

    #[event_version("1.0.0")]
    PayoutFiled {
        id: PayoutId,
        lane: LaneId,
        filer: AccountId,
        recipient: AccountId,
        token: TokenId,
        amount: U128,
        tier: Tier,
        /// Small: end of objection window. Medium: escalation timeout.
        deadline_ns: U64,
    },

    #[event_version("1.0.0")]
    PayoutCancelled { id: PayoutId, by: AccountId },

    #[event_version("1.0.0")]
    PayoutObjected {
        id: PayoutId,
        by: AccountId,
        reason: String,
    },

    #[event_version("1.0.0")]
    PayoutApproved { id: PayoutId, by: AccountId },

    #[event_version("1.0.0")]
    PayoutEscalated {
        id: PayoutId,
        proposal_id: U64,
        bond: U128,
    },

    /// The DAO proposal could not be filed; a member must file it by hand.
    #[event_version("1.0.0")]
    EscalationFailed { id: PayoutId, reason: String },

    #[event_version("1.0.0")]
    PayoutSending { id: PayoutId },

    #[event_version("1.0.0")]
    PayoutPaid {
        id: PayoutId,
        recipient: AccountId,
        token: TokenId,
        amount: U128,
    },

    #[event_version("1.0.0")]
    PayoutFailed { id: PayoutId, reason: String },

    #[event_version("1.0.0")]
    EscalationSettled {
        id: PayoutId,
        proposal_id: U64,
        approved: bool,
    },

    #[event_version("1.0.0")]
    StandingAdded {
        id: StandingId,
        recipient: AccountId,
        token: TokenId,
        amount: U128,
        period_ns: U64,
        notice_periods: u32,
        notice_locked: U128,
    },

    #[event_version("1.0.0")]
    StandingFunded { id: StandingId, amount: U128 },

    #[event_version("1.0.0")]
    StandingPaid {
        id: StandingId,
        periods: u32,
        amount: U128,
        from_notice: bool,
    },

    /// A payment is due but the buffer can't cover it; it stays due.
    #[event_version("1.0.0")]
    StandingShort {
        id: StandingId,
        due: U128,
        buffer: U128,
    },

    /// A standing transfer failed; the money went back and the periods are due again.
    #[event_version("1.0.0")]
    StandingFailed { id: StandingId, reason: String },

    #[event_version("1.0.0")]
    StandingStopped { id: StandingId, notice_periods: u32 },

    #[event_version("1.0.0")]
    StandingEnded { id: StandingId, released: U128 },

    /// The DAO settled a transfer whose callback never ran.
    #[event_version("1.0.0")]
    StuckResolved { kind: String, id: U64, paid: bool },

    #[event_version("1.0.0")]
    Withdrawn {
        token: TokenId,
        amount: U128,
        to: AccountId,
    },

    #[event_version("1.0.0")]
    Paused {},

    #[event_version("1.0.0")]
    Unpaused {},

    #[event_version("1.0.0")]
    BondFloatSet { amount: U128 },

    #[event_version("1.0.0")]
    FilingDepositSet { amount: U128 },

    #[event_version("1.0.0")]
    CouncilSynced { members: Vec<AccountId> },
}
