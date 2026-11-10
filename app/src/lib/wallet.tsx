import { actionCreators, setupWalletSelector, type WalletSelector } from "@near-wallet-selector/core";
import { setupModal, type WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import "@near-wallet-selector/modal-ui/styles.css";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { NETWORK } from "../config.ts";

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
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [modal, setModal] = useState<WalletSelectorModal | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);

  useEffect(() => {
    let unsub = () => {};
    setupWalletSelector({ network: NETWORK, modules: [setupMeteorWallet()] }).then((s) => {
      setSelector(s);
      setModal(setupModal(s, { contractId: "" }));
      const pick = () => setAccountId(s.store.getState().accounts.find((a) => a.active)?.accountId ?? null);
      pick();
      const sub = s.store.observable.subscribe(pick);
      unsub = () => sub.unsubscribe();
    });
    return () => unsub();
  }, []);

  const value: WalletCtx = {
    accountId,
    ready: selector !== null,
    signIn: () => modal?.show(),
    signOut: async () => {
      if (selector) await (await selector.wallet()).signOut();
    },
    call: async ({ receiverId, method, args, tgas = 100, deposit = "0" }) => {
      if (!selector) throw new Error("Wallet is still loading");
      const wallet = await selector.wallet();
      return wallet.signAndSendTransaction({
        receiverId,
        actions: [actionCreators.functionCall(method, args, BigInt(tgas) * TGAS, BigInt(deposit))],
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
