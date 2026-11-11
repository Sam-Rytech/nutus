// Talks to the loading animation in index.html: the app says when it has
// rendered, and the landing's 3D says when its first frame is on screen.
// The intro opens once both are true.

import { useEffect } from "react";

declare global {
  interface Window {
    __nutusIntro?: "running" | "done";
  }
}

/** The landing's 3D ledger has drawn its first frame (or can't draw at all). */
export const signal3dReady = () => dispatchEvent(new Event("nutus:3d-ready"));

/** Call once the first screen has rendered. */
export function useSignalReady() {
  useEffect(() => {
    const id = requestAnimationFrame(() => dispatchEvent(new Event("nutus:ready")));
    return () => cancelAnimationFrame(id);
  }, []);
}
