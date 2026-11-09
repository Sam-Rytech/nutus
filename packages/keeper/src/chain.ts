// near-api-js implementation of the keeper's Chain interface.

import { Account, JsonRpcProvider, teraToGas, type KeyPairString } from "near-api-js";
import type { Chain } from "./keeper.ts";

export function nearChain(rpcUrl: string, accountId: string, secretKey: string): Chain {
  const provider = new JsonRpcProvider({ url: rpcUrl });
  const account = new Account(accountId, provider, secretKey as KeyPairString);
  return {
    async view<T>(contractId: string, method: string, args: Record<string, unknown> = {}) {
      return (await provider.callFunction({ contractId, method, args })) as T;
    },
    async call(contractId: string, method: string, args: Record<string, unknown>, tgas: number) {
      return account.callFunction({ contractId, methodName: method, args, gas: teraToGas(tgas) });
    },
  };
}
