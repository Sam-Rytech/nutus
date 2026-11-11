// What the council chat hears about. Pure: a snapshot of the instance and its
// DAO in, messages out. Each alert fires once, in the run whose window
// [from, to) contains the moment it became true, so a run needs to remember
// nothing but when it last ran.

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

export interface Alert {
  /** Stable id, for tests and logs. */
  key: string;
  text: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const code = (s: string) => `<code>${esc(s)}</code>`;
const link = (href: string, label: string) => `<a href="${esc(href)}">${esc(label)}</a>`;

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

const page = (s: Snapshot, path: string) => {
  const q = s.app.includes("nutus.vercel.app") && s.instance === "nutus-demo.v2.nutus-dev.testnet" ? "" : `?instance=${encodeURIComponent(s.instance)}`;
  return `${s.app.replace(/\/$/, "")}${path}${q}`;
};

const within = (t: bigint, from: bigint, to: bigint) => t >= from && t < to;

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
  const amt = (p: { amount: string; token: string }) => amount(p.amount, p.token, s.tokens);

  for (const p of s.payouts) {
    // New payout: announced in the run that sees it filed.
    if (p.status === "Waiting" && within(BigInt(p.filed_at_ns), from, to)) {
      const left = inWords(BigInt(p.deadline_ns) - to > 0n ? BigInt(p.deadline_ns) - to : 0n);
      out.push(
        p.tier === "Small"
          ? {
              key: `filed:${p.id}`,
              text: `New payout #${p.id}: <b>${esc(amt(p))}</b> to ${code(p.recipient)} (${esc(p.lane)}). It pays in ${left} unless a council member objects.\n${link(p.link, "The work")} · ${link(page(s, "/council"), "Object in the inbox")}`,
            }
          : {
              key: `filed:${p.id}`,
              text: `Payout #${p.id} needs one council approval: <b>${esc(amt(p))}</b> to ${code(p.recipient)} (${esc(p.lane)}). If nobody approves in ${left}, it goes to a DAO vote.\n${link(p.link, "The work")} · ${link(page(s, "/council"), "Approve in the inbox")}`,
            },
      );
    }

    const e = s.escalations.get(p.id);
    if (!e) continue;
    const submitted = BigInt(e.submission_time);
    // Escalated: a DAO proposal was filed for it (an objection or a medium timeout).
    if (within(submitted, from, to)) {
      out.push({
        key: `escalated:${p.id}`,
        text: `Payout #${p.id} (${esc(amt(p))} to ${code(p.recipient)}) is now DAO proposal ${e.id}. It pays only if the DAO votes for it within ${inWords(BigInt(s.policy.proposal_period))}.`,
      });
    }
    // Expired without a decision: someone has to finalize it to get the bond back.
    const expires = submitted + BigInt(s.policy.proposal_period);
    if (e.status === "InProgress" && within(expires, from, to)) {
      out.push({
        key: `expired:${p.id}`,
        text: `DAO proposal ${e.id} (payout #${p.id}) expired without a decision. Finalize it to return the ${esc(amount(s.policy.proposal_bond, "near", s.tokens))} bond to Nutus.\n${link(page(s, "/council"), "Finalize in the inbox")}`,
      });
    }
  }

  for (const r of s.standing) {
    if (r.state !== "Active" || r.in_flight) continue;
    const due = BigInt(r.next_due_ns);
    if (within(due, from, to) && BigInt(r.buffer) < BigInt(r.amount)) {
      out.push({
        key: `short:${r.id}:${r.next_due_ns}`,
        text: `Recurring payment #${r.id} to ${code(r.recipient)} is due, but its buffer holds ${esc(amount(r.buffer, r.token, s.tokens))} of the ${esc(amount(r.amount, r.token, s.tokens))} it needs. The DAO needs to top it up.`,
      });
    }
  }

  for (const [m, t] of lastVotes(s)) {
    if (t !== null && within(t + QUIET_AFTER, from, to)) {
      out.push({
        key: `quiet:${m}`,
        text: `${code(m)} hasn't voted on a DAO proposal in 60 days. Silent seats are how councils lose the votes to pay anyone.\n${link(`${s.app.replace(/\/$/, "")}/report?dao=${encodeURIComponent(s.dao)}&net=testnet`, "See the DAO report")}`,
      });
    }
  }
  return out;
}

/** The reply to /status: what needs the council right now. */
export function status(s: Snapshot, now: bigint): string {
  const lines: string[] = [];
  const amt = (p: { amount: string; token: string }) => amount(p.amount, p.token, s.tokens);
  const waiting = s.payouts.filter((p) => p.status === "Waiting");
  const small = waiting.filter((p) => p.tier === "Small" && BigInt(p.deadline_ns) > now);
  const medium = waiting.filter((p) => p.tier === "Medium");
  const expired = s.payouts.filter((p) => {
    const e = s.escalations.get(p.id);
    return e?.status === "InProgress" && BigInt(e.submission_time) + BigInt(s.policy.proposal_period) <= now;
  });
  const short = s.standing.filter((r) => r.state === "Active" && !r.in_flight && BigInt(r.next_due_ns) <= now && BigInt(r.buffer) < BigInt(r.amount));
  const quiet = [...lastVotes(s)].filter(([, t]) => t === null || t + QUIET_AFTER <= now).map(([m]) => m);

  lines.push(`<b>Nutus</b> · ${code(s.instance)}`);
  if (small.length) {
    lines.push(`\n<b>Paying unless someone objects (${small.length})</b>`);
    for (const p of small) lines.push(`#${p.id} ${esc(amt(p))} to ${code(p.recipient)}, in ${inWords(BigInt(p.deadline_ns) - now)}`);
  }
  if (medium.length) {
    lines.push(`\n<b>Waiting for one approval (${medium.length})</b>`);
    for (const p of medium) lines.push(`#${p.id} ${esc(amt(p))} to ${code(p.recipient)}`);
  }
  if (expired.length) {
    lines.push(`\n<b>Expired, finalize to recover the bond (${expired.length})</b>`);
    for (const p of expired) lines.push(`#${p.id} → DAO proposal ${s.escalations.get(p.id)!.id}`);
  }
  if (short.length) {
    lines.push(`\n<b>Recurring payments short (${short.length})</b>`);
    for (const r of short) lines.push(`#${r.id} to ${code(r.recipient)}`);
  }
  if (quiet.length) lines.push(`\n<b>No vote in 60 days</b>\n${quiet.map(code).join(", ")}`);
  if (lines.length === 1) lines.push("Nothing needs the council right now.");
  lines.push(`\n${link(page(s, "/council"), "Open the council inbox")}`);
  return lines.join("\n");
}
