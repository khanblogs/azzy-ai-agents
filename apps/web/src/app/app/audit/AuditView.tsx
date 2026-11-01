"use client";

import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import type { AuditEntry } from "@azzy/events";
import { Button } from "@/components/Button";
import { Card, PageHeader } from "@/components/Card";
import { EmptyState, Skeleton } from "@/components/EmptyState";
import { api, ApiError } from "@/lib/api";
import { clock, relTime, safeJson } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import { useAzzy } from "@/store/useAzzy";

const ACTION_COLORS: [RegExp, string][] = [
  [/approval\.approved|succeeded|login$/, "#34D399"],
  [/reject|fail|denied|error|delete/, "#F04DFF"],
  [/approval\.requested|cancel|expired/, "#FFB547"],
  [/tool\.call/, "#00E5FF"],
  [/account|env|user|integration|setting|mfa/, "#9747FF"],
];

function actionColor(a: string) {
  for (const [re, c] of ACTION_COLORS) if (re.test(a)) return c;
  return "#94a3b8";
}

export function AuditView() {
  const live = useAzzy((s) => s.audit);
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const now = useNow(10_000);

  const load = async (before?: string) => {
    try {
      const list = await api.audit.list({ limit: 50, before, action: action || undefined, actor: actor || undefined });
      setRows((r) => (before ? [...(r ?? []), ...list] : list));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load audit log");
      if (!before) setRows([]);
    }
  };
  useEffect(() => {
    setRows(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, actor]);

  const merged = useMemo(() => {
    const map = new Map<string, AuditEntry>();
    for (const e of live) {
      if (action && e.action !== action) continue;
      if (actor && e.actor !== actor) continue;
      map.set(e.id, e);
    }
    for (const e of rows ?? []) map.set(e.id, e);
    return Array.from(map.values()).sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  }, [live, rows, action, actor]);

  const actions = useMemo(() => Array.from(new Set(merged.map((e) => e.action))).sort(), [merged]);
  const actors = useMemo(() => Array.from(new Set(merged.map((e) => e.actor))).sort(), [merged]);
  const field = "h-9 rounded-xl border border-line bg-navy px-2 text-xs text-slate-200 focus:border-brand-cyan/60 focus:outline-none";

  return (
    <div>
      <PageHeader
        title="Audit"
        subtitle="Append-only trail: logins, approvals, tool calls, task and configuration changes. New entries stream in live."
        action={
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="audit-action">
              Action
            </label>
            <select id="audit-action" className={field} value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">All actions</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="audit-actor">
              Actor
            </label>
            <select id="audit-actor" className={field} value={actor} onChange={(e) => setActor(e.target.value)}>
              <option value="">All actors</option>
              {actors.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        }
      />
      <Card>
        <div className="overflow-x-auto px-2 py-2">
          {rows === null ? <Skeleton className="m-2 h-40" /> : null}
          {error ? <p className="px-2 py-2 text-xs text-rose-300">{error}</p> : null}
          {rows !== null && merged.length === 0 ? (
            <div className="p-2">
              <EmptyState title="No audit entries" hint="Your own login is the first entry — if it is missing, the API has not started writing audit rows yet." />
            </div>
          ) : null}
          {merged.length > 0 ? (
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-2 py-1.5">Time</th>
                  <th className="px-2 py-1.5">Actor</th>
                  <th className="px-2 py-1.5">Action</th>
                  <th className="px-2 py-1.5">Target</th>
                  <th className="px-2 py-1.5">Task</th>
                  <th className="px-2 py-1.5">IP</th>
                  <th className="px-2 py-1.5">Detail</th>
                </tr>
              </thead>
              <tbody>
                {merged.map((e) => {
                  const c = actionColor(e.action);
                  const isOpen = open === e.id;
                  const detailKeys = Object.keys(e.detail);
                  return (
                    <tr key={e.id} data-testid="audit-row" data-action={e.action} data-actor={e.actor} className="border-t border-line align-top text-slate-200">
                      <td className="whitespace-nowrap px-2 py-1.5 font-mono text-slate-400" title={e.ts}>
                        {clock(e.ts)} <span className="text-slate-600">· {relTime(e.ts, now)}</span>
                      </td>
                      <td className="max-w-[180px] truncate px-2 py-1.5" title={e.actor}>
                        {e.actor}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="rounded-md px-1.5 py-0.5 font-mono text-[11px]" style={{ color: c, backgroundColor: `${c}1a` }}>
                          {e.action}
                        </span>
                      </td>
                      <td className="max-w-[200px] truncate px-2 py-1.5 font-mono text-slate-400" title={e.target ?? undefined}>
                        {e.target ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-slate-500">{e.task_id ? e.task_id.slice(0, 8) : "—"}</td>
                      <td className="px-2 py-1.5 font-mono text-slate-500">{e.ip ?? "—"}</td>
                      <td className="px-2 py-1.5">
                        {detailKeys.length === 0 ? (
                          <span className="text-slate-600">—</span>
                        ) : (
                          <button type="button" className={clsx("text-left font-mono text-[11px]", isOpen ? "text-white" : "text-slate-400 hover:text-white")} onClick={() => setOpen(isOpen ? null : e.id)} aria-expanded={isOpen}>
                            {isOpen ? <pre className="whitespace-pre-wrap">{safeJson(e.detail)}</pre> : <span className="line-clamp-1">{detailKeys.map((k) => `${k}=${String(e.detail[k])}`).join(" ")}</span>}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </div>
        {rows && rows.length >= 50 ? (
          <div className="flex justify-center border-t border-line p-3">
            <Button
              variant="outline"
              size="sm"
              loading={loadingMore}
              onClick={async () => {
                setLoadingMore(true);
                await load(rows[rows.length - 1]?.ts);
                setLoadingMore(false);
              }}
              aria-label="Load older entries"
            >
              Load older
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
