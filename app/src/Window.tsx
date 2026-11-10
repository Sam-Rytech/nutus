// The objection window: how much of a payout's window has passed, and what
// happens when it closes. The one element the whole product is about.

import { duration, useNow, type Payout } from "./lib/chain.ts";

type Status = Payout["status"];
const name = (s: Status) => (typeof s === "string" ? s : Object.keys(s)[0]!);

export function Window({ payout }: { payout: Payout }) {
  const now = useNow(1000);
  const s = name(payout.status);
  const filed = BigInt(payout.filed_at_ns);
  const deadline = BigInt(payout.deadline_ns);
  const span = deadline - filed || 1n;
  const done = now >= deadline;
  const pct = Math.min(100, Math.max(0, Number(((now - filed) * 1000n) / span) / 10));

  let cls = "";
  let says = "";
  let width = pct;
  if (s === "Waiting") {
    if (payout.tier === "Small") says = done ? "Window closed. Releases on the next keeper round." : `Pays in ${duration(deadline - now)} unless the council objects`;
    else says = done ? "Not approved in time. Goes to a DAO vote on the next keeper round." : `Needs one council approval within ${duration(deadline - now)}`;
  } else if (s === "Sending") {
    cls = "paid";
    width = 100;
    says = "Paying now";
  } else if (s === "Paid") {
    cls = "paid";
    width = 100;
    says = "Paid";
  } else if (s === "Escalating" || s === "Escalated" || s === "Objected") {
    cls = "stopped";
    const st = payout.status as Record<string, { by?: string; objected_by?: string | null; reason?: string | null; proposal_id?: string; needs_manual_filing?: boolean }>;
    const v = st[s]!;
    const by = v.by ?? v.objected_by;
    says =
      s === "Escalated"
        ? `Objected${by ? ` by ${by}` : ""}; now DAO proposal #${v.proposal_id}`
        : s === "Objected" && v.needs_manual_filing
          ? `Objected${by ? ` by ${by}` : ""}. The DAO proposal couldn't be filed automatically; file it by hand.`
          : `Objected${by ? ` by ${by}` : ""}. Filing a DAO proposal.`;
    if (v.reason) says += ` "${v.reason}"`;
  } else if (s === "Settled") {
    const v = (payout.status as { Settled: { approved: boolean; proposal_id: string } }).Settled;
    cls = v.approved ? "paid" : "stopped";
    width = 100;
    says = v.approved ? `Paid by DAO vote (proposal #${v.proposal_id})` : `Turned down by DAO vote (proposal #${v.proposal_id})`;
  } else if (s === "Failed") {
    cls = "stopped";
    width = 100;
    says = "Transfer failed. The budget was restored.";
  } else {
    cls = "idle";
    width = 100;
    says = "Cancelled";
  }

  return (
    <div className={`window ${cls}`}>
      <div className="track" role="progressbar" aria-valuenow={Math.round(width)} aria-valuemin={0} aria-valuemax={100} aria-label="Objection window">
        <div className="fill" style={{ width: `${width}%` }} />
      </div>
      <div className="says">{says}</div>
    </div>
  );
}

export const statusName = name;
