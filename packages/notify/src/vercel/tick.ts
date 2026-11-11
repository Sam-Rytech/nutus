// POST /api/tick: called every 15 minutes (.github/workflows/notify.yml).
// Keeps the webhook pointed here, then sends or queues new alerts per chat.
import type { IncomingMessage, ServerResponse } from "node:http";
import { secretsFor, tick } from "../bot.ts";
import { APP, deps, token } from "./deps.ts";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const s = secretsFor(token());
  if (req.method !== "POST" || req.headers["x-tick-key"] !== s.tick) {
    res.statusCode = 401;
    return res.end();
  }
  res.setHeader("content-type", "application/json");
  try {
    const d = deps();
    const webhookSet = await d.tg.ensureWebhook(`${APP.replace(/\/$/, "")}/api/telegram`, s.webhook);
    const r = await tick(d);
    res.end(JSON.stringify({ webhookSet, ...r }));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: (e as Error).message }));
  }
}
