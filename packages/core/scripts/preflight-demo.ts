// Runs preflight on a Transfer to an account that isn't registered with the token,
// and prints the proposal to file. Usage: tsx scripts/preflight-demo.ts <dao> <token> <to> <amount> <rpc>
import { preflight, rpcView, viewAccount } from "../src/index.ts";

const [dao, token, to, amount, rpc = "https://rpc.testnet.fastnear.com"] = process.argv.slice(2);
if (!dao || !token || !to || !amount) {
  console.error("Usage: tsx scripts/preflight-demo.ts <dao> <token> <to> <amount> [rpc]");
  process.exit(1);
}
const view = rpcView(rpc);
const r = await preflight(
  { view, nearBalance: async (id) => { const a = await viewAccount(rpc, id); return a ? BigInt(a.amount) : null; } },
  dao,
  { description: `Pay ${to} (preflight demo)`, kind: { Transfer: { token_id: token, receiver_id: to, amount, msg: null } } },
);
console.error(JSON.stringify(r.issues, null, 2));
console.log(JSON.stringify({ proposal: r.proposal }));
