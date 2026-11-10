// Reads a DAO's proposal history over RPC. No Node APIs: runs in the browser too.

import type { Proposal, View } from "@nutus/core";

const PAGE = 50;

/** Public RPCs rate-limit (HTTP 429): back off for longer on those. */
export async function retry<T>(f: () => Promise<T>, tries = 8): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await f();
    } catch (e) {
      if (i + 1 >= tries) throw e;
      const limited = /429/.test(String(e));
      const ms = (limited ? 2000 : 500) * 2 ** Math.min(i, 5) + Math.random() * 500;
      await new Promise((r) => setTimeout(r, ms));
    }
  }
}

/** Proposals submitted at or after `from`, ascending by id. */
export async function proposalsSince(view: View, dao: string, from: bigint): Promise<Proposal[]> {
  const last = await retry(() => view<number>(dao, "get_last_proposal_id"));
  const out: Proposal[] = [];
  for (let end = last; end > 0; end -= PAGE) {
    const start = Math.max(0, end - PAGE);
    const page = await retry(() => view<Proposal[]>(dao, "get_proposals", { from_index: start, limit: end - start }));
    const inWindow = page.filter((p) => BigInt(p.submission_time) >= from);
    out.unshift(...inWindow);
    if (inWindow.length < page.length) break; // reached proposals older than the window
  }
  return out;
}
