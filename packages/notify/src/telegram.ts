// The Telegram Bot API calls the bot needs. No library: plain fetch.

export interface Chat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
}

export interface Message {
  message_id: number;
  chat: Chat;
  from?: { id: number; first_name?: string };
  text?: string;
}

export interface CallbackQuery {
  id: string;
  from: { id: number };
  message?: Message;
  data?: string;
}

export interface Update {
  update_id: number;
  message?: Message;
  callback_query?: CallbackQuery;
}

export type Button = { text: string; url: string } | { text: string; callback_data: string };
export type Keyboard = Button[][];

export interface Bot {
  send(chatId: string | number, html: string, keyboard?: Keyboard): Promise<unknown>;
  edit(chatId: string | number, messageId: number, html: string, keyboard?: Keyboard): Promise<unknown>;
  answer(callbackId: string, text?: string): Promise<unknown>;
  isAdmin(chatId: string | number, userId: number): Promise<boolean>;
}

export class Telegram implements Bot {
  constructor(
    private token: string,
    private fetchFn: typeof fetch = fetch,
  ) {}

  async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const r = await this.fetchFn(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json()) as { ok: boolean; result: T; description?: string };
    // Never echo the URL: it contains the token.
    if (!j.ok) throw new Error(`Telegram ${method}: ${j.description ?? r.status}`);
    return j.result;
  }

  send(chatId: string | number, html: string, keyboard?: Keyboard) {
    return this.call("sendMessage", {
      chat_id: chatId,
      text: html,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  }

  edit(chatId: string | number, messageId: number, html: string, keyboard?: Keyboard) {
    return this.call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: html,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: keyboard ?? [] },
    }).catch((e: Error) => {
      // Tapping the option that's already selected changes nothing.
      if (!/message is not modified/.test(e.message)) throw e;
    });
  }

  answer(callbackId: string, text?: string) {
    return this.call("answerCallbackQuery", { callback_query_id: callbackId, ...(text ? { text } : {}) });
  }

  async isAdmin(chatId: string | number, userId: number) {
    const m = await this.call<{ status: string }>("getChatMember", { chat_id: chatId, user_id: userId });
    return m.status === "creator" || m.status === "administrator";
  }

  /** Points Telegram at the webhook (once) and sets the command menu. */
  async ensureWebhook(url: string, secret: string) {
    const info = await this.call<{ url: string }>("getWebhookInfo", {});
    if (info.url === url) return false;
    await this.call("setWebhook", { url, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
    await this.call("setMyCommands", {
      commands: [
        { command: "status", description: "What needs the council now" },
        { command: "settings", description: "Choose alerts and how often" },
        { command: "start", description: "Turn alerts on in this chat" },
        { command: "stop", description: "Turn alerts off in this chat" },
      ],
    });
    return true;
  }
}

/** "/status@nutus_bot args" → "status". */
export function command(text: string | undefined): string | null {
  const m = /^\/([a-z_]+)(?:@\w+)?(?:\s|$)/i.exec(text?.trim() ?? "");
  return m ? m[1]!.toLowerCase() : null;
}
