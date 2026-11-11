// Reads everything the alerts need from the instance and its DAO.

import { allPayouts, allStanding, instance, rpcView, type Policy, type Proposal, type View } from "@nutus/core";
import { DAY, QUIET_AFTER, type Snapshot, type TokenMeta } from "./alerts.ts";

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

export async function snapshot(o: { rpc: string; instance: string; app: string; now: bigint }): Promise<Snapshot> {
  const view = rpcView(o.rpc);
  const r = instance(view, o.instance);
  const [config, payouts, standing] = await Promise.all([r.view("get_config"), allPayouts(r), allStanding(r)]);
  const [policy, recent] = await Promise.all([view<Policy>(config.dao, "get_policy"), recentProposals(view, config.dao, o.now - QUIET_AFTER - 2n * DAY)]);
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
  return { instance: o.instance, dao: config.dao, app: o.app, council: config.council, policy, payouts, standing, escalations, recent, tokens };
}
