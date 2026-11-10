// Drafts that turn a DAO's own history into Nutus setup proposals: track
// records seeded from past payments, and recurring pay from repeat series.
// Pure, so the report screen and tests share exactly the same JSON.

import type { Instance, Proposal } from "@nutus/core";
import { singlePayment } from "./payments.ts";
import type { RepeatSeries } from "./metrics.ts";

/** Median of bigint values; `0n` for an empty list. */
export function medianBig(xs: bigint[]): bigint {
  if (xs.length === 0) return 0n;
  const s = [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2n;
}

/**
 * One `seed_records` entry per recipient that an approved single payment
 * paid, listing the proposals that paid them. The contract checks every id
 * against the DAO, so rejected, expired and bulk proposals stay out.
 */
export function recordsFromHistory(dao: string, proposals: Proposal[]): Instance.SeedEntry[] {
  const by = new Map<string, string[]>();
  for (const p of proposals) {
    const pay = singlePayment(dao, p);
    if (!pay || pay.status !== "Approved") continue;
    by.set(pay.recipient, [...(by.get(pay.recipient) ?? []), String(p.id)]);
  }
  return [...by]
    .map(([account, ids]) => ({ account, proposal_ids: ids.sort((a, b) => Number(a) - Number(b)) }))
    .sort((a, b) => (a.account < b.account ? -1 : a.account > b.account ? 1 : 0));
}

/**
 * The recurring payment a repeat series suggests: the amount it paid every
 * time, a period equal to the median gap between payments, and the next
 * payment one period after the last one.
 */
export function standingFromSeries(s: RepeatSeries): Instance.StandingInput {
  const times = [...s.submitted].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const gaps: bigint[] = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i]! - times[i - 1]!);
  const period = medianBig(gaps);
  const last = times[times.length - 1]!;
  return {
    recipient: s.recipient,
    token: s.token,
    amount: String(s.amount),
    period_ns: String(period),
    first_due_ns: String(last + period),
    notice_periods: 1,
    memo: `Recurring pay for ${s.recipient}`,
  };
}
