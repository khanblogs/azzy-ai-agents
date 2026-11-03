"use client";

import clsx from "clsx";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { DemoChip } from "@/components/Brand";
import { Card, CardHeader, PageHeader, Stat } from "@/components/Card";
import { EmptyState, Skeleton } from "@/components/EmptyState";
import { Pill } from "@/components/KV";
import { ToolLogList } from "@/components/ToolLogList";
import { api, ApiError } from "@/lib/api";
import { clock, relTime } from "@/lib/format";
import type { Settings, ToolLog } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { can, useAzzy } from "@/store/useAzzy";

const SCAN_TOOLS = ["semgrep.scan", "gitleaks.scan", "trivy.scan", "checkov.scan", "nuclei.scan", "zap.scan", "iam.review", "playwright.run"];
const SEV_ORDER = ["critical", "high", "medium", "low", "info"] as const;
type Sev = (typeof SEV_ORDER)[number];
const SEV_COLOR: Record<Sev, string> = { critical: "#ef4444", high: "#F04DFF", medium: "#FFB547", low: "#00E5FF", info: "#94a3b8" };

interface Finding {
  id: string;
  tool: string;
  severity: Sev;
  text: string;
  ts: string;
  ok: boolean;
}

/** Extracts findings + severity totals from scanner output.
 * Structured severity counts (JSON `"critical": 3`) are totals, never findings by
 * themselves — a `"critical": 0` line must not count as a critical finding.
 * Free-text lines like "[HIGH] CVE-2024-1234 in openssl …" count one each. */
function extractFindings(logs: ToolLog[]): { findings: Finding[]; counts: Record<Sev, number> } {
  const findings: Finding[] = [];
  const counts: Record<Sev, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const l of logs) {
    if (!SCAN_TOOLS.includes(l.tool)) continue;
    const summarised = new Set<Sev>();
    for (const m of l.output.matchAll(/"(critical|high|medium|low|info)"\s*:\s*(\d+)/gi)) {
      const sev = m[1].toLowerCase() as Sev;
      const n = parseInt(m[2], 10);
      if (n <= 0) continue;
      counts[sev] += n;
      if (!summarised.has(sev)) {
        summarised.add(sev);
        findings.push({ id: `${l.id}-sum-${sev}`, tool: l.tool, severity: sev, text: `Scan summary: ${n} ${sev} issue(s) reported`, ts: l.ts, ok: l.ok });
      }
    }
    let i = 0;
    for (const line of l.output.split(/\r?\n/)) {
      if (/"(critical|high|medium|low|info)"\s*:/i.test(line)) continue;
      if (/^\s*(critical|high|medium|low|info)\s*:\s*\d+\s*,?\s*$/i.test(line)) continue;
      if (/\b0\s+(critical|high|medium|low)\b/i.test(line) || /no\s+(critical|high|medium|low)/i.test(line)) continue;
      const m = /\b(critical|high|medium|low|info)\b/i.exec(line);
      if (!m) continue;
      const sev = m[1].toLowerCase() as Sev;
      counts[sev] += 1;
      findings.push({ id: `${l.id}-${i++}`, tool: l.tool, severity: sev, text: line.trim().slice(0, 200), ts: l.ts, ok: l.ok });
      if (i >= 6) break;
    }
  }
  findings.sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity) || Date.parse(b.ts) - Date.parse(a.ts));
  return { findings: findings.slice(0, 40), counts };
}

export function SecurityView() {
  const liveLogs = useAzzy((s) => s.toolLogs.cyber);
  const tasks = useAzzy((s) => s.tasks);
  const me = useAzzy((s) => s.me);
  const toast = useAzzy((s) => s.toast);
  const [history, setHistory] = useState<ToolLog[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow(10_000);

  useEffect(() => {
    let alive = true;
    api.agents
      .get("cyber")
      .then((d) => alive && setHistory(d.log))
      .catch(() => alive && setHistory([]));
    api.settings
      .get()
      .then((s) => alive && setSettings(s))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const logs = useMemo(() => {
    const map = new Map<string, ToolLog>();
    for (const l of history ?? []) map.set(l.id, l);
    for (const l of liveLogs) map.set(l.id, l);
    return Array.from(map.values()).sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  }, [history, liveLogs]);

  const scans = useMemo(() => logs.filter((l) => SCAN_TOOLS.includes(l.tool)), [logs]);
  const { findings, counts } = useMemo(() => extractFindings(scans), [scans]);
  const lastScanByTool = useMemo(() => {
    const m = new Map<string, ToolLog>();
    for (const l of scans) if (!m.has(l.tool)) m.set(l.tool, l);
    return SCAN_TOOLS.map((t) => [t, m.get(t)] as const);
  }, [scans]);

  const gate = useMemo(() => {
    if (scans.length === 0) return { status: "unknown" as const, reason: "No scans have run yet." };
    const gateLog = logs.find((l) => /release[\s_-]?gate/i.test(l.output) || /release[\s_-]?gate/i.test(JSON.stringify(l.args)));
    if (gateLog && /blocked|fail/i.test(gateLog.output)) return { status: "blocked" as const, reason: gateLog.output.split("\n")[0].slice(0, 160) };
    if (counts.critical > 0) return { status: "blocked" as const, reason: `${counts.critical} critical finding(s) in the last scans.` };
    return { status: "pass" as const, reason: "No critical findings in the latest scans." };
  }, [scans.length, logs, counts.critical]);

  const securityTasks = useMemo(() => tasks.filter((t) => t.lead === "cyber" || t.assignees.includes("cyber")).slice(0, 6), [tasks]);

  const runAudit = async () => {
    setBusy(true);
    try {
      const r = await api.routines.run("sunday_security_audit");
      toast({ tone: "success", title: "Security audit started", body: `Cyber is running it as task ${r.task_id.slice(0, 8)}` });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Could not start audit", body: err instanceof ApiError ? err.message : "Network error" });
    } finally {
      setBusy(false);
    }
  };

  const gateColor = gate.status === "pass" ? "#34D399" : gate.status === "blocked" ? "#ef4444" : "#94a3b8";
  const writable = can(me, "write");
  const demo = useAzzy((s) => s.demo);

  return (
    <div>
      <PageHeader
        title="Security"
        subtitle="Cyber's findings from the last scans, the release-gate verdict and the authorised targets."
        action={
          <Button variant="purple" loading={busy} onClick={runAudit} disabled={!writable} title={!writable ? "Read-only role" : "Runs the weekly security audit routine now"} aria-label="Run security audit" data-testid="run-audit">
            Run audit
          </Button>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Card className="px-4 py-3 sm:col-span-2">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-400">
            Release gate <DemoChip show={demo} />
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className={clsx("h-3 w-3 rounded-full", gate.status === "blocked" && "animate-pulseDot")} style={{ backgroundColor: gateColor, boxShadow: `0 0 10px ${gateColor}` }} />
            <span className="text-xl font-semibold uppercase" style={{ color: gateColor }} data-testid="release-gate">
              {gate.status}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500" title={gate.reason}>
            {gate.reason}
          </p>
        </Card>
        {SEV_ORDER.slice(0, 4).map((s) => (
          <Stat key={s} label={s} value={counts[s]} accent={counts[s] > 0 ? SEV_COLOR[s] : undefined} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Findings" subtitle={`${findings.length} extracted from the last ${scans.length} scan(s)`} />
          <div className="px-4 pb-4">
            {history === null ? <Skeleton className="h-24" /> : null}
            {history !== null && findings.length === 0 ? <EmptyState title="No findings reported" hint="Run an audit, or ask Cyber in chat to run a secrets sweep. Scanners only run when their binaries are in the image." /> : null}
            <ul className="space-y-1.5">
              {findings.map((f) => (
                <li key={f.id} className="flex items-start gap-2 rounded-lg border border-line bg-black/20 px-3 py-2 text-xs" data-testid="finding">
                  <Pill color={SEV_COLOR[f.severity]}>{f.severity}</Pill>
                  <span className="font-mono text-[11px] text-brand-purple">{f.tool}</span>
                  <span className="min-w-0 flex-1 break-words text-slate-200">{f.text}</span>
                  <span className="shrink-0 text-[10px] text-slate-500">{relTime(f.ts, now)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Last scans" subtitle="per scanner" />
            <ul className="space-y-1.5 px-4 pb-4 text-xs">
              {lastScanByTool.map(([tool, l]) => (
                <li key={tool} className="flex items-center gap-2">
                  <span className={clsx("h-1.5 w-1.5 rounded-full", !l ? "bg-slate-600" : l.ok ? "bg-emerald-400" : "bg-rose-400")} />
                  <span className="font-mono text-slate-200">{tool}</span>
                  <span className="ml-auto text-slate-500">{l ? `${clock(l.ts)} · ${l.duration_ms} ms` : "never"}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Authorised targets" subtitle="nuclei / ZAP only scan these" />
            <div className="px-4 pb-4 text-xs">
              {!settings ? <Skeleton className="h-10" /> : settings.authorized_targets.length === 0 ? <p className="text-slate-500">None configured. Admins set them under Settings.</p> : (
                <ul className="space-y-1">
                  {settings.authorized_targets.map((t) => (
                    <li key={t} className="rounded bg-white/5 px-2 py-1 font-mono text-slate-200">
                      {t}
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/app/settings" className="mt-2 inline-block text-brand-cyan hover:underline">
                Manage in Settings →
              </Link>
            </div>
          </Card>
          <Card>
            <CardHeader title="Security tasks" />
            <ul className="divide-y divide-line px-4 pb-3 text-xs">
              {securityTasks.length === 0 ? <li className="py-2 text-slate-500">No security tasks yet.</li> : null}
              {securityTasks.map((t) => (
                <li key={t.id}>
                  <Link href={`/app/tasks/${t.id}`} className="flex items-center gap-2 py-2 hover:text-white">
                    <span className="min-w-0 flex-1 truncate text-slate-200">{t.title}</span>
                    <span className="text-slate-500">{t.state.replace(/_/g, " ")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader title="Scanner log" subtitle="raw tool calls by Cyber (live)" />
        <div className="px-4 pb-4">{scans.length === 0 ? <p className="text-xs text-slate-500">No scanner calls yet.</p> : <ToolLogList logs={scans} max={20} />}</div>
      </Card>
    </div>
  );
}
