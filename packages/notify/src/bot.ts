// The bot: commands and settings buttons (answered by the webhook as they
// arrive), and the tick (every 15 minutes) that finds new alerts and delivers
// them to each chat the way that chat asked for.

import { createHash } from "node:crypto";
import { DAY, HOUR, KINDS, KIND_LABEL, alerts, appPage, esc, status, type Alert, type Kind, type Snapshot } from "./alerts.ts";
import type { Store } from "./store.ts";
import { command, type Bot, type Keyboard, type Update } from "./telegram.ts";

export type Every = "now" | "1h" | "6h" | "24h";
export const EVERY: Record<Every, { label: string; ns: bigint; says: string; period: string }> = {
  now: { label: "As it happens", ns: 0n, says: "as it happens", period: "" },
  "1h": { label: "Hourly", ns: HOUR, says: "in one summary an hour", period: "in the last hour" },
  "6h": { label: "Every 6 hours", ns: 6n * HOUR, says: "in one summary every 6 hours", period: "in the last 6 hours" },
  "24h": { label: "Daily", ns: DAY, says: "in one summary a day", period: "in the last day" },
};

export interface ChatSettings {
  on: Kind[];
  every: Every;
  /** Alerts waiting for the next summary. */
  pending: { kind: Kind; line: string }[];
  lastDigestNs: string;
}

export interface Deps {
  bot: Bot;
  store: Store;
  snapshot: () => Promise<Snapshot>;
  instance: string;
  app: string;
  now: () => bigint;
}

/** Both secrets come from the bot token, so there is nothing extra to configure. */
export const secretsFor = (token: string) => ({
  webhook: createHash("sha256").update(`${token}:webhook`).digest("hex").slice(0, 48),
  tick: createHash("sha256").update(`${token}:tick`).digest("hex"),
});

const CHATS = "chats";
const key = (chat: string | number) => `chat:${chat}`;
const fresh = (now: bigint): ChatSettings => ({ on: [...KINDS], every: "now", pending: [], lastDigestNs: String(now) });

export async function loadChat(store: Store, chat: string | number): Promise<ChatSettings | null> {
  const raw = await store.get(key(chat));
  return raw ? (JSON.parse(raw) as ChatSettings) : null;
}
const saveChat = (store: Store, chat: string | number, c: ChatSettings) => store.set(key(chat), JSON.stringify(c));

function summary(c: ChatSettings): string {
  const n = c.on.length;
  if (n === 0) return "Every alert is off, so this chat hears nothing until you turn one on.";
  return `This chat gets ${n === KINDS.length ? "every alert" : `${n} of ${KINDS.length} alerts`}, ${EVERY[c.every].says}.`;
}

export function settingsView(c: ChatSettings): { text: string; keyboard: Keyboard } {
  const kinds = KINDS.map((k) => [{ text: `${c.on.includes(k) ? "✅" : "▫️"} ${KIND_LABEL[k]}`, callback_data: `t:${k}` }]);
  const opt = (e: Every) => ({ text: `${c.every === e ? "● " : ""}${EVERY[e].label}`, callback_data: `f:${e}` });
  return {
    text: ["<b>Alert settings</b>", "Tap an alert to turn it on or off, then choose how often to hear about them.", "", summary(c)].join("\n"),
    keyboard: [...kinds, [opt("now"), opt("1h")], [opt("6h"), opt("24h")], [{ text: "Done", callback_data: "x" }]],
  };
}

function welcome(d: Deps, c: ChatSettings, already: boolean): { text: string; keyboard: Keyboard } {
  return {
    text: [
      already ? "<b>Nutus alerts are already on here</b>" : "<b>Nutus alerts are on</b>",
      `This chat follows the council's payouts on <code>${esc(d.instance)}</code>. It hears about:`,
      "",
      "• new payouts, while they can still be stopped",
      "• payouts sent to a DAO vote",
      "• expired votes to finalize, to recover the bond",
      "• recurring pay running short",
      "• council seats gone quiet",
      "",
      summary(c),
    ].join("\n"),
    keyboard: [
      [{ text: "Settings", callback_data: "s" }, { text: "What needs us now", callback_data: "st" }],
      [{ text: "Open the council inbox", url: appPage(d, "/council") }],
    ],
  };
}

const groupish = (type: string) => type === "group" || type === "supergroup";

async function sendStatus(d: Deps, chat: number) {
  await d.bot.send(chat, status(await d.snapshot(), d.now()), [[{ text: "Open the council inbox", url: appPage(d, "/council") }]]);
}

export async function handleUpdate(u: Update, d: Deps): Promise<void> {
  if (u.message) {
    const m = u.message;
    const cmd = command(m.text);
    if (!cmd) return;
    const chat = m.chat.id;
    const current = await loadChat(d.store, chat);

    if (cmd === "start" || cmd === "help") {
      const c = current ?? fresh(d.now());
      if (!current) {
        await saveChat(d.store, chat, c);
        await d.store.sadd(CHATS, String(chat));
      }
      const w = welcome(d, c, !!current && cmd === "start");
      await d.bot.send(chat, w.text, w.keyboard);
    } else if (cmd === "settings") {
      if (!current) return void (await d.bot.send(chat, "Alerts are off in this chat. Send /start to turn them on."));
      const v = settingsView(current);
      await d.bot.send(chat, v.text, v.keyboard);
    } else if (cmd === "status") {
      await sendStatus(d, chat);
    } else if (cmd === "stop") {
      if (groupish(m.chat.type) && m.from && !(await d.bot.isAdmin(chat, m.from.id))) {
        return void (await d.bot.send(chat, "Only group admins can turn alerts off."));
      }
      await d.store.srem(CHATS, String(chat));
      await d.store.del(key(chat));
      await d.bot.send(chat, "Alerts are off in this chat. Send /start to turn them back on.");
    }
    return;
  }

  const q = u.callback_query;
  if (!q?.message || !q.data) return;
  const chat = q.message.chat.id;
  if (q.data === "st") {
    await d.bot.answer(q.id);
    return sendStatus(d, chat);
  }
  const c = (await loadChat(d.store, chat)) ?? fresh(d.now());
  if (q.data === "s") {
    await d.bot.answer(q.id);
    const v = settingsView(c);
    return void (await d.bot.send(chat, v.text, v.keyboard));
  }
  if (q.data === "x") {
    await d.bot.answer(q.id, "Saved");
    return void (await d.bot.edit(chat, q.message.message_id, `<b>Alert settings saved</b>\n${summary(c)}\n\nChange them any time with /settings.`));
  }
  if (groupish(q.message.chat.type) && !(await d.bot.isAdmin(chat, q.from.id))) {
    return void (await d.bot.answer(q.id, "Only group admins can change alert settings."));
  }
  const [op, arg] = q.data.split(":") as [string, string];
  if (op === "t" && (KINDS as readonly string[]).includes(arg)) {
    const k = arg as Kind;
    c.on = c.on.includes(k) ? c.on.filter((x) => x !== k) : KINDS.filter((x) => x === k || c.on.includes(x));
  } else if (op === "f" && arg in EVERY) {
    if (c.every === "now" && arg !== "now") c.lastDigestNs = String(d.now());
    c.every = arg as Every;
  } else {
    return void (await d.bot.answer(q.id));
  }
  await saveChat(d.store, chat, c);
  await d.store.sadd(CHATS, String(chat));
  await d.bot.answer(q.id);
  const v = settingsView(c);
  await d.bot.edit(chat, q.message.message_id, v.text, v.keyboard);
}

export function digest(c: ChatSettings, d: Pick<Deps, "app" | "instance">): { text: string; keyboard: Keyboard } {
  const n = c.pending.length;
  const shown = c.pending.slice(0, 25);
  const lines = shown.map((p) => `• ${p.line}`);
  if (n > shown.length) lines.push(`…and ${n - shown.length} more`);
  return {
    text: [`<b>Nutus · ${n} update${n === 1 ? "" : "s"} ${EVERY[c.every].period}</b>`, "", ...lines].join("\n"),
    keyboard: [[{ text: "Open the council inbox", url: appPage(d, "/council") }]],
  };
}

const GONE = /bot was kicked|chat not found|bot was blocked|group chat was upgraded|user is deactivated/;

export interface TickResult {
  from: string;
  to: string;
  chats: number;
  alerts: number;
  sent: number;
  dropped: number;
}

export async function tick(d: Deps): Promise<TickResult> {
  const now = d.now();
  const last = await d.store.get("lastTick");
  let from = last ? BigInt(last) : now - 15n * 60n * 1_000_000_000n;
  if (from < now - DAY) from = now - DAY; // after a long gap, don't flood chats with old news
  const chats = await d.store.smembers(CHATS);
  const r: TickResult = { from: String(from), to: String(now), chats: chats.length, alerts: 0, sent: 0, dropped: 0 };
  if (chats.length > 0) {
    const found: Alert[] = alerts(await d.snapshot(), from, now);
    r.alerts = found.length;
    for (const chat of chats) {
      try {
        const c = await loadChat(d.store, chat);
        if (!c) continue;
        const mine = found.filter((a) => c.on.includes(a.kind));
        if (c.every === "now") {
          for (const a of mine) {
            await d.bot.send(chat, a.text, [a.buttons]);
            r.sent++;
          }
          continue;
        }
        c.pending.push(...mine.map((a) => ({ kind: a.kind, line: a.line })));
        if (now - BigInt(c.lastDigestNs) >= EVERY[c.every].ns) {
          if (c.pending.length > 0) {
            const g = digest(c, d);
            await d.bot.send(chat, g.text, g.keyboard);
            r.sent++;
          }
          c.pending = [];
          c.lastDigestNs = String(now);
        }
        await saveChat(d.store, chat, c);
      } catch (e) {
        // A chat that removed the bot stops getting tried.
        if (GONE.test((e as Error).message)) {
          await d.store.srem(CHATS, chat);
          await d.store.del(key(chat));
          r.dropped++;
        } else {
          console.error(`chat ${chat}: ${(e as Error).message}`);
        }
      }
    }
  }
  await d.store.set("lastTick", String(now));
  return r;
}
