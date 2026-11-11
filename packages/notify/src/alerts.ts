// What the council chat hears about. Pure: a snapshot of the instance and its
// DAO in, messages out. Each alert fires once, in the tick whose window
// [from, to) contains the moment it became true, so a tick needs to remember
// nothing but when the last one ran.

import type { Instance, Policy, Proposal } from "@nutus/core";

export const DAY = 86_400n * 1_000_000_000n;
export const HOUR = 3_600n * 1_000_000_000n;
/** A seat that hasn't voted in this long counts as silent (same as the report). */
export const QUIET_AFTER = 60n * DAY;

export interface TokenMeta {
  decimals: number;
  symbol: string;
}

export interface Snapshot {
  instance: string;
  dao: string;
  /** Web app origin, for links. */
  app: string;
  council: string[];
  policy: Policy;
  payouts: Instance.Payout[];
  standing: Instance.Standing[];
  /** Payout id → the DAO proposal it escalated to. */
  escalations: Map<string, Proposal>;
  /** DAO proposals submitted in roughly the last QUIET_AFTER + a few days. */
  recent: Proposal[];
  tokens: Map<string, TokenMeta>;
}

/** The kinds of alert a chat can turn on or off. */
export const KINDS = ["filed", "escalated", "expired", "short", "quiet"] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_LABEL: Record<Kind, string> = {
  filed: "New payouts",
  escalated: "Payouts sent to a DAO vote",
  expired: "Expired votes to finalize",
  short: "Recurring pay running short",
  quiet: "Council seats gone quiet",
};

export interface LinkButton {
  text: string;
  url: string;
}

export interface Alert {
  /** Stable id, for tests and logs. */
  key: string;
  kind: Kind;
  /** One line, for digests. */
  line: string;
  /** The full message, for alerts sent as they happen. */
  text: string;
  buttons: LinkButton[];
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const code = (s: string) => `<code>${esc(s)}</code>`;

export function amount(raw: string | bigint, token: string, tokens: Map<string, TokenMeta>): string {
  const m = token === "near" ? { decimals: 24, symbol: "NEAR" } : tokens.get(token) ?? { decimals: 0, symbol: token };
  const v = BigInt(raw);
  const unit = 10n ** BigInt(m.decimals);
  const whole = v / unit;
  const cents = m.decimals === 0 ? 0n : ((v % unit) * 100n) / unit;
  const n = whole.toLocaleString("en-US") + (cents > 0n ? `.${String(cents).padStart(2, "0").replace(/0$/, "")}` : "");
  return `${n} ${m.symbol}`;
}

export function inWords(ns: bigint): string {
  if (ns >= 2n * DAY) return `${ns / DAY} days`;
  if (ns >= HOUR) return `${ns / HOUR} h`;
  return `${(ns / 60_000_000_000n) || 1n} min`;
}

export const appPage = (s: Pick<Snapshot, "app" | "instance">, path: string) => {
  const q = s.instance === "nutus-demo.v2.nutus-dev.testnet" ? "" : `?instance=${encodeURIComponent(s.instance)}`;
  return `${s.app.replace(/\/$/, "")}${path}${q}`;
};

const within = (t: bigint, from: bigint, to: bigint) => t >= from && t < to;
const lane = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

/** Last time each council member voted, judged by the submission time of the newest proposal they voted on. */
export function lastVotes(s: Snapshot): Map<string, bigint | null> {
  const out = new Map<string, bigint | null>(s.council.map((m) => [m, null]));
  for (const p of s.recent)
    for (const m of Object.keys(p.votes ?? {}))
      if (out.has(m)) {
        const t = BigInt(p.submission_time);
        const prev = out.get(m);
        if (prev == null || t > prev) out.set(m, t);
      }
  return out;
}

export function alerts(s: Snapshot, from: bigint, to: bigint): Alert[] {
  const out: Alert[] = [];
  const amt = (p: { amount: string; token: string }) => esc(amount(p.amount, p.token, s.tokens));
  const inbox = { text: "Open the council inbox", url: appPage(s, "/council") };

  for (const p of s.payouts) {
    if (p.status === "Waiting" && within(BigInt(p.filed_at_ns), from, to)) {
      const left = inWords(BigInt(p.deadline_ns) > to ? BigInt(p.deadline_ns) - to : 0n);
      const small = p.tier === "Small";
      out.push({
        key: `filed:${p.id}`,
        kind: "filed",
        line: small
          ? `Payout #${p.id}: <b>${amt(p)}</b> to ${code(p.recipient)}, pays in ${left} unless someone objects`
          : `Payout #${p.id}: <b>${amt(p)}</b> to ${code(p.recipient)}, needs one approval`,
        text: [
          small ? `<b>New payout #${p.id}</b>` : `<b>Payout #${p.id} needs your approval</b>`,
          `<b>${amt(p)}</b> to ${code(p.recipient)}`,
          `${esc(lane(p.lane))} lane${p.memo ? ` · ${esc(p.memo)}` : ""}`,
          "",
          small
            ? `It pays automatically in ${left} unless a council member objects.`
            : `One council approval pays it. If nobody approves in ${left}, it goes to a DAO vote.`,
        ].join("\n"),
        buttons: [{ text: "See the work", url: p.link }, small ? { text: "Object", url: inbox.url } : { text: "Approve", url: inbox.url }],
      });
    }

    const e = s.escalations.get(p.id);
    if (!e) continue;
    const submitted = BigInt(e.submission_time);
    if (within(submitted, from, to)) {
      out.push({
        key: `escalated:${p.id}`,
        kind: "escalated",
        line: `Payout #${p.id} (${amt(p)} to ${code(p.recipient)}) is now DAO proposal ${e.id}`,
        text: [
          `<b>Payout #${p.id} went to a DAO vote</b>`,
          `<b>${amt(p)}</b> to ${code(p.recipient)}`,
          "",
          `It's now DAO proposal ${e.id}. It pays only if the DAO votes for it within ${inWords(BigInt(s.policy.proposal_period))}.`,
        ].join("\n"),
        buttons: [inbox],
      });
    }
    const expires = submitted + BigInt(s.policy.proposal_period);
    if (e.status === "InProgress" && within(expires, from, to)) {
      const bond = esc(amount(s.policy.proposal_bond, "near", s.tokens));
      out.push({
        key: `expired:${p.id}`,
        kind: "expired",
        line: `DAO proposal ${e.id} (payout #${p.id}) expired: finalize it to recover the ${bond} bond`,
        text: [
          `<b>DAO proposal ${e.id} expired</b>`,
          `Nobody decided on payout #${p.id} in time.`,
          "",
          `Finalize it to return the ${bond} bond to Nutus.`,
        ].join("\n"),
        buttons: [{ text: "Finalize", url: inbox.url }],
      });
    }
  }

  for (const r of s.standing) {
    if (r.state !== "Active" || r.in_flight) continue;
    const due = BigInt(r.next_due_ns);
    if (within(due, from, to) && BigInt(r.buffer) < BigInt(r.amount)) {
      const held = esc(amount(r.buffer, r.token, s.tokens));
      const needs = esc(amount(r.amount, r.token, s.tokens));
      out.push({
        key: `short:${r.id}:${r.next_due_ns}`,
        kind: "short",
        line: `Recurring payment #${r.id} to ${code(r.recipient)} is due but short: ${held} of ${needs}`,
        text: [
          `<b>Recurring payment #${r.id} is short</b>`,
          `${code(r.recipient)} is due ${needs}; the buffer holds ${held}.`,
          "",
          "The DAO needs to top it up before it can pay.",
        ].join("\n"),
        buttons: [inbox],
      });
    }
  }

  for (const [m, t] of lastVotes(s)) {
    if (t !== null && within(t + QUIET_AFTER, from, to)) {
      out.push({
        key: `quiet:${m}`,
        kind: "quiet",
        line: `${code(m)} hasn't voted in 60 days`,
        text: [`<b>A council seat has gone quiet</b>`, `${code(m)} hasn't voted on a DAO proposal in 60 days.`, "", "Silent seats are how councils lose the votes to pay anyone."].join("\n"),
        buttons: [{ text: "See the DAO report", url: `${s.app.replace(/\/$/, "")}/report?dao=${encodeURIComponent(s.dao)}&net=testnet` }],
      });
    }
  }
  return out;
}

/** The reply to /status: what needs the council right now. */
export function status(s: Snapshot, now: bigint): string {
  const amt = (p: { amount: string; token: string }) => esc(amount(p.amount, p.token, s.tokens));
  const waiting = s.payouts.filter((p) => p.status === "Waiting");
  const small = waiting.filter((p) => p.tier === "Small" && BigInt(p.deadline_ns) > now);
  const medium = waiting.filter((p) => p.tier === "Medium");
  const expired = s.payouts.filter((p) => {
    const e = s.escalations.get(p.id);
    return e?.status === "InProgress" && BigInt(e.submission_time) + BigInt(s.policy.proposal_period) <= now;
  });
  const short = s.standing.filter((r) => r.state === "Active" && !r.in_flight && BigInt(r.next_due_ns) <= now && BigInt(r.buffer) < BigInt(r.amount));
  const quiet = [...lastVotes(s)].filter(([, t]) => t === null || t + QUIET_AFTER <= now).map(([m]) => m);

  const parts: string[] = ["<b>What needs the council</b>"];
  const section = (title: string, rows: string[]) => rows.length && parts.push(`\n<b>${title}</b>\n${rows.map((r) => `• ${r}`).join("\n")}`);
  section(`Paying unless someone objects (${small.length})`, small.map((p) => `#${p.id} · ${amt(p)} to ${code(p.recipient)} · in ${inWords(BigInt(p.deadline_ns) - now)}`));
  section(`Waiting for one approval (${medium.length})`, medium.map((p) => `#${p.id} · ${amt(p)} to ${code(p.recipient)}`));
  section(`Expired, finalize to recover the bond (${expired.length})`, expired.map((p) => `#${p.id} · DAO proposal ${s.escalations.get(p.id)!.id}`));
  section(`Recurring pay short (${short.length})`, short.map((r) => `#${r.id} to ${code(r.recipient)}`));
  section("No vote in 60 days", quiet.map(code));
  if (parts.length === 1) parts.push("\nNothing right now.");
  return parts.join("\n");
}
