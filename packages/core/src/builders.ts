// Proposal builders: ready-to-file Sputnik `add_proposal` inputs for every
// DAO-side Nutus action. Shapes match what the contracts and Sputnik accept
// (the same JSON the sandbox suite and testnet scripts file).

import type { LaneConfig, RecordStep, SeedEntry, SetupConfig, StandingInput } from "./generated/instance.ts";
import { b64json } from "./rpc.ts";
import { can, KIND_LABEL, type ActionCall, type Policy, type ProposalInput, type Role } from "./sputnik.ts";

/** NEP-145 registration on USDC / USDT (verified on mainnet). */
export const FT_STORAGE_DEPOSIT = "1250000000000000000000";
/** Factory default: NEAR given to each new instance account. */
export const INSTANCE_STORAGE = "250000000000000000000000";
const TGAS = 1_000_000_000_000n;

export const action = (method_name: string, args: unknown, deposit: string | bigint | number = "0", tgas = 30): ActionCall => ({
  method_name,
  args: b64json(args),
  deposit: String(deposit),
  gas: String(BigInt(tgas) * TGAS),
});

const call = (receiver_id: string, description: string, actions: ActionCall[]): ProposalInput => ({
  description,
  kind: { FunctionCall: { receiver_id, actions } },
});

/** `x.sputnik-dao.near` + `nutus.near` → `x.nutus.near` (the factory's rule). */
export const instanceAccount = (dao: string, factory: string): string => `${dao.split(".")[0]}.${factory}`;

// ───────────────────────────── setup ─────────────────────────────

/**
 * Token budget (USDC/USDT): one proposal, two actions on the token.
 * 1. register the instance account with the token (it doesn't exist yet);
 * 2. send the budget to the factory with the setup config.
 */
export function setupWithToken(p: { dao: string; factory: string; token: string; amount: string; config: SetupConfig }): ProposalInput {
  const inst = instanceAccount(p.dao, p.factory);
  return call(p.token, `Set up Nutus (${inst}): ${p.config.lanes.map((l) => l.name).join(", ")}`, [
    action("storage_deposit", { account_id: inst, registration_only: true }, FT_STORAGE_DEPOSIT, 10),
    action("ft_transfer_call", { receiver_id: p.factory, amount: p.amount, msg: `setup:${JSON.stringify(p.config)}` }, 1, 250),
  ]);
}

/** NEAR budget: `create` on the factory with storage + budget attached. */
export function setupWithNear(p: { dao: string; factory: string; budgetYocto: string; config: SetupConfig; instanceStorage?: string }): ProposalInput {
  const deposit = BigInt(p.budgetYocto) + BigInt(p.instanceStorage ?? INSTANCE_STORAGE);
  return call(p.factory, `Set up Nutus (${instanceAccount(p.dao, p.factory)}) with a NEAR budget`, [
    action("create", { config: p.config }, deposit, 250),
  ]);
}

/**
 * Only for DAOs whose policy restricts AddProposal: lets the instance file
 * escalations. Adds a `nutus` role with just `transfer:AddProposal`.
 */
export function grantEscalationRole(instance: string): ProposalInput {
  const role: Role = { name: "nutus", kind: { Group: [instance] }, permissions: [`${KIND_LABEL.Transfer}:AddProposal`], vote_policy: {} };
  return { description: `Let ${instance} file escalated payouts as proposals`, kind: { ChangePolicyAddOrUpdateRole: { role } } };
}

/** Does setup need the extra role proposal (spec V4)? */
export const needsEscalationRole = (policy: Policy, instance: string): boolean =>
  !can(policy, instance, KIND_LABEL.Transfer, "AddProposal");

// ─────────────────── DAO-only instance methods ───────────────────

const onInstance = (instance: string, description: string, method: string, args: unknown, deposit: string | bigint = "0") =>
  call(instance, description, [action(method, args, deposit, 150)]);

export const configureLane = (instance: string, lane: LaneConfig) =>
  onInstance(instance, `Nutus: configure lane "${lane.name}"`, "configure_lane", { lane });
export const removeLane = (instance: string, lane_id: string) =>
  onInstance(instance, `Nutus: remove lane ${lane_id}`, "remove_lane", { lane_id });
export const setRecordSteps = (instance: string, lane_id: string, steps: RecordStep[]) =>
  onInstance(instance, `Nutus: set record steps for lane ${lane_id}`, "set_record_steps", { lane_id, steps });
export const seedRecords = (instance: string, entries: SeedEntry[]) =>
  onInstance(instance, `Nutus: import ${entries.reduce((n, e) => n + e.proposal_ids.length, 0)} past payments as track records`, "seed_records", { entries });
export const addStanding = (instance: string, standing: StandingInput) =>
  onInstance(instance, `Nutus: recurring payment to ${standing.recipient} with ${standing.notice_periods} period(s) notice`, "add_standing", { standing });
export const stopStanding = (instance: string, standing_id: string) =>
  onInstance(instance, `Nutus: stop recurring payment #${standing_id} (notice starts)`, "stop_standing", { standing_id });
export const pause = (instance: string) => onInstance(instance, "Nutus: pause", "pause", {});
export const unpause = (instance: string) => onInstance(instance, "Nutus: unpause", "unpause", {});
export const withdraw = (instance: string, token: string, amount: string, to: string | null = null) =>
  onInstance(instance, `Nutus: withdraw ${amount} of ${token}`, "withdraw", { token, amount, to });
export const cancelPayout = (instance: string, payout_id: string) =>
  onInstance(instance, `Nutus: cancel payout #${payout_id}`, "cancel_payout", { payout_id });
export const fundNear = (instance: string, yocto: string) =>
  onInstance(instance, "Nutus: add NEAR budget", "fund_near", {}, yocto);
export const fundStandingNear = (instance: string, standing_id: string, yocto: string) =>
  onInstance(instance, `Nutus: fund recurring payment #${standing_id}`, "fund_standing_near", { standing_id }, yocto);
export const resolveStuckPayout = (instance: string, payout_id: string, paid: boolean) =>
  onInstance(instance, `Nutus: settle stuck payout #${payout_id} as ${paid ? "paid" : "not paid"}`, "resolve_stuck_payout", { payout_id, paid });

// ───────────────────────── token funding ─────────────────────────

/** Top up the lane budget in a token (the instance is already registered). */
export const fundWithToken = (token: string, instance: string, amount: string): ProposalInput =>
  call(token, "Nutus: add budget", [action("ft_transfer_call", { receiver_id: instance, amount, msg: "fund" }, 1, 100)]);

export const fundStandingWithToken = (token: string, instance: string, standing_id: string, amount: string): ProposalInput =>
  call(token, `Nutus: fund recurring payment #${standing_id}`, [
    action("ft_transfer_call", { receiver_id: instance, amount, msg: `fund_standing:${standing_id}` }, 1, 100),
  ]);

// ───────────────────────────── seats ─────────────────────────────
// Seat watch drafts these; a person files them. Nutus never removes anyone.

export const removeMember = (member_id: string, role: string, why: string): ProposalInput => ({
  description: `Remove ${member_id} from ${role}: ${why}`,
  kind: { RemoveMemberFromRole: { member_id, role } },
});

export const addMember = (member_id: string, role: string, why: string): ProposalInput => ({
  description: `Add ${member_id} to ${role}: ${why}`,
  kind: { AddMemberToRole: { member_id, role } },
});

/** Arguments for `add_proposal` on the DAO; attach the DAO's `proposal_bond`. */
export const addProposalArgs = (proposal: ProposalInput) => ({ proposal });
