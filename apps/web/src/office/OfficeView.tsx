"use client";

import clsx from "clsx";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { AgentId } from "@azzy/events";
import { Button } from "@/components/Button";
import { IconBolt, IconCamera, IconRefresh, IconSpinner } from "@/components/Icons";
import { Sheet } from "@/components/Sheet";
import { StatusDot, StatusPill } from "@/components/StatusDot";
import { api, ApiError } from "@/lib/api";
import { usd } from "@/lib/format";
import { deriveStatus, HEALTH_COLORS, OFFICE_STATUS_COLORS, PHASE_LABELS, STATUS_COLORS, STATUS_LABELS } from "@/lib/status";
import type { CollaborationEdge } from "@/lib/types";
import { AGENT_IDS, can, EMPTY_LOGS, pendingApprovalFor, useAzzy, usePendingApprovals, type CameraMode } from "@/store/useAzzy";
import { detectWebGL, OfficeErrorBoundary } from "./OfficeErrorBoundary";

const OfficeScene = dynamic(() => import("./OfficeScene").then((m) => m.OfficeScene), { ssr: false, loading: () => <SceneLoading /> });

function SceneLoading() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-navy" aria-busy="true" aria-live="polite">
      <div className="flex flex-col items-center gap-3 text-slate-400">
        <IconSpinner width={28} height={28} className="text-brand-cyan" />
        <span className="text-xs">Loading the office…</span>
      </div>
    </div>
  );
}

const LEGEND: { key: keyof typeof STATUS_COLORS; label: string }[] = [
  { key: "working", label: "At desk" },
  { key: "walking", label: "Walking" },
  { key: "talking", label: "Talking" },
  { key: "approval", label: "Waiting approval" },
  { key: "away", label: "Away" },
  { key: "idle", label: "Idle" },
];

const MODES: { key: CameraMode; label: string; hint: string }[] = [
  { key: "overview", label: "Overview", hint: "Whole office" },
  { key: "iso", label: "Iso", hint: "Isometric view, like the concept mock" },
  { key: "focus", label: "Focus", hint: "Follow the selected agent" },
  { key: "collaboration", label: "Collaboration", hint: "Arcs for agent-to-agent messages" },
  { key: "execution", label: "Execution", hint: "Spotlight agents on active tasks" },
  { key: "monitoring", label: "Monitoring", hint: "LED wall + environment health" },
];

function Hud() {
  const office = useAzzy((s) => s.office);
  const me = useAzzy((s) => s.me);
  const toast = useAzzy((s) => s.toast);
  const requestFocus = useAzzy((s) => s.requestFocus);
  const upsertIncident = useAzzy((s) => s.upsertIncident);
  const mode = useAzzy((s) => s.cameraMode);
  const setMode = useAzzy((s) => s.setCameraMode);
  const selected = useAzzy((s) => s.selectedAgent);
  const envs = useAzzy((s) => s.environments);
  const [busy, setBusy] = useState<"meeting" | "incident" | null>(null);
  const writable = can(me, "write");

  const callMeeting = async () => {
    setBusy("meeting");
    try {
      await api.meeting.call();
      toast({ tone: "success", title: "Meeting called", body: "Everyone is heading to the orchestration table." });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) toast({ tone: "info", title: "A meeting is already running" });
      else if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Could not call meeting", body: err instanceof ApiError ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  const simulate = async () => {
    setBusy("incident");
    try {
      const inc = await api.incidents.simulate();
      upsertIncident(inc);
      toast({ tone: "info", title: "Incident opened", body: inc.title });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Could not simulate incident", body: err instanceof ApiError ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  const color = OFFICE_STATUS_COLORS[office.status];
  return (
    <div className="hud pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span data-testid="office-status" className="glass pointer-events-auto inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold" style={{ color }} role="status">
          <span className="inline-block h-2 w-2 rounded-full animate-pulseDot" style={{ backgroundColor: color }} />
          <span className="capitalize">{office.status}</span>
          {office.note ? <span className="hidden max-w-[220px] truncate font-normal text-slate-300 sm:inline">· {office.note}</span> : null}
        </span>
        <div className="pointer-events-auto flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Button className="flex-1 sm:flex-none" size="sm" variant="primary" data-testid="call-meeting" aria-label="Call meeting" onClick={callMeeting} loading={busy === "meeting"} disabled={!writable} title={!writable ? "Read-only role" : undefined} icon={<IconBolt width={14} height={14} />}>
            Call meeting
          </Button>
          <Button className="flex-1 sm:flex-none" size="sm" variant="danger" data-testid="simulate-incident" aria-label="Simulate incident" onClick={simulate} loading={busy === "incident"} disabled={!writable} title={!writable ? "Read-only role" : undefined}>
            Simulate incident
          </Button>
          <Button size="sm" variant="ghost" className="glass flex-1 sm:flex-none" aria-label="Look at the LED wall" onClick={() => requestFocus(null, "wall")} icon={<IconCamera width={14} height={14} />}>
            Wall
          </Button>
          <Button size="sm" variant="ghost" className="glass flex-1 sm:flex-none" aria-label="Reset camera" onClick={() => { setMode("overview"); requestFocus(null, "reset"); }} icon={<IconRefresh width={14} height={14} />}>
            Reset
          </Button>
        </div>
      </div>
      <div className="pointer-events-auto flex w-fit max-w-full flex-nowrap items-center gap-1 overflow-x-auto rounded-full glass p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Camera modes">
        {MODES.map((m) => {
          const active = mode === m.key;
          const disabled = m.key === "focus" && !selected;
          return (
            <button
              key={m.key}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`office-mode-${m.key}`}
              title={disabled ? "Select an agent first" : m.hint}
              disabled={disabled}
              onClick={() => setMode(m.key)}
              className={clsx("shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-medium transition", active ? "bg-brand-cyan text-navy shadow-glow" : "text-slate-300 hover:bg-white/10 disabled:opacity-40")}
            >
              {m.label}
            </button>
          );
        })}
      </div>
      {mode === "monitoring" ? (
        <ul className="pointer-events-auto flex flex-wrap gap-2" aria-label="Environment health">
          {envs.map((e) => {
            const c = HEALTH_COLORS[e.health] ?? HEALTH_COLORS.unknown;
            return (
              <li key={e.id} className="glass flex items-center gap-2 rounded-xl px-3 py-1.5 text-[11px] text-slate-200">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c, boxShadow: `0 0 8px ${c}` }} />
                <span className="font-medium">{e.name}</span>
                <span className="capitalize" style={{ color: c }}>
                  {e.health}
                </span>
                <span className="font-mono text-slate-400">{e.version ?? "—"}</span>
                <span className="text-slate-500">{e.latency_ms !== null ? `${e.latency_ms} ms` : ""}</span>
              </li>
            );
          })}
          {envs.length === 0 ? <li className="glass rounded-xl px-3 py-1.5 text-[11px] text-slate-400">No environments registered</li> : null}
        </ul>
      ) : (
        <ul className="pointer-events-auto glass hidden w-fit flex-wrap items-center gap-x-3 gap-y-1 rounded-full px-3 py-1 text-[11px] text-slate-300 sm:flex" aria-label="Status legend">
          {LEGEND.map((l) => (
            <li key={l.key} className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[l.key] }} />
              {l.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RosterRow({ id, compact }: { id: AgentId; compact?: boolean }) {
  const a = useAzzy((s) => s.agents[id]);
  const bubble = useAzzy((s) => s.bubbles[id]);
  const approvals = useAzzy((s) => s.approvals);
  const selected = useAzzy((s) => s.selectedAgent);
  const setSelected = useAzzy((s) => s.setSelectedAgent);
  const setMode = useAzzy((s) => s.setCameraMode);
  const requestFocus = useAzzy((s) => s.requestFocus);
  const pending = pendingApprovalFor(approvals, id);
  const status = deriveStatus({ phase: a.phase, arrived: true, hasBubble: Boolean(bubble), hasPendingApproval: Boolean(pending) });
  return (
    <li>
      <button
        type="button"
        onClick={() => {
          setSelected(id);
          setMode("focus");
          requestFocus(id, "agent");
        }}
        aria-label={`Focus on ${a.name}`}
        className={clsx("flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-white/5", selected === id && "bg-white/10 ring-1 ring-white/10")}
      >
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-navy" style={{ backgroundColor: a.color }}>
          {a.name[0]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-white">{a.name}</span>
            <StatusDot color={STATUS_COLORS[status]} label={STATUS_LABELS[status]} pulse={status === "approval"} />
            <span className="text-[11px] text-slate-400">{STATUS_LABELS[status]}</span>
          </span>
          <span className="block truncate text-[11px] text-slate-500">
            {PHASE_LABELS[a.phase]} · {a.spot}
            {a.detail ? ` · ${a.detail}` : ""}
          </span>
          {!compact && bubble ? <span className="mt-1 block truncate text-xs text-slate-300">“{bubble.text}”</span> : null}
          {pending ? <span className="mt-1 block text-xs font-medium text-rose-300">Needs your approval: {pending.tool}</span> : null}
        </span>
      </button>
    </li>
  );
}

function Roster({ compact }: { compact?: boolean }) {
  return (
    <ul className="space-y-1">
      {AGENT_IDS.map((id) => (
        <RosterRow key={id} id={id} compact={compact} />
      ))}
    </ul>
  );
}

function SelectedAgentPanel() {
  const selected = useAzzy((s) => s.selectedAgent);
  const setSelected = useAzzy((s) => s.setSelectedAgent);
  const agent = useAzzy((s) => (selected ? s.agents[selected] : null));
  const logs = useAzzy((s) => (selected ? s.toolLogs[selected] : EMPTY_LOGS));
  if (!selected || !agent) return null;
  return (
    <div className="mt-2 rounded-xl border border-line bg-black/30 p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-white">{agent.name}</span>
        <div className="flex items-center gap-2">
          <Link href={`/app/agents/${selected}`} className="text-brand-cyan hover:underline">
            Profile & chat →
          </Link>
          <button type="button" onClick={() => setSelected(null)} className="text-slate-500 hover:text-white" aria-label="Deselect agent">
            ✕
          </button>
        </div>
      </div>
      <p className="mt-1 text-slate-400">
        {agent.role} · {agent.rank} · {agent.xp} XP · ${agent.today_usd.toFixed(2)} today
      </p>
      <div className="mt-2 max-h-28 space-y-1 overflow-y-auto font-mono text-[10px] text-slate-400">
        {logs.length === 0 ? <p>No tool calls yet.</p> : null}
        {logs.slice(0, 6).map((l) => (
          <p key={l.id} className="truncate">
            <span className={l.ok ? "text-emerald-400" : "text-rose-400"}>{l.ok ? "✓" : "✗"}</span> {l.tool} · {l.duration_ms}ms
          </p>
        ))}
      </div>
    </div>
  );
}

export function OfficeFallback({ reason }: { reason: string }) {
  return (
    <div data-testid="office-fallback" className="glass flex h-full min-h-[320px] flex-col rounded-2xl p-4">
      <p className="text-sm font-semibold text-white">3D view unavailable — showing live roster</p>
      <p className="mb-3 text-xs text-slate-400">{reason}</p>
      <Roster />
    </div>
  );
}

/** Bottom KPI strip over the 3D view — the concept mock's metric bar, fed with live store data. */
function KpiStrip() {
  const tasks = useAzzy((s) => s.tasks);
  const agents = useAzzy((s) => s.agents);
  const costs = useAzzy((s) => s.costs);
  const pending = usePendingApprovals();
  const active = tasks.filter((t) => !["done", "failed", "cancelled"].includes(t.state)).length;
  const working = AGENT_IDS.filter((id) => !["idle", "away"].includes(agents[id].phase)).length;
  const done = AGENT_IDS.reduce((n, id) => n + agents[id].tasks_done, 0);
  const stats: { label: string; value: string; color: string }[] = [
    { label: "Active tasks", value: String(active), color: "#00E5FF" },
    { label: "Agents working", value: `${working}/5`, color: "#34D399" },
    { label: "Pending approval", value: String(pending.length), color: "#F04DFF" },
    { label: "Tasks done", value: String(done), color: "#22c55e" },
    { label: "Spend today", value: `${usd(costs.today_usd)} / ${usd(costs.budget_usd, 0)}`, color: "#FFB547" },
  ];
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 hidden p-3 md:block" aria-label="Office key metrics">
      <div className="glass flex items-stretch justify-between gap-2 rounded-2xl px-4 py-2">
        {stats.map((s) => (
          <div key={s.label} className="min-w-0 text-center">
            <div className="truncate text-[10px] font-medium uppercase tracking-wider text-slate-400">{s.label}</div>
            <div className="text-base font-bold leading-tight" style={{ color: s.color }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OfficeView() {
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const hydrated = useAzzy((s) => s.hydrated);
  const pending = usePendingApprovals();
  const mode = useAzzy((s) => s.cameraMode);
  const [edges, setEdges] = useState<CollaborationEdge[]>([]);

  useEffect(() => {
    setWebgl(detectWebGL());
  }, []);

  // Live edges for the collaboration mode (polled; the arcs themselves animate from agent.message events).
  useEffect(() => {
    if (mode !== "collaboration") return;
    let alive = true;
    const load = () => api.collaboration.live().then((r) => alive && setEdges(r.edges)).catch(() => undefined);
    load();
    const id = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [mode]);

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
      <div className="relative h-[60svh] min-h-[360px] w-full overflow-hidden rounded-2xl border border-line bg-navy lg:h-[calc(100svh-7.5rem)] lg:flex-1">
        {webgl === null ? (
          <SceneLoading />
        ) : webgl ? (
          <OfficeErrorBoundary
            fallback={
              <div className="p-3">
                <OfficeFallback reason="The 3D renderer crashed or a resource failed to load. Live data continues below." />
              </div>
            }
          >
            <OfficeScene liveEdges={edges} />
          </OfficeErrorBoundary>
        ) : (
          <div className="h-full p-3">
            <OfficeFallback reason="This browser does not expose WebGL. Everything else keeps updating live." />
          </div>
        )}
        <Hud />
        <KpiStrip />
        {!hydrated ? <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-full bg-black/60 px-3 py-1 text-[11px] text-slate-300">Syncing state…</div> : null}
      </div>

      <Sheet
        title={
          <span className="flex items-center gap-2">
            Agents
            {pending.length > 0 ? <StatusPill color="#F04DFF" label={`${pending.length} approval${pending.length === 1 ? "" : "s"} pending`} /> : null}
          </span>
        }
        className="lg:w-80 lg:shrink-0"
        defaultOpen
      >
        <Roster />
        <SelectedAgentPanel />
        {pending.length > 0 ? (
          <Link href="/app/approvals" className="mt-3 block rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-center text-xs font-medium text-rose-200 hover:bg-rose-500/20">
            Review {pending.length} pending approval{pending.length === 1 ? "" : "s"} →
          </Link>
        ) : null}
      </Sheet>
    </div>
  );
}
