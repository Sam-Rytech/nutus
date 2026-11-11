import { describe, expect, it } from "vitest";
import type { Instance, Policy } from "@nutus/core";
import { DAY, HOUR, KINDS, type Snapshot } from "../src/alerts.ts";
import { handleUpdate, loadChat, secretsFor, tick, type Deps } from "../src/bot.ts";
import { MemoryStore } from "../src/store.ts";
import type { Bot, Keyboard, Update } from "../src/telegram.ts";

const T0 = 1_000n * DAY;
const MIN = 60_000_000_000n;
const policy: Policy = {
  roles: [],
  default_vote_policy: { weight_kind: "RoleWeight", quorum: "0", threshold: [1, 2] },
  proposal_bond: "1",
  proposal_period: String(7n * DAY),
  bounty_bond: "1",
  bounty_forgiveness_period: "1",
};
const payout = (id: string, filed: bigint): Instance.Payout => ({
  id, lane: "design", filer: "f", recipient: "r.testnet", token: "usd", amount: "10000000", link: "https://x/work",
  tier: "Small", filed_at_ns: String(filed), deadline_ns: String(filed + 48n * HOUR), deposit: "0", status: "Waiting",
});

class FakeBot implements Bot {
  sent: { chat: string; text: string; keyboard?: Keyboard }[] = [];
  edits: { text: string; keyboard?: Keyboard }[] = [];
  answers: (string | undefined)[] = [];
  admins = new Set<number>();
  gone = new Set<string>();
  async send(chat: string | number, text: string, keyboard?: Keyboard) {
    if (this.gone.has(String(chat))) throw new Error("Telegram sendMessage: Forbidden: bot was kicked from the group chat");
    this.sent.push({ chat: String(chat), text, keyboard });
  }
  async edit(_c: string | number, _m: number, text: string, keyboard?: Keyboard) {
    this.edits.push({ text, keyboard });
  }
  async answer(_id: string, text?: string) {
    this.answers.push(text);
  }
  async isAdmin(_c: string | number, user: number) {
    return this.admins.has(user);
  }
}

function setup(payouts: Instance.Payout[] = []) {
  let now = T0;
  const bot = new FakeBot();
  const store = new MemoryStore();
  const snap: Snapshot = {
    instance: "i.testnet", dao: "d.testnet", app: "https://app", council: [], policy, payouts, standing: [],
    escalations: new Map(), recent: [], tokens: new Map([["usd", { decimals: 6, symbol: "tUSDC" }]]),
  };
  const d: Deps = { bot, store, snapshot: async () => snap, instance: "i.testnet", app: "https://app", now: () => now };
  return { bot, store, d, at: (t: bigint) => (now = t) };
}

const msg = (chat: number, text: string, type: "private" | "group" = "group", from = 7): Update => ({
  update_id: 1,
  message: { message_id: 1, chat: { id: chat, type }, from: { id: from }, text },
});
const tap = (chat: number, data: string, type: "private" | "group" = "group", from = 7): Update => ({
  update_id: 2,
  callback_query: { id: "q", from: { id: from }, data, message: { message_id: 9, chat: { id: chat, type } } },
});
const labels = (k?: Keyboard) => (k ?? []).flat().map((b) => b.text);

describe("commands", () => {
  it("/start turns every alert on, as it happens, and explains it in plain words", async () => {
    const { bot, store, d } = setup();
    await handleUpdate(msg(-5, "/start@nutusalertbot"), d);
    expect(await store.smembers("chats")).toEqual(["-5"]);
    expect((await loadChat(store, -5))!.on).toEqual([...KINDS]);
    const w = bot.sent[0]!;
    expect(w.text).toContain("Nutus alerts are on");
    expect(w.text).toContain("every alert, as it happens");
    expect(w.text).not.toMatch(/gh secret|chat's id/);
    expect(labels(w.keyboard)).toEqual(["Settings", "What needs us now", "Open the council inbox"]);
  });

  it("a second /start keeps the chat's settings", async () => {
    const { bot, store, d } = setup();
    await handleUpdate(msg(-5, "/start"), d);
    bot.admins.add(7);
    await handleUpdate(tap(-5, "f:24h"), d);
    await handleUpdate(msg(-5, "/start"), d);
    expect((await loadChat(store, -5))!.every).toBe("24h");
    expect(bot.sent.at(-1)!.text).toContain("already on");
  });

  it("/stop needs an admin in a group", async () => {
    const { bot, store, d } = setup();
    await handleUpdate(msg(-5, "/start"), d);
    await handleUpdate(msg(-5, "/stop"), d);
    expect(await store.smembers("chats")).toEqual(["-5"]);
    bot.admins.add(7);
    await handleUpdate(msg(-5, "/stop"), d);
    expect(await store.smembers("chats")).toEqual([]);
  });

  it("/status replies with what needs the council", async () => {
    const { bot, d } = setup([payout("1", T0 - HOUR)]);
    await handleUpdate(msg(1, "/status", "private"), d);
    expect(bot.sent[0]!.text).toContain("Paying unless someone objects (1)");
  });
});

describe("settings buttons", () => {
  it("toggle an alert and redraw the same message", async () => {
    const { bot, store, d } = setup();
    await handleUpdate(msg(1, "/start", "private"), d);
    await handleUpdate(tap(1, "t:quiet", "private"), d);
    expect((await loadChat(store, 1))!.on).not.toContain("quiet");
    expect(bot.edits[0]!.text).toContain("4 of 5 alerts");
    expect(labels(bot.edits[0]!.keyboard).find((t) => t.includes("Council seats"))).toMatch(/^▫️/);
    await handleUpdate(tap(1, "t:quiet", "private"), d);
    expect((await loadChat(store, 1))!.on).toEqual([...KINDS]);
  });

  it("can only be changed by group admins", async () => {
    const { bot, store, d } = setup();
    await handleUpdate(msg(-5, "/start"), d);
    await handleUpdate(tap(-5, "f:1h", "group", 99), d);
    expect((await loadChat(store, -5))!.every).toBe("now");
    expect(bot.answers.at(-1)).toContain("Only group admins");
  });
});

describe("tick", () => {
  it("sends each new alert once to a chat that wants them as they happen", async () => {
    const { bot, d, at } = setup([payout("4", T0 + 5n * MIN)]);
    await handleUpdate(msg(-5, "/start"), d);
    bot.sent = [];
    at(T0 + 15n * MIN);
    expect((await tick(d)).sent).toBe(1);
    expect(bot.sent[0]!.text).toContain("New payout #4");
    expect(labels(bot.sent[0]!.keyboard)).toEqual(["See the work", "Object"]);
    at(T0 + 30n * MIN);
    expect((await tick(d)).sent).toBe(0);
  });

  it("skips alerts the chat turned off", async () => {
    const { bot, d, at } = setup([payout("4", T0 + 1n)]);
    await handleUpdate(msg(1, "/start", "private"), d);
    await handleUpdate(tap(1, "t:filed", "private"), d);
    bot.sent = [];
    at(T0 + HOUR);
    await tick(d);
    expect(bot.sent).toEqual([]);
  });

  it("holds alerts for an hourly summary, then sends them together", async () => {
    const { bot, store, d, at } = setup([payout("4", T0 + 1n), payout("5", T0 + 20n * MIN)]);
    await handleUpdate(msg(1, "/start", "private"), d);
    await handleUpdate(tap(1, "f:1h", "private"), d);
    bot.sent = [];
    at(T0 + 15n * MIN);
    await tick(d);
    at(T0 + 30n * MIN);
    await tick(d);
    expect(bot.sent).toEqual([]);
    expect((await loadChat(store, 1))!.pending).toHaveLength(2);
    at(T0 + HOUR);
    await tick(d);
    expect(bot.sent).toHaveLength(1);
    expect(bot.sent[0]!.text).toContain("Nutus · 2 updates in the last hour");
    expect((await loadChat(store, 1))!.pending).toEqual([]);
  });

  it("forgets a chat that removed the bot", async () => {
    const { bot, store, d, at } = setup([payout("4", T0 + 1n)]);
    await handleUpdate(msg(-5, "/start"), d);
    bot.gone.add("-5");
    at(T0 + 15n * MIN);
    expect((await tick(d)).dropped).toBe(1);
    expect(await store.smembers("chats")).toEqual([]);
  });
});

describe("secretsFor", () => {
  it("derives fixed, distinct secrets from the token, in characters Telegram allows", () => {
    const a = secretsFor("123:abc");
    expect(a).toEqual(secretsFor("123:abc"));
    expect(a.webhook).not.toBe(a.tick.slice(0, 48));
    expect(a.webhook).toMatch(/^[0-9a-f]{48}$/);
  });
});
