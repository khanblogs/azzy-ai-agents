"use client";

import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";
import type { Approval } from "@azzy/events";
import { api, ApiError } from "@/lib/api";
import { countdown, relTime, safeJson } from "@/lib/format";
import { can, useAzzy } from "@/store/useAzzy";
import { AgentChip } from "./AgentChip";
import { Button } from "./Button";
import { RiskBadge } from "./RiskBadge";

const STATUS_STYLE: Record<Approval["status"], string> = {
  pending: "text-amber-300 bg-amber-500/10 border-amber-500/30",
  approved: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
  rejected: "text-rose-300 bg-rose-500/10 border-rose-500/30",
  expired: "text-slate-400 bg-white/5 border-line",
};

export function useApprovalActions() {
  const toast = useAzzy((s) => s.toast);
  const upsertApproval = useAzzy((s) => s.upsertApproval);
  const decideOptimistic = useAzzy((s) => s.decideApprovalOptimistic);
  const [busyId, setBusyId] = useState<string | null>(null);

  const decide = async (approval: Approval, kind: "approve" | "reject", reason?: string) => {
    if (busyId) return;
    setBusyId(approval.id);
    decideOptimistic(approval.id, kind === "approve" ? "approved" : "rejected");
    try {
      const res = kind === "approve" ? await api.approvals.approve(approval.id) : await api.approvals.reject(approval.id, reason);
      upsertApproval(res);
      toast({ tone: kind === "approve" ? "success" : "info", title: `${kind === "approve" ? "Approved" : "Rejected"} ${approval.tool}`, body: approval.summary });
    } catch (err) {
      upsertApproval(approval);
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Decision failed", body: err instanceof ApiError ? err.message : "Network error" });
    } finally {
      setBusyId(null);
    }
  };
  return { decide, busyId };
}

export function ApprovalCard({ approval, now, compact }: { approval: Approval; now: number; compact?: boolean }) {
  const { decide, busyId } = useApprovalActions();
  const me = useAzzy((s) => s.me);
  const allowed = can(me, "approve", { agent: approval.agent });
  const denyReason = !allowed ? `Your role (${me?.role ?? "?"}) cannot decide approvals raised by ${approval.agent}` : undefined;
  const pending = approval.status === "pending";
  const busy = busyId === approval.id;
  const expiresIn = countdown(approval.expires_at, now);
  return (
    <article
      data-testid="approval-card"
      data-task-id={approval.task_id}
      data-approval-id={approval.id}
      data-status={approval.status}
      className={clsx(
        "rounded-2xl border bg-panel/80 p-4 shadow-glass",
        pending ? "border-rose-500/40 ring-1 ring-rose-500/20" : "border-line",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <RiskBadge risk={approval.risk} />
        <span className="font-mono text-sm font-semibold text-cyan-200">{approval.tool}</span>
        {approval.env_id ? <span className="rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-slate-300">{approval.env_id}</span> : null}
        <span className={clsx("ml-auto rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize", STATUS_STYLE[approval.status])}>{approval.status}</span>
      </div>
      <p className="mt-2 text-sm text-slate-100">{approval.summary}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
        <AgentChip id={approval.agent} />
        <span>requested {relTime(approval.created_at, now)}</span>
        {pending ? (
          <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5", expiresIn === "expired" ? "bg-rose-500/20 text-rose-200" : "bg-white/5")} aria-live="polite">
            <CountdownRing createdAt={approval.created_at} expiresAt={approval.expires_at} now={now} />
            expires in {expiresIn}
          </span>
        ) : approval.decided_at ? (
          <span>
            decided {relTime(approval.decided_at, now)}
            {approval.decided_by ? ` by ${approval.decided_by}` : ""}
          </span>
        ) : null}
        <Link href={`/app/tasks/${approval.task_id}`} className="font-mono text-slate-500 hover:text-brand-cyan">
          task {approval.task_id.slice(0, 8)}
        </Link>
      </div>
      {!compact ? (
        <details className="mt-2 text-xs" open={pending}>
          <summary className="cursor-pointer text-slate-400">Arguments</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-black/40 p-3 font-mono text-[11px] text-slate-200">{safeJson(approval.args)}</pre>
        </details>
      ) : null}
      {pending ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="success" size="lg" data-testid="approve-btn" aria-label={`Approve ${approval.tool}`} loading={busy} disabled={!allowed} title={denyReason} onClick={() => decide(approval, "approve")}>
            Approve
          </Button>
          <Button variant="danger" size="lg" data-testid="reject-btn" aria-label={`Reject ${approval.tool}`} loading={busy} disabled={!allowed} title={denyReason} onClick={() => decide(approval, "reject")}>
            Reject
          </Button>
        </div>
      ) : null}
    </article>
  );
}

function CountdownRing({ createdAt, expiresAt, now }: { createdAt: string; expiresAt: string; now: number }) {
  const start = Date.parse(createdAt);
  const end = Date.parse(expiresAt);
  const frac = Number.isNaN(start) || Number.isNaN(end) || end <= start ? 0 : Math.max(0, Math.min(1, (end - now) / (end - start)));
  const r = 5;
  const c = 2 * Math.PI * r;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="-rotate-90">
      <circle cx="7" cy="7" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="2" />
      <circle cx="7" cy="7" r={r} fill="none" stroke={frac < 0.2 ? "#F04DFF" : "#FFB547"} strokeWidth="2" strokeDasharray={`${c * frac} ${c}`} strokeLinecap="round" />
    </svg>
  );
}
