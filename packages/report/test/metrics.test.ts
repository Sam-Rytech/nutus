import { describe, expect, it } from "vitest";
import type { Policy, Proposal } from "@nutus/core";
import { DAY, f1, f2, f3, f4, f5, failureCause, findings, lapsed, median, paymentsOf, singlePayment, type DaoHistory } from "../src/index.ts";

const NOW = 1_000n * DAY;
const W = { now: NOW, from: NOW - 365n * DAY };
const PERIOD = 7n * DAY;
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");

const policy = (council: string[]): Policy => ({
  roles: [
    { name: "all", kind: "Everyone", permissions: ["*:AddProposal"], vote_policy: {} },
    { name: "council", kind: { Group: council }, permissions: ["*:*"], vote_policy: {} },
  ],
  default_vote_policy: { weight_kind: "RoleWeight", quorum: "0", threshold: [1, 2] },
  proposal_bond: "1",
  proposal_period: String(PERIOD),
  bounty_bond: "1",
  bounty_forgiveness_period: "1",
});

let nextId = 0;
const prop = (o: { day: number; status?: Proposal["status"]; votes?: string[]; kind?: Proposal["kind"] }): Proposal => ({
  id: nextId++,
  proposer: "p.near",
  description: "",
  kind: o.kind ?? { Transfer: { token_id: "", receiver_id: "carol.near", amount: "10", msg: null } },
  status: o.status ?? "Approved",
  vote_counts: {},
  votes: Object.fromEntries((o.votes ?? []).map((v) => [v, "Approve"])),
  submission_time: String(BigInt(o.day) * DAY),
});
const pay = (day: number, to: string, amount: string, status: Proposal["status"] = "Approved", votes: string[] = ["a"]) =>
  prop({ day, status, votes, kind: { Transfer: { token_id: "usdc.near", receiver_id: to, amount, msg: null } } });
const dao = (proposals: Proposal[], council = ["a", "b", "c"]): DaoHistory => ({ dao: "d.sputnik-dao.near", policy: policy(council), proposals });

describe("payments", () => {
  it("reads Transfer and ft_transfer FunctionCalls, and nothing else", () => {
    expect(paymentsOf("d", pay(1, "x.near", "5"))).toMatchObject([{ token: "usdc.near", recipient: "x.near", amount: 5n, via: "Transfer" }]);
    const fc = prop({
      day: 1,
      kind: { FunctionCall: { receiver_id: "usdt.near", actions: [
        { method_name: "storage_deposit", args: b64({ account_id: "y.near" }), deposit: "1", gas: "1" },
        { method_name: "ft_transfer", args: b64({ receiver_id: "y.near", amount: "7" }), deposit: "1", gas: "1" },
      ] } },
    });
    expect(paymentsOf("d", fc)).toMatchObject([{ token: "usdt.near", recipient: "y.near", amount: 7n, via: "FunctionCall" }]);
    expect(paymentsOf("d", prop({ day: 1, kind: { AddMemberToRole: { member_id: "z", role: "council" } } }))).toEqual([]);
    expect(paymentsOf("d", prop({ day: 1 }))[0]!.token).toBe("near");
  });

  it("bulk proposals don't count as single payments in F1/F2", () => {
    const bulk = prop({
      day: 900,
      status: "Expired",
      votes: [],
      kind: { FunctionCall: { receiver_id: "usdc.near", actions: Array.from({ length: 200 }, (_, i) => ({ method_name: "ft_transfer", args: b64({ receiver_id: `r${i}.near`, amount: "1" }), deposit: "1", gas: "1" })) } },
    });
    expect(paymentsOf("d", bulk)).toHaveLength(200);
    expect(singlePayment("d", bulk)).toBeNull();
    const r = f1([dao([bulk, pay(901, "x.near", "5")])], W);
    expect(r.smallPayments + r.largePayments).toBe(1);
  });

  it("lapsed = Expired, or InProgress past its voting period", () => {
    expect(lapsed("Expired", 0n, PERIOD, NOW)).toBe(true);
    expect(lapsed("InProgress", NOW - PERIOD - 1n, PERIOD, NOW)).toBe(true);
    expect(lapsed("InProgress", NOW - 1n, PERIOD, NOW)).toBe(false);
    expect(lapsed("Rejected", 0n, PERIOD, NOW)).toBe(false);
  });
});

describe("F1: small payouts lapse", () => {
  it("compares lapse rates below and above each DAO's median, counts zero-vote lapses and repayment", () => {
    const h = dao([
      pay(700, "carol.near", "10", "Expired", []), // small, lapsed, zero votes
      pay(701, "dan.near", "10", "Expired", ["a"]), // small, lapsed, one vote
      pay(720, "carol.near", "10"), // carol repaid 20 days later
      pay(702, "erin.near", "1000"), // large, approved
      pay(703, "fay.near", "1000", "Expired"), // large, lapsed
      pay(704, "gus.near", "1000"),
    ]);
    const r = f1([h], W);
    expect(r).toMatchObject({ smallPayments: 3, smallLapsed: 2, largePayments: 3, largeLapsed: 1, smallLapsedZeroVotes: 1 });
    expect(r).toMatchObject({ recipientsWithLapse: 2, neverRepaid: 1, medianDaysToRepay: 20 });
  });

  it("ignores payments still open inside their voting period", () => {
    const r = f1([dao([pay(999, "x.near", "1", "InProgress", [])])], W);
    expect(r.smallPayments + r.largePayments).toBe(0);
  });
});

describe("F2: repeat payments", () => {
  it("finds the same recipient, token and amount approved 3+ times", () => {
    const h = dao([
      pay(1, "x.near", "100"), pay(30, "x.near", "100"), pay(60, "x.near", "100"), // series
      pay(2, "y.near", "100"), pay(31, "y.near", "100"), // only twice
      pay(3, "x.near", "100", "Rejected"), // not approved
      pay(4, "x.near", "101"), // different amount
    ]);
    expect(f2([h])).toEqual({ approvedPayments: 6, repeatPayments: 3, series: 1, daosWithSeries: 1 });
  });
});

describe("F3: silent seats", () => {
  it("marks members with no vote in 60 days and finds frozen roles", () => {
    const recent = (votes: string[]) => prop({ day: 990, votes });
    const h = dao([recent(["a"]), recent(["a"]), recent([])], ["a", "b", "c"]);
    expect(f3([h], W)).toEqual({ seats: 3, silentSeats: 2, frozenRoles: 1, oneAwayRoles: 0, daosAssessed: 1, frozenDaos: 1 });
  });

  it("skips DAOs with fewer than 3 recent proposals (nothing to be silent on)", () => {
    expect(f3([dao([prop({ day: 990 }), prop({ day: 100 })])], W).daosAssessed).toBe(0);
  });

  it("one silent seat in a 5-seat council is not frozen and not one away", () => {
    const recent = () => prop({ day: 995, votes: ["a", "b", "c", "d"] });
    expect(f3([dao([recent(), recent(), recent()], ["a", "b", "c", "d", "e"])], W)).toMatchObject({ silentSeats: 1, frozenRoles: 0, oneAwayRoles: 0 });
  });
});

describe("F4 and F5", () => {
  it("classifies failed executions by kind", () => {
    const failed = (kind: Proposal["kind"]) => prop({ day: 1, status: "Failed", kind });
    const h = dao([
      failed({ Transfer: { token_id: "usdc.near", receiver_id: "x", amount: "1", msg: null } }),
      failed({ Transfer: { token_id: "", receiver_id: "x", amount: "1", msg: null } }),
      failed({ FunctionCall: { receiver_id: "intents.near", actions: [{ method_name: "ft_withdraw", args: "", deposit: "1", gas: "1" }] } }),
      failed({ FunctionCall: { receiver_id: "bulkpayment.near", actions: [{ method_name: "buy_storage", args: "", deposit: "1", gas: "1" }] } }),
      prop({ day: 1, status: "Approved" }),
    ]);
    expect(f4([h])).toEqual({ failed: 4, daos: 1, byCause: { "token transfer": 1, "NEAR transfer": 1, intents: 1, "bulk payment": 1 } });
    expect(failureCause(prop({ day: 1, kind: { FunctionCall: { receiver_id: "x.near", actions: [{ method_name: "go", args: "", deposit: "0", gas: "1" }] } } }))).toBe("other call");
  });

  it("counts bounty proposals", () => {
    expect(f5([dao([prop({ day: 1, kind: { AddBounty: {} } }), prop({ day: 2 })])])).toEqual({ bountyProposals: 1, daosUsingBounties: 1 });
  });

  it("findings totals DAOs and proposals", () => {
    expect(findings([dao([prop({ day: 1 }), prop({ day: 2 })]), dao([])], W)).toMatchObject({ daos: 2, proposals: 2 });
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
