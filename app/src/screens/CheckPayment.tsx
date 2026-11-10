import { build, preflight, type PreflightResult } from "@nutus/core";
import { useState } from "react";
import { DEFAULTS, EXPLORER } from "../config.ts";
import { formatAmount, nearBalance, parseAmount, useToken, view } from "../lib/chain.ts";
import { explain, useWallet } from "../lib/wallet.tsx";

/** Runs preflight on a payment before anyone files it, then files the checked version. */
export function CheckPayment({ dao, bond }: { dao: string; bond: string }) {
  const { accountId, signIn, call } = useWallet();
  const [token, setToken] = useState<string>(DEFAULTS.token);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [why, setWhy] = useState("");
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [busy, setBusy] = useState<"check" | "file" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const m = useToken(token);

  const reset = () => { setResult(null); setMsg(null); };

  const check = async () => {
    if (!m) return;
    setBusy("check");
    reset();
    try {
      const raw = parseAmount(amount, m.decimals);
      const description = why.trim() || `Pay ${to}`;
      const proposal = { description, kind: { Transfer: { token_id: token === "near" ? "" : token, receiver_id: to, amount: raw, msg: null } } };
      const r = await preflight({ view, nearBalance }, dao, proposal);
      // Preflight reports raw base units; say it in the token's own units.
      const fmt = (v: string | bigint) => `${formatAmount(v, m.decimals)} ${m.symbol}`;
      for (const i of r.issues) {
        if (i.code === "INSUFFICIENT_TOKEN") {
          const held = await view<string>(token, "ft_balance_of", { account_id: dao });
          i.message = `The DAO holds ${fmt(held)}; this payment needs ${fmt(raw)}.`;
        }
        if (i.code === "INSUFFICIENT_NEAR") {
          const held = (await nearBalance(dao)) ?? 0n;
          i.message = `The DAO holds ${fmt(held)}; this payment needs ${fmt(raw)}.`;
        }
      }
      setResult(r);
    } catch (e) {
      setMsg({ ok: false, text: explain(e) });
    } finally {
      setBusy(null);
    }
  };

  const file = async () => {
    if (!result) return;
    setBusy("file");
    setMsg(null);
    try {
      await call({ receiverId: dao, method: "add_proposal", args: build.addProposalArgs(result.proposal) as Record<string, unknown>, deposit: bond, tgas: 50 });
      setMsg({ ok: true, text: "Filed. The council can vote on it in the DAO now." });
      setResult(null);
    } catch (e) {
      setMsg({ ok: false, text: explain(e) });
    } finally {
      setBusy(null);
    }
  };

  const rewritten = result && "FunctionCall" in (result.proposal.kind as object);

  return (
    <>
      <h2>Check a payment before the vote</h2>
      <p className="muted">
        On mainnet, 171 proposals passed the vote and then failed to execute; 26 of them were plain payments. A token payment to someone who isn't registered with
        the token fails exactly that way. Check a payment here first: anything that can be fixed is fixed inside the proposal.
      </p>
      <div className="form">
        <label>
          Pay in
          <select value={token} onChange={(e) => { setToken(e.target.value); reset(); }}>
            <option value={DEFAULTS.token}>tUSDC ({DEFAULTS.token})</option>
            <option value="near">NEAR</option>
          </select>
        </label>
        <label>
          Recipient
          <input value={to} placeholder="someone.testnet" onChange={(e) => { setTo(e.target.value.trim()); reset(); }} />
        </label>
        <label>
          Amount {m && <span>in {m.symbol}</span>}
          <input value={amount} inputMode="decimal" placeholder="25" onChange={(e) => { setAmount(e.target.value); reset(); }} />
        </label>
        <label>
          What it's for <span>shown to the council in the DAO</span>
          <input value={why} placeholder={to ? `Pay ${to}` : "Design work, October"} onChange={(e) => setWhy(e.target.value)} />
        </label>
        <div className="row">
          <button className="btn" disabled={!to || !amount || !m || busy !== null} onClick={check}>{busy === "check" ? "Checking…" : "Check payment"}</button>
        </div>
      </div>

      {msg && <div className={`notice ${msg.ok ? "good" : "bad"}`}>{msg.text}</div>}

      {result && (
        <div className={`notice ${result.ok ? "good" : "bad"}`}>
          {result.issues.length === 0 ? (
            <p style={{ marginTop: 0 }}>Nothing to fix. The DAO holds enough and the recipient can receive it.</p>
          ) : (
            <ul style={{ marginTop: 0, paddingLeft: "1.1rem" }}>
              {result.issues.map((i) => (
                <li key={i.code}>
                  <strong>{i.fixed ? "Fixed: " : "Needs a person: "}</strong>
                  {i.message}
                </li>
              ))}
            </ul>
          )}
          {rewritten && m && (
            <p className="small">
              Will file one call on <span className="mono">{token}</span>: register <span className="mono">{to}</span> (0.00125 NEAR from the DAO), then send{" "}
              {formatAmount(parseAmount(amount, m.decimals), m.decimals)} {m.symbol}.
            </p>
          )}
          {result.ok &&
            (accountId ? (
              <div className="row">
                <button className="btn" disabled={busy !== null} onClick={file}>{busy === "file" ? "Filing…" : "File as DAO proposal"}</button>
                <span className="small muted">Attaches the DAO's {formatAmount(bond, 24)} NEAR proposal bond, returned when the vote is decided.</span>
              </div>
            ) : (
              <button className="btn quiet" onClick={signIn}>Connect wallet to file it</button>
            ))}
        </div>
      )}
      <p className="small muted">
        Proposals go to <a href={`${EXPLORER}/address/${dao}`} target="_blank" rel="noreferrer" className="mono">{dao}</a>.
      </p>
    </>
  );
}
