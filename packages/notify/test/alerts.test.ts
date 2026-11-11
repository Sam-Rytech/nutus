import { describe, expect, it } from "vitest";
import type { Instance, Policy, Proposal } from "@nutus/core";
import { DAY, HOUR, alerts, amount, status, type Snapshot } from "../src/alerts.ts";

const T0 = 1_000n * DAY;
const policy: Policy = {
  roles: [{ name: "council", kind: { Group: ["c1", "c2", "c3"] }, permissions: ["*:*"], vote_policy: {} }],
  default_vote_policy: { weight_kind: "RoleWeight", quorum: "0", threshold: [1, 2] },
  proposal_bond: "1000000000000000000000000",
  proposal_period: String(7n * DAY),
  bounty_bond: "1",
  bounty_forgiveness_period: "1",
};

const payout = (o: Partial<Instance.Payout>): Instance.Payout => ({
  id: "1", lane: "design", filer: "f", recipient: "r.testnet", token: "usd", amount: "10000000", link: "https://x/work",
  tier: "Small", filed_at_ns: String(T0), deadline_ns: String(T0 + 48n * HOUR), deposit: "0", status: "Waiting", ...o,
});
const proposal = (o: Partial<Proposal>): Proposal => ({
  id: 4, proposer: "inst", description: "", kind: { Transfer: { token_id: "", receiver_id: "r", amount: "1", msg: null } }, status: "InProgress", vote_counts: {}, votes: {}, submission_time: String(T0), ...o,
});
const snap = (o: Partial<Snapshot>): Snapshot => ({
  instance: "i.testnet", dao: "d.testnet", app: "https://app", council: [], policy, payouts: [], standing: [],
  escalations: new Map(), recent: [], tokens: new Map([["usd", { decimals: 6, symbol: "tUSDC" }]]), ...o,
});
const keys = (s: Snapshot, from: bigint, to: bigint) => alerts(s, from, to).map((a) => a.key);

describe("amount", () => {
  it("uses token decimals and symbol", () => {
    const t = new Map([["usd", { decimals: 6, symbol: "tUSDC" }]]);
    expect(amount("10000000", "usd", t)).toBe("10 tUSDC");
    expect(amount("1500000", "usd", t)).toBe("1.5 tUSDC");
    expect(amount("150000000000", "usd", t)).toBe("150,000 tUSDC");
    expect(amount("1000000000000000000000000", "near", t)).toBe("1 NEAR");
  });
});

describe("alerts", () => {
  it("announces a new payout once, in the window it was filed in", () => {
    const s = snap({ payouts: [payout({})] });
    expect(keys(s, T0 - HOUR, T0 + 1n)).toEqual(["filed:1"]);
    expect(keys(s, T0 + 1n, T0 + HOUR)).toEqual([]);
    expect(alerts(s, T0 - HOUR, T0 + 1n)[0]!.text).toContain("pays in 47 h unless a council member objects");
  });

  it("asks for an approval on a medium payout", () => {
    const s = snap({ payouts: [payout({ tier: "Medium", deadline_ns: String(T0 + 7n * DAY) })] });
    expect(alerts(s, T0, T0 + HOUR)[0]!.text).toContain("needs one council approval");
  });

  it("skips payouts that already paid", () => {
    expect(keys(snap({ payouts: [payout({ status: "Paid" })] }), T0, T0 + HOUR)).toEqual([]);
  });

  it("announces the escalation, then the expiry while the proposal is still open", () => {
    const p = payout({ id: "3", filed_at_ns: String(T0 - DAY), status: { Escalated: { proposal_id: "4" } } });
    const open = snap({ payouts: [p], escalations: new Map([["3", proposal({})]]) });
    expect(keys(open, T0, T0 + HOUR)).toEqual(["escalated:3"]);
    expect(keys(open, T0 + 7n * DAY, T0 + 7n * DAY + HOUR)).toEqual(["expired:3"]);
    const decided = snap({ payouts: [p], escalations: new Map([["3", proposal({ status: "Approved" })]]) });
    expect(keys(decided, T0 + 7n * DAY, T0 + 7n * DAY + HOUR)).toEqual([]);
  });

  it("warns when a recurring payment comes due with a short buffer", () => {
    const r: Instance.Standing = {
      id: "0", recipient: "r", token: "usd", amount: "100", buffer: "40", next_due_ns: String(T0), period_ns: String(30n * DAY),
      notice_locked: "0", notice_periods: 1, state: "Active",
    };
    expect(keys(snap({ standing: [r] }), T0, T0 + HOUR)).toEqual([`short:0:${T0}`]);
    expect(keys(snap({ standing: [{ ...r, buffer: "100" }] }), T0, T0 + HOUR)).toEqual([]);
  });

  it("flags a seat the moment it reaches 60 days without a vote", () => {
    const s = snap({ council: ["c1", "c2"], recent: [proposal({ votes: { c1: "Approve" }, submission_time: String(T0) })] });
    expect(keys(s, T0 + 60n * DAY, T0 + 60n * DAY + HOUR)).toEqual(["quiet:c1"]);
    expect(keys(s, T0 + 61n * DAY, T0 + 61n * DAY + HOUR)).toEqual([]);
  });
});

describe("status", () => {
  it("lists what needs the council", () => {
    const s = snap({
      council: ["c1"],
      payouts: [payout({}), payout({ id: "2", tier: "Medium" })],
      recent: [proposal({ votes: { c1: "Approve" } })],
    });
    const text = status(s, T0 + HOUR);
    expect(text).toContain("Paying unless someone objects (1)");
    expect(text).toContain("#1 10 tUSDC to <code>r.testnet</code>, in 47 h");
    expect(text).toContain("Waiting for one approval (1)");
    expect(text).not.toContain("No vote in 60 days");
  });

  it("says when nothing is waiting", () => {
    expect(status(snap({}), T0)).toContain("Nothing needs the council right now.");
  });
});
