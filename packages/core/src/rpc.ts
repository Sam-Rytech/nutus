// Read-only NEAR access over plain JSON-RPC `fetch`: works in Node and the
// browser, no SDK. Signing lives with whoever holds keys (wallet, keeper).

export type View = <T>(contractId: string, method: string, args?: Record<string, unknown>) => Promise<T>;

export const RPC = {
  testnet: "https://rpc.testnet.near.org",
  mainnet: "https://rpc.mainnet.near.org",
} as const;

const b64encode = (s: string): string => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

/** Base64 of a JSON value: the `args` format Sputnik FunctionCall actions use. */
export const b64json = (v: unknown): string => b64encode(JSON.stringify(v));

export class RpcError extends Error {}

async function rpc<T>(url: string, method: string, params: unknown, fetchFn: typeof fetch): Promise<T> {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "nutus", method, params }),
  });
  if (!res.ok) throw new RpcError(`${method}: HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T & { error?: string }; error?: { cause?: { name?: string }; data?: unknown; message?: string } };
  if (body.error) throw new RpcError(`${method}: ${body.error.cause?.name ?? body.error.message} ${JSON.stringify(body.error.data ?? "")}`);
  if (body.result?.error) throw new RpcError(`${method}: ${body.result.error}`);
  return body.result as T;
}

export function rpcView(url: string, fetchFn: typeof fetch = fetch): View {
  return async <T>(contractId: string, method: string, args: Record<string, unknown> = {}) => {
    const r = await rpc<{ result: number[] }>(
      url,
      "query",
      { request_type: "call_function", finality: "final", account_id: contractId, method_name: method, args_base64: b64json(args) },
      fetchFn,
    );
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(r.result))) as T;
  };
}

export interface AccountInfo {
  amount: string;
  storage_usage: number;
}

/** `null` when the account doesn't exist. */
export async function viewAccount(url: string, accountId: string, fetchFn: typeof fetch = fetch): Promise<AccountInfo | null> {
  try {
    return await rpc<AccountInfo>(url, "query", { request_type: "view_account", finality: "final", account_id: accountId }, fetchFn);
  } catch (e) {
    if (e instanceof RpcError && /UNKNOWN_ACCOUNT|does not exist/.test(e.message)) return null;
    throw e;
  }
}
