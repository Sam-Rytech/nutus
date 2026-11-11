// POST /api/telegram: Telegram delivers each message and button tap here.
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleUpdate, secretsFor } from "../bot.ts";
import type { Update } from "../telegram.ts";
import { body, deps, token } from "./deps.ts";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST" || req.headers["x-telegram-bot-api-secret-token"] !== secretsFor(token()).webhook) {
    res.statusCode = 401;
    return res.end();
  }
  try {
    await handleUpdate((await body(req)) as Update, deps());
  } catch (e) {
    // Answer 200 anyway: Telegram would otherwise retry the same update for hours.
    console.error((e as Error).message);
  }
  res.statusCode = 200;
  res.end("ok");
}
