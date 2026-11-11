// The two Telegram Bot API calls the notifier needs. No library: plain fetch.

export interface Update {
  update_id: number;
  message?: { chat: { id: number; type: string; title?: string }; text?: string };
}

export class Telegram {
  constructor(
    private token: string,
    private fetchFn: typeof fetch = fetch,
  ) {}

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
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

  send(chatId: string | number, html: string) {
    return this.call("sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  }

  /** Pending updates; passing `offset` confirms everything before it. */
  updates(offset?: number) {
    return this.call<Update[]>("getUpdates", { offset, timeout: 0, allowed_updates: ["message"] });
  }
}

/** "/status@nutus_bot args" → "status". */
export function command(text: string | undefined): string | null {
  const m = /^\/([a-z_]+)(?:@\w+)?(?:\s|$)/i.exec(text?.trim() ?? "");
  return m ? m[1]!.toLowerCase() : null;
}
