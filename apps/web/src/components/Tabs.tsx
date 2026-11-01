"use client";

import clsx from "clsx";

export function Tabs<T extends string>({ tabs, value, onChange, className, testIdPrefix = "tab-" }: { tabs: { key: T; label: string; count?: number }[]; value: T; onChange: (k: T) => void; className?: string; testIdPrefix?: string }) {
  return (
    <div role="tablist" className={clsx("flex gap-1 overflow-x-auto rounded-xl border border-line bg-black/20 p-1", className)}>
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={active}
            data-testid={`${testIdPrefix}${t.key}`}
            onClick={() => onChange(t.key)}
            className={clsx("flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition", active ? "bg-white/10 text-white" : "text-slate-400 hover:text-white")}
          >
            {t.label}
            {t.count !== undefined ? <span className="rounded-full bg-white/10 px-1.5 text-[10px]" aria-hidden>{t.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
