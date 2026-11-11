// POST /api/tick: called every few minutes by an outside timer (cron-job.org),
// with .github/workflows/{keeper,notify}.yml as a slower backup.
// 1. Keeper round: release / escalate / pay_due / settle whatever is due
//    (only if KEEPER_PRIVATE_KEY is set on Vercel).
// 2. Keeps the Telegram webhook pointed here, then sends or queues alerts.
// Auth: the tick key (derived from the bot token) in `x-tick-key` or `?key=`.
import type { IncomingMessage, ServerResponse } from "node:http";
import { nearChain } from "../../../keeper/src/chain.ts";
import { discover, runRound } from "../../../keeper/src/keeper.ts";
import { secretsFor, tick } from "../bot.ts";
import { APP, INSTANCE, deps, token } from "./deps.ts";

const KEY_SHAPE = /^(ed25519|secp256k1):[1-9A-HJ-NP-Za-km-z]{40,}$/;

async function keeperRound() {
  const key = (process.env.KEEPER_PRIVATE_KEY ?? "").trim();
  if (!key) return { skipped: "KEEPER_PRIVATE_KEY not set" };
  // Never echo any part of the key.
  if (!KEY_SHAPE.test(key)) return { skipped: "KEEPER_PRIVATE_KEY is not <curve>:<base58>" };
  const chain = nearChain(
    (process.env.NEAR_RPC_URL ?? "").trim() || "https://rpc.testnet.fastnear.com",
    (process.env.KEEPER_ACCOUNT_ID ?? "").trim() || "keeper.nutus-dev.testnet",
    key,
  );
  const listed = (process.env.KEEPER_INSTANCES ?? INSTANCE).split(",").map((s) => s.trim()).filter(Boolean);
  const r = await runRound(chain, await discover(chain, listed), BigInt(Date.now()) * 1_000_000n);
  return {
    done: r.done.map((a) => `${a.kind}(${a.id})`),
    skipped: r.skipped.length,
    failed: r.failed.map((f) => `${f.action.kind}(${f.action.id}): ${f.error.slice(0, 120)}`),
  };
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const s = secretsFor(token());
  const given = req.headers["x-tick-key"] ?? new URL(req.url ?? "/", "http://x").searchParams.get("key");
  if ((req.method !== "POST" && req.method !== "GET") || given !== s.tick) {
    res.statusCode = 401;
    return res.end();
  }
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  const out: Record<string, unknown> = {};
  // Keeper first, so alerts describe the state after anything due was paid.
  try {
    out.keeper = await keeperRound();
  } catch (e) {
    out.keeper = { error: (e as Error).message.slice(0, 200) };
  }
  try {
    const d = deps();
    out.webhookSet = await d.tg.ensureWebhook(`${APP.replace(/\/$/, "")}/api/telegram`, s.webhook);
    Object.assign(out, await tick(d));
  } catch (e) {
    res.statusCode = 500;
    out.error = (e as Error).message;
  }
  res.end(JSON.stringify(out));
}
