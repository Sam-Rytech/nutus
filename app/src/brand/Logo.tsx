// The Nutus mark (a u and an n, two strokes) and the lockup with the wordmark.
// Geometry matches app/public/brand/*.svg exactly.

import { GLYPHS } from "./glyphs.ts";

const U = "M14 12L14 60A24 24 0 0 0 57.2 74.4L104 12";
const N = "M80 84L126.8 21.6A24 24 0 0 1 170 36L170 84";
const CYAN = "var(--tidal)";

/** The two strokes. `draw` animates them in, u first, then n. */
export function Mark({ color = "currentColor", width = 12, draw = false, className, title = "Nutus" }: { color?: string; width?: number; draw?: boolean; className?: string; title?: string }) {
  return (
    <svg className={`${className ?? ""}${draw ? " mark-draw" : ""}`} viewBox="0 0 184 96" role="img" aria-label={title}>
      <g fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
        <path d={U} pathLength={1} />
        <path d={N} pathLength={1} />
      </g>
    </svg>
  );
}

/** Mark + "nutus", with the n and the last u in tidal cyan. */
export function Lockup({ color = "currentColor", className, draw = false }: { color?: string; className?: string; draw?: boolean }) {
  return (
    <svg className={`${className ?? ""}${draw ? " mark-draw" : ""}`} viewBox="0 0 420 96" role="img" aria-label="Nutus">
      <g fill="none" stroke={color} strokeWidth={12} strokeLinecap="round" strokeLinejoin="round">
        <path d={U} pathLength={1} />
        <path d={N} pathLength={1} />
      </g>
      <g className="wordmark" transform="translate(201.4 75.2) scale(0.04085)">
        <path fill={CYAN} d={GLYPHS.n} />
        <path fill={color} d={GLYPHS.u} />
        <path fill={color} d={GLYPHS.t} />
        <path fill={CYAN} d={GLYPHS.u2} />
        <path fill={color} d={GLYPHS.s} />
      </g>
    </svg>
  );
}
