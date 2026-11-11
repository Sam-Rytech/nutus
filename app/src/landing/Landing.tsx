import { allPayouts } from "@nutus/core";
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Lockup, Wordmark } from "../brand/Logo.tsx";
import { instanceId } from "../config.ts";
import { formatAmount, nowNs, reader, useAsync, useNow, useToken, type Payout } from "../lib/chain.ts";
import { useWallet } from "../lib/wallet.tsx";
import "./landing.css";

// three.js is large; load the hero art after the page paints.
const GlassMark = lazy(() => import("../brand/GlassMark.tsx").then((m) => ({ default: m.GlassMark })));

const found = import.meta.glob("../../../data/scan/summary.json", { eager: true, import: "default" });
type Summary = {
  meta: { scannedAt: string };
  findings: { daos: number; proposals: number; f1: { neverRepaid: number; recipientsWithLapse: number }; f3: { seats: number; silentSeats: number }; f4: { failed: number; daos: number } };
};
const summary = Object.values(found)[0] as Summary | undefined;

/** Adds `.in` to every `.reveal` as it scrolls into view. */
function useReveal(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const els = root.current?.querySelectorAll(".reveal") ?? [];
    if (typeof IntersectionObserver === "undefined") return els.forEach((e) => e.classList.add("in"));
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))), { rootMargin: "0px 0px -12% 0px" });
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
        <Statement />
        {summary && <Numbers s={summary} />}
        <How />
        <Live />
        <Read />
      </main>
      <Footer />
    </div>
  );
}

function Nav() {
  const { accountId, signIn, signOut } = useWallet();
  return (
    <header className="ln-nav">
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
          <button className="pill" onClick={() => signOut()}>Sign out</button>
        </>
      ) : (
        <button className="pill" onClick={signIn}>Connect wallet</button>
      )}
    </header>
  );
}

function Hero() {
  return (
    <section className="ln-hero">
      <Suspense fallback={null}>
        <GlassMark className="art" />
      </Suspense>
      <div className="wrap base">
        <div>
          <div className="label"><span className="dot" aria-hidden />Live on NEAR testnet</div>
          <h1>Your DAO pays people <span className="g">even when the council is busy.</span></h1>
        </div>
        <div className="links">
          <Link className="arrow" to="/council">Open the app →</Link>
          <a className="arrow" href="#read">Read your DAO →</a>
        </div>
      </div>
    </section>
  );
}

// ── the idea in one paragraph, lit word by word as it scrolls past ──

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
    <section className="ln-nums">
      <div className="wrap">
        <div className="label reveal">What we found reading {f.proposals.toLocaleString("en-US")} proposals from {f.daos} DAOs on mainnet</div>
        <div className="nums">
          <div className="num reveal"><div className="n">{Math.round((100 * f.f3.silentSeats) / f.f3.seats)}%</div><p>of council seats cast no vote in 60 days.</p></div>
          <div className="num reveal" style={{ transitionDelay: "120ms" }}><div className="n">{f.f4.failed}</div><p>proposals passed the vote, then failed to pay.</p></div>
          <div className="num reveal" style={{ transitionDelay: "240ms" }}><div className="n">{f.f1.neverRepaid}<small>of</small>{f.f1.recipientsWithLapse}</div><p>people whose small payment lapsed were never paid.</p></div>
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
    <section className="ln-how">
      <div className="wrap">
        <div className="label reveal">How a payout moves</div>
        <div className="how">
          <ol>
            {steps.map(([t, d], i) => (
              <li key={t} className="reveal">
                <span className="no">0{i + 1}</span>
                <h3>{t}</h3>
                <p>{d}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

// ── one real payout, its window ticking, as a single line ──

function Live() {
  const id = instanceId();
  const d = useAsync(async () => {
    const now = nowNs();
    const open = (await allPayouts(reader(id))).filter((p) => p.status === "Waiting" && BigInt(p.deadline_ns) > now);
    return open.sort((a, b) => Number(BigInt(a.deadline_ns) - BigInt(b.deadline_ns)))[0] ?? null;
  }, [id]);
  if (!d.data) return null;
  return (
    <section className="ln-live">
      <div className="wrap">
        <div className="label" style={{ marginBottom: "1.5rem" }}><span className="dot" aria-hidden />Right now on testnet</div>
        <LiveRow p={d.data} />
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
    <Link to="/board" className="live" style={{ textDecoration: "none" }}>
      <div className="what">
        Payout #{p.id}: {m ? `${formatAmount(p.amount, m.decimals)} ${m.symbol}` : "…"} to <span className="mono">{p.recipient}</span>
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

function Read() {
  const nav = useNavigate();
  const [dao, setDao] = useState("");
  const go = (e: FormEvent) => {
    e.preventDefault();
    const v = dao.trim();
    nav(v ? `/report?dao=${encodeURIComponent(v.includes(".") ? v : `${v}.sputnik-dao.near`)}` : "/report");
  };
  return (
    <section className="ln-read" id="read">
      <div className="wrap">
        <h2 className="reveal">Read your DAO.</h2>
        <form className="reveal" onSubmit={go} role="search">
          <label htmlFor="dao" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Sputnik DAO name</label>
          <input id="dao" value={dao} onChange={(e) => setDao(e.target.value)} placeholder="marketing.sputnik-dao.near" autoComplete="off" spellCheck={false} />
          <button type="submit">Read it →</button>
        </form>
        <p className="hint reveal">See where its payouts get stuck. Read-only; nothing is signed.</p>
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
            <a href="https://github.com/Sam-Rytech/nutus">Code</a>
            <a href="https://t.me/nutusalertbot">Telegram</a>
            <Link to="/privacy">Privacy and terms</Link>
          </nav>
        </div>
        <Wordmark className="big" color="#fff" />
      </div>
    </footer>
  );
}
