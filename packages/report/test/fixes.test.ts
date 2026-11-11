import { describe, expect, it } from "vitest";
import type { Policy, Proposal } from "@nutus/core";
import { DAY, f2, recordsFromHistory, repeatSeries, recurringSeries, seedBatches, standingFromSeries } from "../src/index.ts";

const policy: Policy = {
  roles: [
    { name: "all", kind: "Everyone", permissions: ["*:AddProposal"], vote_policy: {} },
    { name: "council", kind: { Group: ["a", "b", "c"] }, permissions: ["*:*"], vote_policy: {} },
  ],
  default_vote_policy: { weight_kind: "RoleWeight", quorum: "0", threshold: [1, 2] },
  proposal_bond: "1",
  proposal_period: String(7n * DAY),
  bounty_bond: "1",
  bounty_forgiveness_period: "1",
};

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");

const prop = (id: number, day: number, kind: Proposal["kind"], status: Proposal["status"] = "Approved"): Proposal => ({
  id,
  proposer: "p.near",
  description: "",
  kind,
  status,
  vote_counts: {},
  votes: status === "Approved" ? { a: "Approve" } : {},
  submission_time: String(BigInt(day) * DAY),
});

const transfer = (id: number, day: number, to: string, amount: string, status: Proposal["status"] = "Approved", token = "usdc.near") =>
  prop(id, day, { Transfer: { token_id: token, receiver_id: to, amount, msg: null } }, status);

const ftCall = (id: number, day: number, to: string, amount: string, status: Proposal["status"] = "Approved") =>
  prop(id, day, {
    FunctionCall: {
      receiver_id: "usdc.near",
      actions: [{ method_name: "ft_transfer", args: b64({ receiver_id: to, amount }), deposit: "1", gas: "1" }],
    },
  }, status);

describe("recordsFromHistory", () => {
  it("lists the approved single payments that paid each recipient, and nothing else", () => {
    const bulk = prop(3, 3, {
      FunctionCall: {
        receiver_id: "usdc.near",
        actions: [1, 2].map((n) => ({ method_name: "ft_transfer", args: b64({ receiver_id: "alice.near", amount: String(n) }), deposit: "1", gas: "1" })),
      },
    });
    const r = recordsFromHistory("d.sputnik-dao.near", [
      transfer(0, 1, "alice.near", "10"),
      transfer(1, 1, "alice.near", "10", "Rejected"),
      ftCall(2, 2, "bob.near", "7"),
      bulk,
      transfer(4, 4, "carol.near", "1", "Approved", ""),
    ]);
    expect(r).toEqual([
      { account: "alice.near", proposal_ids: ["0"] },
      { account: "bob.near", proposal_ids: ["2"] },
      { account: "carol.near", proposal_ids: ["4"] },
    ]);
  });
});

describe("repeat series to standing payments", () => {
  const proposals = [
    transfer(0, 1, "x.near", "100"),
    transfer(1, 2, "y.near", "100"), // only twice, not a series
    transfer(2, 31, "x.near", "100"),
    transfer(3, 31, "y.near", "100"),
    transfer(4, 61, "x.near", "100"),
    transfer(5, 92, "x.near", "100"),
    transfer(6, 92, "z.near", "100", "Rejected"),
  ];

  it("exposes the series f2 counts", () => {
    const series = repeatSeries([{ dao: "d.sputnik-dao.near", policy, proposals }]);
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({ recipient: "x.near", token: "usdc.near", amount: 100n });
    expect(series[0]!.proposalIds).toEqual(["0", "2", "4", "5"]);
    expect(series[0]!.submitted).toEqual([1n, 31n, 61n, 92n].map((d) => d * DAY));
    expect(f2([{ dao: "d.sputnik-dao.near", policy, proposals }])).toEqual({
      approvedPayments: 6,
      repeatPayments: 4,
      series: 1,
      daosWithSeries: 1,
    });
  });

  it("drafts the amount, the median gap and the next due date", () => {
    const series = repeatSeries([{ dao: "d.sputnik-dao.near", policy, proposals }])[0]!;
    expect(standingFromSeries(series)).toEqual({
      recipient: "x.near",
      token: "usdc.near",
      amount: "100",
      period_ns: String(30n * DAY),
      first_due_ns: String(122n * DAY),
      notice_periods: 1,
      memo: "Recurring pay for x.near",
    });
  });
});

describe("seedBatches", () => {
  const ids = (n: number, from = 0) => Array.from({ length: n }, (_, i) => String(from + i));
  it("keeps a small seed in one batch", () => {
    expect(seedBatches([{ account: "a", proposal_ids: ["1", "2"] }])).toEqual([[{ account: "a", proposal_ids: ["1", "2"] }]]);
  });
  it("never puts more than the contract's limit in one batch", () => {
    const b = seedBatches([{ account: "a", proposal_ids: ids(150) }, { account: "b", proposal_ids: ids(120, 150) }, { account: "c", proposal_ids: ids(5, 270) }]);
    expect(b.map((x) => x.reduce((s, e) => s + e.proposal_ids.length, 0))).toEqual([200, 75]);
    expect(b.flat().flatMap((e) => e.proposal_ids)).toEqual(ids(275));
    expect(b[0]!.at(-1)).toEqual({ account: "b", proposal_ids: ids(50, 150) });
  });
  it("splits one recipient with more ids than fit", () => {
    expect(seedBatches([{ account: "a", proposal_ids: ids(450) }]).map((x) => x[0]!.proposal_ids.length)).toEqual([200, 200, 50]);
  });
  it("returns nothing for no entries", () => {
    expect(seedBatches([])).toEqual([]);
  });
});

describe("standingFromSeries with now", () => {
  const s = { dao: "d", recipient: "x.near", token: "usdc.near", amount: 100n, proposalIds: ["1", "2", "3"], submitted: [32n * DAY, 62n * DAY, 92n * DAY] };
  it("keeps the next date when it is still ahead", () => {
    expect(standingFromSeries(s, 100n * DAY).first_due_ns).toBe(String(122n * DAY));
  });
  it("rolls a past date forward to the first one after now, so nothing is back-paid", () => {
    expect(standingFromSeries(s, 200n * DAY).first_due_ns).toBe(String(212n * DAY));
    expect(standingFromSeries(s, 212n * DAY).first_due_ns).toBe(String(242n * DAY));
  });
});

describe("recurringSeries", () => {
  it("drops series paid less than a week apart", () => {
    const at = (...d: bigint[]) => ({ dao: "d", recipient: "x", token: "near", amount: 1n, proposalIds: d.map(String), submitted: d.map((x) => x * DAY) });
    expect(recurringSeries([at(1n, 2n, 3n), at(1n, 31n, 61n)]).map((x) => x.submitted[1])).toEqual([31n * DAY]);
  });
});
