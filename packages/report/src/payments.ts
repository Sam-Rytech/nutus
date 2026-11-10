// Turns Sputnik proposals into payments. A payment is either a `Transfer`
// proposal or a `FunctionCall` on a token whose actions include
// `ft_transfer` / `ft_transfer_call` (how bulk and "fixed" payments are filed).

import type { Proposal, ProposalStatus } from "@nutus/core";

export interface Payment {
  dao: string;
  proposalId: number;
  /** `near` for native NEAR, else the token contract. */
  token: string;
  recipient: string;
  amount: bigint;
  status: ProposalStatus;
  /** Nanoseconds. */
  submitted: bigint;
  votes: number;
  via: "Transfer" | "FunctionCall";
}

/** Base64 JSON → value, in Node and the browser alike. */
const decode = (b64: string): unknown => {
  try {
    const bin = atob(b64);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
};

export function paymentsOf(dao: string, p: Proposal): Payment[] {
  const base = {
    dao,
    proposalId: p.id,
    status: p.status,
    submitted: BigInt(p.submission_time),
    votes: Object.keys(p.votes ?? {}).length,
  };
  const kind = p.kind as Record<string, Record<string, unknown>>;
  if (kind.Transfer) {
    const t = kind.Transfer as { token_id: string; receiver_id: string; amount: string };
    return [{ ...base, token: t.token_id === "" ? "near" : t.token_id, recipient: t.receiver_id, amount: BigInt(t.amount), via: "Transfer" }];
  }
  if (kind.FunctionCall) {
    const fc = kind.FunctionCall as { receiver_id: string; actions: { method_name: string; args: string }[] };
    const out: Payment[] = [];
    for (const a of fc.actions ?? []) {
      if (a.method_name !== "ft_transfer" && a.method_name !== "ft_transfer_call") continue;
      const args = decode(a.args) as { receiver_id?: string; amount?: string } | null;
      if (!args?.receiver_id || !args.amount || !/^\d+$/.test(args.amount)) continue;
      out.push({ ...base, token: fc.receiver_id, recipient: args.receiver_id, amount: BigInt(args.amount), via: "FunctionCall" });
    }
    return out;
  }
  return [];
}

/**
 * The payment a proposal makes, if it makes exactly one: a `Transfer`, or a
 * `FunctionCall` with a single `ft_transfer(_call)`. Bulk proposals (many
 * transfers in one vote) are a different flow and would let one DAO's batch
 * swamp per-payment rates, so F1/F2 leave them out.
 */
export function singlePayment(dao: string, p: Proposal): Payment | null {
  const ps = paymentsOf(dao, p);
  return ps.length === 1 ? ps[0]! : null;
}

/** Expired, or still InProgress after its voting period ended (never finalized). */
export function lapsed(status: ProposalStatus, submitted: bigint, proposalPeriod: bigint, now: bigint): boolean {
  return status === "Expired" || (status === "InProgress" && submitted + proposalPeriod < now);
}

/** The amount at or below which a payment counts as "small" for its DAO and token: the median. */
export function smallCutoffs(payments: Payment[]): Map<string, bigint> {
  const by = new Map<string, bigint[]>();
  for (const p of payments) {
    const k = `${p.dao}|${p.token}`;
    by.set(k, [...(by.get(k) ?? []), p.amount]);
  }
  const out = new Map<string, bigint>();
  for (const [k, xs] of by) {
    xs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    out.set(k, xs[Math.floor((xs.length - 1) / 2)]!);
  }
  return out;
}
