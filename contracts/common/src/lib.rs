//! Types shared by the Nutus instance and the factory.
//!
//! JSON conventions (ARCHITECTURE §10): token amounts are `U128` strings in
//! base units, times and durations are `U64` strings in nanoseconds.

use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId};

/// `"near"` for native NEAR, otherwise the NEP-141 token contract account.
pub type TokenId = String;
/// Short DAO-chosen slug, e.g. `"design"`.
pub type LaneId = String;

pub const NEAR_TOKEN_ID: &str = "near";

/// 48 hours.
pub const DEFAULT_WINDOW_NS: u64 = 48 * 3_600 * 1_000_000_000;
/// 7 days.
pub const DEFAULT_MEDIUM_TIMEOUT_NS: u64 = 7 * 86_400 * 1_000_000_000;
/// 30 days.
pub const DEFAULT_PERIOD_NS: u64 = 30 * 86_400 * 1_000_000_000;
/// 90 days: after an objection, record step-ups pause for this long.
pub const DEFAULT_OBJECTION_COOLDOWN_NS: u64 = 90 * 86_400 * 1_000_000_000;
/// 0.1 NEAR anti-spam deposit on `file_payout`.
pub const DEFAULT_FILING_DEPOSIT: u128 = 100_000_000_000_000_000_000_000;

/// Who may call `file_payout` on a lane.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub enum Filers {
    Anyone,
    Members(Vec<AccountId>),
    /// Members of this role in the DAO policy (refreshed by `sync_council`).
    DaoMembersOfRole(String),
}

/// One rung of the track-record ladder: once a recipient has at least
/// `min_paid_jobs` paid jobs, Small payouts up to `small_max` are allowed.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct RecordStep {
    pub min_paid_jobs: u32,
    pub small_max: U128,
}

/// Lane as the DAO submits it. Optional fields take the defaults above.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct LaneConfig {
    pub id: LaneId,
    pub name: String,
    pub token: TokenId,
    /// Small: amount ≤ small_max (and ≤ the recipient's record step).
    pub small_max: U128,
    /// Medium: small_max < amount ≤ medium_max. Above → full DAO vote.
    pub medium_max: U128,
    /// Total Small + Medium payouts allowed per period.
    pub period_cap: U128,
    pub period_ns: Option<U64>,
    pub window_ns: Option<U64>,
    pub medium_timeout_ns: Option<U64>,
    /// `None` = the whole council may object / approve.
    pub objectors: Option<Vec<AccountId>>,
    pub filers: Filers,
    /// Whether council seats flagged silent may still object. Default true.
    pub silent_can_object: Option<bool>,
    /// Track-record ladder for this lane. Empty = no record limit.
    pub record_steps: Option<Vec<RecordStep>>,
}

/// Passed to the instance's `new` (by the factory) during setup.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Default)]
pub struct SetupConfig {
    pub lanes: Vec<LaneConfig>,
    /// Initial council. `None` = read from the DAO policy on first `sync_council`.
    pub council: Option<Vec<AccountId>>,
    /// Anti-spam deposit for `file_payout`, in yoctoNEAR.
    pub filing_deposit: Option<U128>,
    pub objection_cooldown_ns: Option<U64>,
}
