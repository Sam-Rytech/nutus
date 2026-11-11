import { allPayouts, allStanding } from "@nutus/core";
import { instanceId } from "../config.ts";
import { date, duration, formatAmount, nowNs, reader, useAsync, useToken, type Payout, type Standing } from "../lib/chain.ts";
import { Window, statusName } from "../Window.tsx";
import { PageHead } from "../shell/PageHead.tsx";

export function Amount({ raw, token }: { raw: string; token: string }) {
  const m = useToken(token);
  return <>{m ? `${formatAmount(raw, m.decimals)} ${m.symbol}` : "…"}</>;
}

export function PayoutRow({ p, actions }: { p: Payout; actions?: React.ReactNode }) {
  return (
    <div className="payout">
      <div>
        <div className="mono">{p.recipient}</div>
        <div className="small muted">
          #{p.id} in {p.lane}, filed {date(p.filed_at_ns)} by <span className="mono">{p.filer}</span>
          {p.link && (
            <>
              {" "}
              ·{" "}
              <a href={p.link} target="_blank" rel="noreferrer">
                the work
              </a>
            </>
          )}
        </div>
      </div>
      <div className="amount">
        <Amount raw={p.amount} token={p.token} />
        <div className="small muted">{p.tier === "Small" ? "Small: no vote needed" : "Medium: one approval"}</div>
      </div>
      <Window payout={p} />
      <div>{actions}</div>
    </div>
  );
}

const open = (p: Payout) => ["Waiting", "Sending", "Escalating", "Objected"].includes(statusName(p.status));

export function Board() {
  const id = instanceId();
  const r = reader(id);
  const { data, error, loading } = useAsync(
    async () => {
      const [config, books, lanes, payouts, standing] = await Promise.all([
        r.view("get_config"),
        r.view("get_token_books"),
        r.view("get_lanes"),
        allPayouts(r),
        allStanding(r),
      ]);
      const usage = await Promise.all(lanes.map((l) => r.view("get_period_usage", { lane_id: l.id })));
      return { config, books, lanes, payouts, standing, usage };
    },
    [id],
  );

  if (error) return <div className="notice bad">Couldn't read {id}: {error}</div>;
  if (loading || !data) return <p className="muted">Reading {id}…</p>;
  const { config, books, lanes, payouts, standing, usage } = data;
  const waiting = payouts.filter(open).reverse();
  const done = payouts.filter((p) => !open(p)).reverse();

  return (
    <>
      <PageHead
        path="/board"
        title="Payouts."
        rest="Everything this DAO is paying, has paid, or stopped."
        lede="Small payouts go through when their window closes, unless a council member objects. Read straight from the chain."
        stats={[
          { n: waiting.length, label: "waiting now", hint: waiting.length > 0 },
          { n: done.filter((p) => ["Paid", "Settled"].includes(statusName(p.status))).length, label: "paid" },
          { n: books[0] ? <Amount raw={books[0].available} token={books[0].token} /> : "—", label: "free to spend" },
          { n: standing.filter((s) => s.state !== "Ended").length, label: "recurring payments" },
        ]}
      />
      {config.paused && <div className="notice warn">The DAO has paused this instance: no new payouts or releases. Notice payments still go out.</div>}

      <h2>Waiting <span className="g">{waiting.length}</span></h2>
      {waiting.length === 0 ? (
        <p className="muted">Nothing waiting. Contributors file payouts on the Get paid screen.</p>
      ) : (
        <div className="payouts">{waiting.map((p) => <PayoutRow key={p.id} p={p} />)}</div>
      )}

      <h2>Budget <span className="g">by lane</span></h2>
      {lanes.length === 0 ? (
        <p className="muted">No lanes yet. A setup proposal adds the first one.</p>
      ) : (
        <table>
        <thead>
          <tr><th>Lane</th><th>Small up to</th><th>Medium up to</th><th>Spent this period</th><th>Window</th></tr>
        </thead>
        <tbody>
          {lanes.map((l, i) => {
            const u = usage[i];
            const pct = u ? Number((BigInt(u.spent) * 1000n) / (BigInt(u.cap) || 1n)) / 10 : 0;
            return (
              <tr key={l.id}>
                <td data-label="Lane"><strong>{l.name}</strong></td>
                <td data-label="Small up to"><Amount raw={l.small_max} token={l.token} /></td>
                <td data-label="Medium up to"><Amount raw={l.medium_max} token={l.token} /></td>
                <td data-label="Spent this period">
                  <Amount raw={u?.spent ?? "0"} token={l.token} /> of <Amount raw={l.period_cap} token={l.token} />
                  <div className="bar" aria-hidden><i style={{ width: `${pct}%` }} /></div>
                </td>
                <td data-label="Window">{duration(BigInt(l.window_ns))}</td>
              </tr>
            );
          })}
        </tbody>
        </table>
      )}
      <p className="small muted">
        {books.length === 0 ? "No token books yet." : books.map((b) => (
          <span key={b.token}>
            Held: <Amount raw={b.balance} token={b.token} />. Free to spend: <Amount raw={b.available} token={b.token} />. Locked for notice:{" "}
            <Amount raw={b.committed_notice} token={b.token} />.{" "}
          </span>
        ))}
      </p>

      {standing.length > 0 && <StandingList standing={standing} />}

      <h2>History <span className="g">{done.length}</span></h2>
      {done.length === 0 ? <p className="muted">No finished payouts yet.</p> : <div className="payouts">{done.map((p) => <PayoutRow key={p.id} p={p} />)}</div>}
    </>
  );
}

function StandingList({ standing }: { standing: Standing[] }) {
  const now = nowNs();
  return (
    <>
      <h2>Recurring pay</h2>
      <table>
        <thead>
          <tr><th>To</th><th>Each period</th><th>Next</th><th>Guaranteed notice</th><th>State</th></tr>
        </thead>
        <tbody>
          {standing.map((s) => {
            const st = typeof s.state === "string" ? s.state : `Notice: ${s.state.Noticed.remaining_periods} payment(s) left`;
            const next = BigInt(s.next_due_ns);
            return (
              <tr key={s.id}>
                <td data-label="To" className="mono">{s.recipient}</td>
                <td data-label="Each period"><Amount raw={s.amount} token={s.token} /> every {duration(BigInt(s.period_ns))}</td>
                <td data-label="Next">{s.state === "Ended" ? "—" : next <= now ? "Due now" : `in ${duration(next - now)}`}</td>
                <td data-label="Guaranteed notice">
                  <Amount raw={s.notice_locked} token={s.token} /> locked ({s.notice_periods} period{s.notice_periods === 1 ? "" : "s"})
                </td>
                <td data-label="State">{st}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="small muted">Locked notice can't be withdrawn, even by a DAO vote. If the DAO stops a payment, the notice still pays out.</p>
    </>
  );
}
