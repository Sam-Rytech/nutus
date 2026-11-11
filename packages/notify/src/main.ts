#!/usr/bin/env -S npx tsx
// Preview the alerts and /status reply the bot would send, without Telegram.
// The live bot runs as two Vercel functions (src/vercel/*); see README.
//
//   LOOKBACK_HOURS=48 pnpm --filter @nutus/notify preview
//
// Env: INSTANCE (default the testnet demo), NEAR_RPC_URL, APP_URL.

import { alerts, status } from "./alerts.ts";
import { snapshot } from "./snapshot.ts";

const env = (k: string, d: string) => (process.env[k] ?? "").trim() || d;
const now = BigInt(Date.now()) * 1_000_000n;
const from = now - BigInt(Math.round(Number(env("LOOKBACK_HOURS", "24")) * 3600)) * 1_000_000_000n;
const s = await snapshot({
  rpc: env("NEAR_RPC_URL", "https://rpc.testnet.fastnear.com"),
  instance: env("INSTANCE", "nutus-demo.v2.nutus-dev.testnet"),
  app: env("APP_URL", "https://nutus.vercel.app"),
  now,
});
const found = alerts(s, from, now);
console.log(`${found.length} alert(s) in the last ${env("LOOKBACK_HOURS", "24")} h:\n`);
for (const a of found) console.log(`[${a.key}]\n${a.text}\n  buttons: ${a.buttons.map((b) => b.text).join(" | ")}\n  digest line: ${a.line}\n`);
console.log(`/status:\n${status(s, now)}`);
