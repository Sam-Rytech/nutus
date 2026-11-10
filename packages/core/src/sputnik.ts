// Sputnik DAO v2 JSON shapes (sputnikdao2/src/policy.rs, proposals.rs).

/** `Weight(n)` serialises as a U128 string, `Ratio(num, den)` as a pair. */
export type WeightOrRatio = string | [number, number];

export interface VotePolicy {
  weight_kind: "RoleWeight" | "TokenWeight";
  quorum: string;
  threshold: WeightOrRatio;
}

export type RoleKind = "Everyone" | { Member: string } | { Group: string[] };

export interface Role {
  name: string;
  kind: RoleKind;
  /** `<proposal kind>:<action>`, e.g. `transfer:VoteApprove`, `*:AddProposal`. */
  permissions: string[];
  vote_policy: Record<string, VotePolicy>;
}

export interface Policy {
  roles: Role[];
  default_vote_policy: VotePolicy;
  proposal_bond: string;
  proposal_period: string;
  bounty_bond: string;
  bounty_forgiveness_period: string;
}

export type ProposalStatus = "InProgress" | "Approved" | "Rejected" | "Removed" | "Expired" | "Moved" | "Failed";

export interface ActionCall {
  method_name: string;
  /** Base64 of the JSON arguments. */
  args: string;
  deposit: string;
  gas: string;
}

export type ProposalKind =
  | { Transfer: { token_id: string; receiver_id: string; amount: string; msg: string | null } }
  | { FunctionCall: { receiver_id: string; actions: ActionCall[] } }
  | { AddMemberToRole: { member_id: string; role: string } }
  | { RemoveMemberFromRole: { member_id: string; role: string } }
  | { ChangePolicyAddOrUpdateRole: { role: Role } }
  | Record<string, unknown>;

export interface ProposalInput {
  description: string;
  kind: ProposalKind;
}

export interface Proposal extends ProposalInput {
  id: number;
  proposer: string;
  status: ProposalStatus;
  vote_counts: Record<string, [string, string, string] | [number, number, number]>;
  /** account → "Approve" | "Reject" | "Remove" */
  votes: Record<string, string>;
  submission_time: string;
}

/** Sputnik's label for each proposal kind in permission strings. */
export const KIND_LABEL = {
  Transfer: "transfer",
  FunctionCall: "call",
  AddMemberToRole: "add_member_to_role",
  RemoveMemberFromRole: "remove_member_from_role",
  ChangePolicy: "policy",
  ChangePolicyAddOrUpdateRole: "policy_add_or_update_role",
} as const;

export const groupMembers = (role: Role): string[] | null =>
  typeof role.kind === "object" && "Group" in role.kind ? role.kind.Group : null;

/** Does `role` allow `action` on proposals of `kind` (labels as in permissions)? */
export function roleAllows(role: Role, kind: string, action: string): boolean {
  return role.permissions.some((p) => {
    const [k, a] = p.split(":");
    return (k === "*" || k === kind) && (a === "*" || a === action);
  });
}

/** Can `account` do `action` on `kind` proposals under this policy? */
export function can(policy: Policy, account: string, kind: string, action: string): boolean {
  return policy.roles.some(
    (r) => roleAllows(r, kind, action) && (r.kind === "Everyone" || (groupMembers(r)?.includes(account) ?? false)),
  );
}
