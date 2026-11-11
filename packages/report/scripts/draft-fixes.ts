// Prints the Fix-this proposals the Report screen drafts for a DAO, as JSON
// ready for `add_proposal`. Same code path as the app.
//   tsx scripts/draft-fixes.ts <dao> <factory> [rpc]
import { build, instanceAccount, rpcView } from "@nutus/core";
import { DAY, proposalsSince, recordsFromHistory, recurringSeries, repeatSeries, seedBatches, standingFromSeries } from "../src/index.ts";
import type { Policy } from "@nutus/core";

const [dao, factory, rpc = "https://rpc.testnet.fastnear.com"] = process.argv.slice(2);
if (!dao || !factory) {
  console.error("Usage: tsx scripts/draft-fixes.ts <dao> <factory> [rpc]");
  process.exit(1);
}
const view = rpcView(rpc);
const now = BigInt(Date.now()) * 1_000_000n;
const proposals = await proposalsSince(view, dao, now - 365n * DAY);
const policy = await view<Policy>(dao, "get_policy");
const instance = instanceAccount(dao, factory);
const seeds = seedBatches(recordsFromHistory(dao, proposals)).map((b) => build.seedRecords(instance, b));
const standing = recurringSeries(repeatSeries([{ dao, policy, proposals }])).map((s) => build.addStanding(instance, standingFromSeries(s, now)));
console.log(JSON.stringify({ instance, seeds, standing }, null, 2));
