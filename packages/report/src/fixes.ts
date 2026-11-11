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

/** `ft_transfer_call` hands tokens to a contract to act on (funding, deposits, swaps): not pay for work. */
const callsAContract = (p: Proposal): boolean => {
  const fc = (p.kind as { FunctionCall?: { actions?: { method_name: string }[] } }).FunctionCall;
  return !!fc?.actions?.some((a) => a.method_name === "ft_transfer_call");
};

/**
 * One `seed_records` entry per recipient that an approved single payment
 * paid, listing the proposals that paid them. Rejected, expired and bulk
 * proposals stay out, and so do payments into contracts. The contract trusts
 * these ids (the DAO's vote on the seed is the check), so the draft has to be
 * right: every id is an approved payment to that account.
 */
export function recordsFromHistory(dao: string, proposals: Proposal[]): Instance.SeedEntry[] {
  const by = new Map<string, string[]>();
  for (const p of proposals) {
    const pay = singlePayment(dao, p);
    if (!pay || pay.status !== "Approved" || callsAContract(p)) continue;
    by.set(pay.recipient, [...(by.get(pay.recipient) ?? []), String(p.id)]);
  }
  return [...by]
    .map(([account, ids]) => ({ account, proposal_ids: ids.sort((a, b) => Number(a) - Number(b)) }))
    .sort((a, b) => (a.account < b.account ? -1 : a.account > b.account ? 1 : 0));
}

/** Shortest gap between payments that still reads as recurring pay. */
export const MIN_STANDING_PERIOD_NS = 7n * 86_400n * 1_000_000_000n;

/** Median gap between a series' payments, in ns. */
export const seriesPeriod = (s: RepeatSeries): bigint => {
  const times = [...s.submitted].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const gaps: bigint[] = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i]! - times[i - 1]!);
  return medianBig(gaps);
};

/** Series paid at least a week apart; closer repeats are batches, not a salary. */
export const recurringSeries = (series: RepeatSeries[]): RepeatSeries[] => series.filter((s) => seriesPeriod(s) >= MIN_STANDING_PERIOD_NS);

/**
 * The recurring payment a repeat series suggests: the amount it paid every
 * time, a period equal to the median gap between payments, and the next
 * payment one period after the last one. With `now`, the first payment is the
 * first such date after `now`: the contract pays every period that has already
 * elapsed at once, so a date in the past would back-pay.
 */
export function standingFromSeries(s: RepeatSeries, now?: bigint): Instance.StandingInput {
  const times = [...s.submitted].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const gaps: bigint[] = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i]! - times[i - 1]!);
  const period = medianBig(gaps);
  const last = times[times.length - 1]!;
  let first = last + period;
  if (now !== undefined && period > 0n && first <= now) first += ((now - first) / period + 1n) * period;
  return {
    recipient: s.recipient,
    token: s.token,
    amount: String(s.amount),
    period_ns: String(period),
    first_due_ns: String(first),
    notice_periods: 1,
    memo: `Recurring pay for ${s.recipient}`,
  };
}

/** The instance's `MAX_SEED_POINTS`: proposal ids one `seed_records` call accepts. */
export const MAX_SEED_POINTS = 200;

/**
 * Splits seed entries into batches of at most `max` proposal ids, one
 * `seed_records` proposal each, so no batch fails with TOO_MANY_POINTS after
 * the vote. A recipient with more ids than fit is split across batches.
 */
export function seedBatches(entries: Instance.SeedEntry[], max = MAX_SEED_POINTS): Instance.SeedEntry[][] {
  const out: Instance.SeedEntry[][] = [];
  let batch: Instance.SeedEntry[] = [];
  let room = max;
  for (const e of entries) {
    let ids = e.proposal_ids;
    while (ids.length > 0) {
      if (room === 0) { out.push(batch); batch = []; room = max; }
      const take = ids.slice(0, room);
      batch.push({ account: e.account, proposal_ids: take });
      room -= take.length;
      ids = ids.slice(take.length);
    }
  }
  if (batch.length > 0) out.push(batch);
  return out;
}
