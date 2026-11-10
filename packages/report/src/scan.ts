// Reads Sputnik DAO history over RPC: the DAO list from the factory, each
// DAO's policy, and every proposal submitted inside the window (paging back
// from the newest). Results are cached as JSON files so a rerun is cheap.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Policy, Proposal, View } from "@nutus/core";
import type { DaoHistory } from "./metrics.ts";
import { proposalsSince, retry } from "./history.ts";

export interface ScanOptions {
  view: View;
  /** Sputnik factory, e.g. `sputnik-dao.near`. */
  factory: string;
  /** Window start, ns. */
  from: bigint;
  /** Keep DAOs with at least this many proposals in the window. */
  minProposals: number;
  /** Directory for per-DAO JSON (skip the network for DAOs already there). */
  cacheDir?: string;
  concurrency?: number;
  log?: (msg: string) => void;
}

async function pool<T, R>(items: T[], n: number, f: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await f(items[i]!, i);
      }
    }),
  );
  return out;
}

export interface ScanResult {
  scanned: number;
  kept: DaoHistory[];
  errors: { dao: string; error: string }[];
}

export async function scan(o: ScanOptions): Promise<ScanResult> {
  const log = o.log ?? (() => {});
  const daos = await retry(() => o.view<string[]>(o.factory, "get_dao_list"));
  log(`${daos.length} DAOs on ${o.factory}`);
  if (o.cacheDir) mkdirSync(o.cacheDir, { recursive: true });
  const errors: ScanResult["errors"] = [];
  let done = 0;
  const results = await pool(daos, o.concurrency ?? 8, async (dao) => {
    const file = o.cacheDir ? join(o.cacheDir, `${dao}.json`) : null;
    try {
      let h: DaoHistory | null;
      if (file && existsSync(file)) {
        h = JSON.parse(readFileSync(file, "utf8")) as DaoHistory | null;
      } else {
        const proposals = await proposalsSince(o.view, dao, o.from);
        h = proposals.length >= o.minProposals ? { dao, policy: await retry(() => o.view<Policy>(dao, "get_policy")), proposals } : null;
        if (file) writeFileSync(file, JSON.stringify(h));
      }
      return h;
    } catch (e) {
      errors.push({ dao, error: String(e instanceof Error ? e.message : e).slice(0, 200) });
      return null;
    } finally {
      if (++done % 100 === 0) log(`${done}/${daos.length}`);
    }
  });
  return { scanned: daos.length, kept: results.filter((h): h is DaoHistory => h !== null), errors };
}
