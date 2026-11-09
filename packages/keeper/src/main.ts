#!/usr/bin/env -S npx tsx
// Nutus keeper. Anyone can run one; it only needs gas money.
//
//   KEEPER_ACCOUNT_ID=keeper.testnet KEEPER_PRIVATE_KEY=ed25519:... \
//   FACTORY=nutus.nutus-dev.testnet pnpm --filter @nutus/keeper start
//
// Env: NEAR_RPC_URL (default testnet), INSTANCES (comma list) or FACTORY,
//      INTERVAL_SEC (default 60), ONCE=1 for a single round.

import { nearChain } from "./chain.ts";
import { discover, runRound } from "./keeper.ts";

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`set ${k}`);
  return v;
};

const rpc = env("NEAR_RPC_URL", "https://rpc.testnet.near.org");
const chain = nearChain(rpc, env("KEEPER_ACCOUNT_ID"), env("KEEPER_PRIVATE_KEY"));
const explicit = (process.env.INSTANCES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const factory = process.env.FACTORY;
const intervalMs = Number(env("INTERVAL_SEC", "60")) * 1000;

async function round() {
  const instances = await discover(chain, explicit, factory);
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  const r = await runRound(chain, instances, nowNs);
  const stamp = new Date().toISOString();
  for (const a of r.done) console.log(`${stamp} ${a.instance} ${a.kind}(${a.id}) — ${a.why}`);
  for (const s of r.skipped) console.log(`${stamp} ${s.action.instance} ${s.action.kind}(${s.action.id}) skipped: ${s.reason}`);
  for (const f of r.failed) console.error(`${stamp} ${f.action.instance} ${f.action.kind}(${f.action.id}) FAILED: ${f.error}`);
  if (r.done.length + r.skipped.length + r.failed.length === 0) {
    console.log(`${stamp} nothing due across ${instances.length} instance(s)`);
  }
}

if (process.env.ONCE) {
  await round();
} else {
  for (;;) {
    await round().catch((e) => console.error("round failed:", e));
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
