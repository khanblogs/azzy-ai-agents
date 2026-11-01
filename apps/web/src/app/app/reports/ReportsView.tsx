"use client";

import { useEffect, useMemo, useState } from "react";
import type { AgentId } from "@azzy/events";
import { AgentChip } from "@/components/AgentChip";
import { Button } from "@/components/Button";
import { DemoChip } from "@/components/Brand";
import { Card, CardHeader, PageHeader } from "@/components/Card";
import { EmptyState, Skeleton } from "@/components/EmptyState";
import { IconDownload, IconReport } from "@/components/Icons";
import { api, ApiError } from "@/lib/api";
import { relTime } from "@/lib/format";
import type { Report, ReportKind } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { can, useAzzy } from "@/store/useAzzy";

const KINDS: { kind: ReportKind; title: string; agent: AgentId; desc: string }[] = [
  { kind: "ops_kpi", title: "Operations KPI report", agent: "sara", desc: "Task throughput, approvals, incidents and SLAs as a deck + xlsx." },
  { kind: "security_posture", title: "Security posture", agent: "cyber", desc: "Findings by severity, release-gate history, IAM review summary (PDF)." },
  { kind: "growth", title: "Growth report", agent: "marwah", desc: "Campaign performance, channel mix and spend vs plan (pptx + PDF)." },
  { kind: "fleet", title: "Fleet report", agent: "jimmy", desc: "Environment health, versions, cost deltas and open alerts." },
];

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const KIND_ICON: Record<string, string> = { pptx: "📊", xlsx: "📈", pdf: "📄" };

export function ReportsView() {
  const me = useAzzy((s) => s.me);
  const toast = useAzzy((s) => s.toast);
  const tasks = useAzzy((s) => s.tasks);
  const [reports, setReports] = useState<Report[] | null>(null);
  const [busy, setBusy] = useState<ReportKind | null>(null);
  const [pending, setPending] = useState<Record<string, string>>({});
  const now = useNow(10_000);
  const writable = can(me, "write");

  const load = () =>
    api.reports
      .list()
      .then(setReports)
      .catch(() => setReports([]));
  useEffect(() => {
    void load();
  }, []);
  // refresh when a generating task finishes
  const doneIds = useMemo(() => tasks.filter((t) => t.state === "done").map((t) => t.id).join(","), [tasks]);
  useEffect(() => {
    if (Object.values(pending).some((id) => doneIds.includes(id))) void load();
  }, [doneIds, pending]);

  const generate = async (kind: ReportKind) => {
    setBusy(kind);
    try {
      const r = await api.reports.generate(kind);
      setPending((p) => ({ ...p, [kind]: r.task_id }));
      toast({ tone: "success", title: "Report requested", body: `Task ${r.task_id.slice(0, 8)} — the file appears here when the agent finishes.` });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Could not generate report", body: err instanceof ApiError ? err.message : "Network error" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader title="Reports" subtitle="Artifacts produced by pptx.build, xlsx.model and pdf.export. Downloads require your session." />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {KINDS.map((k) => {
          const taskId = pending[k.kind];
          const task = taskId ? tasks.find((t) => t.id === taskId) : undefined;
          return (
            <Card key={k.kind} className="flex flex-col p-4">
              <div className="flex items-center gap-2">
                <IconReport className="text-brand-gold" />
                <h2 className="text-sm font-semibold text-white">{k.title}</h2>
              </div>
              <p className="mt-1 flex-1 text-xs text-slate-400">{k.desc}</p>
              <div className="mt-3 flex items-center justify-between gap-2">
                <AgentChip id={k.agent} />
                <Button size="sm" variant="primary" loading={busy === k.kind} onClick={() => generate(k.kind)} disabled={!writable || (task ? !["done", "failed", "cancelled"].includes(task.state) : false)} title={!writable ? "Read-only role" : task && !["done", "failed", "cancelled"].includes(task.state) ? `Generating (${task.state})` : undefined} aria-label={`Generate ${k.title}`} data-testid={`report-generate-${k.kind}`}>
                  {task && !["done", "failed", "cancelled"].includes(task.state) ? "Generating…" : "Generate"}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
      <Card>
        <CardHeader title="Artifacts" subtitle={reports ? `${reports.length} file(s)` : "loading…"} action={<Button size="sm" variant="ghost" onClick={load} aria-label="Refresh reports">Refresh</Button>} />
        <div className="overflow-x-auto px-2 pb-3">
          {reports === null ? <Skeleton className="m-2 h-24" /> : reports.length === 0 ? (
            <div className="px-2 pb-2">
              <EmptyState title="No artifacts yet" hint="Generate a report above or ask Sara for a deck from the command bar." />
            </div>
          ) : (
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-2 py-1.5">File</th>
                  <th className="px-2 py-1.5">Kind</th>
                  <th className="px-2 py-1.5">Agent</th>
                  <th className="px-2 py-1.5">Task</th>
                  <th className="px-2 py-1.5 text-right">Size</th>
                  <th className="px-2 py-1.5 text-right">Created</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id} className="border-t border-line text-slate-200" data-testid="report-row">
                    <td className="px-2 py-2">
                      <span className="mr-1" aria-hidden>
                        {KIND_ICON[r.kind] ?? "📁"}
                      </span>
                      <span className="font-medium text-white">{r.filename}</span> <DemoChip show={Boolean(r.demo)} className="ml-1" />
                    </td>
                    <td className="px-2 py-2 font-mono uppercase text-slate-400">{r.kind}</td>
                    <td className="px-2 py-2">
                      <AgentChip id={r.agent} />
                    </td>
                    <td className="px-2 py-2 font-mono text-slate-500">{r.task_id ? r.task_id.slice(0, 8) : "—"}</td>
                    <td className="px-2 py-2 text-right font-mono">{fmtBytes(r.bytes)}</td>
                    <td className="px-2 py-2 text-right text-slate-400">{relTime(r.created_at, now)}</td>
                    <td className="px-2 py-2 text-right">
                      <a href={api.reports.downloadUrl(r.id)} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] text-slate-200 hover:bg-white/5" download={r.filename} aria-label={`Download ${r.filename}`}>
                        <IconDownload width={14} height={14} /> Download
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}
