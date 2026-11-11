import "./polyfills.ts";
import "@fontsource-variable/public-sans";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "./styles.css";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { instanceId } from "./config.ts";
import { Landing } from "./landing/Landing.tsx";
import { WalletProvider } from "./lib/wallet.tsx";
import { Board } from "./screens/Board.tsx";
import { Council } from "./screens/Council.tsx";
import { GetPaid } from "./screens/GetPaid.tsx";
import { Privacy } from "./screens/Privacy.tsx";
import { Report } from "./screens/Report.tsx";
import { Setup } from "./screens/Setup.tsx";
import { Nav } from "./shell/Nav.tsx";

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
  useEffect(() => {
    document.title = TITLES[pathname] ? `${TITLES[pathname]} · Nutus` : "Nutus";
    scrollTo(0, 0);
  }, [pathname]);
  return (
    <div className="ap">
      <Nav />
      <main>
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
          <Route path="/" element={<Landing />} />
          <Route path="*" element={<AppShell />} />
        </Routes>
      </BrowserRouter>
    </WalletProvider>
  </StrictMode>,
);
