import { Link } from "react-router-dom";
// Optional: present once `pnpm --filter @nutus/report scan` has written it.
const found = import.meta.glob("../../../data/scan/summary.json", { eager: true, import: "default" });
const summary = Object.values(found)[0];

const pct = (a: number, b: number) => (b === 0 ? "—" : `${Math.round((100 * a) / b)}%`);

export function Ecosystem() {
  if (!summary) return <><h1>Your DAO pays people even when the council is busy.</h1><p className="muted">The mainnet scan hasn't been run in this build. Run <span className="mono">pnpm --filter @nutus/report scan</span>.</p></>;
  const { meta, findings: f } = summary as unknown as {
    meta: { scannedAt: string; daosOnFactory: number; windowDays: number; minProposals: number; errors: unknown[] };
    findings: {
      daos: number;
      proposals: number;
      f1: { smallPayments: number; smallLapsed: number; largePayments: number; largeLapsed: number; smallLapsedZeroVotes: number; neverRepaid: number; recipientsWithLapse: number };
      f2: { approvedPayments: number; repeatPayments: number; series: number; daosWithSeries: number };
      f3: { seats: number; silentSeats: number; frozenRoles: number; oneAwayRoles: number; daosAssessed: number };
      f4: { failed: number; daos: number; byCause: Record<string, number> };
      f5: { bountyProposals: number };
    };
  };
  return (
    <>
      <h1>Your DAO pays people even when the council is busy.</h1>
      <p className="lede">
        The council decides once. Small payouts then go through unless someone objects, recurring pay runs with guaranteed notice, and every payment is
        checked before the vote. The DAO's own contract never changes.
      </p>
      <div className="row">
        <Link className="btn" to="/board">See the live demo</Link>
        <Link className="btn quiet" to="/report">Read your DAO</Link>
      </div>

      <h2>What we found on mainnet</h2>
      <p className="muted">
        {f.daos} active Sputnik DAOs ({meta.minProposals}+ proposals in the last {meta.windowDays} days, of {meta.daosOnFactory} on sputnik-dao.near), {f.proposals.toLocaleString()} proposals. Scanned {meta.scannedAt.slice(0, 10)}.
      </p>
      <div className="figures">
        <div className="figure"><div className="n">{pct(f.f1.smallLapsed, f.f1.smallPayments)}</div><p>of small payments lapsed without a decision, against {pct(f.f1.largeLapsed, f.f1.largePayments)} of large ones. {f.f1.smallLapsedZeroVotes} of {f.f1.smallLapsed} got no votes at all.</p></div>
        <div className="figure"><div className="n">{f.f1.neverRepaid} of {f.f1.recipientsWithLapse}</div><p>people whose small payment lapsed were never paid by that DAO afterwards.</p></div>
        <div className="figure"><div className="n">{pct(f.f2.repeatPayments, f.f2.approvedPayments)}</div><p>of approved payments repeat the same recipient and amount ({f.f2.series} series in {f.f2.daosWithSeries} DAOs), each voted on from scratch.</p></div>
        <div className="figure"><div className="n">{f.f3.silentSeats} of {f.f3.seats}</div><p>council seats cast no vote in 60 days. {f.f3.frozenRoles} roles can't pass a payment; {f.f3.oneAwayRoles} are one silent seat away.</p></div>
        <div className="figure"><div className="n">{f.f4.failed}</div><p>payments and calls passed the vote and then failed to execute, in {f.f4.daos} DAOs.</p></div>
      </div>
      <p className="small muted">
        Every number is reproducible: <span className="mono">pnpm --filter @nutus/report scan</span>. Definitions are in packages/report/DEFINITIONS.md.
      </p>

      <h2>How it works</h2>
      <table>
        <tbody>
          <tr><th>Small</th><td>Paid when its window closes (48 hours by default) unless a council member objects. An objection files a normal DAO proposal, so nothing is lost.</td></tr>
          <tr><th>Medium</th><td>Paid on the first council approval. If nobody approves in time it becomes a normal DAO vote.</td></tr>
          <tr><th>Large</th><td>Stays a normal DAO vote, with the payment checked before anyone votes.</td></tr>
          <tr><th>Recurring</th><td>Paid every period. The notice is locked when it starts: not even a DAO vote can withdraw it.</td></tr>
          <tr><th>Records</th><td>Every paid job counts, and a longer record raises how much can be paid without a vote. Every point traces to a real payment.</td></tr>
        </tbody>
      </table>
    </>
  );
}
