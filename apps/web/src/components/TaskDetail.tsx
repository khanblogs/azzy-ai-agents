"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AGENT_META, PIPELINE_ORDER, type AgentMessage, type PipelineState, type Task } from "@azzy/events";
import { api, ApiError } from "@/lib/api";
import { clock, relTime, safeJson, titleCase } from "@/lib/format";
import { PIPELINE_ACCENTS, PIPELINE_LABELS, PIPELINE_TERMINAL } from "@/lib/status";
import type { TaskDetail as TaskDetailData } from "@/lib/types";
import { can, useAzzy } from "@/store/useAzzy";
import { AgentAvatar, AgentChip } from "./AgentChip";
import { Button } from "./Button";
import { Drawer } from "./Drawer";
import { EmptyState, Skeleton } from "./EmptyState";
import { IconStop } from "./Icons";
import { Progress } from "./KV";
import { Tabs } from "./Tabs";
import { ToolLogList } from "./ToolLogList";

const MOVE_STATES: PipelineState[] = [...PIPELINE_ORDER, "failed", "cancelled"];

export function TaskStateSelect({ task, className, testId = "task-move" }: { task: Task; className?: string; testId?: string }) {
  const toast = useAzzy((s) => s.toast);
  const upsertTask = useAzzy((s) => s.upsertTask);
  const me = useAzzy((s) => s.me);
  const [busy, setBusy] = useState(false);
  const allowed = can(me, "write");
  const onChange = async (state: PipelineState) => {
    if (state === task.state) return;
    setBusy(true);
    const prev = task;
    upsertTask({ ...task, state });
    try {
      const updated = await api.tasks.move(task.id, state);
      upsertTask(updated);
      toast({ tone: "success", title: `Moved to ${PIPELINE_LABELS[state]}`, body: task.title });
    } catch (err) {
      upsertTask(prev);
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Move failed", body: err instanceof ApiError ? err.message : "Network error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <label className={className} title={!allowed ? "Read-only role cannot move tasks" : undefined}>
      <span className="sr-only">Move task to state</span>
      <select
        data-testid={testId}
        aria-label={`Move "${task.title}" to another state`}
        value={task.state}
        disabled={busy || !allowed}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => void onChange(e.target.value as PipelineState)}
        className="h-7 w-full rounded-lg border border-line bg-navy px-2 text-[11px] text-slate-200 focus:border-brand-cyan/60 focus:outline-none disabled:opacity-50"
      >
        {MOVE_STATES.map((s) => (
          <option key={s} value={s}>
            {PIPELINE_LABELS[s]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CancelTaskButton({ task, size = "sm" }: { task: Task; size?: "sm" | "md" }) {
  const toast = useAzzy((s) => s.toast);
  const upsertTask = useAzzy((s) => s.upsertTask);
  const me = useAzzy((s) => s.me);
  const [busy, setBusy] = useState(false);
  const terminal = PIPELINE_TERMINAL.includes(task.state);
  const allowed = can(me, "cancel", { task });
  const reason = terminal ? "Task already finished" : !allowed ? "Only the creator, an admin or the lead's domain role can cancel" : undefined;
  const cancel = async () => {
    if (!window.confirm(`Cancel "${task.title}"? Running steps stop and pending approvals expire.`)) return;
    setBusy(true);
    try {
      const t = await api.tasks.cancel(task.id);
      upsertTask(t);
      toast({ tone: "info", title: "Task cancelled", body: task.title });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Cancel failed", body: err instanceof ApiError ? err.message : "Network error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size={size} variant="danger" data-testid="task-cancel" aria-label={`Cancel task ${task.title}`} onClick={cancel} loading={busy} disabled={terminal || !allowed} title={reason} icon={<IconStop width={14} height={14} />}>
      Cancel
    </Button>
  );
}

const TYPE_COLORS: Record<AgentMessage["type"], string> = {
  handoff: "#00E5FF",
  request: "#FFB547",
  result: "#34D399",
  note: "#94a3b8",
  escalation: "#F04DFF",
};

export function AgentMessageList({ messages, emptyHint }: { messages: AgentMessage[]; emptyHint: string }) {
  if (messages.length === 0) return <EmptyState title="No agent messages yet" hint={emptyHint} />;
  return (
    <ol className="space-y-2" aria-live="polite">
      {messages.map((m) => (
        <li key={m.id} className="rounded-xl border border-line bg-black/25 p-3 text-xs" data-testid="agent-message">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <AgentChip id={m.from_agent} link={false} />
            <span className="text-slate-500">→</span>
            {m.to_agent ? <AgentChip id={m.to_agent} link={false} /> : <span className="rounded-full bg-white/5 px-2 py-0.5 text-slate-300">task room</span>}
            <span className="rounded-md px-1.5 py-0.5 font-semibold uppercase tracking-wider" style={{ color: TYPE_COLORS[m.type], backgroundColor: `${TYPE_COLORS[m.type]}1a` }}>
              {m.type}
            </span>
            <span className="ml-auto text-slate-500">
              {m.status} · {clock(m.created_at)}
            </span>
          </div>
          <p className="mt-1.5 line-clamp-4 break-words text-slate-100">{m.content}</p>
          {m.artifacts.length > 0 ? (
            <ul className="mt-1.5 flex flex-wrap gap-1">
              {m.artifacts.map((a, i) => (
                <li key={`${a.ref}-${i}`} className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-slate-300" title={a.ref}>
                  {a.kind}: {a.label}
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

type Tab = "overview" | "messages" | "log" | "memories";

export function TaskDetailView({ taskId, initialTab = "overview" }: { taskId: string; initialTab?: Tab }) {
  const liveTask = useAzzy((s) => s.tasks.find((t) => t.id === taskId));
  const liveMessages = useAzzy((s) => s.agentMessages);
  const [detail, setDetail] = useState<TaskDetailData | null>(null);
  const [messages, setMessages] = useState<AgentMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    let alive = true;
    api.tasks
      .get(taskId)
      .then((d) => alive && setDetail(d))
      .catch((e: unknown) => alive && setError(e instanceof ApiError ? e.message : "Failed to load task"));
    api.tasks
      .messages(taskId)
      .then((m) => alive && setMessages(m))
      .catch(() => alive && setMessages([]));
    return () => {
      alive = false;
    };
  }, [taskId, liveTask?.state, liveTask?.steps_done]);

  const merged = useMemo(() => {
    const map = new Map<string, AgentMessage>();
    for (const m of messages ?? []) map.set(m.id, m);
    for (const m of liveMessages) if (m.task_id === taskId) map.set(m.id, m);
    return Array.from(map.values()).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  }, [messages, liveMessages, taskId]);

  const task = liveTask ?? detail?.task ?? null;
  if (!task) {
    return error ? (
      <p className="text-sm text-rose-300">{error}</p>
    ) : (
      <div className="space-y-2">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  const accent = PIPELINE_ACCENTS[task.state];
  const progress = task.steps_total > 0 ? (task.steps_done / task.steps_total) * 100 : PIPELINE_TERMINAL.includes(task.state) ? 100 : 0;

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `${accent}22`, color: accent }}>
          {PIPELINE_LABELS[task.state]}
        </span>
        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-300">{titleCase(task.kind)}</span>
        {task.env_id ? <span className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[11px] text-slate-300">{task.env_id}</span> : null}
        <span className="text-[11px] text-slate-500">created {relTime(task.created_at)}</span>
        {task.created_by ? <span className="text-[11px] text-slate-500">by {task.created_by}</span> : null}
        {task.xp_awarded ? <span className="text-[11px] text-emerald-300">+{task.xp_awarded} XP</span> : null}
        <span className="ml-auto">
          <CancelTaskButton task={task} />
        </span>
      </div>
      {task.steps_total > 0 ? (
        <div>
          <div className="mb-1 flex justify-between text-[11px] text-slate-400">
            <span>Steps</span>
            <span>
              {task.steps_done} / {task.steps_total}
            </span>
          </div>
          <Progress value={progress} color={accent} label="Task progress" />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {task.lead ? <AgentChip id={task.lead} suffix="lead" /> : null}
        {task.assignees
          .filter((a) => a !== task.lead)
          .map((a) => (
            <AgentChip key={a} id={a} />
          ))}
      </div>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        testIdPrefix="task-tab-"
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "messages", label: "Messages", count: merged.length },
          { key: "log", label: "Tool log", count: detail?.log.length },
          { key: "memories", label: "Memories", count: detail?.memories.length },
        ]}
      />
      {tab === "overview" ? (
        <div className="space-y-4">
          <div>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Prompt</h3>
            <p className="rounded-xl bg-black/30 p-3 text-slate-200">{task.prompt}</p>
          </div>
          {task.result ? (
            <div>
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Result</h3>
              <pre className="whitespace-pre-wrap rounded-xl bg-black/30 p-3 font-mono text-xs text-slate-200">{task.result}</pre>
            </div>
          ) : null}
          <div>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Move</h3>
            <TaskStateSelect task={task} className="block w-56" testId="task-move-detail" />
          </div>
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer">Raw task</summary>
            <pre className="mt-2 overflow-x-auto rounded-xl bg-black/30 p-3 font-mono text-[11px] text-slate-300">{safeJson(task)}</pre>
          </details>
        </div>
      ) : null}
      {tab === "messages" ? (
        <div data-testid="task-messages">
          {messages === null ? <Skeleton className="h-20" /> : <AgentMessageList messages={merged} emptyHint="Handoffs, requests and results between agents appear here as the task runs." />}
        </div>
      ) : null}
      {tab === "log" ? (
        !detail ? (
          <Skeleton className="h-20" />
        ) : detail.log.length === 0 ? (
          <EmptyState title="No tool calls yet" hint="Calls appear here as the agent works through the task." />
        ) : (
          <ToolLogList logs={detail.log} />
        )
      ) : null}
      {tab === "memories" ? (
        !detail ? (
          <Skeleton className="h-12" />
        ) : detail.memories.length === 0 ? (
          <EmptyState title="Nothing learned yet" hint="Agents write 1–3 durable memories when a task finishes." />
        ) : (
          <ul className="space-y-2">
            {detail.memories.map((m) => (
              <li key={m.id} className="rounded-xl border border-line bg-black/20 p-3 text-xs">
                <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-500">
                  <AgentAvatar id={m.agent} size={16} /> {AGENT_META[m.agent].name}
                  <span className="rounded bg-white/5 px-1.5 py-0.5">{m.kind}</span>
                  <span>{clock(m.created_at)}</span>
                </div>
                <p className="text-slate-200">{m.text}</p>
              </li>
            ))}
          </ul>
        )
      ) : null}
      <div className="text-right text-[11px]">
        <Link href={`/app/tasks/${task.id}`} className="text-brand-cyan hover:underline">
          Open full page →
        </Link>
      </div>
    </div>
  );
}

export function TaskDrawer({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  const title = useAzzy((s) => (taskId ? s.tasks.find((t) => t.id === taskId)?.title : undefined));
  return (
    <Drawer open={Boolean(taskId)} onClose={onClose} title={title ?? "Task"}>
      {taskId ? <TaskDetailView taskId={taskId} /> : null}
    </Drawer>
  );
}
