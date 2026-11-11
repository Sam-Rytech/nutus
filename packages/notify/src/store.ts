// Where the bot keeps each chat's settings and queued digest: Upstash Redis
// over its REST API (no client library), or memory for tests.

export interface Store {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
  sadd(key: string, member: string): Promise<void>;
  srem(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
}

export class RedisStore implements Store {
  constructor(
    private url: string,
    private token: string,
    private fetchFn: typeof fetch = fetch,
  ) {}

  private async cmd<T>(...args: string[]): Promise<T> {
    const r = await this.fetchFn(this.url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    const j = (await r.json()) as { result?: T; error?: string };
    if (j.error) throw new Error(`Redis ${args[0]}: ${j.error}`);
    return j.result as T;
  }

  get = (k: string) => this.cmd<string | null>("GET", k);
  set = async (k: string, v: string) => void (await this.cmd("SET", k, v));
  del = async (k: string) => void (await this.cmd("DEL", k));
  sadd = async (k: string, m: string) => void (await this.cmd("SADD", k, m));
  srem = async (k: string, m: string) => void (await this.cmd("SREM", k, m));
  smembers = (k: string) => this.cmd<string[]>("SMEMBERS", k);
}

/** Vercel's Upstash integration names these KV_REST_API_*; Upstash's own docs say UPSTASH_REDIS_REST_*. */
export function storeFromEnv(env: Record<string, string | undefined>): RedisStore {
  const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("No Redis configured: add Upstash Redis to the Vercel project");
  return new RedisStore(url, token);
}

export class MemoryStore implements Store {
  kv = new Map<string, string>();
  sets = new Map<string, Set<string>>();
  get = async (k: string) => this.kv.get(k) ?? null;
  set = async (k: string, v: string) => void this.kv.set(k, v);
  del = async (k: string) => void this.kv.delete(k);
  sadd = async (k: string, m: string) => void (this.sets.get(k) ?? this.sets.set(k, new Set()).get(k)!).add(m);
  srem = async (k: string, m: string) => void this.sets.get(k)?.delete(m);
  smembers = async (k: string) => [...(this.sets.get(k) ?? [])];
}
