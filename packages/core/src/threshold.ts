// Vote-threshold maths, matching sputnikdao2 `policy.rs` (spec fact V6):
//   Weight(n)        → min(n, total)
//   Ratio(num, den)  → min(num * total / den + 1, total)
//   required         = max(quorum, the above)
// For RoleWeight policies `total` is the role's group size.

import { groupMembers, roleAllows, type Policy, type Role, type VotePolicy } from "./sputnik.ts";

export function thresholdVotes(policy: VotePolicy, total: number): number {
  const t = policy.threshold;
  const base = Array.isArray(t)
    ? Math.min(Math.floor((t[0] * total) / t[1]) + 1, total)
    : Math.min(Number(BigInt(t)), total);
  return Math.max(Number(BigInt(policy.quorum)), base);
}

/** The vote policy a role uses for a proposal kind (`transfer`, `call`, …). */
export function votePolicyFor(policy: Policy, role: Role, kind: string): VotePolicy {
  return role.vote_policy[kind] ?? policy.default_vote_policy;
}

export interface RoleHealth {
  role: string;
  members: string[];
  /** Approve votes needed to pass a proposal of this kind. */
  required: number;
  /** Members still voting (not in `silent`). */
  active: number;
  /** How many more members can go silent before nothing can pass. Negative = frozen. */
  freezeDistance: number;
  frozen: boolean;
}

/**
 * For each Group role that can approve `kind` proposals: how close it is to
 * being unable to pass anything, given which members have gone silent.
 * Token-weighted roles can't be assessed from the policy and are skipped.
 */
export function roleHealth(policy: Policy, silent: Iterable<string>, kind = "transfer"): RoleHealth[] {
  const quiet = new Set(silent);
  const out: RoleHealth[] = [];
  for (const role of policy.roles) {
    const members = groupMembers(role);
    if (!members || !roleAllows(role, kind, "VoteApprove")) continue;
    const vp = votePolicyFor(policy, role, kind);
    if (vp.weight_kind !== "RoleWeight") continue;
    const required = thresholdVotes(vp, members.length);
    const active = members.filter((m) => !quiet.has(m)).length;
    out.push({
      role: role.name,
      members,
      required,
      active,
      freezeDistance: active - required,
      frozen: active < required,
    });
  }
  return out;
}

/** The DAO can still pass `kind` proposals if any approving role can. */
export function daoFrozen(health: RoleHealth[]): boolean {
  return health.length > 0 && health.every((h) => h.frozen);
}
