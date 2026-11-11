// The top of every app screen: a small mono label, a big light two-tone
// title, one line of explanation, and optional headline numbers.

import type { ReactNode } from "react";

export interface Stat {
  n: ReactNode;
  label: string;
  hint?: boolean;
}

export function PageHead({ path, title, rest, lede, stats, children }: { path: string; title: string; rest?: string; lede?: ReactNode; stats?: Stat[]; children?: ReactNode }) {
  return (
    <header className="pg-head">
      <div className="pg-label">{path}</div>
      <h1>
        {title} {rest && <span className="g">{rest}</span>}
      </h1>
      {lede && <p className="pg-lede">{lede}</p>}
      {stats && stats.length > 0 && (
        <div className="pg-stats">
          {stats.map((s) => (
            <div key={s.label} className="pg-stat">
              <div className={`n${s.hint ? " hint" : ""}`}>{s.n}</div>
              <div className="l">{s.label}</div>
            </div>
          ))}
        </div>
      )}
      {children}
    </header>
  );
}
