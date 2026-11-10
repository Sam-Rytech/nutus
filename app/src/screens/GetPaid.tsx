import { useState } from "react";
import { instanceId } from "../config.ts";
import { duration, formatAmount, parseAmount, reader, useAsync, useToken, type Lane } from "../lib/chain.ts";
import { explain, useWallet } from "../lib/wallet.tsx";

type Rec = { paid_jobs: number; last_objection_ns?: string | null; jobs_at_last_objection: number } | null;

/** Mirrors the contract's small_limit: the record ladder caps Small. */
function smallLimit(lane: Lane, rec: Rec, cooldownNs: bigint): bigint {
  if (lane.record_steps.length === 0) return BigInt(lane.small_max);
  let jobs = rec?.paid_jobs ?? 0;
  if (rec?.last_objection_ns && BigInt(Date.now()) * 1_000_000n < BigInt(rec.last_objection_ns) + cooldownNs) jobs = Math.min(jobs, rec.jobs_at_last_objection);
  const step = [...lane.record_steps].reverse().find((s) => s.min_paid_jobs <= jobs);
  const v = step ? BigInt(step.small_max) : 0n;
  return v < BigInt(lane.small_max) ? v : BigInt(lane.small_max);
}

export function GetPaid() {
  const id = instanceId();
  const r = reader(id);
  const { accountId, signIn, call } = useWallet();
  const [laneId, setLaneId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amountText, setAmountText] = useState("");
  const [link, setLink] = useState("");
  const [memo, setMemo] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const to = recipient || accountId || "";
  const base = useAsync(async () => {
    const [config, lanes] = await Promise.all([r.view("get_config"), r.view("get_lanes")]);
    return { config, lanes };
  }, [id]);
  const rec = useAsync(async () => (to ? ((await r.view("get_record", { account_id: to })) as Rec) : null), [id, to]);

  const lane = base.data?.lanes.find((l) => l.id === laneId) ?? base.data?.lanes[0];
  const token = useToken(lane?.token);

  if (base.error) return <div className="notice bad">Couldn't read {id}: {base.error}</div>;
  if (!base.data || !lane) return <p className="muted">Reading lanes…</p>;

  let amount: string | null = null;
  let amountError = "";
  try {
    if (amountText && token) amount = parseAmount(amountText, token.decimals);
  } catch (e) {
    amountError = String((e as Error).message);
  }

  const limit = smallLimit(lane, rec.data ?? null, BigInt(base.data.config.objection_cooldown_ns));
  let tier: { cls: string; text: string } | null = null;
  if (amount && token) {
    const a = BigInt(amount);
    if (a > BigInt(lane.medium_max))
      tier = { cls: "bad", text: `Above this lane's ${formatAmount(lane.medium_max, token.decimals)} ${token.symbol} limit. Ask a member to file it as a normal DAO proposal.` };
    else if (a <= limit)
      tier = { cls: "good", text: `Small. Paid ${duration(BigInt(lane.window_ns))} after you file unless a council member objects. No vote needed.` };
    else
      tier = {
        cls: "warn",
        text:
          `Medium. Paid as soon as one council member approves. If nobody does within ${duration(BigInt(lane.medium_timeout_ns))}, it becomes a normal DAO vote.` +
          (limit < BigInt(lane.small_max) ? ` (Your record allows Small payouts up to ${formatAmount(limit, token.decimals)} ${token.symbol}.)` : ""),
      };
  }

  const submit = async () => {
    if (!amount) return;
    setBusy(true);
    setResult(null);
    try {
      await call({
        receiverId: id,
        method: "file_payout",
        args: { lane_id: lane.id, recipient: to, amount, link, memo: memo || null },
        deposit: base.data!.config.filing_deposit,
        tgas: 60,
      });
      setResult({ ok: true, text: "Filed. It's on the Payouts screen with its window running." });
    } catch (e) {
      setResult({ ok: false, text: explain(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Get paid</h1>
      <p className="lede">File a payout for work you've done. You'll see how it will be paid before you sign.</p>

      <div className="form">
        <label>
          Lane
          <select value={lane.id} onChange={(e) => setLaneId(e.target.value)}>
            {base.data.lanes.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>
        <label>
          Pay to
          <span>Defaults to your connected account.</span>
          <input value={recipient} placeholder={accountId ?? "you.testnet"} onChange={(e) => setRecipient(e.target.value.trim())} />
        </label>
        <label>
          Amount {token && `(${token.symbol})`}
          <input inputMode="decimal" value={amountText} placeholder="120" onChange={(e) => setAmountText(e.target.value)} aria-invalid={!!amountError} />
          {amountError && <span style={{ color: "var(--brick)" }}>{amountError}</span>}
        </label>
        <label>
          Link to the work
          <span>A pull request, a design file, a post. The council sees this.</span>
          <input value={link} placeholder="https://github.com/…/pull/42" onChange={(e) => setLink(e.target.value)} />
        </label>
        <label>
          Note <span>Optional.</span>
          <input value={memo} onChange={(e) => setMemo(e.target.value)} />
        </label>
        {to && rec.data !== undefined && (
          <p className="small muted" style={{ margin: 0 }}>
            {to} has {rec.data?.paid_jobs ?? 0} paid job{rec.data?.paid_jobs === 1 ? "" : "s"} on record here.
          </p>
        )}
        {tier && <div className={`notice ${tier.cls}`} style={{ margin: 0 }}>{tier.text}</div>}
        <div className="row">
          {accountId ? (
            <button className="btn" disabled={!amount || !link || !to || busy || tier?.cls === "bad"} onClick={submit}>
              {busy ? "Filing…" : "File payout"}
            </button>
          ) : (
            <button className="btn" onClick={signIn}>Connect wallet to file</button>
          )}
          <span className="small muted">Attaches a {formatAmount(base.data.config.filing_deposit, 24)} NEAR deposit, refunded when the payout finishes.</span>
        </div>
        {result && <div className={`notice ${result.ok ? "good" : "bad"}`}>{result.text}</div>}
      </div>
    </>
  );
}
