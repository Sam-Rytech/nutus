import { describe, expect, it } from "vitest";
import {
  build,
  can,
  daoFrozen,
  instance,
  instanceAccount,
  preflight,
  roleHealth,
  rpcView,
  thresholdVotes,
  type Policy,
  type PreflightEnv,
  type ProposalInput,
  type VotePolicy,
} from "../src/index.ts";

const ratio = (num: number, den: number, quorum = "0"): VotePolicy => ({ weight_kind: "RoleWeight", quorum, threshold: [num, den] });
const weight = (n: string): VotePolicy => ({ weight_kind: "RoleWeight", quorum: "0", threshold: n });
const decode = (b64: string) => JSON.parse(Buffer.from(b64, "base64").toString());

/** The default policy Sputnik v2 builds from a council list. */
const policy = (council: string[], extra: Policy["roles"] = []): Policy => ({
  roles: [
    { name: "all", kind: "Everyone", permissions: ["*:AddProposal"], vote_policy: {} },
    {
      name: "council",
      kind: { Group: council },
      permissions: ["*:Finalize", "*:AddProposal", "*:VoteApprove", "*:VoteReject", "*:VoteRemove"],
      vote_policy: {},
    },
    ...extra,
  ],
  default_vote_policy: ratio(1, 2),
  proposal_bond: "1000000000000000000000000",
  proposal_period: "604800000000000",
  bounty_bond: "1000000000000000000000000",
  bounty_forgiveness_period: "86400000000000",
});

describe("thresholdVotes (Sputnik policy.rs)", () => {
  it("Ratio: num*total/den + 1, capped at total", () => {
    expect(thresholdVotes(ratio(1, 2), 3)).toBe(2);
    expect(thresholdVotes(ratio(1, 2), 4)).toBe(3);
    expect(thresholdVotes(ratio(1, 2), 5)).toBe(3);
    expect(thresholdVotes(ratio(1, 2), 1)).toBe(1);
    expect(thresholdVotes(ratio(2, 3), 6)).toBe(5);
    expect(thresholdVotes(ratio(1, 1), 4)).toBe(4);
  });
  it("Weight: fixed count, capped at total", () => {
    expect(thresholdVotes(weight("2"), 5)).toBe(2);
    expect(thresholdVotes(weight("9"), 5)).toBe(5);
  });
  it("quorum is a floor", () => {
    expect(thresholdVotes(ratio(1, 2, "4"), 5)).toBe(4);
  });
});

describe("roleHealth / freeze distance", () => {
  const p = policy(["a", "b", "c", "d", "e"]);
  it("counts how many more members can go silent", () => {
    expect(roleHealth(p, [])[0]).toMatchObject({ role: "council", required: 3, active: 5, freezeDistance: 2, frozen: false });
    expect(roleHealth(p, ["a", "b"])[0]).toMatchObject({ active: 3, freezeDistance: 0, frozen: false });
  });
  it("frozen when active members can't reach the threshold", () => {
    const h = roleHealth(p, ["a", "b", "c"]);
    expect(h[0]).toMatchObject({ active: 2, freezeDistance: -1, frozen: true });
    expect(daoFrozen(h)).toBe(true);
  });
  it("uses a per-kind vote policy and skips roles that can't approve transfers", () => {
    const custom = policy(["a", "b", "c"], [
      { name: "ops", kind: { Group: ["x", "y"] }, permissions: ["transfer:VoteApprove"], vote_policy: { transfer: weight("1") } },
      { name: "voters", kind: { Group: ["z"] }, permissions: ["policy:VoteApprove"], vote_policy: {} },
    ]);
    const h = roleHealth(custom, ["a", "b", "c", "x"]);
    expect(h.map((r) => r.role)).toEqual(["council", "ops"]);
    expect(h[1]).toMatchObject({ required: 1, active: 1, frozen: false });
    expect(daoFrozen(h)).toBe(false);
  });
});

describe("permissions", () => {
  it("default policy lets anyone add proposals; a restricted one doesn't", () => {
    const open = policy(["a"]);
    expect(can(open, "x.nutus.near", "transfer", "AddProposal")).toBe(true);
    expect(build.needsEscalationRole(open, "x.nutus.near")).toBe(false);
    const closed: Policy = { ...open, roles: open.roles.slice(1) };
    expect(build.needsEscalationRole(closed, "x.nutus.near")).toBe(true);
    const role = (build.grantEscalationRole("x.nutus.near").kind as { ChangePolicyAddOrUpdateRole: { role: Policy["roles"][0] } }).ChangePolicyAddOrUpdateRole.role;
    expect(build.needsEscalationRole({ ...closed, roles: [...closed.roles, role] }, "x.nutus.near")).toBe(false);
  });
});

describe("builders", () => {
  const config = {
    lanes: [{ id: "design", name: "Design", token: "tusdc.nutus-dev.testnet", small_max: "100000000", medium_max: "500000000", period_cap: "2000000000", filers: "Anyone" as const }],
    council: ["c1.nutus-dev.testnet", "c2.nutus-dev.testnet", "c3.nutus-dev.testnet"],
  };

  it("instance account follows the factory's rule", () => {
    expect(instanceAccount("nutus-demo.sputnikv2.testnet", "v2.nutus-dev.testnet")).toBe("nutus-demo.v2.nutus-dev.testnet");
  });

  it("token setup = the proposal that executed on testnet (proposal 2)", () => {
    const p = build.setupWithToken({ dao: "nutus-demo.sputnikv2.testnet", factory: "v2.nutus-dev.testnet", token: "tusdc.nutus-dev.testnet", amount: "5000000000", config });
    const fc = (p.kind as { FunctionCall: { receiver_id: string; actions: { method_name: string; args: string; deposit: string; gas: string }[] } }).FunctionCall;
    expect(fc.receiver_id).toBe("tusdc.nutus-dev.testnet");
    expect(fc.actions.map((a) => [a.method_name, a.deposit, a.gas])).toEqual([
      ["storage_deposit", "1250000000000000000000", "10000000000000"],
      ["ft_transfer_call", "1", "250000000000000"],
    ]);
    expect(decode(fc.actions[0]!.args)).toEqual({ account_id: "nutus-demo.v2.nutus-dev.testnet", registration_only: true });
    const transfer = decode(fc.actions[1]!.args);
    expect(transfer).toMatchObject({ receiver_id: "v2.nutus-dev.testnet", amount: "5000000000" });
    expect(transfer.msg.startsWith("setup:")).toBe(true);
    expect(JSON.parse(transfer.msg.slice(6))).toEqual(config);
  });

  it("NEAR setup attaches storage + budget to create", () => {
    const p = build.setupWithNear({ dao: "d.sputnik-dao.near", factory: "nutus.near", budgetYocto: "5000000000000000000000000", config });
    const fc = (p.kind as { FunctionCall: { receiver_id: string; actions: { method_name: string; deposit: string }[] } }).FunctionCall;
    expect(fc.receiver_id).toBe("nutus.near");
    expect(fc.actions[0]).toMatchObject({ method_name: "create", deposit: "5250000000000000000000000" });
  });

  it("DAO-only calls target the instance with the contract's argument names", () => {
    const inst = "d.nutus.near";
    const args = (p: ProposalInput) => {
      const fc = (p.kind as { FunctionCall: { receiver_id: string; actions: { method_name: string; args: string }[] } }).FunctionCall;
      expect(fc.receiver_id).toBe(inst);
      return [fc.actions[0]!.method_name, decode(fc.actions[0]!.args)];
    };
    expect(args(build.stopStanding(inst, "3"))).toEqual(["stop_standing", { standing_id: "3" }]);
    expect(args(build.withdraw(inst, "usdc.near", "10"))).toEqual(["withdraw", { token: "usdc.near", amount: "10", to: null }]);
    expect(args(build.seedRecords(inst, [{ account: "a.near", proposal_ids: ["1", "2"] }]))).toEqual([
      "seed_records",
      { entries: [{ account: "a.near", proposal_ids: ["1", "2"] }] },
    ]);
    expect(args(build.resolveStuckPayout(inst, "7", false))).toEqual(["resolve_stuck_payout", { payout_id: "7", paid: false }]);
    expect(build.seedRecords(inst, [{ account: "a.near", proposal_ids: ["1", "2"] }]).description).toContain("2 past payments");
  });

  it("standing funding uses the fund_standing message", () => {
    const p = build.fundStandingWithToken("usdc.near", "d.nutus.near", "0", "10");
    const fc = (p.kind as { FunctionCall: { actions: { args: string }[] } }).FunctionCall;
    expect(decode(fc.actions[0]!.args)).toEqual({ receiver_id: "d.nutus.near", amount: "10", msg: "fund_standing:0" });
  });

  it("seat proposals are plain Sputnik membership kinds", () => {
    expect(build.removeMember("gone.near", "council", "no votes in 90 days").kind).toEqual({ RemoveMemberFromRole: { member_id: "gone.near", role: "council" } });
  });
});

describe("preflight", () => {
  const transfer = (token: string, to: string, amount: string): ProposalInput => ({
    description: "Pay carol",
    kind: { Transfer: { token_id: token, receiver_id: to, amount, msg: null } },
  });
  const env = (o: { registered?: string[]; daoBalance?: string; near?: Record<string, bigint | null> }): PreflightEnv => ({
    view: (async (_c: string, method: string, args: Record<string, unknown> = {}) => {
      if (method === "storage_balance_of") return (o.registered ?? []).includes(args.account_id as string) ? { total: "1" } : null;
      if (method === "ft_balance_of") return o.daoBalance ?? "0";
      throw new Error("not a token");
    }) as PreflightEnv["view"],
    nearBalance: async (a) => (o.near && a in o.near ? o.near[a]! : 10n ** 26n),
  });

  it("passes a clean token payment through unchanged", async () => {
    const p = transfer("usdc.near", "carol.near", "50");
    const r = await preflight(env({ registered: ["carol.near", "dao"], daoBalance: "100" }), "dao", p);
    expect(r).toEqual({ ok: true, issues: [], proposal: p });
  });

  it("fixes an unregistered recipient by bundling registration with the transfer", async () => {
    const r = await preflight(env({ registered: ["dao"], daoBalance: "100" }), "dao", transfer("usdc.near", "carol.near", "50"));
    expect(r.ok).toBe(true);
    expect(r.issues).toMatchObject([{ code: "RECIPIENT_NOT_REGISTERED", fixed: true }]);
    const fc = (r.proposal.kind as { FunctionCall: { receiver_id: string; actions: { method_name: string; args: string; deposit: string }[] } }).FunctionCall;
    expect(fc.receiver_id).toBe("usdc.near");
    expect(fc.actions.map((a) => a.method_name)).toEqual(["storage_deposit", "ft_transfer"]);
    expect(decode(fc.actions[1]!.args)).toEqual({ receiver_id: "carol.near", amount: "50", memo: null });
    expect(fc.actions[1]!.deposit).toBe("1");
    expect(r.proposal.description).toBe("Pay carol");
  });

  it("warns when the DAO can't cover it", async () => {
    const r = await preflight(env({ registered: ["carol.near", "dao"], daoBalance: "49" }), "dao", transfer("usdc.near", "carol.near", "50"));
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.code)).toEqual(["INSUFFICIENT_TOKEN"]);
  });

  it("flags a NEAR transfer to an account that doesn't exist, but not to an implicit account", async () => {
    const missing = await preflight(env({ near: { "ghost.near": null } }), "dao", transfer("", "ghost.near", "1"));
    expect(missing.issues.map((i) => i.code)).toEqual(["RECIPIENT_MISSING"]);
    const implicit = "a".repeat(64);
    const fine = await preflight(env({ near: { [implicit]: null } }), "dao", transfer("", implicit, "1"));
    expect(fine.ok).toBe(true);
  });

  it("reports a contract that isn't a token, and ignores other proposal kinds", async () => {
    const bad = await preflight({ view: (async () => { throw new Error("x"); }) as PreflightEnv["view"], nearBalance: async () => 1n }, "dao", transfer("nft.near", "c.near", "1"));
    expect(bad.issues.map((i) => i.code)).toEqual(["UNKNOWN_TOKEN"]);
    const other = build.pause("d.nutus.near");
    expect(await preflight(env({}), "dao", other)).toEqual({ ok: true, issues: [], proposal: other });
  });
});

describe("rpc client", () => {
  it("encodes args, decodes the byte result, and types the method", async () => {
    const calls: unknown[] = [];
    const fake = (async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      calls.push(body.params);
      const result = Array.from(new TextEncoder().encode(JSON.stringify({ dao: "d", paused: false })));
      return { ok: true, json: async () => ({ result: { result } }) };
    }) as unknown as typeof fetch;
    const cfg = await instance(rpcView("http://rpc", fake), "d.nutus.near").view("get_config");
    expect(cfg.dao).toBe("d");
    expect(calls[0]).toMatchObject({ request_type: "call_function", account_id: "d.nutus.near", method_name: "get_config", args_base64: "e30=" });
  });
});
