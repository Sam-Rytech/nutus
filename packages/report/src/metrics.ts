// F1–F5 over one or many DAOs' proposal history. Pure: no network.
// Definitions are in packages/report/DEFINITIONS.md and repeated in comments.

import { roleHealth, groupMembers, roleAllows, type Policy, type Proposal } from "@nutus/core";
import { lapsed, singlePayment, smallCutoffs, type Payment } from "./payments.ts";

export const DAY = 86_400n * 1_000_000_000n;

export interface DaoHistory {
  dao: string;
  policy: Policy;
  /** Proposals submitted inside the scan window (ascending id). */
  proposals: Proposal[];
}

export interface ScanWindow {
  /** Scan time, ns. */
  now: bigint;
  /** Window start, ns. */
  from: bigint;
}

// ───────────────────── F1: small payouts lapse ─────────────────────

export interface F1 {
  smallPayments: number;
  smallLapsed: number;
  largePayments: number;
  largeLapsed: number;
  /** Lapsed small payments that got zero votes from anyone. */
  smallLapsedZeroVotes: number;
  /** Recipients of a lapsed small payment never paid by that DAO afterwards (in the window). */
  neverRepaid: number;
  recipientsWithLapse: number;
  /** For recipients repaid later: median days from the lapsed proposal to the next approved payment's proposal. */
  medianDaysToRepay: number | null;
}

export function f1(histories: DaoHistory[], w: ScanWindow): F1 {
  const all: Payment[] = [];
  const period = new Map<string, bigint>();
  for (const h of histories) {
    period.set(h.dao, BigInt(h.policy.proposal_period));
    for (const p of h.proposals) {
      const pay = singlePayment(h.dao, p);
      if (pay) all.push(pay);
    }
  }
  // Only decided-or-lapsed payments count; open ones haven't had their chance.
  const settled = all.filter((p) => p.status !== "InProgress" || lapsed(p.status, p.submitted, period.get(p.dao)!, w.now));
  const cut = smallCutoffs(settled);
  const r: F1 = { smallPayments: 0, smallLapsed: 0, largePayments: 0, largeLapsed: 0, smallLapsedZeroVotes: 0, neverRepaid: 0, recipientsWithLapse: 0, medianDaysToRepay: null };
  const firstLapse = new Map<string, bigint>(); // dao|recipient → earliest small lapse
  for (const p of settled) {
    const small = p.amount <= cut.get(`${p.dao}|${p.token}`)!;
    const isLapsed = lapsed(p.status, p.submitted, period.get(p.dao)!, w.now);
    if (small) {
      r.smallPayments++;
      if (isLapsed) {
        r.smallLapsed++;
        if (p.votes === 0) r.smallLapsedZeroVotes++;
        const k = `${p.dao}|${p.recipient}`;
        if (!firstLapse.has(k) || p.submitted < firstLapse.get(k)!) firstLapse.set(k, p.submitted);
      }
    } else {
      r.largePayments++;
      if (isLapsed) r.largeLapsed++;
    }
  }
  const delays: number[] = [];
  for (const [k, t0] of firstLapse) {
    const [dao, recipient] = k.split("|");
    const next = settled
      .filter((p) => p.dao === dao && p.recipient === recipient && p.status === "Approved" && p.submitted > t0)
      .map((p) => p.submitted)
      .sort((a, b) => (a < b ? -1 : 1))[0];
    if (next === undefined) r.neverRepaid++;
    else delays.push(Number((next - t0) / (DAY / 10n)) / 10);
  }
  r.recipientsWithLapse = firstLapse.size;
  r.medianDaysToRepay = median(delays);
  return r;
}

// ───────────────────── F2: the same payment, again ─────────────────────

export interface F2 {
  approvedPayments: number;
  /** Approved payments that belong to a repeat series. */
  repeatPayments: number;
  /** (dao, recipient, token, amount) paid ≥ 3 times. */
  series: number;
  daosWithSeries: number;
}

/** A run of approved payments with the same recipient, token and amount, in submission order. */
export interface RepeatSeries {
  dao: string;
  recipient: string;
  token: string;
  amount: bigint;
  /** Proposal ids, oldest first. */
  proposalIds: string[];
  /** Submission times (ns), oldest first. */
  submitted: bigint[];
}

/** Approved single payments grouped by (dao, recipient, token, amount), keeping those paid 3+ times. */
export function repeatSeries(histories: DaoHistory[]): RepeatSeries[] {
  const groups = new Map<string, RepeatSeries>();
  for (const h of histories)
    for (const p of h.proposals) {
      const pay = singlePayment(h.dao, p);
      if (!pay || pay.status !== "Approved") continue;
      const k = `${pay.dao}|${pay.recipient}|${pay.token}|${pay.amount}`;
      const g = groups.get(k) ?? { dao: pay.dao, recipient: pay.recipient, token: pay.token, amount: pay.amount, proposalIds: [], submitted: [] };
      g.proposalIds.push(String(p.id));
      g.submitted.push(pay.submitted);
      groups.set(k, g);
    }
  return [...groups.values()]
    .filter((g) => g.proposalIds.length >= 3)
    .map((g) => {
      const order = g.proposalIds.map((_, i) => i).sort((a, b) => (g.submitted[a]! < g.submitted[b]! ? -1 : g.submitted[a]! > g.submitted[b]! ? 1 : 0));
      return { ...g, proposalIds: order.map((i) => g.proposalIds[i]!), submitted: order.map((i) => g.submitted[i]!) };
    })
    .sort((a, b) => `${a.dao}|${a.recipient}|${a.token}|${a.amount}`.localeCompare(`${b.dao}|${b.recipient}|${b.token}|${b.amount}`));
}

export function f2(histories: DaoHistory[]): F2 {
  let approved = 0;
  for (const h of histories)
    for (const p of h.proposals) {
      const pay = singlePayment(h.dao, p);
      if (pay && pay.status === "Approved") approved++;
    }
  const series = repeatSeries(histories);
  return {
    approvedPayments: approved,
    repeatPayments: series.reduce((s, g) => s + g.proposalIds.length, 0),
    series: series.length,
    daosWithSeries: new Set(series.map((g) => g.dao)).size,
  };
}

// ───────────────────── F3: silent seats ─────────────────────

export interface SeatStatus {
  dao: string;
  role: string;
  member: string;
  silent: boolean;
}

export interface F3 {
  /** Seats in Group roles that can approve transfers, in DAOs with something to vote on. */
  seats: number;
  silentSeats: number;
  /** Roles that can no longer reach their transfer threshold with their active members. */
  frozenRoles: number;
  /** Roles one more silent seat away from frozen. */
  oneAwayRoles: number;
  daosAssessed: number;
  /** DAOs where every transfer-approving role is frozen. */
  frozenDaos: number;
}

/** Silent = cast no vote on any proposal submitted in the last `days`, while the DAO had ≥ 3 such proposals. */
export function seatsOf(h: DaoHistory, w: ScanWindow, days = 60n): SeatStatus[] | null {
  const recent = h.proposals.filter((p) => BigInt(p.submission_time) >= w.now - days * DAY);
  if (recent.length < 3) return null;
  const voted = new Set(recent.flatMap((p) => Object.keys(p.votes ?? {})));
  const out: SeatStatus[] = [];
  for (const role of h.policy.roles) {
    const members = groupMembers(role);
    if (!members || !roleAllows(role, "transfer", "VoteApprove")) continue;
    for (const m of members) out.push({ dao: h.dao, role: role.name, member: m, silent: !voted.has(m) });
  }
  return out;
}

export function f3(histories: DaoHistory[], w: ScanWindow): F3 {
  const r: F3 = { seats: 0, silentSeats: 0, frozenRoles: 0, oneAwayRoles: 0, daosAssessed: 0, frozenDaos: 0 };
  for (const h of histories) {
    const seats = seatsOf(h, w);
    if (!seats) continue;
    r.daosAssessed++;
    r.seats += seats.length;
    const silent = seats.filter((s) => s.silent).map((s) => s.member);
    r.silentSeats += silent.length;
    const health = roleHealth(h.policy, silent);
    r.frozenRoles += health.filter((x) => x.frozen).length;
    r.oneAwayRoles += health.filter((x) => x.freezeDistance === 0).length;
    if (health.length > 0 && health.every((x) => x.frozen)) r.frozenDaos++;
  }
  return r;
}

// ───────────────────── F4: approved, then failed ─────────────────────

export type FailureCause = "token transfer" | "NEAR transfer" | "intents" | "bulk payment" | "token call" | "other call" | "other";

export interface F4 {
  failed: number;
  byCause: Record<string, number>;
  daos: number;
}

/** Cause from the proposal kind alone (no receipts): a heuristic, labelled as such. */
export function failureCause(p: Proposal): FailureCause {
  const kind = p.kind as Record<string, Record<string, unknown>>;
  if (kind.Transfer) return (kind.Transfer as { token_id: string }).token_id === "" ? "NEAR transfer" : "token transfer";
  if (kind.FunctionCall) {
    const fc = kind.FunctionCall as { receiver_id: string; actions: { method_name: string }[] };
    const methods = (fc.actions ?? []).map((a) => a.method_name);
    if (/intents/.test(fc.receiver_id) || methods.some((m) => /intent/i.test(m))) return "intents";
    if (/bulk|batch/i.test(fc.receiver_id) || methods.some((m) => /bulk|batch/i.test(m))) return "bulk payment";
    if (methods.some((m) => m === "ft_transfer" || m === "ft_transfer_call")) return "token call";
    return "other call";
  }
  return "other";
}

export function f4(histories: DaoHistory[]): F4 {
  const byCause: Record<string, number> = {};
  const daos = new Set<string>();
  let failed = 0;
  for (const h of histories)
    for (const p of h.proposals)
      if (p.status === "Failed") {
        failed++;
        daos.add(h.dao);
        const c = failureCause(p);
        byCause[c] = (byCause[c] ?? 0) + 1;
      }
  return { failed, byCause, daos: daos.size };
}

// ───────────────────── F5: bounties ─────────────────────

export interface F5 {
  bountyProposals: number;
  daosUsingBounties: number;
}

export function f5(histories: DaoHistory[]): F5 {
  let n = 0;
  const daos = new Set<string>();
  for (const h of histories)
    for (const p of h.proposals) {
      const k = Object.keys(p.kind as object)[0];
      if (k === "AddBounty" || k === "BountyDone") {
        n++;
        daos.add(h.dao);
      }
    }
  return { bountyProposals: n, daosUsingBounties: daos.size };
}

// ───────────────────── all together ─────────────────────

export interface Findings {
  daos: number;
  proposals: number;
  f1: F1;
  f2: F2;
  f3: F3;
  f4: F4;
  f5: F5;
}

export function findings(histories: DaoHistory[], w: ScanWindow): Findings {
  return {
    daos: histories.length,
    proposals: histories.reduce((s, h) => s + h.proposals.length, 0),
    f1: f1(histories, w),
    f2: f2(histories),
    f3: f3(histories, w),
    f4: f4(histories),
    f5: f5(histories),
  };
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
