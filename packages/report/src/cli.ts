#!/usr/bin/env -S npx tsx
// nutus-report scan        → scans mainnet Sputnik, writes data/scan/summary.json + REPORT.md
// nutus-report dao <id>    → findings for one DAO, live
//
// Env: NEAR_RPC_URL (default FastNear mainnet), FACTORY (sputnik-dao.near),
//      WINDOW_DAYS (365), MIN_PROPOSALS (10), CONCURRENCY (8).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { rpcView } from "@nutus/core";
import { DAY, findings, type ScanWindow } from "./metrics.ts";
import { renderReport } from "./render.ts";
import { proposalsSince } from "./history.ts";
import { scan } from "./scan.ts";
import type { Policy } from "@nutus/core";

const rpc = process.env.NEAR_RPC_URL ?? "https://rpc.mainnet.fastnear.com";
const factory = process.env.FACTORY ?? "sputnik-dao.near";
const windowDays = BigInt(process.env.WINDOW_DAYS ?? "365");
const minProposals = Number(process.env.MIN_PROPOSALS ?? "10");
const view = rpcView(rpc);
const now = BigInt(Date.now()) * 1_000_000n;
const w: ScanWindow = { now, from: now - windowDays * DAY };
const root = fileURLToPath(new URL("../../../", import.meta.url));
const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2);

const [cmd, arg] = process.argv.slice(2);

if (cmd === "scan") {
  const out = join(root, "data", "scan");
  mkdirSync(out, { recursive: true });
  const r = await scan({ view, factory, from: w.from, minProposals, cacheDir: join(out, "daos"), concurrency: Number(process.env.CONCURRENCY ?? "8"), log: (m) => console.error(m) });
  const f = findings(r.kept, w);
  const meta = { scannedAt: new Date(Number(now / 1_000_000n)).toISOString(), rpc, factory, windowDays: Number(windowDays), minProposals, daosOnFactory: r.scanned, errors: r.errors };
  writeFileSync(join(out, "summary.json"), json({ meta, findings: f }));
  writeFileSync(join(out, "REPORT.md"), renderReport(meta, f));
  console.log(json(f));
  if (r.errors.length) console.error(`${r.errors.length} DAOs failed to read; listed in summary.json`);
} else if (cmd === "dao" && arg) {
  const proposals = await proposalsSince(view, arg, w.from);
  const policy = await view<Policy>(arg, "get_policy");
  console.log(json(findings([{ dao: arg, policy, proposals }], w)));
} else {
  console.error("usage: nutus-report scan | nutus-report dao <dao-account>");
  process.exit(1);
}
