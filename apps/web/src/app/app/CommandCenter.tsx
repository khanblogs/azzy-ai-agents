"use client";

import clsx from "clsx";
import Link from "next/link";
import { useEffect, useMemo } from "react";
import { AGENT_IDS, AGENT_META } from "@azzy/events";
import { AgentAvatar, AgentChip } from "@/components/AgentChip";
import { ApprovalCard } from "@/components/ApprovalCard";
import { Card, CardHeader } from "@/components/Card";
import { EmptyState, Skeleton } from "@/components/EmptyState";
import { Pill, Progress } from "@/components/KV";
import { Sparkline } from "@/components/Sparkline";
import { StatusDot } from "@/components/StatusDot";
import { AgentMessageList } from "@/components/TaskDetail";
import { Ticker } from "@/components/Ticker";
import { api } from "@/lib/api";
import { clock, relTime, uptime as fmtUptime, usd } from "@/lib/format";
import { deriveStatus, HEALTH_COLORS, OFFICE_STATUS_COLORS, PHASE_LABELS, PIPELINE_ACCENTS, PIPELINE_LABELS, STATUS_COLORS, STATUS_LABELS } from "@/lib/status";
import { useMounted } from "@/lib/useMounted";
import { useNow } from "@/lib/useNow";
import { pendingApprovalFor, useActiveTasks, useAzzy, useLiveUptime, usePendingApprovals } from "@/store/useAzzy";

function Kpi({ label, value, hint, color, spark, href, format }: { label: string; value: number; hint?: string; color: string; spark?: number[]; href?: string; format?: (n: number) => string }) {
  const inner = (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-midnight/80 px-4 py-3 shadow-glass transition hover:-translate-y-px hover:border-white/20">
      <span className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-0 blur-2xl transition group-hover:opacity-30" style={{ backgroundColor: color }} aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight text-white">
            <Ticker value={value} format={format} />
          </div>
          {hint ? <div className="mt-0.5 text-xs text-slate-500">{hint}</div> : null}
        </div>
        {spark && spark.length > 0 ? <Sparkline values={spark} color={color} width={96} height={30} label={`${label} trend`} /> : null}
      </div>
    </div>
  );
  return href ? (
    <Link href={href} aria-label={`${label}: open`}>
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function CommandCenter() {
  const hydrated = useAzzy((s) => s.hydrated);
  const office = useAzzy((s) => s.office);
  const agents = useAzzy((s) => s.agents);
  const bubbles = useAzzy((s) => s.bubbles);
  const approvals = useAzzy((s) => s.approvals);
  const pending = usePendingApprovals();
  const active = useActiveTasks();
  const tasks = useAzzy((s) => s.tasks);
  const incidents = useAzzy((s) => s.incidents);
  const envs = useAzzy((s) => s.environments);
  const costs = useAzzy((s) => s.costs);
  const messages = useAzzy((s) => s.agentMessages);
  const updates = useAzzy((s) => s.updates);
  const deployments = useAzzy((s) => s.deployments);
  const setCostsExtra = useAzzy((s) => s.setCostsExtra);
  const me = useAzzy((s) => s.me);
  const demo = useAzzy((s) => s.demo);
  const now = useNow(5000);
  const liveUptime = useLiveUptime(now);
  const mounted = useMounted();

  useEffect(() => {
    api
      .costs()
      .then((c) => setCostsExtra(c.series, c.recent))
      .catch(() => undefined);
  }, [setCostsExtra]);

  const openIncidents = incidents.filter((i) => i.status !== "resolved");
  const doneToday = useMemo(() => {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    return tasks.filter((t) => t.state === "done" && Date.parse(t.updated_at) >= dayStart.getTime()).length;
  }, [tasks]);
  const spark = costs.series.slice(-24).map((p) => p.usd);
  const taskSpark = useMemo(() => {
    const buckets = new Array(12).fill(0) as number[];
    for (const t of tasks) {
      const age = (now - Date.parse(t.created_at)) / 3_600_000;
      if (age >= 0 && age < 12) buckets[11 - Math.floor(age)] += 1;
    }
    return buckets;
  }, [tasks, now]);
  const healthy = envs.filter((e) => e.health === "healthy").length;
  const statusColor = OFFICE_STATUS_COLORS[office.status];
  const budgetPct = costs.budget_usd > 0 ? (costs.today_usd / costs.budget_usd) * 100 : 0;
  const hour = new Date(now).getHours();
  const greeting = !mounted ? "Welcome back" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const recentDeploy = deployments[0];

  return (
    <div className={clsx("transition-all duration-300", mounted ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0")}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">Command Center</p>
          <h1 className="text-2xl font-semibold tracking-tight text-white md:text-[32px] md:leading-tight">
            {greeting}
            {me ? `, ${me.email.split("@")[0]}` : ""}.
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {active.length} task{active.length === 1 ? "" : "s"} in flight · {pending.length} awaiting your decision · {openIncidents.length} open incident{openIncidents.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/app/office" className="glass inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold" style={{ color: statusColor }} data-testid="office-status">
            <span className="h-2 w-2 rounded-full animate-pulseDot" style={{ backgroundColor: statusColor }} />
            Office <span className="capitalize">{office.status}</span>
            {office.note ? <span className="hidden font-normal text-slate-300 sm:inline">· {office.note}</span> : null}
          </Link>
          {demo ? <Pill color="#FFB547">DEMO mode</Pill> : null}
          <span className="text-xs text-slate-500">up {fmtUptime(liveUptime)}</span>
        </div>
      </div>

      {!hydrated ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
          <Kpi label="Active tasks" value={active.length} hint={`${doneToday} done today`} color="#00E5FF" spark={taskSpark} href="/app/tasks" />
          <Kpi label="Pending approvals" value={pending.length} hint={pending[0] ? `oldest ${relTime(pending[0].created_at, now)}` : "nothing waiting"} color={pending.length ? "#F04DFF" : "#9747FF"} href="/app/approvals" />
          <Kpi label="Spend today" value={costs.today_usd} format={(n) => usd(n)} hint={`${Math.round(budgetPct)}% of ${usd(costs.budget_usd, 0)} budget`} color="#FFB547" spark={spark} href="/app/monitoring" />
          <Kpi label="Environments healthy" value={healthy} format={(n) => `${Math.round(n)} / ${envs.length}`} hint={openIncidents.length ? `${openIncidents.length} incident open` : "no open incidents"} color={openIncidents.length ? "#F04DFF" : "#34D399"} href="/app/infrastructure" />
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-3 [&>*]:min-w-0">
        <Card className="xl:col-span-2">
          <CardHeader title="Agents" subtitle="live phase, spot and spend" action={<Link href="/app/office" className="text-xs text-brand-cyan hover:underline">Open 3D office →</Link>} />
          <ul className="grid gap-2 px-3 pb-3 sm:grid-cols-2 lg:grid-cols-5">
            {AGENT_IDS.map((id) => {
              const a = agents[id];
              const p = pendingApprovalFor(approvals, id);
              const st = deriveStatus({ phase: a.phase, arrived: true, hasBubble: Boolean(bubbles[id]), hasPendingApproval: Boolean(p) });
              const pct = a.daily_budget_usd > 0 ? (a.today_usd / a.daily_budget_usd) * 100 : 0;
              return (
                <li key={id}>
                  <Link href={`/app/agents/${id}`} className="block rounded-xl border border-line bg-black/20 p-3 transition hover:-translate-y-px hover:border-white/20" aria-label={`Open ${a.name}`}>
                    <div className="flex items-center gap-2">
                      <AgentAvatar id={id} size={28} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white">{a.name}</div>
                        <div className="truncate text-[10px] uppercase tracking-wider" style={{ color: AGENT_META[id].color }}>
                          {AGENT_META[id].short}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-300">
                      <StatusDot color={STATUS_COLORS[st]} label={STATUS_LABELS[st]} pulse={st === "approval"} />
                      <span className="truncate">{st === "working" ? PHASE_LABELS[a.phase] : STATUS_LABELS[st]}</span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-slate-500">{bubbles[id]?.text ?? a.detail ?? "—"}</p>
                    <div className="mt-2">
                      <Progress value={pct} color={AGENT_META[id].color} label={`${a.name} budget`} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Needs you" subtitle={`${pending.length} approval${pending.length === 1 ? "" : "s"}`} action={<Link href="/app/approvals" className="text-xs text-brand-cyan hover:underline">All →</Link>} />
          <div className="space-y-3 px-3 pb-3">
            {hydrated && pending.length === 0 ? <EmptyState title="No approvals pending" hint="Risky actions pause here until a permitted role decides." /> : null}
            {pending.slice(0, 2).map((a) => (
              <ApprovalCard key={a.id} approval={a} now={now} compact />
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3 [&>*]:min-w-0">
        <Card>
          <CardHeader title="Active tasks" subtitle="pipeline in motion" action={<Link href="/app/tasks" className="text-xs text-brand-cyan hover:underline">Board →</Link>} />
          <ul className="divide-y divide-line px-4 pb-3 text-xs">
            {hydrated && active.length === 0 ? <li className="py-3 text-slate-500">Nothing running. Try the ECS workflow prompt in the command bar.</li> : null}
            {active.slice(0, 7).map((t) => (
              <li key={t.id}>
                <Link href={`/app/tasks/${t.id}`} className="flex items-center gap-2 py-2 hover:text-white">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: PIPELINE_ACCENTS[t.state] }} />
                  <span className="min-w-0 flex-1 truncate text-slate-200">{t.title}</span>
                  {t.lead ? <AgentAvatar id={t.lead} size={16} /> : null}
                  <span className="shrink-0 text-slate-500">{PIPELINE_LABELS[t.state]}</span>
                </Link>
                {t.steps_total > 0 ? <Progress value={(t.steps_done / t.steps_total) * 100} color={PIPELINE_ACCENTS[t.state]} label="progress" /> : null}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Agent messages" subtitle="latest handoffs" action={<Link href="/app/collaboration" className="text-xs text-brand-cyan hover:underline">Graph →</Link>} />
          <div className="px-3 pb-3">
            <AgentMessageList messages={messages.slice(0, 4)} emptyHint="Appears when a task involves more than one agent." />
          </div>
        </Card>
        <Card>
          <CardHeader title="Pulse" subtitle="environments · deployments · feed" action={<Link href="/app/monitoring" className="text-xs text-brand-cyan hover:underline">Monitoring →</Link>} />
          <div className="space-y-3 px-4 pb-4 text-xs">
            <ul className="flex flex-wrap gap-1.5">
              {envs.map((e) => {
                const c = HEALTH_COLORS[e.health] ?? HEALTH_COLORS.unknown;
                return (
                  <li key={e.id} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11px] text-slate-200">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c }} />
                    {e.name} <span className="font-mono text-slate-500">{e.version ?? ""}</span>
                  </li>
                );
              })}
            </ul>
            {recentDeploy ? (
              <Link href="/app/deployments" className="block rounded-xl border border-line bg-black/20 p-2 hover:border-white/20">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-white">{recentDeploy.version}</span>
                  <span className="text-slate-400">→ {recentDeploy.env_id}</span>
                  <Pill color={recentDeploy.status === "succeeded" ? "#34D399" : recentDeploy.status === "failed" ? "#ef4444" : "#00E5FF"}>{recentDeploy.status.replace(/_/g, " ")}</Pill>
                  <span className="ml-auto text-slate-500">{relTime(recentDeploy.created_at, now)}</span>
                </div>
              </Link>
            ) : null}
            <ul className="space-y-1" aria-live="polite">
              {updates.slice(0, 6).map((u, i) => (
                <li key={`${u.ts}-${i}`} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: u.agent ? AGENT_META[u.agent].color : "#64748b" }} />
                  <span className="min-w-0 flex-1 truncate text-slate-300">
                    {u.agent ? <AgentChip id={u.agent} link={false} className="mr-1 align-middle" /> : null}
                    {u.text}
                  </span>
                  <span className="shrink-0 text-[10px] text-slate-500">{clock(u.ts)}</span>
                </li>
              ))}
              {updates.length === 0 ? <li className="text-slate-500">Waiting for the first event…</li> : null}
            </ul>
          </div>
        </Card>
      </div>
    </div>
  );
}
