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
// Secrets pasted or piped often carry a trailing newline or CR.
const key = env("KEEPER_PRIVATE_KEY").trim();
if (!/^(ed25519|secp256k1):[1-9A-HJ-NP-Za-km-z]{40,}$/.test(key)) {
  // Never print any part of the key: only its length and whether it starts
  // with a known curve name (GitHub masks the whole secret, not fragments).
  const curve = ["ed25519:", "secp256k1:"].find((c) => key.startsWith(c)) ?? "no known curve prefix";
  throw new Error(
    `KEEPER_PRIVATE_KEY is not "<curve>:<base58>" (${key.length} chars, ${curve}). ` +
      `A full ed25519 key is about 96 chars.`,
  );
}
const chain = nearChain(rpc, env("KEEPER_ACCOUNT_ID"), key);
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
