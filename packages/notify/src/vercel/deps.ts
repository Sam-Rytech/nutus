// Shared setup for the two Vercel functions.
import type { IncomingMessage } from "node:http";
import type { Deps } from "../bot.ts";
import { snapshot } from "../snapshot.ts";
import { storeFromEnv } from "../store.ts";
import { Telegram } from "../telegram.ts";

const env = (k: string, d: string) => (process.env[k] ?? "").trim() || d;
export const INSTANCE = env("NUTUS_INSTANCE", "nutus-demo.v2.nutus-dev.testnet");
export const APP = env("APP_URL", "https://nutus.vercel.app");
const RPC = env("NEAR_RPC_URL", "https://rpc.testnet.fastnear.com");

export function token(): string {
  const t = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN is not set on the Vercel project");
  return t;
}

export function deps(): Deps & { tg: Telegram } {
  const now = () => BigInt(Date.now()) * 1_000_000n;
  const tg = new Telegram(token());
  let snap: ReturnType<typeof snapshot> | null = null;
  return {
    tg,
    bot: tg,
    store: storeFromEnv(process.env),
    snapshot: () => (snap ??= snapshot({ rpc: RPC, instance: INSTANCE, app: APP, now: now() })),
    instance: INSTANCE,
    app: APP,
    now,
  };
}

export async function body(req: IncomingMessage & { body?: unknown }): Promise<unknown> {
  if (req.body !== undefined) return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
}
