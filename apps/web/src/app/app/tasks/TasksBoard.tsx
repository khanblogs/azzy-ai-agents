"use client";

import { useMemo, useState } from "react";
import { PIPELINE_ORDER, type PipelineState, type Task } from "@azzy/events";
import { AgentAvatar, AgentChip } from "@/components/AgentChip";
import { PageHeader } from "@/components/Card";
import { EmptyState, Skeleton } from "@/components/EmptyState";
import { Progress } from "@/components/KV";
import { CancelTaskButton, TaskDrawer, TaskStateSelect } from "@/components/TaskDetail";
import { relTime } from "@/lib/format";
import { PIPELINE_ACCENTS, PIPELINE_LABELS, PIPELINE_TERMINAL } from "@/lib/status";
import { useNow } from "@/lib/useNow";
import { useAzzy } from "@/store/useAzzy";

function TaskCard({ task, now, onOpen }: { task: Task; now: number; onOpen: (id: string) => void }) {
  const accent = PIPELINE_ACCENTS[task.state];
  const running = !PIPELINE_TERMINAL.includes(task.state);
  return (
    <article data-testid="task-card" data-task-id={task.id} data-state={task.state} className="group rounded-xl border border-line bg-midnight/80 p-3 shadow-glass transition hover:-translate-y-px hover:border-white/20">
      <button type="button" onClick={() => onOpen(task.id)} className="block w-full text-left" aria-label={`Open task ${task.title}`}>
        <div className="mb-1.5 flex items-start gap-2">
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: accent }} aria-hidden />
          <h3 className="line-clamp-2 text-sm font-medium leading-snug text-white">{task.title}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
          {task.lead ? <AgentChip id={task.lead} link={false} /> : <span className="rounded-full bg-white/5 px-2 py-0.5">unassigned</span>}
          {task.assignees
            .filter((a) => a !== task.lead)
            .map((a) => (
              <AgentAvatar key={a} id={a} size={20} />
            ))}
          {task.env_id ? <span className="rounded-md bg-white/5 px-1.5 py-0.5 font-mono">{task.env_id}</span> : null}
          <span className="rounded-md bg-white/5 px-1.5 py-0.5 capitalize">{task.kind}</span>
          <span className="ml-auto">{relTime(task.created_at, now)}</span>
        </div>
        {task.steps_total > 0 ? (
          <div className="mt-2">
            <Progress value={(task.steps_done / task.steps_total) * 100} color={accent} label={`${task.steps_done} of ${task.steps_total} steps`} />
          </div>
        ) : null}
      </button>
      <div className="mt-2 flex items-center gap-2">
        <TaskStateSelect task={task} className="block flex-1" />
        {running ? <CancelTaskButton task={task} /> : null}
      </div>
    </article>
  );
}

export function TasksBoard() {
  const tasks = useAzzy((s) => s.tasks);
  const hydrated = useAzzy((s) => s.hydrated);
  const [openId, setOpenId] = useState<string | null>(null);
  const now = useNow(15_000);

  const byState = useMemo(() => {
    const map = new Map<PipelineState, Task[]>();
    for (const s of [...PIPELINE_ORDER, "failed", "cancelled"] as PipelineState[]) map.set(s, []);
    for (const t of tasks) map.get(t.state)?.push(t);
    return map;
  }, [tasks]);

  const extras = (["failed", "cancelled"] as PipelineState[]).filter((s) => (byState.get(s)?.length ?? 0) > 0);
  const columns: PipelineState[] = [...PIPELINE_ORDER, ...extras];
  const active = tasks.filter((t) => !PIPELINE_TERMINAL.includes(t.state)).length;

  return (
    <div>
      <PageHeader title="Tasks" subtitle={`${active} active · ${tasks.length} total · needs_work → needs_review → needs_qa → needs_docs → ready → needs_human → done`} />
      {!hydrated && tasks.length === 0 ? (
        <div className="grid gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : (
        <div className="snap-x-cols -mx-4 flex gap-3 overflow-x-auto px-4 pb-3 md:mx-0 md:px-0" role="list" aria-label="Pipeline columns">
          {columns.map((state) => {
            const items = byState.get(state) ?? [];
            return (
              <section key={state} role="listitem" data-testid={`pipeline-column-${state}`} className="flex w-[82vw] shrink-0 flex-col rounded-2xl border border-line bg-black/20 sm:w-72 md:w-64 lg:w-[calc((100%-6*0.75rem)/7)] lg:min-w-[13rem]">
                <header className="flex items-center justify-between border-b border-line px-3 py-2">
                  <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-200">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PIPELINE_ACCENTS[state] }} aria-hidden />
                    {PIPELINE_LABELS[state]}
                  </h2>
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-400" aria-label={`${items.length} tasks`}>
                    {items.length}
                  </span>
                </header>
                <div className="flex max-h-[70svh] flex-col gap-2 overflow-y-auto p-2">
                  {items.length === 0 ? <p className="px-2 py-6 text-center text-[11px] text-slate-600">Nothing here</p> : items.map((t) => <TaskCard key={t.id} task={t} now={now} onOpen={setOpenId} />)}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {hydrated && tasks.length === 0 ? <EmptyState className="mt-4" title="No tasks yet" hint='Type a command above, e.g. "Investigate my failing ECS deployment…", and it will appear in Needs work.' /> : null}
      <TaskDrawer taskId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
