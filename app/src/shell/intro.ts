// Talks to the loading animation in index.html: the app says when it has
// rendered (the intro then zooms out), and heavy work can wait until the
// intro is over and the browser is idle.

import { useEffect, useState } from "react";

declare global {
  interface Window {
    __nutusIntro?: "running" | "done";
  }
}

/** Call once the first screen has rendered. */
export function useSignalReady() {
  useEffect(() => {
    const id = requestAnimationFrame(() => dispatchEvent(new Event("nutus:ready")));
    return () => cancelAnimationFrame(id);
  }, []);
}

/** True once the intro has finished (or never ran) and the browser has had an idle moment. */
export function useAfterIntro(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const idle = (cb: () => void) => {
      const ric = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (ric) ric(cb, { timeout: 1500 });
      else setTimeout(cb, 300);
    };
    const go = () => idle(() => !cancelled && setOk(true));
    if (window.__nutusIntro !== "running") go();
    else addEventListener("nutus:intro-done", go, { once: true });
    return () => {
      cancelled = true;
      removeEventListener("nutus:intro-done", go);
    };
  }, []);
  return ok;
}
