// Live testnet deployment (deployments/testnet.env, v2). Override with
// ?instance=<account> to point the app at any Nutus instance on testnet.

export const NETWORK = "testnet" as const;
export const RPC_URL = "https://rpc.testnet.fastnear.com";
export const MAINNET_RPC_URL = "https://rpc.mainnet.fastnear.com";
export const EXPLORER = "https://testnet.nearblocks.io";

export const DEFAULTS = {
  instance: "nutus-demo.v2.nutus-dev.testnet",
  factory: "v2.nutus-dev.testnet",
  token: "tusdc.nutus-dev.testnet",
  daoFactory: "sputnikv2.testnet",
};

export function instanceId(): string {
  return new URLSearchParams(location.search).get("instance") ?? DEFAULTS.instance;
}
