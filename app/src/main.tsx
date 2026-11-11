import "./styles.css";
import { lazy, StrictMode, Suspense, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { instanceId } from "./config.ts";
import { WalletProvider } from "./lib/wallet.tsx";
import { Nav } from "./shell/Nav.tsx";
import { useSignalReady } from "./shell/intro.ts";

// Each screen is its own download, fetched when it's first opened.
const named = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })));
const Landing = named(() => import("./landing/Landing.tsx"), "Landing");
const Board = named(() => import("./screens/Board.tsx"), "Board");
const Council = named(() => import("./screens/Council.tsx"), "Council");
const GetPaid = named(() => import("./screens/GetPaid.tsx"), "GetPaid");
const Privacy = named(() => import("./screens/Privacy.tsx"), "Privacy");
const Report = named(() => import("./screens/Report.tsx"), "Report");
const Setup = named(() => import("./screens/Setup.tsx"), "Setup");

const TITLES: Record<string, string> = {
  "/board": "Payouts",
  "/council": "Council inbox",
  "/get-paid": "Get paid",
  "/report": "DAO report",
  "/setup": "Set up",
  "/privacy": "Privacy and terms",
};

/** Every app screen: the floating navigation, the page, a quiet footer. */
function AppShell() {
  const { pathname } = useLocation();
  useSignalReady();
  useEffect(() => {
    document.title = TITLES[pathname] ? `${TITLES[pathname]} · Nutus` : "Nutus";
    scrollTo(0, 0);
  }, [pathname]);
  return (
    <div className="ap">
      <Nav />
      <main>
        <Suspense fallback={<p className="muted">Loading…</p>}>
        <Routes>
          <Route path="/board" element={<Board />} />
          <Route path="/get-paid" element={<GetPaid />} />
          <Route path="/council" element={<Council />} />
          <Route path="/report" element={<Report />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/findings" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </main>
      <footer className="ap-foot">
        <div className="in">
          <span>Reading <span className="mono">{instanceId()}</span> on NEAR testnet</span>
          <nav aria-label="Footer">
            <Link to="/setup">Set up</Link>
            <a href="https://t.me/nutusalertbot">Telegram</a>
            <a href="https://github.com/Sam-Rytech/nutus">Code</a>
            <Link to="/privacy">Privacy and terms</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function NotFound() {
  return (
    <div className="nf">
      <div className="code">404</div>
      <h1>That address doesn't match a screen. <span className="g">Try one of these.</span></h1>
      <div className="row" style={{ marginTop: "1.5rem" }}>
        <Link className="btn" to="/">Go to the start</Link>
        <Link className="btn quiet" to="/board">See the payouts</Link>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WalletProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Suspense fallback={<div style={{ minHeight: "100vh", background: "#000" }} />}><Landing /></Suspense>} />
          <Route path="*" element={<AppShell />} />
        </Routes>
      </BrowserRouter>
    </WalletProvider>
  </StrictMode>,
);
