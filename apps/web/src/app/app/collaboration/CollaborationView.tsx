"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AGENT_IDS, AGENT_META, type AgentId } from "@azzy/events";
import { AgentChip } from "@/components/AgentChip";
import { Card, CardHeader, PageHeader } from "@/components/Card";
import { EmptyState, Skeleton } from "@/components/EmptyState";
import { Progress } from "@/components/KV";
import { AgentMessageList } from "@/components/TaskDetail";
import { api } from "@/lib/api";
import { relTime } from "@/lib/format";
import { PIPELINE_ACCENTS, PIPELINE_LABELS } from "@/lib/status";
import type { CollaborationEdge } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { useAzzy } from "@/store/useAzzy";

const W = 640;
const H = 420;
const CX = W / 2;
const CY = H / 2;
const R = 150;
const RECENT_MS = 20_000;

const NODE_POS: Record<AgentId, { x: number; y: number }> = Object.fromEntries(
  AGENT_IDS.map((id, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / AGENT_IDS.length;
    return [id, { x: CX + Math.cos(a) * R, y: CY + Math.sin(a) * R }];
  }),
) as Record<AgentId, { x: number; y: number }>;

function arcPath(a: { x: number; y: number }, b: { x: number; y: number }) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  // bow outwards from the centre so A→B and B→A do not overlap
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const k = 28;
  return `M${a.x},${a.y} Q${mx + nx * k},${my + ny * k} ${b.x},${b.y}`;
}

export function CollaborationView() {
  const messages = useAzzy((s) => s.agentMessages);
  const agents = useAzzy((s) => s.agents);
  const tasks = useAzzy((s) => s.tasks);
  const [live, setLive] = useState<{ edges: CollaborationEdge[]; loaded: boolean }>({ edges: [], loaded: false });
  const now = useNow(1000);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api.collaboration
        .live()
        .then((r) => alive && setLive({ edges: r.edges, loaded: true }))
        .catch(() => alive && setLive((s) => ({ ...s, loaded: true })));
    load();
    const id = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [messages.length]);

  const edges = useMemo(() => {
    const map = new Map<string, { from: AgentId; to: AgentId | "hub"; count: number; last: number; active: boolean }>();
    for (const e of live.edges) {
      // The API reports broadcasts (to_agent = null) as "azzy"; the graph draws those into the orchestrator hub.
      const to: AgentId | "hub" = e.to === "azzy" ? "hub" : e.to;
      map.set(`${e.from}>${to}`, { from: e.from, to, count: e.count, last: e.last_ts ? Date.parse(e.last_ts) : 0, active: e.active });
    }
    for (const m of messages) {
      const to: AgentId | "hub" = m.to_agent ?? "hub";
      const key = `${m.from_agent}>${to}`;
      const t = Date.parse(m.created_at);
      const cur = map.get(key);
      const recent = now - t < RECENT_MS;
      if (cur) {
        cur.count = Math.max(cur.count, 1);
        cur.last = Math.max(cur.last, t);
        cur.active = cur.active || recent;
      } else map.set(key, { from: m.from_agent, to, count: 1, last: t, active: recent });
    }
    return Array.from(map.values());
  }, [live.edges, messages, now]);

  const activeTasks = useMemo(() => tasks.filter((t) => !["done", "failed", "cancelled"].includes(t.state)), [tasks]);
  const activeEdges = edges.filter((e) => e.active).length;

  return (
    <div>
      <PageHeader title="Collaboration" subtitle="Live graph of agent-to-agent handoffs, requests and results. The orchestrator sits in the middle; arcs light up for 20 s after each message." />
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Live graph" subtitle={`${activeEdges} active edge${activeEdges === 1 ? "" : "s"} · ${edges.length} total`} />
          <div className="px-3 pb-3">
            <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Agent collaboration graph">
              <defs>
                <radialGradient id="hubGlow">
                  <stop offset="0%" stopColor="#00E5FF" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#9747FF" stopOpacity="0" />
                </radialGradient>
                <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill="#94a3b8" />
                </marker>
              </defs>
              <circle cx={CX} cy={CY} r={R + 40} fill="none" stroke="#1a2140" strokeDasharray="3 6" />
              <circle cx={CX} cy={CY} r={90} fill="url(#hubGlow)" />
              {edges.map((e) => {
                const a = NODE_POS[e.from];
                const b = e.to === "hub" ? { x: CX, y: CY } : NODE_POS[e.to];
                const color = AGENT_META[e.from].color;
                return (
                  <g key={`${e.from}>${e.to}`}>
                    <path data-testid="collab-edge" data-active={e.active ? "true" : "false"} d={arcPath(a, b)} fill="none" stroke={color} strokeOpacity={e.active ? 0.9 : 0.25} strokeWidth={e.active ? 3 : 1.5} className={e.active ? "collab-edge" : undefined} markerEnd="url(#arrow)" />
                    {e.active ? <circle r="4" fill="#fff">
                      <animateMotion dur="1.6s" repeatCount="indefinite" path={arcPath(a, b)} />
                    </circle> : null}
                  </g>
                );
              })}
              {/* orchestrator hub */}
              <g>
                <circle cx={CX} cy={CY} r="34" fill="#0B1025" stroke="#00E5FF" strokeWidth="1.5" />
                <text x={CX} y={CY - 2} textAnchor="middle" fontSize="20" fontWeight="800" fill="#00E5FF">
                  A
                </text>
                <text x={CX} y={CY + 16} textAnchor="middle" fontSize="9" fill="#94a3b8" letterSpacing="1.5">
                  ORCHESTRATOR
                </text>
              </g>
              {AGENT_IDS.map((id) => {
                const p = NODE_POS[id];
                const a = agents[id];
                const busy = a.phase !== "idle" && a.phase !== "away";
                return (
                  <g key={id}>
                    <a href={`/app/agents/${id}`} aria-label={`Open ${a.name}`}>
                      {busy ? <circle cx={p.x} cy={p.y} r="34" fill={AGENT_META[id].color} fillOpacity="0.12" className="animate-pulseDot" /> : null}
                      <circle cx={p.x} cy={p.y} r="26" fill="#0B1025" stroke={AGENT_META[id].color} strokeWidth="2" />
                      <text x={p.x} y={p.y + 5} textAnchor="middle" fontSize="16" fontWeight="700" fill={AGENT_META[id].color}>
                        {a.name[0]}
                      </text>
                      <text x={p.x} y={p.y + 44} textAnchor="middle" fontSize="12" fontWeight="600" fill="#e2e8f0">
                        {a.name}
                      </text>
                      <text x={p.x} y={p.y + 58} textAnchor="middle" fontSize="9" fill="#94a3b8">
                        {AGENT_META[id].short} · {a.phase.replace(/_/g, " ")}
                      </text>
                    </a>
                  </g>
                );
              })}
            </svg>
          </div>
        </Card>
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Active tasks" subtitle={`${activeTasks.length} in flight`} />
            <div className="space-y-2 px-3 pb-3">
              {!live.loaded && activeTasks.length === 0 ? <Skeleton className="h-16" /> : null}
              {live.loaded && activeTasks.length === 0 ? <EmptyState title="No active tasks" hint="Submit the ECS workflow prompt from the command bar to watch a full multi-agent run." /> : null}
              {activeTasks.slice(0, 8).map((t) => (
                <Link key={t.id} href={`/app/tasks/${t.id}`} className="block rounded-xl border border-line bg-black/20 p-3 transition hover:border-white/20">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-white">{t.title}</span>
                    <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ color: PIPELINE_ACCENTS[t.state], backgroundColor: `${PIPELINE_ACCENTS[t.state]}1f` }}>
                      {PIPELINE_LABELS[t.state]}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-slate-400">
                    {t.lead ? <AgentChip id={t.lead} link={false} /> : null}
                    {t.assignees.filter((a) => a !== t.lead).length > 0 ? <span>+{t.assignees.filter((a) => a !== t.lead).length}</span> : null}
                    <span className="ml-auto">{relTime(t.updated_at, now)}</span>
                  </div>
                  {t.steps_total > 0 ? (
                    <div className="mt-2">
                      <Progress value={(t.steps_done / t.steps_total) * 100} color={PIPELINE_ACCENTS[t.state]} label="progress" />
                    </div>
                  ) : null}
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>
      <Card className="mt-4">
        <CardHeader title="Recent agent messages" subtitle="newest last · live" />
        <div className="px-3 pb-3">
          <AgentMessageList messages={messages.slice(0, 30).slice().reverse()} emptyHint="Messages stream in as soon as a task involves more than one agent." />
        </div>
      </Card>
    </div>
  );
}
