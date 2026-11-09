// One keeper round: read each instance, plan, call. Idempotent: the contract
// refuses anything not due (or already done), and those refusals are
// reported as skipped, not failures.

import { plan } from "./plan.ts";
import type { Action, InstanceConfig, Payout, ProposalStatus, Snapshot, Standing } from "./types.ts";

export interface Chain {
  view<T>(contractId: string, method: string, args?: Record<string, unknown>): Promise<T>;
  call(contractId: string, method: string, args: Record<string, unknown>, tgas: number): Promise<unknown>;
}

/** Contract errors that mean "someone already did it" or "not due any more". */
export const BENIGN = [
  "ALREADY_SENT",
  "ALREADY_SENDING",
  "NOT_WAITING",
  "WINDOW_OPEN",
  "NOT_TIMED_OUT",
  "CANNOT_ESCALATE",
  "NOT_ESCALATED",
  "PROPOSAL_IN_PROGRESS",
  "PAUSED",
];

const PAGE = 100;

export async function snapshot(chain: Chain, instance: string): Promise<Snapshot> {
  const config = await chain.view<InstanceConfig>(instance, "get_config");
  const payouts: Payout[] = [];
  for (let from = 0; ; from += PAGE) {
    const page = await chain.view<Payout[]>(instance, "get_payouts", { from_index: String(from), limit: PAGE });
    payouts.push(...page);
    if (page.length < PAGE) break;
  }
  const standing: Standing[] = [];
  for (let from = 0; ; from += PAGE) {
    const page = await chain.view<Standing[]>(instance, "get_standing", { from_index: String(from), limit: PAGE });
    standing.push(...page);
    if (page.length < PAGE) break;
  }
  const proposals = new Map<string, ProposalStatus>();
  for (const p of payouts) {
    if (typeof p.status === "object" && "Escalated" in p.status) {
      const id = p.status.Escalated.proposal_id;
      const proposal = await chain.view<{ status: ProposalStatus }>(config.dao, "get_proposal", { id: Number(id) });
      proposals.set(id, proposal.status);
    }
  }
  return { instance, config, payouts, standing, proposals };
}

export interface RoundResult {
  done: Action[];
  skipped: { action: Action; reason: string }[];
  failed: { action: Action; error: string }[];
}

const argName = (a: Action) => (a.kind === "pay_due" ? "standing_id" : "payout_id");

export async function runRound(chain: Chain, instances: string[], now: bigint): Promise<RoundResult> {
  const result: RoundResult = { done: [], skipped: [], failed: [] };
  for (const instance of instances) {
    let snap: Snapshot;
    try {
      snap = await snapshot(chain, instance);
    } catch (e) {
      result.failed.push({
        action: { kind: "release", instance, id: "-", tgas: 0, why: "snapshot" },
        error: String(e),
      });
      continue;
    }
    for (const action of plan(snap, now)) {
      try {
        await chain.call(instance, action.kind, { [argName(action)]: action.id }, action.tgas);
        result.done.push(action);
      } catch (e) {
        const msg = String(e instanceof Error ? e.message : e);
        const benign = BENIGN.find((b) => msg.includes(b));
        if (benign) result.skipped.push({ action, reason: benign });
        else result.failed.push({ action, error: msg });
      }
    }
  }
  return result;
}

/** Instances to serve: an explicit list, or every instance the factory made. */
export async function discover(chain: Chain, explicit: string[], factory?: string): Promise<string[]> {
  if (explicit.length > 0) return explicit;
  if (!factory) return [];
  const all: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const page = await chain.view<{ dao: string; instance: string }[]>(factory, "list_instances", {
      from_index: String(from),
      limit: PAGE,
    });
    all.push(...page.map((e) => e.instance));
    if (page.length < PAGE) break;
  }
  return all;
}
