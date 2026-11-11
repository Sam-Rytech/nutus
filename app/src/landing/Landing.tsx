import { allPayouts } from "@nutus/core";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Lockup, Mark } from "../brand/Logo.tsx";
import { Water } from "../brand/Water.tsx";
import { instanceId } from "../config.ts";
import { formatAmount, nowNs, reader, useAsync, useNow, useToken, type Payout } from "../lib/chain.ts";
import { useWallet } from "../lib/wallet.tsx";
import "./landing.css";

const found = import.meta.glob("../../../data/scan/summary.json", { eager: true, import: "default" });
type Summary = {
  meta: { scannedAt: string; daosOnFactory: number; windowDays: number };
  findings: {
    daos: number;
    proposals: number;
    f1: { smallLapsed: number; neverRepaid: number; recipientsWithLapse: number };
    f2: { repeatPayments: number };
    f3: { seats: number; silentSeats: number };
    f4: { failed: number; daos: number };
  };
};
const summary = Object.values(found)[0] as Summary | undefined;

/** 0 when `el`'s top reaches the viewport top, 1 when its bottom reaches the viewport bottom. */
function useProgress(ref: React.RefObject<HTMLElement | null>) {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const span = r.height - innerHeight;
        setP(span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : r.top < innerHeight * 0.5 ? 1 : 0);
      });
    };
    on();
    addEventListener("scroll", on, { passive: true });
    addEventListener("resize", on);
    return () => {
      removeEventListener("scroll", on);
      removeEventListener("resize", on);
      cancelAnimationFrame(raf);
    };
  }, [ref]);
  return p;
}

/** Adds `.in` to every `.reveal` inside the page as it scrolls into view. */
function useReveal(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const els = root.current?.querySelectorAll(".reveal") ?? [];
    if (typeof IntersectionObserver === "undefined") return els.forEach((e) => e.classList.add("in"));
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))), { rootMargin: "0px 0px -10% 0px" });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [root]);
}

export function Landing() {
  const page = useRef<HTMLDivElement>(null);
  useReveal(page);
  return (
    <div className="ln" ref={page}>
      <Nav />
      <main>
        <Hero />
        {summary && <Findings s={summary} />}
        <How />
        <Ways />
        <Runs />
        <Read />
      </main>
      <Footer />
    </div>
  );
}

function Nav() {
  const { accountId, signIn, signOut } = useWallet();
  return (
    <header className="ln-nav glass">
      <Link to="/" aria-label="Nutus home"><Lockup className="logo" color="#fff" /></Link>
      <nav aria-label="Screens">
        <Link to="/board">Payouts</Link>
        <Link to="/council">Council</Link>
        <Link to="/get-paid">Get paid</Link>
        <Link to="/report">Report</Link>
      </nav>
      {accountId ? (
        <>
          <span className="who" title={accountId}>{accountId}</span>
          <button className="btn btn-white" onClick={() => signOut()}>Sign out</button>
        </>
      ) : (
        <button className="btn btn-white" onClick={signIn}>Connect wallet</button>
      )}
    </header>
  );
}

// ── 2 · hero: the newest payout whose window is open, live from testnet ──

function Hero() {
  const id = instanceId();
  const d = useAsync(async () => {
    const ps = await allPayouts(reader(id));
    const now = nowNs();
    const open = ps.filter((p) => p.status === "Waiting" && BigInt(p.deadline_ns) > now);
    // The open window closest to paying: the most water, and the soonest thing to watch happen.
    return open.sort((a, b) => Number(BigInt(a.deadline_ns) - BigInt(b.deadline_ns)))[0] ?? null;
  }, [id]);
  return (
    <section className="ln-hero">
      <div className="wrap grid">
        <div>
          <h1 className="two">Your DAO pays people. <span className="rest">Even when the council is busy.</span></h1>
          <p className="lede">The council decides once. Small payouts then go through unless someone objects, recurring pay runs with notice nobody can take back, and every payment is checked before the vote.</p>
          <div className="ctas">
            <Link className="btn btn-tidal" to="/council">Open the council inbox</Link>
            <Link className="btn btn-ghost" to="/report">Read your DAO</Link>
          </div>
        </div>
        {d.data ? <LiveWindow p={d.data} /> : <ExampleWindow loading={d.loading} />}
      </div>
    </section>
  );
}

function LiveWindow({ p }: { p: Payout }) {
  const now = useNow(1000);
  const m = useToken(p.token);
  const filed = BigInt(p.filed_at_ns);
  const end = BigInt(p.deadline_ns);
  const level = Number(((now - filed) * 10000n) / (end - filed || 1n)) / 10000;
  const left = end > now ? end - now : 0n;
  return (
    <div className="live glass" aria-live="off">
      <div className="tube">
        <Water variant="rise" level={level} label={`Payout ${p.id} objection window`} />
        <div className="over">
          <div>
            <span className="tag"><i aria-hidden /> Live on testnet · payout #{p.id}</span>
            <div className="amt" style={{ marginTop: "1rem" }}>{m ? `${formatAmount(p.amount, m.decimals)} ${m.symbol}` : "…"}</div>
            <div className="to">to {p.recipient}</div>
          </div>
          <div>
            <div className="clock">{clock(left)}</div>
            <div className="dim" style={{ fontSize: "0.9rem" }}>{p.tier === "Small" ? "until it pays, unless the council objects" : "left for one council approval"}</div>
          </div>
        </div>
      </div>
      <div className="foot">
        <span>The water is the window. Full means paid.</span>
        <Link to="/council">{p.tier === "Small" ? "Object" : "Approve"} →</Link>
      </div>
    </div>
  );
}

function ExampleWindow({ loading }: { loading: boolean }) {
  return (
    <div className="live glass">
      <div className="tube">
        <Water variant="rise" level={0.62} />
        <div className="over">
          <div>
            <span className="tag"><i aria-hidden /> {loading ? "Reading testnet…" : "Example · no window open on testnet right now"}</span>
            <div className="amt" style={{ marginTop: "1rem" }}>120 USDC</div>
            <div className="to">to designer.near</div>
          </div>
          <div>
            <div className="clock">18:14:07</div>
            <div className="dim" style={{ fontSize: "0.9rem" }}>until it pays, unless the council objects</div>
          </div>
        </div>
      </div>
      <div className="foot"><span>The water is the window. Full means paid.</span><Link to="/get-paid">File a payout →</Link></div>
    </div>
  );
}

const clock = (ns: bigint) => {
  const s = Number(ns / 1_000_000_000n);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return [h, m, x].map((v) => String(v).padStart(2, "0")).join(":");
};

// ── 3 · what we found: every proposal a tile, scanned, sorted into findings ──

function Findings({ s }: { s: Summary }) {
  const f = s.findings;
  const sec = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const p = useProgress(sec);
  const flagged = useMemo(() => {
    // Proposals that hit a problem the scan measures: failed after the vote, small payments that lapsed, repeat payments voted from scratch.
    const n = Math.min(f.proposals, f.f4.failed + f.f1.smallLapsed + f.f2.repeatPayments);
    const set = new Set<number>();
    let x = 7;
    while (set.size < n) set.add((x = (x * 1103515245 + 12345) % 2147483648) % f.proposals);
    return set;
  }, [f]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = c.clientWidth, H = c.clientHeight;
    c.width = W * dpr;
    c.height = H * dpr;
    const g = c.getContext("2d")!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, W, H);
    // Lay out exactly f.proposals tiles in the box.
    const cell = Math.sqrt((W * H) / f.proposals);
    const cols = Math.floor(W / cell), size = Math.max(1.5, cell - 1.4);
    const scan = Math.min(1, Math.max(0, (p - 0.1) / 0.55)) * W;
    for (let i = 0; i < f.proposals; i++) {
      const x = (i % cols) * cell, y = Math.floor(i / cols) * cell;
      if (y > H) break;
      const seen = x < scan;
      g.fillStyle = seen && flagged.has(i) ? "#0b8fa3" : seen ? "#c9ced5" : "#e3e7eb";
      g.fillRect(x, y, size, size);
    }
    if (scan > 0 && scan < W) {
      g.fillStyle = "#13b5cb";
      g.fillRect(scan, 0, 2, H);
    }
  }, [p, f, flagged]);

  const silent = Math.round((100 * f.f3.silentSeats) / f.f3.seats);
  const show = p > 0.55;
  return (
    <section className="ln-find" ref={sec} style={{ minHeight: "150vh" }}>
      <div className="wrap" style={{ position: "sticky", top: "4.5rem" }}>
        <h2 className="two reveal">We read {f.proposals.toLocaleString("en-US")} proposals. <span className="rest">Across {f.daos} active Sputnik DAOs on mainnet.</span></h2>
        <canvas ref={canvas} aria-label={`${f.proposals} proposals, one tile each; the highlighted ones hit a problem`} role="img" />
        <div className="stats" style={{ opacity: show ? 1 : 0, transform: show ? "none" : "translateY(16px)", transition: "all .8s cubic-bezier(.22,1,.36,1)" }}>
          <div className="stat"><div className="n">{silent}<em>%</em></div><p>of council seats ({f.f3.silentSeats} of {f.f3.seats}) cast no vote in the last 60 days.</p></div>
          <div className="stat"><div className="n">{f.f4.failed}</div><p>proposals passed the vote and then failed to execute, in {f.f4.daos} DAOs.</p></div>
          <div className="stat"><div className="n">{f.f1.neverRepaid}<small>of</small>{f.f1.recipientsWithLapse}</div><p>people whose small payment lapsed were never paid by that DAO afterwards.</p></div>
        </div>
        <p className="src">Scanned {s.meta.scannedAt.slice(0, 10)}. Every number reproduces with <span className="mono">pnpm --filter @nutus/report scan</span>.</p>
      </div>
    </section>
  );
}

// ── 4 · how it works: four steps, scrolled sideways ──

function How() {
  const sec = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const p = useProgress(sec);
  const [shift, setShift] = useState(0);
  useEffect(() => {
    const t = track.current;
    const last = t?.lastElementChild as HTMLElement | null;
    // Travel until the last card's right edge sits one gutter inside the viewport.
    if (t && last) setShift(Math.max(0, last.offsetLeft + last.offsetWidth + Math.max(16, (innerWidth - 1180) / 2) - innerWidth) * p);
  }, [p]);
  const fill = Math.min(1, Math.max(0, (p - 0.12) / 0.38));
  return (
    <section className="ln-how" ref={sec} aria-label="How it works">
      <div className="stick">
        <div className="head">
          <h2 className="two">How a payout moves. <span className="rest">Four steps, one vote.</span></h2>
          <div className="bar" aria-hidden><Water level={p} /></div>
        </div>
        <div className="track" ref={track} style={{ transform: `translateX(${-shift}px)` }}>
          <article className="step glass">
            <span className="no">01</span>
            <h3>Filed</h3>
            <p>Someone files their payout against a lane the council set up once: a budget, a size limit, a window.</p>
            <div className="demo">
              <div className="chip"><div className="row"><span className="k">Recipient</span><span className="v">designer.near</span></div></div>
              <div className="chip"><div className="row"><span className="k">Amount</span><span className="v">120 USDC · small</span></div></div>
            </div>
          </article>
          <article className="step glass">
            <span className="no">02</span>
            <h3>The window opens</h3>
            <p>For 48 hours any council member can object. Nobody has to vote for it to pay.</p>
            <div className="demo"><div className="chip"><div className="row"><span className="k">Payout #12</span><span className="v">{clock(BigInt(Math.round((1 - fill) * 48 * 3600)) * 1_000_000_000n)} left</span></div><Water level={fill} /></div></div>
          </article>
          <article className="step glass">
            <span className="no">03</span>
            <h3>Paid, or a real vote</h3>
            <p>When the window closes, it pays. If someone objected, it becomes a normal DAO proposal instead.</p>
            <div className="demo fork">
              <div className="chip"><b>Nobody objected</b><span className="k">Paid when the window closed</span><Water level={1} /></div>
              <div className="chip"><b>Someone objected</b><span className="k">Now DAO proposal 14</span><Water level={0.4} tone="grey" /></div>
            </div>
          </article>
          <article className="step glass">
            <span className="no">04</span>
            <h3>On the record</h3>
            <p>Every paid job counts. A longer record raises how much can be paid without a vote, and every point traces back to a real payment.</p>
            <div className="demo"><div className="chip"><div className="row"><span className="k">designer.near</span><span className="v">7 paid jobs · limit 250 USDC</span></div></div></div>
          </article>
        </div>
      </div>
    </section>
  );
}

// ── 5 · four ways to pay ──

function Ways() {
  const ways = [
    { t: "Small", lim: "up to the lane's limit", p: "Pays when the 48-hour window closes, unless a council member objects.", l: 0.7 },
    { t: "Medium", lim: "one approval", p: "Pays on the first council approval. If nobody approves in time, it goes to a DAO vote.", l: 0.35 },
    { t: "Large", lim: "full DAO vote", p: "Stays a normal vote, with the payment checked first so it can't fail after it passes.", l: 0.12 },
    { t: "Recurring", lim: "every period", p: "Pays on schedule. The notice is locked when it starts: not even a DAO vote can withdraw it.", l: 1 },
  ];
  return (
    <section className="ln-ways">
      <div className="wrap">
        <h2 className="two reveal">The council decides once. <span className="rest">Then each payment takes the path its size calls for.</span></h2>
        <div className="ways">
          {ways.map((w, i) => (
            <div className="way glass reveal" key={w.t} style={{ transitionDelay: `${i * 80}ms` }}>
              <span className="lim">{w.lim}</span>
              <h3>{w.t}</h3>
              <p>{w.p}</p>
              <Water level={w.l} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── 6 · it runs itself ──

function Runs() {
  return (
    <section className="ln-runs">
      <div className="wrap runs">
        <div className="reveal">
          <h2 className="two">It runs itself. <span className="rest">Nobody has to remember.</span></h2>
          <p className="lede">Every five minutes a keeper checks every Nutus account and calls whatever is due. Anyone can run one; ours only holds gas money.</p>
          <div className="ticker" aria-label="What each keeper round does">
            <div><span>release</span><span>a small payout whose window closed</span></div>
            <div><span>escalate</span><span>a medium payout nobody approved in time</span></div>
            <div><span>pay_due</span><span className="ok">recurring pay that's due</span></div>
            <div><span>settle</span><span>the result of a DAO vote</span></div>
          </div>
        </div>
        <div className="tg glass reveal" aria-label="An alert from the Nutus Telegram bot">
          <div className="who"><span className="av"><Mark color="#fff" width={14} /></span><div><b>Nutus</b><div className="dim" style={{ fontSize: "0.8rem" }}>@nutusalertbot</div></div></div>
          <div className="bubble">
            <b>New payout #6</b>
            <br />
            <b>3 tUSDC</b> to <span className="mono">c3.nutus-dev.testnet</span>
            <br />
            Design lane · Bot alert card test
            <br />
            <br />
            It pays automatically in 47 h unless a council member objects.
          </div>
          <div className="btns"><span>See the work</span><span>Object</span></div>
        </div>
      </div>
    </section>
  );
}

// ── 7 · read your DAO ──

function Read() {
  const nav = useNavigate();
  const [dao, setDao] = useState("");
  const go = (e: FormEvent) => {
    e.preventDefault();
    const v = dao.trim();
    nav(v ? `/report?dao=${encodeURIComponent(v.includes(".") ? v : `${v}.sputnik-dao.near`)}` : "/report");
  };
  return (
    <section className="ln-read">
      <div className="wrap">
        <h2 className="two reveal">Read your DAO. <span className="rest">See where its payouts get stuck.</span></h2>
        <form className="glass reveal" onSubmit={go}>
          <label htmlFor="dao" className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Sputnik DAO</label>
          <input id="dao" value={dao} onChange={(e) => setDao(e.target.value)} placeholder="marketing.sputnik-dao.near" autoComplete="off" spellCheck={false} />
          <button className="btn btn-tidal" type="submit">Read it</button>
        </form>
        <p className="hint">Read-only. Nothing is signed.</p>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="ln-foot">
      <div className="wrap">
        <div className="links">
          <span>Nutus runs on NEAR testnet. Mainnet findings are read-only.</span>
          <nav aria-label="Footer">
            <a href="https://github.com/Sam-Rytech/nutus">Code</a>
            <a href="https://t.me/nutusalertbot">Telegram</a>
            <Link to="/privacy">Privacy and terms</Link>
          </nav>
        </div>
        <Lockup className="big" color="#fff" />
      </div>
    </footer>
  );
}

