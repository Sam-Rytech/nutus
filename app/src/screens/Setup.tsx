import { build, groupMembers, instanceAccount, type Policy } from "@nutus/core";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DEFAULTS } from "../config.ts";
import { formatAmount, parseAmount, useAsync, useToken, view } from "../lib/chain.ts";
import { explain, useWallet } from "../lib/wallet.tsx";

const DAY_NS = 86_400n * 1_000_000_000n;

export function Setup() {
  const [q] = useSearchParams();
  const { accountId, signIn, call } = useWallet();
  const [dao, setDao] = useState(q.get("dao")?.endsWith(".testnet") ? q.get("dao")! : "");
  const [token, setToken] = useState(q.get("token") && q.get("token") !== "near" && q.get("token")!.endsWith(".testnet") ? q.get("token")! : DEFAULTS.token);
  const t = useToken(token);
  const fromBase = (k: string, fallback: string) => (q.get(k) && t ? formatAmount(q.get(k)!, t.decimals, 6).replace(/,/g, "") : fallback);
  const [name, setName] = useState("Contributors");
  const [budget, setBudget] = useState("5000");
  const [small, setSmall] = useState(() => fromBase("small", "100"));
  const [medium, setMedium] = useState("500");
  const [cap, setCap] = useState(() => fromBase("cap", "2000"));
  const [windowH, setWindowH] = useState("48");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const info = useAsync(async () => {
    if (!/\.testnet$/.test(dao)) return null;
    const [policy, balance, instanceExists] = await Promise.all([
      view<Policy>(dao, "get_policy"),
      view<string>(token, "ft_balance_of", { account_id: dao }).catch(() => "0"),
      view<string | null>(DEFAULTS.factory, "get_instance", { dao }),
    ]);
    return { policy, balance, instanceExists };
  }, [dao, token]);

  const council = info.data ? [...new Set(info.data.policy.roles.flatMap((r) => (r.permissions.some((p) => /^(\*|transfer):(\*|VoteApprove)$/.test(p)) ? groupMembers(r) ?? [] : [])))] : [];
  const instance = dao ? instanceAccount(dao, DEFAULTS.factory) : "";

  let proposal: ReturnType<typeof build.setupWithToken> | null = null;
  let problem = "";
  try {
    if (t && dao && info.data) {
      proposal = build.setupWithToken({
        dao,
        factory: DEFAULTS.factory,
        token,
        amount: parseAmount(budget, t.decimals),
        config: {
          lanes: [{
            id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "main",
            name,
            token,
            small_max: parseAmount(small, t.decimals),
            medium_max: parseAmount(medium, t.decimals),
            period_cap: parseAmount(cap, t.decimals),
            window_ns: String(BigInt(Math.round(Number(windowH) * 3600)) * 1_000_000_000n),
            period_ns: String(30n * DAY_NS),
            filers: "Anyone",
          }],
          council,
        },
      });
    }
  } catch (e) {
    problem = String((e as Error).message);
  }

  const checks: { ok: boolean; text: string }[] = [];
  if (info.data && t) {
    const need = (() => { try { return BigInt(parseAmount(budget, t.decimals)); } catch { return 0n; } })();
    checks.push(BigInt(info.data.balance) >= need
      ? { ok: true, text: `The DAO holds ${formatAmount(info.data.balance, t.decimals)} ${t.symbol}, enough for the budget.` }
      : { ok: false, text: `The DAO holds ${formatAmount(info.data.balance, t.decimals)} ${t.symbol}; the budget is larger. The setup would fail and refund.` });
    checks.push(info.data.instanceExists
      ? { ok: false, text: `This DAO already has ${info.data.instanceExists}. One instance per DAO.` }
      : { ok: true, text: `Creates ${instance}.` });
    checks.push(build.needsEscalationRole(info.data.policy, instance)
      ? { ok: false, text: "This DAO restricts who can file proposals, so objections couldn't become DAO votes. File the role grant below too." }
      : { ok: true, text: "Anyone can file proposals in this DAO, so objections become DAO votes with no extra setup." });
    checks.push(council.length
      ? { ok: true, text: `Council from the DAO's policy: ${council.join(", ")}.` }
      : { ok: false, text: "No group role can approve transfers. Objections need a council." });
  }
  const blocked = checks.some((c) => !c.ok && !c.text.startsWith("This DAO restricts"));

  const file = async (p: NonNullable<typeof proposal>) => {
    if (!info.data) return;
    setBusy(true);
    setMsg(null);
    try {
      await call({ receiverId: dao, method: "add_proposal", args: build.addProposalArgs(p) as Record<string, unknown>, deposit: info.data.policy.proposal_bond, tgas: 50 });
      setMsg({ ok: true, text: "Filed. Once the council approves it in the DAO, the instance exists and holds the budget." });
    } catch (e) {
      setMsg({ ok: false, text: explain(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Set up</h1>
      <p className="lede">One DAO proposal creates this DAO's Nutus and moves a budget into it. The council votes once; after that, small payouts don't need a vote.</p>
      {q.get("dao") && !dao && <div className="notice warn">The report drafted this for {q.get("dao")}. This demo files on testnet only: enter a testnet DAO.</div>}
      <div className="form">
        <label>DAO <span>A Sputnik DAO on testnet, e.g. nutus-demo.sputnikv2.testnet.</span>
          <input value={dao} onChange={(e) => setDao(e.target.value.trim())} placeholder="your-dao.sputnikv2.testnet" />
        </label>
        <label>Token <span>The setup token the factory accepts on testnet.</span>
          <input value={token} onChange={(e) => setToken(e.target.value.trim())} />
        </label>
        <label>Lane name <input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <div className="row" style={{ alignItems: "end" }}>
          <label style={{ flex: 1 }}>Budget <input value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
          <label style={{ flex: 1 }}>Monthly cap <input value={cap} onChange={(e) => setCap(e.target.value)} /></label>
        </div>
        <div className="row" style={{ alignItems: "end" }}>
          <label style={{ flex: 1 }}>Small up to <span>Paid unless someone objects.</span><input value={small} onChange={(e) => setSmall(e.target.value)} /></label>
          <label style={{ flex: 1 }}>Medium up to <span>One council approval.</span><input value={medium} onChange={(e) => setMedium(e.target.value)} /></label>
          <label style={{ flex: 1 }}>Window (hours) <span>Time to object.</span><input value={windowH} onChange={(e) => setWindowH(e.target.value)} /></label>
        </div>
      </div>

      {dao && info.loading && <p className="muted">Reading {dao}…</p>}
      {info.error && <div className="notice bad">Couldn't read {dao}: {info.error}</div>}
      {problem && <div className="notice bad">{problem}</div>}
      {checks.length > 0 && <h2>Checks</h2>}
      {checks.map((c) => <div key={c.text} className={`notice ${c.ok ? "good" : "warn"}`}>{c.text}</div>)}

      {proposal && (
        <>
          <h2>The proposal</h2>
          <p>One FunctionCall on <span className="mono">{token}</span>: register the new instance with the token, then send the budget to the factory with the lane settings. Attaches the DAO's {formatAmount(info.data!.policy.proposal_bond, 24)} NEAR proposal bond, returned when the proposal is decided.</p>
          <details><summary>Proposal JSON</summary><pre>{JSON.stringify(proposal, null, 2)}</pre></details>
          <div className="row" style={{ marginTop: "1rem" }}>
            {accountId ? (
              <button className="btn" disabled={busy || blocked} onClick={() => file(proposal!)}>{busy ? "Filing…" : "File setup proposal"}</button>
            ) : (
              <button className="btn" onClick={signIn}>Connect wallet to file</button>
            )}
            {info.data && build.needsEscalationRole(info.data.policy, instance) && (
              <button className="btn quiet" disabled={busy || !accountId} onClick={() => file(build.grantEscalationRole(instance))}>File the role grant</button>
            )}
          </div>
        </>
      )}
      {msg && <div className={`notice ${msg.ok ? "good" : "bad"}`}>{msg.text}</div>}
    </>
  );
}
