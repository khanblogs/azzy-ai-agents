import clsx from "clsx";
import type { ReactNode } from "react";

export function KV({ rows, className }: { rows: { k: string; v: ReactNode }[]; className?: string }) {
  return (
    <dl className={clsx("grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs", className)}>
      {rows.map((r) => (
        <div key={r.k} className="contents">
          <dt className="text-slate-500">{r.k}</dt>
          <dd className="min-w-0 truncate text-slate-200">{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Pill({ color, children, className }: { color: string; children: ReactNode; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize", className)} style={{ borderColor: `${color}55`, color, backgroundColor: `${color}14` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </span>
  );
}

export function Progress({ value, color = "#00E5FF", label }: { value: number; color?: string; label: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/5" role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="h-full rounded-full transition-all" style={{ width: `${v}%`, backgroundColor: color }} />
    </div>
  );
}
