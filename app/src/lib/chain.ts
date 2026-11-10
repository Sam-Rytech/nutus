import { instance, rpcView, viewAccount, type Instance, type View } from "@nutus/core";
import { useCallback, useEffect, useState } from "react";
import { MAINNET_RPC_URL, RPC_URL } from "../config.ts";

export const view: View = rpcView(RPC_URL);
export const mainnetView: View = rpcView(MAINNET_RPC_URL);
export const reader = (id: string) => instance(view, id);
export const nearBalance = async (id: string) => {
  const a = await viewAccount(RPC_URL, id);
  return a ? BigInt(a.amount) : null;
};

export type Payout = Instance.Payout;
export type Standing = Instance.Standing;
export type Lane = Instance.Lane;

// ───────────── amounts ─────────────

const decimalsCache = new Map<string, Promise<number>>([["near", Promise.resolve(24)]]);
const symbolCache = new Map<string, Promise<string>>([["near", Promise.resolve("NEAR")]]);

function meta(token: string) {
  if (!decimalsCache.has(token)) {
    const m = view<{ decimals: number; symbol: string }>(token, "ft_metadata").catch(() => ({ decimals: 0, symbol: token }));
    decimalsCache.set(token, m.then((x) => x.decimals));
    symbolCache.set(token, m.then((x) => x.symbol));
  }
  return Promise.all([decimalsCache.get(token)!, symbolCache.get(token)!]);
}

export function useToken(token: string | undefined) {
  const [m, setM] = useState<{ decimals: number; symbol: string } | null>(token === "near" ? { decimals: 24, symbol: "NEAR" } : null);
  useEffect(() => {
    if (!token) return;
    meta(token).then(([decimals, symbol]) => setM({ decimals, symbol }));
  }, [token]);
  return m;
}

/** Base units → "1,234.5". */
export function formatAmount(raw: string | bigint, decimals: number, maxFraction = 2): string {
  const v = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
}

/** "1,234.5" → base units. Throws on a malformed amount. */
export function parseAmount(text: string, decimals: number): string {
  const clean = text.replace(/,/g, "").trim();
  if (!/^\d+(\.\d+)?$/.test(clean)) throw new Error("Enter an amount like 120 or 120.50");
  const [w, f = ""] = clean.split(".");
  if (f.length > decimals) throw new Error(`At most ${decimals} decimal places`);
  return (BigInt(w!) * 10n ** BigInt(decimals) + BigInt(f.padEnd(decimals, "0") || "0")).toString();
}

// ───────────── time ─────────────

export const nowNs = () => BigInt(Date.now()) * 1_000_000n;

export function duration(ns: bigint): string {
  const s = Number(ns / 1_000_000_000n);
  if (s < 90) return `${Math.max(s, 0)} s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} days`;
}

export const date = (ns: string | bigint) =>
  new Date(Number(BigInt(ns) / 1_000_000n)).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// ───────────── data hook ─────────────

export function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    run().then(
      (data) => live && setState({ data, loading: false }),
      (e) => live && setState({ error: String(e instanceof Error ? e.message : e), loading: false }),
    );
    return () => {
      live = false;
    };
  }, [run, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

/** Re-render every `ms` so countdowns move. */
export function useNow(ms = 1000) {
  const [t, setT] = useState(nowNs());
  useEffect(() => {
    const i = setInterval(() => setT(nowNs()), ms);
    return () => clearInterval(i);
  }, [ms]);
  return t;
}
