"use client";

import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { AGENT_IDS, AGENT_META } from "@azzy/events";
import { AgentChip } from "@/components/AgentChip";
import { Button } from "@/components/Button";
import { DemoChip } from "@/components/Brand";
import { Card, CardHeader, PageHeader } from "@/components/Card";
import { EmptyState, Skeleton } from "@/components/EmptyState";
import { IncidentCard } from "@/components/IncidentCard";
import { Pill, Progress } from "@/components/KV";
import { Sparkline } from "@/components/Sparkline";
import { api, ApiError } from "@/lib/api";
import { clock, relTime, uptime as fmtUptime, usd } from "@/lib/format";
import { HEALTH_COLORS } from "@/lib/status";
import type { SystemMetrics } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { can, useAzzy, useLiveUptime } from "@/store/useAzzy";

function MetricTile({ label, value, ok, hint, accent }: { label: string; value: string | number; ok?: boolean; hint?: string; accent?: string }) {
  const color = ok === undefined ? accent : ok ? "#34D399" : "#ef4444";
  return (
    <div className="rounded-2xl border border-line bg-midnight/80 px-4 py-3 shadow-glass">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-400">
        {ok !== undefined ? <span className={clsx("h-1.5 w-1.5 rounded-full", !ok && "animate-pulseDot")} style={{ backgroundColor: color }} /> : null}
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-white" style={color ? { color } : undefined}>
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

export function MonitoringView() {
  const envs = useAzzy((s) => s.environments);
  const incidents = useAzzy((s) => s.incidents);
  const costs = useAzzy((s) => s.costs);
  const agents = useAzzy((s) => s.agents);
  const updates = useAzzy((s) => s.updates);
  const hydrated = useAzzy((s) => s.hydrated);
  const ws = useAzzy((s) => s.ws);
  const me = useAzzy((s) => s.me);
  const toast = useAzzy((s) => s.toast);
  const upsertIncident = useAzzy((s) => s.upsertIncident);
  const setCostsExtra = useAzzy((s) => s.setCostsExtra);
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [metricsError, setMetricsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const now = useNow(5000);
  const liveUptime = useLiveUptime(now);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api.system
        .metrics()
        .then((m) => {
          if (!alive) return;
          setMetrics(m);
          setMetricsError(false);
        })
        .catch(() => alive && setMetricsError(true));
    load();
    const id = setInterval(load, 10_000);
    api.costs().then((c) => alive && setCostsExtra(c.series, c.recent)).catch(() => undefined);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [setCostsExtra]);

  const simulate = async () => {
    setBusy(true);
    try {
      const inc = await api.incidents.simulate();
      upsertIncident(inc);
      toast({ tone: "info", title: "Incident opened", body: inc.title });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Could not simulate incident", body: err instanceof ApiError ? err.message : "Network error" });
    } finally {
      setBusy(false);
    }
  };

  const open = useMemo(() => incidents.filter((i) => i.status !== "resolved"), [incidents]);
  const closed = useMemo(() => incidents.filter((i) => i.status === "resolved"), [incidents]);
  const series = costs.series.slice(-24).map((p) => p.usd);
  const pct = costs.budget_usd > 0 ? Math.min(100, (costs.today_usd / costs.budget_usd) * 100) : 0;
  const writable = can(me, "write");

  return (
    <div>
      <PageHeader
        title="Monitoring"
        subtitle="System health, environment probes, incidents and spend — all live."
        action={
          <Button variant="danger" data-testid="simulate-incident" aria-label="Simulate incident" loading={busy} onClick={simulate} disabled={!writable} title={!writable ? "Read-only role" : undefined}>
            Simulate incident
          </Button>
        }
      />

      <section aria-labelledby="sys-h" className="mb-6">
        <h2 id="sys-h" className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
          System {metrics ? <DemoChip show={metrics.demo} /> : null}
          {metrics ? <span className="text-xs font-normal text-slate-500">api {metrics.version}</span> : null}
        </h2>
        {!metrics && !metricsError ? (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <MetricTile label="WebSocket" value={ws === "connected" ? "live" : ws} ok={ws === "connected"} hint={metrics ? `${metrics.ws_clients} client(s)` : undefined} />
            <MetricTile label="Worker" value={metrics ? (metrics.worker_ok ? "ok" : "stale") : "—"} ok={metrics?.worker_ok} hint={metrics?.worker_heartbeat_ts ? `heartbeat ${relTime(metrics.worker_heartbeat_ts, now)}` : "no heartbeat"} />
            <MetricTile label="Database" value={metrics ? (metrics.db_ok ? "ok" : "down") : "—"} ok={metrics?.db_ok} />
            <MetricTile label="Redis" value={metrics ? (metrics.redis_ok ? "ok" : "down") : "—"} ok={metrics?.redis_ok} hint={metrics ? `queue depth ${metrics.queue_depth}` : undefined} />
            <MetricTile label="Uptime" value={fmtUptime(metrics?.uptime_seconds ?? liveUptime)} accent="#00E5FF" />
            <MetricTile label="Active" value={metrics ? `${metrics.tasks_active} tasks` : "—"} hint={metrics ? `${metrics.approvals_pending} approvals · ${metrics.incidents_open} incidents` : undefined} />
          </div>
        )}
        {metricsError ? <p className="mt-2 text-xs text-amber-300">/api/system/metrics is unreachable — showing live values from the event stream.</p> : null}
      </section>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Environment health" subtitle="probes stream on env.health" />
          <div className="px-4 pb-4">
            {!hydrated ? <Skeleton className="h-24" /> : envs.length === 0 ? <EmptyState title="No environments" hint="Register environments under Infrastructure." /> : null}
            <ul className="grid gap-2 sm:grid-cols-2">
              {envs.map((e) => {
                const c = HEALTH_COLORS[e.health] ?? HEALTH_COLORS.unknown;
                return (
                  <li key={e.id} className="flex items-center gap-3 rounded-xl border border-line bg-black/20 px-3 py-2 text-xs">
                    <span className={clsx("h-2.5 w-2.5 rounded-full", e.health !== "healthy" && "animate-pulseDot")} style={{ backgroundColor: c, boxShadow: `0 0 8px ${c}` }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-white">{e.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {e.kind} · {e.version ?? "—"} · {e.latency_ms !== null ? `${e.latency_ms} ms` : "—"} · {relTime(e.last_checked, now)}
                      </div>
                    </div>
                    <span className="capitalize" style={{ color: c }}>
                      {e.health}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>
        <Card>
          <CardHeader title="Spend today" subtitle={`${usd(costs.today_usd)} of ${usd(costs.budget_usd, 0)}`} action={<Sparkline values={series} label="hourly spend" color={pct > 85 ? "#F04DFF" : "#FFB547"} />} />
          <div className="px-4 pb-4">
            <Progress value={pct} color={pct > 90 ? "#ef4444" : pct > 70 ? "#FFB547" : "#00E5FF"} label="Daily budget used" />
            <ul className="mt-3 space-y-1.5 text-xs">
              {AGENT_IDS.map((id) => {
                const a = agents[id];
                const v = costs.per_agent[id] ?? a.today_usd;
                return (
                  <li key={id} className="flex items-center gap-2">
                    <AgentChip id={id} />
                    <span className="ml-auto font-mono text-slate-200">{usd(v)}</span>
                    <span className="w-16 text-right font-mono text-slate-500">/ {usd(a.daily_budget_usd, 0)}</span>
                  </li>
                );
              })}
            </ul>
            {costs.recent.length > 0 ? (
              <p className="mt-2 text-[11px] text-slate-500">
                last tick {clock(costs.recent[0].ts)} · {AGENT_META[costs.recent[0].agent].name} · {usd(costs.recent[0].usd, 4)}
              </p>
            ) : null}
          </div>
        </Card>
      </div>

      <section className="mb-6" aria-labelledby="open-h">
        <h2 id="open-h" className="mb-3 text-sm font-semibold text-white">
          Open incidents <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[11px] text-rose-200">{open.length}</span>
        </h2>
        {!hydrated ? <Skeleton className="h-40" /> : open.length === 0 ? <EmptyState title="All quiet" hint="No open incidents. Use Simulate incident to watch the war room: Jimmy leads, Emir finds root cause, Cyber checks for attack, Sara drafts the client update." /> : (
          <div className="grid gap-3 lg:grid-cols-2">
            {open.map((i) => (
              <IncidentCard key={i.id} incident={i} now={now} />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="lg:col-span-2" aria-labelledby="resolved-h">
          <h2 id="resolved-h" className="mb-3 text-sm font-semibold text-white">
            Resolved <span className="text-xs font-normal text-slate-500">last {closed.length}</span>
          </h2>
          {hydrated && closed.length === 0 ? <EmptyState title="No resolved incidents yet" hint="Resolved incidents keep their full timeline here." /> : null}
          <div className="grid gap-3 md:grid-cols-2">
            {closed.slice(0, 6).map((i) => (
              <IncidentCard key={i.id} incident={i} now={now} compact />
            ))}
          </div>
        </section>
        <Card>
          <CardHeader title="LED wall feed" subtitle="latest updates" />
          <ul className="space-y-1.5 px-4 pb-4 text-xs" aria-live="polite">
            {updates.length === 0 ? <li className="text-slate-500">Waiting for the first event…</li> : null}
            {updates.slice(0, 12).map((u, i) => (
              <li key={`${u.ts}-${i}`} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: u.agent ? AGENT_META[u.agent].color : "#64748b" }} />
                <span className="min-w-0 flex-1 text-slate-200">
                  <span className="font-semibold" style={{ color: u.agent ? AGENT_META[u.agent].color : undefined }}>
                    {u.agent ? AGENT_META[u.agent].name : "Azzy"}
                  </span>{" "}
                  {u.text}
                </span>
                <span className="shrink-0 text-[10px] text-slate-500">{clock(u.ts)}</span>
              </li>
            ))}
          </ul>
          <div className="px-4 pb-4">
            <Pill color="#00E5FF">{ws === "connected" ? "stream live" : ws}</Pill>
          </div>
        </Card>
      </div>
    </div>
  );
}
