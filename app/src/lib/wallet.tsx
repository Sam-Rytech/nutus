// The wallet code (selector, Meteor, NEAR libraries, the Buffer shim) is
// large and nobody needs it until they sign something, so it loads after the
// page is idle, or straight away if someone presses Connect wallet first.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { NETWORK } from "../config.ts";

async function loadWallet() {
  await import("../polyfills.ts"); // Meteor needs Buffer before it loads
  const [core, modalUi, meteor] = await Promise.all([
    import("@near-wallet-selector/core"),
    import("@near-wallet-selector/modal-ui"),
    import("@near-wallet-selector/meteor-wallet"),
    import("@near-wallet-selector/modal-ui/styles.css"),
  ]);
  const selector = await core.setupWalletSelector({ network: NETWORK, modules: [meteor.setupMeteorWallet()] });
  return { selector, modal: modalUi.setupModal(selector, { contractId: "" }), actionCreators: core.actionCreators };
}
type Loaded = Awaited<ReturnType<typeof loadWallet>>;

const TGAS = 1_000_000_000_000n;

export interface Call {
  receiverId: string;
  method: string;
  args: Record<string, unknown>;
  tgas?: number;
  /** yoctoNEAR */
  deposit?: string | bigint;
}

interface WalletCtx {
  accountId: string | null;
  ready: boolean;
  signIn: () => void;
  signOut: () => Promise<void>;
  /** Signs and sends one function call. Resolves when the wallet returns (or redirects). */
  call: (c: Call) => Promise<unknown>;
}

const Ctx = createContext<WalletCtx | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [w, setW] = useState<Loaded | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const loading = useRef<Promise<Loaded> | null>(null);

  const ensure = useCallback(() => {
    loading.current ??= loadWallet().then((l) => {
      setW(l);
      const pick = () => setAccountId(l.selector.store.getState().accounts.find((a) => a.active)?.accountId ?? null);
      pick();
      l.selector.store.observable.subscribe(pick);
      return l;
    });
    return loading.current;
  }, []);

  // Load once the page has settled, so a returning user's account shows up.
  useEffect(() => {
    const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const id = idle ? idle(() => void ensure(), { timeout: 4000 }) : window.setTimeout(() => void ensure(), 2500);
    return () => {
      const cancel = (window as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
      if (idle && cancel) cancel(id);
      else clearTimeout(id);
    };
  }, [ensure]);

  const value: WalletCtx = {
    accountId,
    ready: w !== null,
    signIn: () => void ensure().then((l) => l.modal.show()),
    signOut: async () => {
      const l = await ensure();
      await (await l.selector.wallet()).signOut();
    },
    call: async ({ receiverId, method, args, tgas = 100, deposit = "0" }) => {
      const l = await ensure();
      const wallet = await l.selector.wallet();
      return wallet.signAndSendTransaction({
        receiverId,
        actions: [l.actionCreators.functionCall(method, args, BigInt(tgas) * TGAS, BigInt(deposit))],
      });
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWallet outside WalletProvider");
  return c;
}

/** Contract panic text from a wallet error, e.g. "WINDOW_CLOSED". */
export function explain(e: unknown): string {
  const s = String(e instanceof Error ? e.message : e);
  const code = s.match(/Smart contract panicked: ([A-Z_]+)/)?.[1] ?? s.match(/\b([A-Z][A-Z_]{4,})\b/)?.[1];
  const words: Record<string, string> = {
    WINDOW_CLOSED: "The objection window has closed; this payout is releasing.",
    NOT_AN_OBJECTOR: "Your account isn't on this lane's council.",
    NOT_AN_APPROVER: "Your account isn't on this lane's council.",
    SELF_APPROVAL: "You can't approve a payout you filed or will receive.",
    USE_FULL_VOTE: "That's above this lane's limit. File it as a normal DAO proposal.",
    PERIOD_CAP_REACHED: "This lane's budget for the period is used up.",
    INSUFFICIENT_BUDGET: "The lane doesn't have enough unreserved budget for this amount.",
    DEPOSIT_TOO_SMALL: "Attach the 0.1 NEAR filing deposit.",
    NOT_A_FILER: "Your account isn't allowed to file in this lane.",
    PAUSED: "The DAO has paused this instance.",
    ALREADY_SENT: "Already released.",
  };
  return code && words[code] ? words[code] : s.slice(0, 240);
}
