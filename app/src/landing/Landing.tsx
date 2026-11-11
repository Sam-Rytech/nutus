import { allPayouts } from "@nutus/core";
import { createContext, lazy, Suspense, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Mark, Wordmark } from "../brand/Logo.tsx";
import { Nav } from "../shell/Nav.tsx";
import { EXPLORER, instanceId } from "../config.ts";
import { duration, formatAmount, nowNs, reader, useAsync, useNow, useToken, type Lane, type Payout } from "../lib/chain.ts";
import { statusName } from "../Window.tsx";
import "./landing.css";

// three.js is large; load the hero art after the page paints.
const GlassLedger = lazy(() => import("../brand/GlassLedger.tsx").then((m) => ({ default: m.GlassLedger })));

const REPO = "https://github.com/Sam-Rytech/nutus";
const found = import.meta.glob("../../../data/scan/summary.json", { eager: true, import: "default" });
type Summary = {
  meta: { scannedAt: string };
  findings: { daos: number; proposals: number; f1: { neverRepaid: number; recipientsWithLapse: number }; f3: { seats: number; silentSeats: number }; f4: { failed: number; daos: number } };
};
const summary = Object.values(found)[0] as Summary | undefined;

// ── live testnet data, fetched once and shared by every section ──

type Live = { payouts: Payout[]; lanes: Lane[] };
const LiveCtx = createContext<Live | null>(null);
const useLive = () => useContext(LiveCtx);

function useMeta() {
  const live = useLive();
  return useToken(live?.payouts[0]?.token ?? live?.lanes[0]?.token);
}

function money(raw: string, m: { decimals: number; symbol: string } | null) {
  return m ? `${formatAmount(raw, m.decimals)} ${m.symbol}` : "…";
}

function said(p: Payout, now: bigint): string {
  const s = statusName(p.status);
  if (s === "Waiting") return BigInt(p.deadline_ns) > now ? `${p.tier === "Small" ? "pays" : "approval"} in ${duration(BigInt(p.deadline_ns) - now)}` : "due";
  if (s === "Settled") return (p.status as { Settled: { approved: boolean } }).Settled.approved ? "paid by DAO vote" : "turned down";
  if (s === "Escalated" || s === "Escalating" || s === "Objected") return "objected";
  return s.toLowerCase();
}

/** Adds `.in` to every `.reveal` as it scrolls into view. */
function useReveal(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const els = root.current?.querySelectorAll(".reveal") ?? [];
    if (typeof IntersectionObserver === "undefined") return els.forEach((e) => e.classList.add("in"));
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))), { rootMargin: "0px 0px -10% 0px" });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  });
}

export function Landing() {
  const page = useRef<HTMLDivElement>(null);
  const id = instanceId();
  const d = useAsync(async () => {
    const r = reader(id);
    const [payouts, lanes] = await Promise.all([allPayouts(r), r.view("get_lanes")]);
    return { payouts, lanes };
  }, [id]);
  useReveal(page);
  return (
    <LiveCtx.Provider value={d.data ?? null}>
      <div className="ln" ref={page}>
        <Nav />
        <main>
          <Hero />
          <Statement />
          {summary && <Numbers s={summary} />}
          <How />
          <Product />
          <Safe />
          <Proof />
          <Setup />
          <Open />
          <Faq />
        </main>
        <Footer />
      </div>
    </LiveCtx.Provider>
  );
}

const Label = ({ children, dot }: { children: ReactNode; dot?: boolean }) => (
  <div className="label reveal">{dot && <span className="dot" aria-hidden />}{children}</div>
);

// ── hero: words on the left, the glass ledger of real payouts on the right ──

function Hero() {
  const live = useLive();
  const m = useMeta();
  const now = nowNs();
  const labels = live && m
    ? [...live.payouts].reverse().map((p) => `${money(p.amount, m)} → ${p.recipient.replace(/\.nutus-dev\.testnet$/, "")}\n#${p.id} · ${said(p, now)}`)
    : [];
  return (
    <section className="ln-hero">
      <Suspense fallback={null}>{labels.length > 0 && <GlassLedger className="art" labels={labels} />}</Suspense>
      <div className="wrap hero-copy">
        <div className="label"><span className="dot" aria-hidden />Live on NEAR testnet</div>
        <h1>Your DAO pays people <span className="g">even when the council is busy.</span></h1>
        <p className="sub">A payout layer for Sputnik DAOs. The council decides once; then small payments go through unless someone objects.</p>
        <div className="links">
          <Link className="arrow" to="/get-paid">Try it on testnet →</Link>
          <a className="arrow" href="#read">Read your DAO →</a>
        </div>
      </div>
    </section>
  );
}

// ── the idea in one paragraph, lit word by word ──

const SAY = "The council decides once. Small payouts go through ~unless someone objects.~ Recurring pay keeps the notice it promised. And every payment is checked before anyone votes.";

function Statement() {
  const ref = useRef<HTMLParagraphElement>(null);
  const [lit, setLit] = useState(0);
  const words = SAY.split(" ");
  useEffect(() => {
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        // Start lighting as the paragraph enters; fully lit by the time it's mid-screen.
        const p = (innerHeight * 0.85 - r.top) / (innerHeight * 0.3 + r.height * 0.6);
        setLit(Math.round(Math.min(1, Math.max(0, p)) * words.length));
      });
    };
    on();
    addEventListener("scroll", on, { passive: true });
    return () => {
      removeEventListener("scroll", on);
      cancelAnimationFrame(raf);
    };
  }, [words.length]);
  let hint = false;
  return (
    <section className="ln-say">
      <div className="wrap">
        <p ref={ref} aria-label={SAY.replace(/~/g, "")}>
          {words.map((w, i) => {
            if (w.startsWith("~")) hint = true;
            const cls = `w${hint ? " hint" : ""}${i < lit ? " on" : ""}`;
            if (w.endsWith("~")) hint = false;
            return (
              <span key={i} aria-hidden>
                <span className={cls}>{w.replace(/~/g, "")}</span>{" "}
              </span>
            );
          })}
        </p>
      </div>
    </section>
  );
}

function Numbers({ s }: { s: Summary }) {
  const f = s.findings;
  return (
    <section className="ln-sec">
      <div className="wrap">
        <Label>The problem, measured on mainnet</Label>
        <h2 className="reveal">We read {f.proposals.toLocaleString("en-US")} proposals from {f.daos} active DAOs. <span className="g">Here's where payouts break.</span></h2>
        <div className="nums">
          <div className="num reveal"><div className="n">{Math.round((100 * f.f3.silentSeats) / f.f3.seats)}%</div><p>of council seats cast no vote in 60 days.</p></div>
          <div className="num reveal" style={{ transitionDelay: "120ms" }}><div className="n">{f.f4.failed}</div><p>proposals passed the vote, then failed to pay.</p></div>
          <div className="num reveal" style={{ transitionDelay: "240ms" }}><div className="n">{f.f1.neverRepaid}</div><p>of {f.f1.recipientsWithLapse} people whose small payment lapsed were never paid.</p></div>
        </div>
        <p className="src">Scanned {s.meta.scannedAt.slice(0, 10)}. Reproduce it with <span className="mono">pnpm --filter @nutus/report scan</span>.</p>
      </div>
    </section>
  );
}

function How() {
  const steps = [
    ["Filed", "Someone files their payout in a lane the council set up once."],
    ["Window", "For 48 hours any council member can object. Nobody has to vote."],
    ["Paid", "When the window closes, it pays. An objection makes it a normal DAO vote."],
    ["Recorded", "Every paid job counts. A longer record raises what pays without a vote."],
  ];
  return (
    <section className="ln-sec">
      <div className="wrap">
        <Label>How a payout moves</Label>
        <ol className="how">
          {steps.map(([t, d], i) => (
            <li key={t} className="reveal">
              <span className="no">0{i + 1}</span>
              <h3>{t}</h3>
              <p>{d}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ── what you get: each surface shown live, not described ──

function Product() {
  return (
    <section className="ln-sec">
      <div className="wrap">
        <Label>What you get</Label>
        <h2 className="reveal">One place for the council, the people being paid, <span className="g">and anyone checking the books.</span></h2>
        <div className="surfaces">
          <Surface path="/council" title="Council inbox" line="Everything that needs a council member: object to a small payout, approve a medium one, finalize an expired vote." cta="Open the inbox" view={<InboxView />} />
          <Surface path="/get-paid" title="Get paid" line="Contributors file their own payout and see straight away whether it needs a vote." cta="File a payout" view={<FileView />} />
          <Surface path="/board" title="Payouts" line="A public board of every payout, recurring payment and record, read from the chain." cta="See the board" view={<BoardView />} />
          <Surface path="/report" title="DAO report" line="Read any Sputnik DAO's last year and get the fixes drafted as proposals." cta="Read a DAO" view={<ReportView />} />
          <Surface href="https://t.me/nutusalertbot" title="Telegram alerts" line="Add the bot to the council's chat. It posts what needs attention, as it happens or as a daily summary." cta="Open the bot" view={<BotView />} />
        </div>
      </div>
    </section>
  );
}

function Surface({ path, href, title, line, cta, view }: { path?: string; href?: string; title: string; line: string; cta: string; view: ReactNode }) {
  return (
    <article className="surface reveal">
      <div className="say">
        <span className="mono path">{path ?? "@nutusalertbot"}</span>
        <h3>{title}</h3>
        <p>{line}</p>
        {path ? <Link className="arrow" to={path}>{cta} →</Link> : <a className="arrow" href={href}>{cta} →</a>}
      </div>
      <div className="screen">{view}</div>
    </article>
  );
}

function InboxView() {
  const live = useLive();
  const m = useMeta();
  const now = useNow(30_000);
  const open = live?.payouts.filter((p) => p.status === "Waiting" && BigInt(p.deadline_ns) > now).slice(0, 3) ?? [];
  if (!live) return <p className="quiet">Reading testnet…</p>;
  if (open.length === 0) return <p className="quiet">Nothing waiting for the council right now.</p>;
  return (
    <ul className="rows">
      {open.map((p) => (
        <li key={p.id}>
          <div><b>{money(p.amount, m)}</b> <span className="mono dim">{p.recipient}</span><div className="dim small">{said(p, now)}</div></div>
          <span className="ghost">{p.tier === "Small" ? "Object" : "Approve"}</span>
        </li>
      ))}
    </ul>
  );
}

function FileView() {
  const live = useLive();
  const m = useToken(live?.lanes[0]?.token);
  const lane = live?.lanes[0];
  return (
    <div className="sentence">
      <p>Pay <u>{lane && m ? `${formatAmount(lane.small_max, m.decimals)} ${m.symbol}` : "…"}</u> to <u className="mono">you.testnet</u> for <u>the work</u>.</p>
      <p className="dim small"><span className="dot" aria-hidden /> Small: pays in {lane ? duration(BigInt(lane.window_ns)) : "48 h"} unless someone objects.</p>
    </div>
  );
}

function BoardView() {
  const live = useLive();
  const m = useMeta();
  const now = nowNs();
  const recent = [...(live?.payouts ?? [])].reverse().slice(0, 4);
  if (!live) return <p className="quiet">Reading testnet…</p>;
  return (
    <ul className="rows">
      {recent.map((p) => (
        <li key={p.id}>
          <div><span className="mono dim">#{p.id}</span> <b>{money(p.amount, m)}</b> <span className="mono dim">{p.recipient}</span></div>
          <span className="status">{said(p, now)}</span>
        </li>
      ))}
    </ul>
  );
}

function ReportView() {
  const reads = ["Council seats that stopped voting", "Payments that failed after the vote", "Small payments that lapsed", "Repeat payments voted from scratch"];
  return (
    <div>
      <div className="field mono">your-dao.sputnik-dao.near</div>
      <ul className="rows ticks">
        {reads.map((r) => <li key={r}><span>{r}</span></li>)}
        <li><span>Fix this: the setup proposal, drafted</span><span className="dot" aria-hidden /></li>
      </ul>
    </div>
  );
}

function BotView() {
  return (
    <div className="tg">
      <div className="who"><span className="av"><Mark color="#fff" width={14} /></span><b>Nutus</b></div>
      <div className="bubble">
        <b>New payout #6</b><br />
        <b>3 tUSDC</b> to <span className="mono">c3.nutus-dev.testnet</span><br />
        <span className="dim">Design lane</span><br /><br />
        It pays automatically in 47 h unless a council member objects.
      </div>
    </div>
  );
}

// ── safe by design ──

function Safe() {
  const facts = [
    ["Your DAO's contract never changes.", "Nutus sits beside Sputnik DAO v2. The council sets it up with one normal proposal."],
    ["The code can't be swapped.", "Every Nutus account runs the same code, deployed once as a NEAR global contract and fixed by its hash."],
    ["Only the DAO controls the money.", "Only the DAO can configure, fund, pause or withdraw. Anyone can trigger a payment that's already due."],
    ["Notice is locked.", "When recurring pay starts, its notice is set aside. Not even a DAO vote can take it back."],
    ["Checked before the vote.", "Preflight catches payments that would fail after passing, like a recipient not registered with the token, and fixes them in the proposal."],
    ["Tested against the real thing.", "106 contract unit tests, a property test of the core invariants, and sandbox runs against the real Sputnik DAO contract."],
  ];
  return (
    <section className="ln-sec">
      <div className="wrap">
        <Label>Safe by design</Label>
        <h2 className="reveal">It can only do what the council already agreed to. <span className="g">Nothing else.</span></h2>
        <div className="facts">
          {facts.map(([t, d], i) => (
            <div className="fact reveal" key={t} style={{ transitionDelay: `${(i % 3) * 80}ms` }}>
              <h3>{t}</h3>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── proof: one live window, and the transactions that show each flow works ──

const TXS: [string, string, string][] = [
  ["10 Nov", "A council member objected from their wallet; payout #3 became DAO proposal 4", "DL2jMatJVN92g8HiA5jae2e4fTk18vtt2V26KmVrUYgM"],
  ["10 Nov", "The DAO approved proposal 4; the bond came back and the payout settled", "BnwT5DEfPFG1UCUKFqxP9R49vnyQ1owcQzo249mkWLK3"],
  ["10 Nov", "One council approval paid medium payout #2: 150 tUSDC", "2LWUDWfFv1BG5nFvABaUujUqYCsvj1fUu88ovmrZzvZD"],
  ["10 Nov", "Preflight added a registration step; an unregistered recipient was paid", "68yuqQcv6BsxajmXMb61p62QDnLeKJvB54FnDYN8Ws6x"],
  ["11 Nov", "Past payments imported as track records, one proposal", "G7oyUnV9cvXtvFicVouPusrtGLuZTEzYudYTcorqEdaJ"],
  ["11 Nov", "The keeper paid recurring payment #0 on schedule", "9gaPg3ZnS7ynNe3sdgPrfpukQ6ew8WkukXf5eyUnQZBE"],
];

function Proof() {
  const live = useLive();
  const now = nowNs();
  const next = live?.payouts.filter((p) => p.status === "Waiting" && BigInt(p.deadline_ns) > now).sort((a, b) => Number(BigInt(a.deadline_ns) - BigInt(b.deadline_ns)))[0];
  return (
    <section className="ln-sec">
      <div className="wrap">
        <Label dot>Proof it works</Label>
        <h2 className="reveal">Every flow has run on testnet <span className="g">with real transactions.</span></h2>
        {next && <LiveRow p={next} />}
        <ul className="txs">
          {TXS.map(([d, what, h]) => (
            <li key={h} className="reveal">
              <span className="mono dim">{d}</span>
              <span>{what}</span>
              <a className="mono" href={`${EXPLORER}/txns/${h}`} target="_blank" rel="noreferrer">{h.slice(0, 8)}… ↗</a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function LiveRow({ p }: { p: Payout }) {
  const now = useNow(1000);
  const m = useToken(p.token);
  const filed = BigInt(p.filed_at_ns), end = BigInt(p.deadline_ns);
  const pct = Math.min(100, Math.max(0, Number(((now - filed) * 10000n) / (end - filed || 1n)) / 100));
  const left = end > now ? Number((end - now) / 1_000_000_000n) : 0;
  const clock = [Math.floor(left / 3600), Math.floor((left % 3600) / 60), left % 60].map((v) => String(v).padStart(2, "0")).join(":");
  return (
    <Link to="/board" className="live reveal">
      <div className="what">
        <span className="label" style={{ display: "inline-flex", marginRight: "0.8rem" }}><span className="dot" aria-hidden />right now</span>
        Payout #{p.id}: {money(p.amount, m)} to <span className="mono">{p.recipient}</span>
        <span className="g"> pays unless someone objects.</span>
      </div>
      <div className="clock" aria-label={`${clock} left`}>{clock}</div>
      <div className="line-track" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Objection window">
        <i style={{ width: `${pct}%` }} />
        <b style={{ left: `${pct}%` }} />
      </div>
    </Link>
  );
}

// ── set it up: three steps, starting with reading your own DAO ──

function Setup() {
  const nav = useNavigate();
  const [dao, setDao] = useState("");
  const go = (e: FormEvent) => {
    e.preventDefault();
    const v = dao.trim();
    nav(v ? `/report?dao=${encodeURIComponent(v.includes(".") ? v : `${v}.sputnik-dao.near`)}` : "/report");
  };
  const steps = [
    ["Read", "Nutus reads your DAO's history and sizes a lane from what you already pay."],
    ["Vote", "Your council votes once on the drafted setup proposal, like any other."],
    ["Run", "Payouts flow through the window. The DAO keeps full control."],
  ];
  return (
    <section className="ln-sec" id="read">
      <div className="wrap">
        <Label>Set it up for your DAO</Label>
        <h2 className="reveal">Three steps, <span className="g">one vote.</span></h2>
        <ol className="steps3">
          {steps.map(([t, d], i) => (
            <li key={t} className="reveal" style={{ transitionDelay: `${i * 80}ms` }}>
              <span className="no">0{i + 1}</span>
              <h3>{t}</h3>
              <p>{d}</p>
            </li>
          ))}
        </ol>
        <form className="read reveal" onSubmit={go} role="search">
          <label htmlFor="dao" className="vh">Sputnik DAO name</label>
          <input id="dao" value={dao} onChange={(e) => setDao(e.target.value)} placeholder="your-dao.sputnik-dao.near" autoComplete="off" spellCheck={false} />
          <button type="submit">Read your DAO →</button>
        </form>
        <p className="hint reveal">Read-only; nothing is signed. When you're ready, <Link to="/setup">set it up</Link>.</p>
      </div>
    </section>
  );
}

function Open() {
  const links = [
    ["Code", "Contracts, app, keeper and bot, all open source.", REPO],
    ["Run a keeper", "Anyone can call what's due. It only needs gas money.", `${REPO}#keeper`],
    ["Telegram bot", "Alerts for your council's chat.", "https://t.me/nutusalertbot"],
    ["How it works, in full", "The spec, threat model and every decision.", `${REPO}/blob/main/docs/NUTUS_SPEC.md`],
  ];
  return (
    <section className="ln-sec">
      <div className="wrap">
        <Label>Open by default</Label>
        <div className="open-links">
          {links.map(([t, d, href]) => (
            <a key={t} href={href} className="reveal" target="_blank" rel="noreferrer">
              <h3>{t} <span aria-hidden>↗</span></h3>
              <p>{d}</p>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function Faq() {
  const qs = [
    ["Does Nutus change our DAO's contract?", "No. It sits beside your Sputnik DAO as a separate account. The council sets it up with one normal proposal and keeps every power it has today."],
    ["Who pays the gas?", "The keeper pays the gas for releases and recurring pay, and anyone can run one. Filing a payout attaches 0.1 NEAR: the payout's storage comes out of it and the rest is refunded once it's final."],
    ["What if the whole council goes quiet?", "Small payouts still pay when their window closes, and recurring pay keeps running. The DAO report flags silent seats before the council loses the votes it needs."],
    ["Can we stop it?", "Yes. The DAO can pause Nutus, cancel a waiting payout or withdraw its budget at any time. The only exception is notice already promised on recurring pay."],
    ["Is it on mainnet?", "Not yet. Nutus runs on NEAR testnet today. The mainnet numbers on this page come from a read-only scan."],
  ];
  return (
    <section className="ln-sec">
      <div className="wrap faq">
        <Label>Questions</Label>
        <div>
          {qs.map(([q, a]) => (
            <details key={q} className="reveal">
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="ln-foot">
      <div className="wrap">
        <div className="links">
          <span>Nutus runs on NEAR testnet.</span>
          <nav aria-label="Footer">
            <a href={REPO}>Code</a>
            <a href="https://t.me/nutusalertbot">Telegram</a>
            <Link to="/privacy">Privacy and terms</Link>
          </nav>
        </div>
        <Wordmark className="big" color="#fff" />
      </div>
    </footer>
  );
}
