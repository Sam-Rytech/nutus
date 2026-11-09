import { describe, expect, it } from "vitest";
import { BENIGN, discover, runRound, type Chain } from "../src/keeper.ts";
import { plan } from "../src/plan.ts";
import type { Payout, Snapshot, Standing } from "../src/types.ts";

const NOW = 1_000_000n;
const I = "demo.nutus.testnet";

const payout = (over: Partial<Payout>): Payout => ({
  id: "0",
  lane: "design",
  recipient: "carol.testnet",
  token: "usdc.testnet",
  amount: "50",
  tier: "Small",
  deadline_ns: String(NOW - 1n),
  status: "Waiting",
  ...over,
});

const standing = (over: Partial<Standing>): Standing => ({
  id: "0",
  amount: "10",
  next_due_ns: String(NOW - 1n),
  ends_at_ns: null,
  buffer: "10",
  sending: false,
  state: "Active",
  ...over,
});

const snap = (over: Partial<Snapshot>): Snapshot => ({
  instance: I,
  config: { dao: "demo.sputnik-dao.testnet", paused: false },
  payouts: [],
  standing: [],
  proposals: new Map(),
  ...over,
});

const kinds = (s: Snapshot) => plan(s, NOW).map((a) => `${a.kind}:${a.id}`);

describe("plan: payouts", () => {
  it("releases a Small payout only after its window", () => {
    expect(kinds(snap({ payouts: [payout({})] }))).toEqual(["release:0"]);
    expect(kinds(snap({ payouts: [payout({ deadline_ns: String(NOW + 1n) })] }))).toEqual([]);
  });

  it("doesn't release while paused, but still escalates a timed-out Medium", () => {
    const s = snap({
      config: { dao: "d", paused: true },
      payouts: [payout({ id: "0" }), payout({ id: "1", tier: "Medium" })],
    });
    expect(kinds(s)).toEqual(["escalate:1"]);
  });

  it("escalates a Medium only after its timeout", () => {
    expect(kinds(snap({ payouts: [payout({ tier: "Medium", deadline_ns: String(NOW + 5n) })] }))).toEqual([]);
    expect(kinds(snap({ payouts: [payout({ tier: "Medium" })] }))).toEqual(["escalate:0"]);
  });

  it("ignores payouts that are in flight or final", () => {
    const done = ["Sending", "Paid", "Cancelled"] as const;
    expect(kinds(snap({ payouts: done.map((status, i) => payout({ id: String(i), status })) }))).toEqual([]);
  });

  it("leaves needs_manual_filing for people", () => {
    const p = payout({ status: { Objected: { by: "c1", reason: "x", needs_manual_filing: true } } });
    expect(kinds(snap({ payouts: [p] }))).toEqual([]);
  });

  it("settles an escalation once the DAO has decided", () => {
    const p = payout({ status: { Escalated: { proposal_id: "7" } } });
    expect(kinds(snap({ payouts: [p], proposals: new Map([["7", "InProgress"]]) }))).toEqual([]);
    expect(kinds(snap({ payouts: [p], proposals: new Map([["7", "Approved"]]) }))).toEqual(["settle_escalation:0"]);
    expect(kinds(snap({ payouts: [p], proposals: new Map([["7", "Rejected"]]) }))).toEqual(["settle_escalation:0"]);
  });
});

describe("plan: standing", () => {
  it("pays a due payment the buffer covers", () => {
    expect(kinds(snap({ standing: [standing({})] }))).toEqual(["pay_due:0"]);
  });

  it("skips a short buffer instead of burning gas every round", () => {
    expect(kinds(snap({ standing: [standing({ buffer: "9" })] }))).toEqual([]);
  });

  it("pays notice even while paused and with an empty buffer", () => {
    const st = standing({ buffer: "0", state: { Noticed: { notice_started_ns: "1", remaining_periods: 2 } } });
    expect(kinds(snap({ config: { dao: "d", paused: true }, standing: [st] }))).toEqual(["pay_due:0"]);
  });

  it("skips regular payments while paused", () => {
    expect(kinds(snap({ config: { dao: "d", paused: true }, standing: [standing({})] }))).toEqual([]);
  });

  it("closes a payment past its end date", () => {
    const st = standing({ next_due_ns: String(NOW + 100n), ends_at_ns: String(NOW + 50n), buffer: "0" });
    expect(kinds(snap({ standing: [st] }))).toEqual(["pay_due:0"]);
  });

  it("skips sending, ended and not-yet-due payments", () => {
    const s = snap({
      standing: [
        standing({ id: "0", sending: true }),
        standing({ id: "1", state: "Ended" }),
        standing({ id: "2", next_due_ns: String(NOW + 1n) }),
      ],
    });
    expect(kinds(s)).toEqual([]);
  });
});

/** In-memory chain: views from a snapshot; calls succeed once, then refuse. */
function fakeChain(s: Snapshot) {
  const calls: string[] = [];
  const done = new Set<string>();
  const chain: Chain = {
    async view<T>(contractId: string, method: string, args: Record<string, unknown> = {}) {
      if (method === "get_config") return s.config as T;
      if (method === "get_payouts") return (Number(args.from_index) === 0 ? s.payouts : []) as T;
      if (method === "get_standing") return (Number(args.from_index) === 0 ? s.standing : []) as T;
      if (method === "get_proposal") return { status: s.proposals.get(String(args.id)) } as T;
      if (method === "list_instances") return (Number(args.from_index) === 0 ? [{ dao: "d", instance: I }] : []) as T;
      throw new Error(`unexpected view ${contractId}.${method}`);
    },
    async call(contractId: string, method: string, args: Record<string, unknown>) {
      const key = `${contractId}.${method}(${Object.values(args).join()})`;
      calls.push(key);
      if (done.has(key)) throw new Error("Smart contract panicked: ALREADY_SENT");
      done.add(key);
      return null;
    },
  };
  return { chain, calls };
}

describe("runRound", () => {
  const state = () =>
    snap({
      payouts: [
        payout({ id: "0" }),
        payout({ id: "1", tier: "Medium" }),
        payout({ id: "2", status: { Escalated: { proposal_id: "3" } } }),
      ],
      standing: [standing({})],
      proposals: new Map([["3", "Approved"]]),
    });

  it("calls everything due with the right argument names and gas", async () => {
    const { chain, calls } = fakeChain(state());
    const r = await runRound(chain, [I], NOW);
    expect(r.failed).toEqual([]);
    expect(calls).toEqual([
      `${I}.release(0)`,
      `${I}.escalate(1)`,
      `${I}.settle_escalation(2)`,
      `${I}.pay_due(0)`,
    ]);
  });

  it("is idempotent: a repeat round reports skips, not failures", async () => {
    const { chain } = fakeChain(state());
    await runRound(chain, [I], NOW);
    const again = await runRound(chain, [I], NOW);
    expect(again.done).toEqual([]);
    expect(again.failed).toEqual([]);
    expect(again.skipped.map((s) => s.reason)).toEqual(["ALREADY_SENT", "ALREADY_SENT", "ALREADY_SENT", "ALREADY_SENT"]);
  });

  it("reports unexpected errors as failures and carries on", async () => {
    const { chain } = fakeChain(state());
    const broken: Chain = {
      view: chain.view,
      async call(c, m, a, g) {
        if (m === "escalate") throw new Error("Exceeded the prepaid gas");
        return chain.call(c, m, a, g);
      },
    };
    const r = await runRound(broken, [I], NOW);
    expect(r.failed.map((f) => f.action.kind)).toEqual(["escalate"]);
    expect(r.done).toHaveLength(3);
  });

  it("discovers instances from the factory when none are listed", async () => {
    const { chain } = fakeChain(state());
    expect(await discover(chain, [], "nutus.testnet")).toEqual([I]);
    expect(await discover(chain, ["x"], "nutus.testnet")).toEqual(["x"]);
  });

  it("treats every contract 'already done / not due' error as benign", () => {
    expect(BENIGN).toEqual(expect.arrayContaining(["ALREADY_SENT", "WINDOW_OPEN", "NOT_TIMED_OUT", "PROPOSAL_IN_PROGRESS"]));
  });
});
