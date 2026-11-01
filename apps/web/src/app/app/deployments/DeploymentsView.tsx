"use client";

import clsx from "clsx";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Deployment, DeploymentStatus } from "@azzy/events";
import { AgentChip } from "@/components/AgentChip";
import { Button } from "@/components/Button";
import { Card, CardHeader, PageHeader, Stat } from "@/components/Card";
import { EmptyState, Skeleton } from "@/components/EmptyState";
import { Pill } from "@/components/KV";
import { RiskBadge } from "@/components/RiskBadge";
import { api, ApiError } from "@/lib/api";
import { clock, relTime } from "@/lib/format";
import { DEPLOYMENT_COLORS } from "@/lib/status";
import { useNow } from "@/lib/useNow";
import { can, useAzzy } from "@/store/useAzzy";

const STAGES: DeploymentStatus[] = ["planned", "awaiting_approval", "running", "verifying", "succeeded"];

function StatusTrack({ status }: { status: DeploymentStatus }) {
  const idx = STAGES.indexOf(status);
  const failed = status === "failed" || status === "rolled_back";
  return (
    <ol className="flex items-center gap-1" aria-label={`Deployment status ${status}`}>
      {STAGES.map((s, i) => {
        const done = idx >= i && !failed;
        const cur = idx === i && !failed;
        return (
          <li key={s} className="flex items-center gap-1">
            <span className={clsx("h-2 w-2 rounded-full", done ? "" : "bg-white/10", cur && "animate-pulseDot")} style={done ? { backgroundColor: DEPLOYMENT_COLORS[s] } : undefined} title={s} />
            {i < STAGES.length - 1 ? <span className={clsx("h-px w-4", done && idx > i ? "bg-white/40" : "bg-white/10")} /> : null}
          </li>
        );
      })}
      {failed ? (
        <li className="ml-1">
          <Pill color={DEPLOYMENT_COLORS[status]}>{status.replace(/_/g, " ")}</Pill>
        </li>
      ) : null}
    </ol>
  );
}

function DeploymentRow({ d, now, expanded, onToggle }: { d: Deployment; now: number; expanded: boolean; onToggle: () => void }) {
  const color = DEPLOYMENT_COLORS[d.status];
  const active = ["running", "verifying", "awaiting_approval"].includes(d.status);
  return (
    <li data-testid="deployment-row" data-deployment-id={d.id} className={clsx("rounded-xl border bg-black/20 p-3", active ? "border-brand-cyan/40" : "border-line")}>
      <button type="button" onClick={onToggle} className="w-full text-left" aria-expanded={expanded} aria-label={`Toggle details for deployment ${d.version} to ${d.env_id}`}>
        <div className="flex flex-wrap items-center gap-2">
          <Pill color={color}>{d.status.replace(/_/g, " ")}</Pill>
          <span className="font-mono text-sm font-semibold text-white">{d.version}</span>
          {d.previous_version ? <span className="font-mono text-[11px] text-slate-500">from {d.previous_version}</span> : null}
          <span className="rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-slate-300">{d.env_id}</span>
          <RiskBadge risk={d.risk} />
          <AgentChip id={d.agent} link={false} />
          <span className="ml-auto text-[11px] text-slate-500">{relTime(d.created_at, now)}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <StatusTrack status={d.status} />
          <span className="truncate text-xs text-slate-400">{d.change_summary}</span>
        </div>
      </button>
      {expanded ? (
        <div className="mt-3 grid gap-3 border-t border-line pt-3 text-xs md:grid-cols-2">
          <div>
            <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Pre-checks</h4>
            {d.checks.length === 0 ? <p className="text-slate-500">No checks recorded yet.</p> : null}
            <ul className="space-y-1">
              {d.checks.map((c) => (
                <li key={c.name} className="flex items-start gap-2">
                  <span className={c.ok ? "text-emerald-400" : "text-rose-400"}>{c.ok ? "✓" : "✗"}</span>
                  <span className="text-slate-200">{c.name}</span>
                  <span className="text-slate-500">{c.detail}</span>
                </li>
              ))}
            </ul>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-slate-500">Started</dt>
            <dd className="text-slate-200">{d.started_at ? clock(d.started_at) : "—"}</dd>
            <dt className="text-slate-500">Finished</dt>
            <dd className="text-slate-200">{d.finished_at ? clock(d.finished_at) : "—"}</dd>
            <dt className="text-slate-500">Account</dt>
            <dd className="font-mono text-slate-200">{d.account_id ?? "—"}</dd>
            <dt className="text-slate-500">Task</dt>
            <dd>
              {d.task_id ? (
                <Link href={`/app/tasks/${d.task_id}`} className="font-mono text-brand-cyan hover:underline">
                  {d.task_id.slice(0, 8)} →
                </Link>
              ) : (
                "—"
              )}
            </dd>
            <dt className="text-slate-500">Approval</dt>
            <dd>
              {d.approval_id ? (
                <Link href="/app/approvals" className="font-mono text-brand-cyan hover:underline">
                  {d.approval_id.slice(0, 8)} →
                </Link>
              ) : (
                "none"
              )}
            </dd>
          </dl>
        </div>
      ) : null}
    </li>
  );
}

function PlanForm() {
  const envs = useAzzy((s) => s.environments);
  const me = useAzzy((s) => s.me);
  const toast = useAzzy((s) => s.toast);
  const upsertDeployment = useAzzy((s) => s.upsertDeployment);
  const [envId, setEnvId] = useState("");
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const writable = can(me, "write");
  useEffect(() => {
    if (!envId && envs.length > 0) setEnvId(envs[0].id);
  }, [envs, envId]);
  const versionOk = /^v?\d+\.\d+(\.\d+)?([-+.][\w.]+)?$/.test(version.trim());
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!versionOk) return;
    setBusy(true);
    try {
      const { deployment: d } = await api.deployments.plan(envId, version.trim());
      upsertDeployment(d);
      toast({ tone: "success", title: `Deployment planned: ${d.version} → ${d.env_id}`, body: "Jimmy picked up the task. Prod deploys wait for approval." });
      setVersion("");
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Could not plan deployment", body: err instanceof ApiError ? err.message : "Network error" });
    } finally {
      setBusy(false);
    }
  };
  const field = "h-10 w-full rounded-xl border border-line bg-navy px-3 text-sm text-white placeholder:text-slate-600 focus:border-brand-cyan/60 focus:outline-none focus:ring-2 focus:ring-brand-cyan/20";
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-white">Plan a deployment</h2>
      <p className="mb-3 text-xs text-slate-400">Creates a planned deployment and a command task for Jimmy. Pre-checks: env healthy, version format, no open incident, approval for prod.</p>
      <form onSubmit={submit} className="space-y-3" data-testid="deploy-plan-form">
        <div>
          <label htmlFor="dep-env" className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Environment
          </label>
          <select id="dep-env" className={field} value={envId} onChange={(e) => setEnvId(e.target.value)}>
            {envs.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {e.kind} · {e.version ?? "?"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="dep-version" className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Version
          </label>
          <input id="dep-version" className={clsx(field, version && !versionOk && "border-rose-500/60")} value={version} onChange={(e) => setVersion(e.target.value)} placeholder="v2.4.0" />
        </div>
        <Button type="submit" variant="primary" loading={busy} disabled={!writable || !envId || !versionOk} title={!writable ? "Read-only role" : !versionOk ? "Use semantic version like v2.4.0" : undefined} aria-label="Plan deployment" data-testid="deploy-plan-submit">
          Plan deployment
        </Button>
      </form>
    </Card>
  );
}

export function DeploymentsView() {
  const deployments = useAzzy((s) => s.deployments);
  const envs = useAzzy((s) => s.environments);
  const [loaded, setLoaded] = useState(false);
  const [envFilter, setEnvFilter] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const now = useNow(5000);

  useEffect(() => {
    let alive = true;
    api.deployments
      .list({ limit: 100 })
      .then((list) => alive && useAzzy.setState({ deployments: list }))
      .catch(() => undefined)
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  const list = useMemo(() => (envFilter ? deployments.filter((d) => d.env_id === envFilter) : deployments).slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)), [deployments, envFilter]);
  const stats = useMemo(() => {
    const active = deployments.filter((d) => ["running", "verifying", "awaiting_approval", "planned"].includes(d.status)).length;
    const ok = deployments.filter((d) => d.status === "succeeded").length;
    const bad = deployments.filter((d) => d.status === "failed" || d.status === "rolled_back").length;
    const total = ok + bad;
    return { active, ok, bad, rate: total ? Math.round((ok / total) * 100) : null };
  }, [deployments]);

  return (
    <div>
      <PageHeader title="Deployments" subtitle="Every aws.deploy / aws.rollback / ssh deploy is a tracked deployment with pre-checks, an execution lock per environment and post-verification." />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Stat label="In flight" value={stats.active} accent="#00E5FF" />
        <Stat label="Succeeded" value={stats.ok} accent="#34D399" />
        <Stat label="Failed / rolled back" value={stats.bad} accent={stats.bad ? "#F04DFF" : undefined} />
        <Stat label="Success rate" value={stats.rate === null ? "—" : `${stats.rate}%`} hint="finished deployments" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="History"
            subtitle={`${list.length} shown · live on deployment.changed`}
            action={
              <select aria-label="Filter by environment" className="h-8 rounded-lg border border-line bg-navy px-2 text-xs text-slate-200" value={envFilter} onChange={(e) => setEnvFilter(e.target.value)}>
                <option value="">All environments</option>
                {envs.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            }
          />
          <div className="px-3 pb-3">
            {!loaded && list.length === 0 ? <Skeleton className="h-32" /> : null}
            {loaded && list.length === 0 ? <EmptyState title="No deployments yet" hint='Plan one here or tell Jimmy "deploy v2.4 to client b" from the command bar.' /> : null}
            <ul className="space-y-2">
              {list.map((d) => (
                <DeploymentRow key={d.id} d={d} now={now} expanded={open === d.id} onToggle={() => setOpen(open === d.id ? null : d.id)} />
              ))}
            </ul>
          </div>
        </Card>
        <PlanForm />
      </div>
    </div>
  );
}
