// The floating navigation, shared by the landing page and every app screen.
// On narrow screens the links and the wallet move into a menu behind a
// hamburger button.

import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Lockup } from "../brand/Logo.tsx";
import { useWallet } from "../lib/wallet.tsx";

const LINKS = [
  ["/board", "Payouts"],
  ["/council", "Council"],
  ["/get-paid", "Get paid"],
  ["/report", "Report"],
] as const;

export function Nav() {
  const { accountId, signIn, signOut } = useWallet();
  // Keep ?instance=… when moving between screens.
  const { pathname, search } = useLocation();
  const to = (path: string) => path + search;
  const [open, setOpen] = useState(false);

  // Close on navigation, on Escape, and when the screen grows past the breakpoint.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const mq = matchMedia("(min-width: 901px)");
    const onWide = () => mq.matches && setOpen(false);
    addEventListener("keydown", onKey);
    mq.addEventListener("change", onWide);
    return () => {
      removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onWide);
    };
  }, [open]);

  const wallet = accountId ? (
    <button className="pill" onClick={() => signOut()}>Sign out</button>
  ) : (
    <button className="pill" onClick={signIn}>Connect wallet</button>
  );

  return (
    <>
    <header className={`top-nav${open ? " is-open" : ""}`}>
      <Link to={to("/")} aria-label="Nutus home"><Lockup className="logo" color="#fff" /></Link>
      <nav aria-label="Screens" className="wide">
        {LINKS.map(([p, l]) => <NavLink key={p} to={to(p)}>{l}</NavLink>)}
      </nav>
      {accountId && <span className="who wide" title={accountId}>{accountId}</span>}
      <span className="wide">{wallet}</span>

      <button className="burger" aria-expanded={open} aria-controls="nav-menu" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden />
        <span aria-hidden />
      </button>
    </header>
      {/* A sibling of the bar, not a child: inside the bar's glass the panel would be composited see-through. */}
      <div id="nav-menu" className="menu" hidden={!open}>
        <nav aria-label="Screens">
          {LINKS.map(([p, l]) => <NavLink key={p} to={to(p)}>{l}</NavLink>)}
          <NavLink to={to("/setup")}>Set up</NavLink>
        </nav>
        <div className="menu-foot">
          {accountId && <span className="who" title={accountId}>{accountId}</span>}
          {wallet}
        </div>
      </div>
    </>
  );
}
