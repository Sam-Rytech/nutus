//! The slice of Sputnik DAO v2's JSON interface that the instance reads and writes.
//! Field names and enum tagging match `sputnikdao2/src` (verified 2026-11-08).
//! Unknown fields are ignored on deserialize, so only what Nutus needs is listed.

use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

/// Sputnik uses `""` as the token id for native NEAR in `Transfer` proposals.
pub const SPUTNIK_NEAR_TOKEN: &str = "";

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub enum RoleKind {
    Everyone,
    Member(U128),
    Group(Vec<AccountId>),
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct RolePermission {
    pub name: String,
    pub kind: RoleKind,
    /// e.g. `"*:AddProposal"`, `"transfer:VoteApprove"`.
    pub permissions: Vec<String>,
}

/// Subset of `get_policy()`.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Policy {
    pub roles: Vec<RolePermission>,
    pub proposal_bond: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProposalStatus {
    InProgress,
    Approved,
    Rejected,
    Removed,
    Expired,
    Moved,
    Failed,
}

/// Subset of `get_proposal(id)`. (Sputnik returns `id` as a bare JSON number,
/// not a `U64` string; it isn't needed, so it isn't read.)
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Proposal {
    pub status: ProposalStatus,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub enum ProposalKind {
    Transfer {
        token_id: String,
        receiver_id: AccountId,
        amount: U128,
        msg: Option<String>,
    },
}

/// Argument of `add_proposal(proposal)`.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct ProposalInput {
    pub description: String,
    pub kind: ProposalKind,
}
