"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AGENT_META, type AgentId, type Task } from "@azzy/events";
import { AgentChat } from "@/components/AgentChat";
import { AgentAvatar } from "@/components/AgentChip";
import { Button } from "@/components/Button";
import { Card, CardHeader } from "@/components/Card";
import { EmptyState, Skeleton } from "@/components/EmptyState";
import { IconTrash } from "@/components/Icons";
import { Progress } from "@/components/KV";
import { StatusDot } from "@/components/StatusDot";
import { Tabs } from "@/components/Tabs";
import { ToolLogList } from "@/components/ToolLogList";
import { api, ApiError } from "@/lib/api";
import { clock, relTime, usd } from "@/lib/format";
import { deriveStatus, PHASE_LABELS, PIPELINE_ACCENTS, PIPELINE_LABELS, STATUS_COLORS, STATUS_LABELS } from "@/lib/status";
import type { AgentDetail, Memory, ToolLog } from "@/lib/types";
import { can, pendingApprovalFor, useAzzy } from "@/store/useAzzy";
import { AVATARS } from "@/office/avatars";

type Tab = "log" | "tools" | "memories" | "tasks";

export function AgentProfile({ id }: { id: AgentId }) {
  const meta = AGENT_META[id];
  const a = useAzzy((s) => s.agents[id]);
  const bubble = useAzzy((s) => s.bubbles[id]);
  const approvals = useAzzy((s) => s.approvals);
  const liveLogs = useAzzy((s) => s.toolLogs[id]);
  const liveMemories = useAzzy((s) => s.memories);
  const tasks = useAzzy((s) => s.tasks);
  const me = useAzzy((s) => s.me);
  const toast = useAzzy((s) => s.toast);
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("log");
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const pending = pendingApprovalFor(approvals, id);
  const status = deriveStatus({ phase: a.phase, arrived: true, hasBubble: Boolean(bubble), hasPendingApproval: Boolean(pending) });

  useEffect(() => {
    let alive = true;
    api.agents
      .get(id)
      .then((d) => alive && setDetail(d))
      .catch((e: unknown) => alive && setError(e instanceof ApiError ? e.message : "Failed to load agent"));
    return () => {
      alive = false;
    };
  }, [id]);

  const logs: ToolLog[] = useMemo(() => {
    const map = new Map<string, ToolLog>();
    for (const l of detail?.log ?? []) map.set(l.id, l);
    for (const l of liveLogs) map.set(l.id, l);
    return Array.from(map.values()).sort((x, y) => Date.parse(y.ts) - Date.parse(x.ts)).slice(0, 200);
  }, [detail?.log, liveLogs]);

  const memories: Memory[] = useMemo(() => {
    const map = new Map<string, Memory>();
    for (const m of detail?.memories ?? []) map.set(m.id, m);
    for (const m of liveMemories) if (m.agent === id) map.set(m.memory_id, { id: m.memory_id, agent: m.agent, task_id: m.task_id, kind: m.kind, text: m.text, created_at: m.ts });
    const ts = (m: Memory) => (m.created_at ? Date.parse(m.created_at) : 0);
    return Array.from(map.values()).filter((m) => !removed.has(m.id)).sort((x, y) => ts(y) - ts(x));
  }, [detail?.memories, liveMemories, id, removed]);

  const agentTasks = useMemo(() => {
    const map = new Map<string, Task>();
    for (const t of detail?.tasks ?? []) map.set(t.id, t);
    for (const t of tasks) if (t.lead === id || t.assignees.includes(id)) map.set(t.id, t);
    return Array.from(map.values()).sort((x, y) => Date.parse(y.updated_at) - Date.parse(x.updated_at)).slice(0, 30);
  }, [detail?.tasks, tasks, id]);

  const deleteMemory = async (mid: string) => {
    try {
      await api.agents.deleteMemory(id, mid);
      setRemoved((s) => new Set(s).add(mid));
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Could not delete memory" });
    }
  };

  const budgetPct = a.daily_budget_usd > 0 ? (a.today_usd / a.daily_budget_usd) * 100 : 0;
  const avatar = AVATARS[id];

  return (
    <div>
      <Link href="/app/agents" className="text-xs text-slate-400 hover:text-white">
        ← All agents
      </Link>
      <header className="relative mt-2 mb-4 overflow-hidden rounded-2xl border border-line bg-midnight/80 p-4 shadow-glass md:p-5">
        <span className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full opacity-25 blur-3xl" style={{ backgroundColor: meta.color }} aria-hidden />
        <div className="relative flex flex-wrap items-start gap-4">
          <AgentAvatar id={id} size={64} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-white">{meta.name}</h1>
              <span className="rounded-md border border-brand-gold/40 bg-brand-gold/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-gold">{a.rank}</span>
              <span className="flex items-center gap-1.5 text-xs text-slate-300">
                <StatusDot color={STATUS_COLORS[status]} label={STATUS_LABELS[status]} pulse={status === "approval"} /> {STATUS_LABELS[status]}
              </span>
            </div>
            <p className="text-sm" style={{ color: meta.color }}>
              {meta.role}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {PHASE_LABELS[a.phase]} · at {a.spot}
              {a.detail ? ` · ${a.detail}` : ""}
              {a.task_id ? (
                <>
                  {" · "}
                  <Link href={`/app/tasks/${a.task_id}`} className="font-mono text-brand-cyan hover:underline">
                    task {a.task_id.slice(0, 8)}
                  </Link>
                </>
              ) : null}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              Avatar: {avatar.kind === "human" ? "human" : `${avatar.kind} humanoid`}
              {avatar.headset ? " · headset" : ""}
              {avatar.glasses ? " · glasses" : ""}
              {avatar.hair !== "none" ? ` · ${avatar.hair}` : ""}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4">
            {[
              ["XP", String(a.xp)],
              ["Tasks done", String(a.tasks_done)],
              ["Today", usd(a.today_usd)],
              ["Budget", usd(a.daily_budget_usd, 0)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-white/5 px-3 py-2">
                <dt className="text-[10px] uppercase tracking-wider text-slate-500">{k}</dt>
                <dd className="font-semibold text-white">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="relative mt-3">
          <Progress value={budgetPct} color={budgetPct > 85 ? "#F04DFF" : meta.color} label="Daily budget used" />
        </div>
        {pending ? (
          <Link href="/app/approvals" className="relative mt-3 block rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200 hover:bg-rose-500/20">
            Waiting for approval: <span className="font-mono">{pending.tool}</span> — {pending.summary} →
          </Link>
        ) : null}
      </header>

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="lg:col-span-3" aria-label={`Chat with ${meta.name}`}>
          <AgentChat agent={id} />
        </section>
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Configuration" subtitle={detail ? `${detail.config.tools.length} tools · ${detail.config.skills.length} skills · ${detail.config.routines.length} routines` : "loading…"} />
            <div className="px-4 pb-4">
              {error ? <p className="text-xs text-rose-300">{error}</p> : null}
              {!detail && !error ? <Skeleton className="h-20" /> : null}
              {detail ? (
                <div className="space-y-3 text-xs">
                  <div>
                    <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Tools</h3>
                    <div className="flex flex-wrap gap-1">
                      {detail.config.tools.map((t) => (
                        <span key={t} className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-slate-200">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Skills</h3>
                    <div className="flex flex-wrap gap-1">
                      {detail.config.skills.map((t) => (
                        <span key={t} className="rounded px-1.5 py-0.5 text-[11px]" style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}>
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Budgets</h3>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                      {Object.entries(detail.config.budgets).map(([k, v]) => (
                        <div key={k} className="contents">
                          <dt className="text-slate-500">{k}</dt>
                          <dd className="truncate font-mono text-slate-200">{String(v)}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                  <div>
                    <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Routines</h3>
                    {detail.config.routines.length === 0 ? <p className="text-slate-500">No scheduled routines.</p> : null}
                    <ul className="space-y-1">
                      {detail.config.routines.map((r) => (
                        <RoutineRow key={r.id} id={r.id} title={r.title} cron={r.cron} canRun={can(me, "write")} />
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}
            </div>
          </Card>
        </div>
      </div>

      <Card className="mt-4">
        <div className="px-4 pt-4">
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            testIdPrefix="agent-tab-"
            tabs={[
              { key: "log", label: "Live sandbox log", count: logs.length },
              { key: "tools", label: "Tool usage" },
              { key: "memories", label: "Memories", count: memories.length },
              { key: "tasks", label: "Tasks", count: agentTasks.length },
            ]}
          />
        </div>
        <div className="p-4">
          {tab === "log" ? (
            logs.length === 0 ? (
              <EmptyState title="No tool calls yet" hint={`Every tool ${meta.name} calls streams here with args, output, risk and duration.`} />
            ) : (
              <ToolLogList logs={logs} max={60} />
            )
          ) : null}
          {tab === "tools" ? <ToolUsage logs={logs} color={meta.color} /> : null}
          {tab === "memories" ? (
            memories.length === 0 ? (
              <EmptyState title="Nothing learned yet" hint="1–3 durable memories are written at the end of every task." />
            ) : (
              <ul className="grid gap-2 md:grid-cols-2">
                {memories.map((m) => (
                  <li key={m.id} className="flex items-start gap-2 rounded-xl border border-line bg-black/20 p-3 text-xs">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-500">
                        <span className="rounded bg-white/5 px-1.5 py-0.5">{m.kind}</span>
                        <span>{clock(m.created_at)}</span>
                        {m.task_id ? (
                          <Link href={`/app/tasks/${m.task_id}`} className="font-mono hover:text-brand-cyan">
                            {m.task_id.slice(0, 8)}
                          </Link>
                        ) : null}
                      </div>
                      <p className="text-slate-200">{m.text}</p>
                    </div>
                    <Button size="sm" variant="ghost" aria-label="Delete memory" onClick={() => deleteMemory(m.id)} disabled={!can(me, "write")} title={!can(me, "write") ? "Read-only role" : "Delete memory"} icon={<IconTrash width={14} height={14} />} />
                  </li>
                ))}
              </ul>
            )
          ) : null}
          {tab === "tasks" ? (
            agentTasks.length === 0 ? (
              <EmptyState title="No tasks yet" hint={`Tasks routed to ${meta.name} appear here.`} />
            ) : (
              <ul className="divide-y divide-line">
                {agentTasks.map((t) => (
                  <li key={t.id}>
                    <Link href={`/app/tasks/${t.id}`} className="flex items-center gap-3 py-2 text-xs hover:text-white">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PIPELINE_ACCENTS[t.state] }} />
                      <span className="min-w-0 flex-1 truncate text-slate-200">{t.title}</span>
                      <span className="text-slate-500">{PIPELINE_LABELS[t.state]}</span>
                      <span className="text-slate-600">{relTime(t.updated_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      </Card>
    </div>
  );
}

function RoutineRow({ id, title, cron, canRun }: { id: string; title: string; cron: string; canRun: boolean }) {
  const toast = useAzzy((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await api.routines.run(id);
      toast({ tone: "success", title: `Routine started: ${title}`, body: `task ${r.task_id.slice(0, 8)}` });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Could not run routine", body: err instanceof ApiError ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5">
      <span className="min-w-0 flex-1 truncate text-slate-200">{title}</span>
      <span className="font-mono text-[10px] text-slate-500">{cron}</span>
      <Button size="sm" variant="outline" loading={busy} onClick={run} disabled={!canRun} title={!canRun ? "Read-only role" : "Run now"} aria-label={`Run routine ${title} now`}>
        Run
      </Button>
    </li>
  );
}

function ToolUsage({ logs, color }: { logs: ToolLog[]; color: string }) {
  const stats = useMemo(() => {
    const map = new Map<string, { n: number; ok: number; ms: number }>();
    for (const l of logs) {
      const s = map.get(l.tool) ?? { n: 0, ok: 0, ms: 0 };
      s.n += 1;
      if (l.ok) s.ok += 1;
      s.ms += l.duration_ms;
      map.set(l.tool, s);
    }
    return Array.from(map.entries())
      .map(([tool, s]) => ({ tool, ...s }))
      .sort((a, b) => b.n - a.n);
  }, [logs]);
  if (stats.length === 0) return <EmptyState title="No usage yet" hint="Per-tool call counts, success rate and average latency build up as the agent works." />;
  const max = Math.max(...stats.map((s) => s.n));
  return (
    <ul className="space-y-2">
      {stats.map((s) => (
        <li key={s.tool} className="text-xs">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-mono text-slate-200">{s.tool}</span>
            <span className="text-slate-400">
              {s.n} calls · {Math.round((s.ok / s.n) * 100)}% ok · {Math.round(s.ms / s.n)} ms avg
            </span>
          </div>
          <Progress value={(s.n / max) * 100} color={color} label={`${s.tool} usage`} />
        </li>
      ))}
    </ul>
  );
}
