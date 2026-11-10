import "./polyfills.ts";
import "@fontsource-variable/public-sans";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { instanceId } from "./config.ts";
import { WalletProvider, useWallet } from "./lib/wallet.tsx";
import { Board } from "./screens/Board.tsx";
import { Council } from "./screens/Council.tsx";
import { Ecosystem } from "./screens/Ecosystem.tsx";
import { GetPaid } from "./screens/GetPaid.tsx";
import { Report } from "./screens/Report.tsx";
import { Setup } from "./screens/Setup.tsx";

function Shell() {
  const { accountId, signIn, signOut } = useWallet();
  const { search } = useLocation();
  const keep = (path: string) => path + search;
  return (
    <div className="shell">
      <aside className="rail">
        <NavLink to={keep("/")} className="brand">
          Nutus
          <small>Your DAO pays people even when the council is busy.</small>
        </NavLink>
        <nav aria-label="Screens">
          <NavLink to={keep("/board")}>Payouts</NavLink>
          <NavLink to={keep("/get-paid")}>Get paid</NavLink>
          <NavLink to={keep("/council")}>Council inbox</NavLink>
          <hr />
          <NavLink to={keep("/report")}>DAO report</NavLink>
          <NavLink to={keep("/setup")}>Set up</NavLink>
          <NavLink to={keep("/")} end>Network findings</NavLink>
        </nav>
        <div className="who">
          <div>Instance <span className="mono">{instanceId()}</span> on testnet</div>
          {accountId ? (
            <div className="row" style={{ marginTop: "0.5rem" }}>
              <span className="mono">{accountId}</span>
              <button className="btn quiet small" onClick={() => signOut()}>Sign out</button>
            </div>
          ) : (
            <button className="btn" style={{ marginTop: "0.5rem" }} onClick={signIn}>Connect wallet</button>
          )}
        </div>
      </aside>
      <main>
        <Routes>
          <Route path="/" element={<Ecosystem />} />
          <Route path="/board" element={<Board />} />
          <Route path="/get-paid" element={<GetPaid />} />
          <Route path="/council" element={<Council />} />
          <Route path="/report" element={<Report />} />
          <Route path="/setup" element={<Setup />} />
        </Routes>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WalletProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </WalletProvider>
  </StrictMode>,
);
