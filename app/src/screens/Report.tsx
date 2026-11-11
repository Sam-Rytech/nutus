import { build, groupMembers, instanceAccount, rpcView, type Policy } from "@nutus/core";
import { DAY, findings, proposalsSince, recordsFromHistory, recurringSeries, repeatSeries, retry, seedBatches, seatsOf, singlePayment, smallCutoffs, standingFromSeries, type Payment } from "@nutus/report/browser";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DEFAULTS, MAINNET_RPC_URL, RPC_URL } from "../config.ts";
import { formatAmount, nowNs, useAsync, useToken } from "../lib/chain.ts";

const pct = (a: number, b: number) => (b === 0 ? "—" : `${Math.round((100 * a) / b)}%`);

export function Report() {
  const [params, setParams] = useSearchParams();
  const dao = params.get("dao") ?? "";
  const net = params.get("net") === "testnet" ? "testnet" : "mainnet";
  const [input, setInput] = useState(dao);

  const r = useAsync(async () => {
    if (!dao) return null;
    const view = rpcView(net === "mainnet" ? MAINNET_RPC_URL : RPC_URL);
    const now = nowNs();
    const w = { now, from: now - 365n * DAY };
    const [policy, proposals] = await Promise.all([retry(() => view<Policy>(dao, "get_policy"), 5), proposalsSince(view, dao, w.from)]);
    const h = { dao, policy, proposals };
    const pays = proposals.map((p) => singlePayment(dao, p)).filter((p): p is Payment => p !== null);
    return { h, w, f: findings([h], w), pays, seats: seatsOf(h, w), records: recordsFromHistory(dao, proposals), series: recurringSeries(repeatSeries([h])) };
  }, [dao, net]);

  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const v = input.trim();
    if (v) setParams({ dao: v.includes(".") ? v : `${v}.${net === "mainnet" ? "sputnik-dao.near" : "sputnikv2.testnet"}`, net });
  };

  return (
    <>
      <h1>DAO report</h1>
      <p className="lede">Read any Sputnik DAO's last year of proposals and see where payouts get stuck. Read-only: nothing is signed.</p>
      <form className="row" onSubmit={go} style={{ maxWidth: "40rem" }}>
        <input aria-label="DAO account" value={input} onChange={(e) => setInput(e.target.value)} placeholder="ref-finance.sputnik-dao.near" style={{ flex: 1 }} />
        <select aria-label="Network" value={net} onChange={(e) => setParams({ dao, net: e.target.value })} style={{ width: "auto" }}>
          <option value="mainnet">mainnet</option>
          <option value="testnet">testnet</option>
        </select>
        <button className="btn">Read</button>
      </form>

      {r.loading && dao && <p className="muted">Reading {dao}…</p>}
      {r.error && (
        <div className="notice bad">
          {/429/.test(r.error)
            ? "The public RPC is limiting requests right now. Wait a minute and press Read again."
            : /does not exist|UNKNOWN_ACCOUNT|CodeDoesNotExist|MethodNotFound/.test(r.error)
              ? `${dao} isn't a Sputnik DAO on ${net}. Check the name and the network.`
              : `Couldn't read ${dao}: ${r.error}`}
        </div>
      )}
      {r.data && <Findings {...r.data} net={net} />}
    </>
  );
}

function Findings({ h, f, pays, seats, records, series, net }: NonNullable<ReturnType<typeof useAsync<any>>["data"]> & { net: string }) {
  const { f1, f2, f3, f4, f5 } = f;
  const instance = instanceAccount(h.dao, DEFAULTS.factory);
  const council = h.policy.roles.flatMap((r: Policy["roles"][number]) => groupMembers(r) ?? []);
  const silent: string[] = (seats ?? []).filter((s: { silent: boolean }) => s.silent).map((s: { member: string }) => s.member);
  // Draft lane from the DAO's own small payments in its most-used token.
  const byToken = new Map<string, Payment[]>();
  for (const p of pays as Payment[]) if (p.status === "Approved") byToken.set(p.token, [...(byToken.get(p.token) ?? []), p]);
  const [token, tokenPays] = [...byToken].sort((a, b) => b[1].length - a[1].length)[0] ?? ["", []];
  const cut = smallCutoffs(tokenPays).get(`${h.dao}|${token}`);
  const recent = tokenPays.filter((p) => p.submitted >= nowNs() - 90n * DAY && cut !== undefined && p.amount <= cut);
  const monthly = recent.reduce((s, p) => s + p.amount, 0n) / 3n;

  return (
    <>
      <h2>{h.dao}</h2>
      <p className="muted">{h.proposals.length} proposals in the last 365 days on {net}.</p>
      <div className="figures">
        <div className="figure"><div className="n">{pct(f1.smallLapsed, f1.smallPayments)}</div><p>of small payments lapsed without a decision ({f1.smallLapsed} of {f1.smallPayments}), against {pct(f1.largeLapsed, f1.largePayments)} of large ones.</p></div>
        <div className="figure"><div className="n">{f1.neverRepaid}</div><p>people whose small payment lapsed and who were never paid by this DAO afterwards.</p></div>
        <div className="figure"><div className="n">{f2.series}</div><p>payments approved 3+ times with the same recipient and amount ({f2.repeatPayments} votes that could have been one).</p></div>
        <div className="figure"><div className="n">{f3.seats ? `${f3.silentSeats}/${f3.seats}` : "—"}</div><p>council seats with no vote in 60 days{f3.frozenRoles ? `; ${f3.frozenRoles} role(s) can no longer pass a payment` : f3.oneAwayRoles ? "; one more silent seat freezes payments" : ""}.</p></div>
        <div className="figure"><div className="n">{f4.failed}</div><p>proposals that passed and then failed to execute{f4.failed ? ` (${Object.keys(f4.byCause).join(", ")})` : ""}.</p></div>
        <div className="figure"><div className="n">{f5.bountyProposals}</div><p>bounty proposals.</p></div>
      </div>

      <h2>Fix this</h2>
      {token && cut !== undefined ? (
        <FixLane dao={h.dao} token={token} small={cut} monthly={monthly} council={council} net={net} />
      ) : (
        <p className="muted">No approved payments to size a lane from yet.</p>
      )}
      {records.length > 0 && (
        <details>
          <summary>Draft a record seed for {records.length} recipient{records.length === 1 ? "" : "s"}</summary>
          <p className="small muted">Approved payments in this DAO's history become each recipient's track record, so a longer record raises how much can be paid without a vote. The contract checks every proposal id against the DAO.</p>
          {seedBatches(records).length > 1 && <p className="small">The contract takes at most 200 payments per call, so this is {seedBatches(records).length} proposals.</p>}
          <pre>{JSON.stringify(seedBatches(records).map((b) => build.seedRecords(instance, b)), null, 2)}</pre>
          <p className="small">File it after setup from the <Link to={`/setup?dao=${encodeURIComponent(h.dao)}`}>Set up screen</Link>.</p>
        </details>
      )}
      {series.length > 0 && (
        <details>
          <summary>Draft recurring pay for {series.length} repeat series</summary>
          <p className="small muted">Each series paid the same recipient, token and amount at least three times, at least a week apart. This draft pays that amount every median period, with one period of locked notice, instead of a fresh vote each time.</p>
          <pre>{JSON.stringify(series.map((s: Parameters<typeof standingFromSeries>[0]) => build.addStanding(instance, standingFromSeries(s, nowNs()))), null, 2)}</pre>
          <p className="small">File these after setup from the <Link to={`/setup?dao=${encodeURIComponent(h.dao)}`}>Set up screen</Link>.</p>
        </details>
      )}
      {silent.length > 0 && (
        <details>
          <summary>Draft seat changes for {silent.length} silent member{silent.length === 1 ? "" : "s"}</summary>
          <p className="small muted">Nutus never removes anyone. A person reviews these and files them.</p>
          <pre>{JSON.stringify(silent.map((m) => build.removeMember(m, "council", "no vote on any proposal in the last 60 days")), null, 2)}</pre>
        </details>
      )}
    </>
  );
}

function FixLane({ dao, token, small, monthly, council, net }: { dao: string; token: string; small: bigint; monthly: bigint; council: string[]; net: string }) {
  const m = useToken(net === "testnet" ? token : undefined);
  const fmt = (v: bigint) => (m ? `${formatAmount(v, m.decimals)} ${m.symbol}` : `${v} (base units of ${token})`);
  const q = new URLSearchParams({ dao, token, small: String(small), cap: String(monthly > small ? monthly : small * 4n), council: council.join(",") });
  return (
    <div className="notice good">
      <p style={{ marginTop: 0 }}>
        A lane in <span className="mono">{token === "near" ? "NEAR" : token}</span> with small payouts up to <strong>{fmt(small)}</strong> (this DAO's median payment) and a monthly budget of{" "}
        <strong>{fmt(monthly > small ? monthly : small * 4n)}</strong> (its recent small payments, per month) would have paid these without a vote, unless someone objected.
      </p>
      <Link className="btn" to={`/setup?${q}`}>Draft the setup proposal</Link>
    </div>
  );
}
