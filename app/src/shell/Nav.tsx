// The floating navigation, shared by the landing page and every app screen.

import { Link, NavLink, useLocation } from "react-router-dom";
import { Lockup } from "../brand/Logo.tsx";
import { useWallet } from "../lib/wallet.tsx";

export function Nav() {
  const { accountId, signIn, signOut } = useWallet();
  // Keep ?instance=… when moving between screens.
  const { search } = useLocation();
  const to = (path: string) => path + search;
  return (
    <header className="top-nav">
      <Link to={to("/")} aria-label="Nutus home"><Lockup className="logo" color="#fff" /></Link>
      <nav aria-label="Screens">
        <NavLink to={to("/board")}>Payouts</NavLink>
        <NavLink to={to("/council")}>Council</NavLink>
        <NavLink to={to("/get-paid")}>Get paid</NavLink>
        <NavLink to={to("/report")}>Report</NavLink>
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
