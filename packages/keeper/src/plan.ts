// Pure rules: given what's on chain and the time, which calls are due.
// Mirrors the contract's own checks, so the keeper doesn't spend gas on
// calls that would be refused.

import type { Action, Payout, Snapshot } from "./types.ts";

/** Prepaid gas per call (TGas), with headroom over the contract's static gas. */
export const GAS = {
  release: 100, // transfer batch 20 + on_sent 20
  escalate: 200, // get_policy 10 + on_policy 70 (add_proposal 30 + callback 20)
  pay_due: 100,
  settle_escalation: 60, // get_proposal 10 + callback 20
} as const;

const statusName = (p: Payout): string =>
  typeof p.status === "string" ? p.status : Object.keys(p.status)[0]!;

export function planPayouts(s: Snapshot, now: bigint): Action[] {
  const out: Action[] = [];
  for (const p of s.payouts) {
    const due = now >= BigInt(p.deadline_ns);
    if (p.status === "Waiting" && due) {
      if (p.tier === "Small" && !s.config.paused) {
        out.push({ kind: "release", instance: s.instance, id: p.id, tgas: GAS.release, why: "objection window passed" });
      } else if (p.tier === "Medium") {
        out.push({ kind: "escalate", instance: s.instance, id: p.id, tgas: GAS.escalate, why: "medium not approved in time" });
      }
    }
    if (statusName(p) === "Escalated") {
      const pid = (p.status as { Escalated: { proposal_id: string } }).Escalated.proposal_id;
      const st = s.proposals.get(pid);
      if (st && st !== "InProgress") {
        out.push({ kind: "settle_escalation", instance: s.instance, id: p.id, tgas: GAS.settle_escalation, why: `DAO proposal ${pid} is ${st}` });
      }
    }
    // Objected with needs_manual_filing is left for people: retrying while the
    // bond float is short would just burn gas. Notifications surface it.
  }
  return out;
}

export function planStanding(s: Snapshot, now: bigint): Action[] {
  const out: Action[] = [];
  for (const st of s.standing) {
    if (st.in_flight !== null || st.state === "Ended") continue;
    const noticed = typeof st.state === "object";
    if (!noticed && s.config.paused) continue; // notice pays even while paused
    const nextDue = BigInt(st.next_due_ns);
    const finished = st.ends_at_ns !== null && nextDue >= BigInt(st.ends_at_ns);
    if (finished) {
      out.push({ kind: "pay_due", instance: s.instance, id: st.id, tgas: GAS.pay_due, why: "past end date: close it" });
      continue;
    }
    if (now < nextDue) continue;
    // A short buffer just emits standing_short and changes nothing; skip it
    // until the DAO tops up, instead of paying gas every round.
    if (!noticed && BigInt(st.buffer) < BigInt(st.amount)) continue;
    out.push({ kind: "pay_due", instance: s.instance, id: st.id, tgas: GAS.pay_due, why: noticed ? "notice payment due" : "payment due" });
  }
  return out;
}

export function plan(s: Snapshot, now: bigint): Action[] {
  return [...planPayouts(s, now), ...planStanding(s, now)];
}

