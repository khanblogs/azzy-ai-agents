"use client";

import { clock, safeJson } from "@/lib/format";
import type { ToolLog } from "@/lib/types";
import { RiskBadge } from "./RiskBadge";

export function ToolLogList({ logs, max }: { logs: ToolLog[]; max?: number }) {
  const rows = max ? logs.slice(0, max) : logs;
  return (
    <ul className="space-y-2" aria-live="polite">
      {rows.map((l) => (
        <li key={l.id} className="rounded-xl border border-line bg-black/30 p-3 font-mono text-[11px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className={l.ok ? "text-emerald-400" : "text-rose-400"} aria-label={l.ok ? "ok" : "failed"}>
              {l.ok ? "✓ ok" : "✗ failed"}
            </span>
            <span className="font-semibold text-cyan-200">{l.tool}</span>
            <RiskBadge risk={l.risk} />
            <span className="text-slate-500">{l.duration_ms} ms</span>
            <span className="ml-auto text-slate-500">{clock(l.ts)}</span>
          </div>
          <details className="mt-1">
            <summary className="cursor-pointer text-slate-400">args {Object.keys(l.args).length ? `(${Object.keys(l.args).length})` : "(none)"}</summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-2 text-slate-300">{safeJson(l.args)}</pre>
          </details>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-slate-200">{l.output}</pre>
        </li>
      ))}
    </ul>
  );
}
