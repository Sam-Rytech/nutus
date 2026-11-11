#!/usr/bin/env -S npx tsx
// Nutus council alerts on Telegram. One run reads the instance and its DAO,
// posts what happened since the last run to the council chat, and answers
// /status and /start. Run it on a schedule (see .github/workflows/notify.yml).
//
//   TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=-100... pnpm --filter @nutus/notify start
//   DRY_RUN=1 LOOKBACK_HOURS=48 pnpm --filter @nutus/notify start   # print, send nothing
//
// Env: INSTANCE (default the testnet demo), NEAR_RPC_URL, APP_URL,
//      STATE_FILE (remembers the last run; default .notify-state.json),
//      LOOKBACK_HOURS (window when there is no state; default 0.25).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { allPayouts, allStanding, instance, rpcView, type Policy, type Proposal, type View } from "@nutus/core";
import { DAY, QUIET_AFTER, alerts, status, type Snapshot, type TokenMeta } from "./alerts.ts";
import { Telegram, command } from "./telegram.ts";

const env = (k: string, d: string) => (process.env[k] ?? "").trim() || d;
const INSTANCE = env("INSTANCE", "nutus-demo.v2.nutus-dev.testnet");
const RPC = env("NEAR_RPC_URL", "https://rpc.testnet.fastnear.com");
const APP = env("APP_URL", "https://nutus.vercel.app");
const STATE = env("STATE_FILE", ".notify-state.json");
const DRY = !!process.env.DRY_RUN;
const token = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
const chat = (process.env.TELEGRAM_CHAT_ID ?? "").trim();
const nowNs = () => BigInt(Date.now()) * 1_000_000n;

async function recentProposals(view: View, dao: string, since: bigint): Promise<Proposal[]> {
  const last = await view<number>(dao, "get_last_proposal_id");
  const out: Proposal[] = [];
  for (let end = last; end > 0; end -= 100) {
    const from = Math.max(0, end - 100);
    const page = await view<Proposal[]>(dao, "get_proposals", { from_index: from, limit: end - from });
    out.push(...page);
    if (page.length === 0 || BigInt(page[0]!.submission_time) < since) break;
  }
  return out.filter((p) => BigInt(p.submission_time) >= since);
}

async function snapshot(): Promise<Snapshot> {
  const view = rpcView(RPC);
  const r = instance(view, INSTANCE);
  const [config, payouts, standing] = await Promise.all([r.view("get_config"), allPayouts(r), allStanding(r)]);
  const now = nowNs();
  const [policy, recent] = await Promise.all([view<Policy>(config.dao, "get_policy"), recentProposals(view, config.dao, now - QUIET_AFTER - 2n * DAY)]);
  const escalations = new Map<string, Proposal>();
  await Promise.all(
    payouts.map(async (p) => {
      if (typeof p.status === "object" && "Escalated" in p.status) {
        escalations.set(p.id, await view<Proposal>(config.dao, "get_proposal", { id: Number(p.status.Escalated.proposal_id) }));
      }
    }),
  );
  const tokens = new Map<string, TokenMeta>();
  for (const t of new Set([...payouts, ...standing].map((x) => x.token).filter((t) => t !== "near"))) {
    tokens.set(t, await view<TokenMeta>(t, "ft_metadata").catch(() => ({ decimals: 0, symbol: t })));
  }
  return { instance: INSTANCE, dao: config.dao, app: APP, council: config.council, policy, payouts, standing, escalations, recent, tokens };
}

function window(now: bigint): bigint {
  const lookback = BigInt(Math.round(Number(env("LOOKBACK_HOURS", "0.25")) * 3600)) * 1_000_000_000n;
  let from = now - lookback;
  if (!DRY && existsSync(STATE)) {
    try {
      from = BigInt((JSON.parse(readFileSync(STATE, "utf8")) as { lastRunNs: string }).lastRunNs);
    } catch {
      /* unreadable state: fall back to the lookback */
    }
  }
  // After a long gap, don't flood the chat with old news.
  return from < now - DAY ? now - DAY : from;
}

const now = nowNs();
const from = window(now);
let snap: Snapshot | null = null;
const load = async () => (snap ??= await snapshot());

if (DRY) {
  const s = await load();
  const found = alerts(s, from, now);
  console.log(`${found.length} alert(s) for ${INSTANCE} in the last ${Number((now - from) / 60_000_000_000n)} min:\n`);
  for (const a of found) console.log(`[${a.key}]\n${a.text}\n`);
  console.log(`/status reply:\n${status(s, now)}`);
  process.exit(0);
}

if (!token) {
  console.log("TELEGRAM_BOT_TOKEN is not set; nothing to do.");
  process.exit(0);
}
const tg = new Telegram(token);

// Commands sent to the bot since the last run.
const updates = await tg.updates();
for (const u of updates) {
  const m = u.message;
  const cmd = command(m?.text);
  if (!m || !cmd) continue;
  if (cmd === "start" || cmd === "help") {
    await tg.send(
      m.chat.id,
      [
        `This bot posts Nutus alerts for <code>${INSTANCE}</code>: new payouts in their window, objections, expired DAO proposals to finalize, short recurring payments and seats going quiet.`,
        `\nThis chat's id is <code>${m.chat.id}</code>. To get alerts here, set it in the repo:`,
        `<code>gh secret set TELEGRAM_CHAT_ID --body "${m.chat.id}"</code>`,
        `\n/status shows what needs the council now. Replies can take up to 15 minutes: the bot runs on a schedule.`,
      ].join("\n"),
    );
  } else if (cmd === "status") {
    await tg.send(m.chat.id, status(await load(), nowNs()));
  }
  console.log(`answered /${cmd} in chat ${m.chat.type}`);
}
if (updates.length > 0) await tg.updates(updates[updates.length - 1]!.update_id + 1);

if (chat) {
  const found = alerts(await load(), from, now);
  for (const a of found) await tg.send(chat, a.text);
  console.log(`${found.length} alert(s) sent for ${new Date(Number(from / 1_000_000n)).toISOString()} → ${new Date(Number(now / 1_000_000n)).toISOString()}`);
} else {
  console.log("TELEGRAM_CHAT_ID is not set: answered commands only. Send /start to the bot in your council chat to get its id.");
}
writeFileSync(STATE, JSON.stringify({ lastRunNs: String(now) }));
