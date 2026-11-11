// The objection window as water. `level` (0..1) is how much of the window has
// passed: empty when filed, full when it pays. "rise" fills a glass panel from
// the bottom (the hero); "flow" fills a slim tube left to right (payout rows).
// The surface moves with a slow wave unless the reader prefers reduced motion.

import { useEffect, useId, useRef, useState } from "react";

const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function useTime(active: boolean) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!active || reduced()) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setT((now - start) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return t;
}

/** A wave across `width` at height `y` (SVG coords, y down), closed down to `bottom`. */
function wavePoints(width: number, y: number, t: number, amp: number, len: number) {
  const pts: string[] = [];
  const step = Math.max(4, width / 40);
  for (let x = 0; x <= width + step; x += step) {
    const yy = y + Math.sin(x / len + t * 1.6) * amp + Math.sin(x / (len * 0.53) - t * 1.1) * amp * 0.45;
    pts.push(`${x.toFixed(1)} ${yy.toFixed(1)}`);
  }
  return pts;
}
function surface(width: number, y: number, bottom: number, t: number, amp: number, len: number) {
  const pts = wavePoints(width, y, t, amp, len);
  return `M0 ${bottom} L${pts.join(" L")} L${width + Math.max(4, width / 40)} ${bottom} Z`;
}
/** Just the surface line, for the highlight. */
const crest = (width: number, y: number, t: number, amp: number, len: number) => `M${wavePoints(width, y, t, amp, len).join(" L")}`;

export function Water({
  level,
  variant = "flow",
  tone = "tidal",
  className,
  label,
}: {
  level: number;
  variant?: "rise" | "flow";
  /** tidal = waiting/paid, grey = objected/drained, alert = failed */
  tone?: "tidal" | "grey" | "alert";
  className?: string;
  label?: string;
}) {
  const id = useId().replace(/:/g, "");
  const ref = useRef<SVGSVGElement>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const t = useTime(visible);
  const lv = Math.min(1, Math.max(0, level));
  const color = tone === "tidal" ? "var(--tidal)" : tone === "grey" ? "var(--grey-500)" : "var(--alert)";
  const aria = { role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(lv * 100), "aria-label": label ?? "Objection window" } as const;

  if (variant === "rise") {
    const W = 320, H = 400, r = 28;
    const y = H - lv * H;
    return (
      <svg ref={ref} className={`water water-rise ${className ?? ""}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" {...aria}>
        <defs>
          <clipPath id={`c${id}`}><rect width={W} height={H} rx={r} /></clipPath>
          <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.95" />
            <stop offset="1" stopColor={color} stopOpacity="0.55" />
          </linearGradient>
        </defs>
        <g clipPath={`url(#c${id})`}>
          <rect width={W} height={H} className="water-glass" />
          {lv > 0 && (
            <>
              <path d={surface(W, y - 6, H, t * 0.8 + 1.3, 7, 34)} fill={color} opacity="0.28" />
              <path d={surface(W, y, H, t, 6, 40)} fill={`url(#g${id})`} />
              <path d={crest(W, y + 1.5, t, 6, 40)} className="water-shine" />
            </>
          )}
        </g>
        <rect x="0.75" y="0.75" width={W - 1.5} height={H - 1.5} rx={r} className="water-edge" />
      </svg>
    );
  }

  const W = 600, H = 14;
  const x = lv * W;
  const wave = Array.from({ length: 9 }, (_, i) => {
    const yy = (i / 8) * H;
    const xx = x + Math.sin(yy / 2.4 + t * 2.4) * 3 * (lv > 0 && lv < 1 ? 1 : 0);
    return `${xx.toFixed(1)} ${yy.toFixed(1)}`;
  });
  return (
    <svg ref={ref} className={`water water-flow ${className ?? ""}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" {...aria}>
      <defs><clipPath id={`c${id}`}><rect width={W} height={H} rx={H / 2} /></clipPath></defs>
      <g clipPath={`url(#c${id})`}>
        <rect width={W} height={H} className="water-glass" />
        {lv > 0 && <path d={`M0 0 L${wave.join(" L")} L0 ${H} Z`} fill={color} />}
      </g>
    </svg>
  );
}
