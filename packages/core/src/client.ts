// Typed read access to the Nutus contracts. Method names, arguments and
// results all come from the generated ABI types, so a contract change that
// isn't regenerated fails to compile here.

import type { FactoryMethods } from "./generated/factory.ts";
import type { InstanceMethods } from "./generated/instance.ts";
import type { View } from "./rpc.ts";

type ViewNames<M> = { [K in keyof M]: M[K] extends { kind: "view" } ? K : never }[keyof M];
type Args<M, K extends keyof M> = M[K] extends { args: infer A } ? A : never;
type Result<M, K extends keyof M> = M[K] extends { result: infer R } ? R : never;

export interface Reader<M> {
  id: string;
  view<K extends ViewNames<M> & string>(method: K, args?: Args<M, K>): Promise<Result<M, K>>;
}

function reader<M>(view: View, id: string): Reader<M> {
  return {
    id,
    view: (method, args) => view(id, method, (args ?? {}) as Record<string, unknown>),
  };
}

export const instance = (view: View, id: string): Reader<InstanceMethods> => reader(view, id);
export const factory = (view: View, id: string): Reader<FactoryMethods> => reader(view, id);

/** Every payout, paging through `get_payouts`. */
export async function allPayouts(inst: Reader<InstanceMethods>, page = 100) {
  const out: Result<InstanceMethods, "get_payouts"> = [];
  for (let from = 0; ; from += page) {
    const batch = await inst.view("get_payouts", { from_index: String(from), limit: page });
    out.push(...batch);
    if (batch.length < page) return out;
  }
}

export async function allStanding(inst: Reader<InstanceMethods>, page = 100) {
  const out: Result<InstanceMethods, "get_standing"> = [];
  for (let from = 0; ; from += page) {
    const batch = await inst.view("get_standing", { from_index: String(from), limit: page });
    out.push(...batch);
    if (batch.length < page) return out;
  }
}
