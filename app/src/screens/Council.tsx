import { allPayouts, allStanding, roleHealth, type Policy, type ProposalStatus } from "@nutus/core";
import { DAY, proposalsSince, seatsOf } from "@nutus/report/browser";
import { useState } from "react";
import { instanceId } from "../config.ts";
import { nowNs, reader, useAsync, view, type Payout } from "../lib/chain.ts";
import { explain, useWallet } from "../lib/wallet.tsx";
import { PayoutRow } from "./Board.tsx";
import { statusName } from "../Window.tsx";

export function Council() {
  const id = instanceId();
  const r = reader(id);
  const { accountId, signIn, call } = useWallet();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const d = useAsync(async () => {
    const [config, payouts, standing, lanes] = await Promise.all([r.view("get_config"), allPayouts(r), allStanding(r), r.view("get_lanes")]);
    const now = nowNs();
    const [policy, recent] = await Promise.all([view<Policy>(config.dao, "get_policy"), proposalsSince(view, config.dao, now - 60n * DAY)]);
    const escalated = payouts.filter((p) => statusName(p.status) === "Escalated");
    const proposals = await Promise.all(
      escalated.map((p) => view<{ status: ProposalStatus }>(config.dao, "get_proposal", { id: Number((p.status as { Escalated: { proposal_id: string } }).Escalated.proposal_id) })),
    );
    const seats = seatsOf({ dao: config.dao, policy, proposals: recent }, { now, from: now - 365n * DAY });
    const silent = seats?.filter((s) => s.silent).map((s) => s.member) ?? [];
    return { config, payouts, standing, lanes, policy, health: roleHealth(policy, silent), silent, settled: new Map(escalated.map((p, i) => [p.id, proposals[i]!.status])), assessed: seats !== null };
  }, [id]);

  if (d.error) return <div className="notice bad">Couldn't read {id}: {d.error}</div>;
  if (!d.data) return <p className="muted">Reading the inbox…</p>;
  const { config, payouts, standing, lanes, health, silent, settled, assessed } = d.data;
  const now = nowNs();
  const member = accountId !== null && config.council.includes(accountId);
  const objectorsOf = (p: Payout) => lanes.find((l) => l.id === p.lane)?.objectors ?? config.council;

  const act = async (key: string, method: string, args: Record<string, unknown>, tgas: number, done: string) => {
    setBusy(key);
    setMsg(null);
    try {
      await call({ receiverId: id, method, args, tgas });
      setMsg({ ok: true, text: done });
      d.reload();
    } catch (e) {
      setMsg({ ok: false, text: explain(e) });
    } finally {
      setBusy(null);
    }
  };

  const objectable = payouts.filter((p) => p.status === "Waiting" && p.tier === "Small" && now < BigInt(p.deadline_ns));
  const approvable = payouts.filter((p) => p.status === "Waiting" && p.tier === "Medium");
  const releasable = payouts.filter((p) => p.status === "Waiting" && p.tier === "Small" && now >= BigInt(p.deadline_ns));
  const escalatable = payouts.filter((p) => p.status === "Waiting" && p.tier === "Medium" && now >= BigInt(p.deadline_ns));
  const settleable = payouts.filter((p) => { const s = settled.get(p.id); return s && s !== "InProgress"; });
  const manual = payouts.filter((p) => statusName(p.status) === "Objected");
  const due = standing.filter((s) => s.state !== "Ended" && !s.in_flight && BigInt(s.next_due_ns) <= now);
  const short = due.filter((s) => s.state === "Active" && BigInt(s.buffer) < BigInt(s.amount));
  const frozen = health.filter((h) => h.frozen);
  const close = health.filter((h) => !h.frozen && h.freezeDistance === 0);

  return (
    <>
      <h1>Council inbox</h1>
      <p className="lede">What needs a council member now. Small payouts pay themselves; you only act to stop one or to approve a medium one.</p>
      {!accountId ? (
        <div className="notice"><button className="btn" onClick={signIn}>Connect wallet</button> to object or approve as a council member.</div>
      ) : !member ? (
        <div className="notice warn"><span className="mono">{accountId}</span> isn't on this DAO's council. You can still trigger releases and payments that are due.</div>
      ) : null}
      {msg && <div className={`notice ${msg.ok ? "good" : "bad"}`}>{msg.text}</div>}

      {(frozen.length > 0 || close.length > 0) && (
        <div className={`notice ${frozen.length ? "bad" : "warn"}`}>
          {frozen.length > 0
            ? `${frozen.map((h) => h.role).join(", ")} can't pass a payment any more: ${frozen[0]!.active} active of ${frozen[0]!.members.length}, ${frozen[0]!.required} needed.`
            : `${close.map((h) => h.role).join(", ")} is one silent seat away from not being able to pass payments.`}{" "}
          No vote in 60 days: {silent.map((s) => <span key={s} className="mono">{s} </span>)}. The DAO report drafts a seat change for a person to file.
        </div>
      )}
      {!assessed && <p className="small muted">Seat health needs at least 3 DAO proposals in the last 60 days to judge who's silent.</p>}

      <h2>Object before it pays ({objectable.length})</h2>
      {objectable.length === 0 && <p className="muted">No small payouts inside their window.</p>}
      <div className="payouts">
        {objectable.map((p) => (
          <PayoutRow
            key={p.id}
            p={p}
            actions={
              objectorsOf(p).includes(accountId ?? "") && (
                <div className="row" style={{ flexWrap: "nowrap" }}>
                  <input aria-label="Reason" placeholder="Reason" value={reasons[p.id] ?? ""} onChange={(e) => setReasons({ ...reasons, [p.id]: e.target.value })} style={{ minWidth: "9rem" }} />
                  <button className="btn stop" disabled={!reasons[p.id]?.trim() || busy !== null} onClick={() => act(`o${p.id}`, "object", { payout_id: p.id, reason: reasons[p.id] }, 200, "Objected. It's now a normal DAO proposal; vote on it in the DAO.")}>
                    {busy === `o${p.id}` ? "Objecting…" : "Object"}
                  </button>
                </div>
              )
            }
          />
        ))}
      </div>

      <h2>Approve ({approvable.length})</h2>
      {approvable.length === 0 && <p className="muted">No medium payouts waiting for approval.</p>}
      <div className="payouts">
        {approvable.map((p) => (
          <PayoutRow key={p.id} p={p} actions={objectorsOf(p).includes(accountId ?? "") && <button className="btn" disabled={busy !== null} onClick={() => act(`a${p.id}`, "approve", { payout_id: p.id }, 100, "Approved and paid.")}>{busy === `a${p.id}` ? "Approving…" : "Approve"}</button>} />
        ))}
      </div>

      <h2>Due now</h2>
      <p className="small muted">The keeper does these every hour. Anyone can do them sooner.</p>
      {releasable.length + escalatable.length + settleable.length + due.length === 0 && <p className="muted">Nothing due.</p>}
      <div className="payouts">
        {releasable.map((p) => <PayoutRow key={p.id} p={p} actions={<button className="btn quiet" disabled={!accountId || busy !== null} onClick={() => act(`r${p.id}`, "release", { payout_id: p.id }, 100, "Released.")}>Release</button>} />)}
        {escalatable.map((p) => <PayoutRow key={p.id} p={p} actions={<button className="btn quiet" disabled={!accountId || busy !== null} onClick={() => act(`e${p.id}`, "escalate", { payout_id: p.id }, 200, "Sent to a DAO vote.")}>Send to DAO vote</button>} />)}
        {settleable.map((p) => <PayoutRow key={p.id} p={p} actions={<button className="btn quiet" disabled={!accountId || busy !== null} onClick={() => act(`s${p.id}`, "settle_escalation", { payout_id: p.id }, 60, "Recorded the DAO's decision.")}>Record outcome</button>} />)}
      </div>
      {due.map((s) => (
        <div key={s.id} className="row" style={{ padding: "0.6rem 0", borderBottom: "1px solid var(--line)" }}>
          <span>Recurring payment #{s.id} to <span className="mono">{s.recipient}</span> is due.</span>
          {short.includes(s) ? <span className="small" style={{ color: "var(--brick)" }}>Its buffer is short: the DAO needs to top it up.</span> : <button className="btn quiet" disabled={!accountId || busy !== null} onClick={() => act(`p${s.id}`, "pay_due", { standing_id: s.id }, 100, "Paid.")}>Pay now</button>}
        </div>
      ))}

      {manual.length > 0 && (
        <>
          <h2>Needs a person ({manual.length})</h2>
          <p className="small muted">These were objected to, but the DAO proposal couldn't be filed automatically (bond float short, or the DAO doesn't let the instance file proposals). File a Transfer proposal in the DAO by hand, then the DAO can cancel the payout here.</p>
          <div className="payouts">{manual.map((p) => <PayoutRow key={p.id} p={p} />)}</div>
        </>
      )}
    </>
  );
}
