"use client";

import { useState } from "react";
import { Html } from "@react-three/drei";
import { AGENT_META, type AgentId, type Approval } from "@azzy/events";
import { api, ApiError } from "@/lib/api";
import { STATUS_COLORS, STATUS_LABELS, type VisualStatus } from "@/lib/status";
import { can, useAzzy } from "@/store/useAzzy";
import { RiskBadge } from "@/components/RiskBadge";

export function NameTag({ id, status, position }: { id: AgentId; status: VisualStatus; position: [number, number, number] }) {
  const meta = AGENT_META[id];
  const color = STATUS_COLORS[status];
  return (
    <Html position={position} center distanceFactor={11} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }} wrapperClass="office-tag">
      <div
        className="flex select-none items-center gap-2 whitespace-nowrap rounded-full border border-white/10 bg-[#0B1025]/80 py-1 pl-2 pr-3 text-[11px] text-white shadow-glass backdrop-blur"
        role="status"
        aria-label={`${meta.name} (${meta.short}): ${STATUS_LABELS[status]}`}
      >
        <span className={status === "approval" ? "inline-block h-2 w-2 rounded-full animate-pulseDot" : "inline-block h-2 w-2 rounded-full"} style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }} />
        <span className="leading-tight">
          <span className="block font-semibold" style={{ color: meta.color }}>
            {meta.name}
          </span>
          {status !== "working" && status !== "idle" ? (
            <span className="block text-[9px] uppercase tracking-wider text-slate-400">{STATUS_LABELS[status]}</span>
          ) : null}
        </span>
      </div>
    </Html>
  );
}

export function SpeechBubble({
  id,
  text,
  approval,
  position,
}: {
  id: AgentId;
  text: string | null;
  approval: Approval | undefined;
  position: [number, number, number];
}) {
  const toast = useAzzy((s) => s.toast);
  const upsertApproval = useAzzy((s) => s.upsertApproval);
  const decideOptimistic = useAzzy((s) => s.decideApprovalOptimistic);
  const me = useAzzy((s) => s.me);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  if (!text && !approval) return null;
  const meta = AGENT_META[id];
  const allowed = can(me, "approve", { agent: id });

  const decide = async (kind: "approve" | "reject") => {
    if (!approval || busy) return;
    setBusy(kind);
    decideOptimistic(approval.id, kind === "approve" ? "approved" : "rejected");
    try {
      const res = kind === "approve" ? await api.approvals.approve(approval.id) : await api.approvals.reject(approval.id);
      upsertApproval(res);
      toast({ tone: kind === "approve" ? "success" : "info", title: `${kind === "approve" ? "Approved" : "Rejected"}: ${approval.tool}` });
    } catch (err) {
      upsertApproval(approval);
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Decision failed", body: err instanceof ApiError ? err.message : "Network error" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Html position={position} center distanceFactor={10} zIndexRange={[30, 0]} wrapperClass="office-bubble">
      <div
        data-testid={`agent-bubble-${id}`}
        className="bubble-arrow relative w-[210px] max-w-[70vw] rounded-2xl border border-white/10 bg-[#0B1025]/95 px-3 py-2 text-left text-[12px] leading-snug text-slate-100 shadow-glass backdrop-blur"
        style={{ touchAction: "manipulation" }}
        role="dialog"
        aria-label={`${meta.name} says`}
      >
        <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: meta.color }}>
          {meta.name}
        </div>
        {text && !approval ? <p className="break-words">{text}</p> : null}
        {approval ? (
          <div className="mt-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] text-rose-100">{approval.tool}</span>
              <RiskBadge risk={approval.risk} />
            </div>
            <p className="mt-1 text-[11px] text-slate-200">{approval.summary}</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                data-testid="approve-btn"
                aria-label={`Approve ${approval.tool}`}
                onClick={() => decide("approve")}
                disabled={busy !== null || !allowed}
                title={!allowed ? "Your role cannot decide this approval" : undefined}
                className="h-9 rounded-lg bg-emerald-500 text-[12px] font-semibold text-black hover:bg-emerald-400 disabled:opacity-50"
              >
                {busy === "approve" ? "…" : "Approve"}
              </button>
              <button
                type="button"
                data-testid="reject-btn"
                aria-label={`Reject ${approval.tool}`}
                onClick={() => decide("reject")}
                disabled={busy !== null || !allowed}
                title={!allowed ? "Your role cannot decide this approval" : undefined}
                className="h-9 rounded-lg bg-rose-500 text-[12px] font-semibold text-white hover:bg-rose-400 disabled:opacity-50"
              >
                {busy === "reject" ? "…" : "Reject"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </Html>
  );
}
