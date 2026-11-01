"use client";

import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";
import { AGENT_META, type Incident } from "@azzy/events";
import { api, ApiError } from "@/lib/api";
import { clock, relTime } from "@/lib/format";
import { can, useAzzy } from "@/store/useAzzy";
import { AgentAvatar } from "./AgentChip";
import { Button } from "./Button";

const STATUS_COLOR: Record<Incident["status"], string> = { open: "#ef4444", investigating: "#f97316", mitigating: "#FFB547", resolved: "#34D399" };
const SEV_STYLE: Record<Incident["severity"], string> = {
  sev1: "bg-rose-500/20 text-rose-200 border-rose-500/40",
  sev2: "bg-amber-500/20 text-amber-200 border-amber-500/40",
  sev3: "bg-sky-500/20 text-sky-200 border-sky-500/40",
};

export function IncidentCard({ incident, now, compact }: { incident: Incident; now: number; compact?: boolean }) {
  const toast = useAzzy((s) => s.toast);
  const me = useAzzy((s) => s.me);
  const upsertIncident = useAzzy((s) => s.upsertIncident);
  const [busy, setBusy] = useState(false);
  const open = incident.status !== "resolved";
  const color = STATUS_COLOR[incident.status];
  const writable = can(me, "write");

  const resolve = async () => {
    setBusy(true);
    try {
      const res = await api.incidents.resolve(incident.id);
      upsertIncident(res);
      toast({ tone: "success", title: "Incident resolved", body: incident.title });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Could not resolve", body: err instanceof ApiError ? err.message : "Network error" });
    } finally {
      setBusy(false);
    }
  };

  const timeline = compact ? incident.timeline.slice(-3) : incident.timeline;
  return (
    <article data-testid="incident-card" data-incident-id={incident.id} data-status={incident.status} className={clsx("rounded-2xl border bg-midnight/80 p-4 shadow-glass", open ? "border-brand-magenta/40" : "border-line")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize" style={{ borderColor: `${color}66`, color, backgroundColor: `${color}14` }}>
          <span className={clsx("h-1.5 w-1.5 rounded-full", open && "animate-pulseDot")} style={{ backgroundColor: color }} />
          {incident.status}
        </span>
        <span className={clsx("rounded-md border px-1.5 py-0.5 text-[11px] font-bold uppercase", SEV_STYLE[incident.severity])}>{incident.severity}</span>
        <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[11px] text-slate-300">{incident.source}</span>
        {incident.env_id ? <span className="rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-slate-300">{incident.env_id}</span> : null}
        <span className="ml-auto text-[11px] text-slate-500">opened {relTime(incident.created_at, now)}</span>
      </div>
      <h3 className="mt-2 text-base font-semibold text-white">{incident.title}</h3>
      <ol className="mt-3 space-y-2 border-l border-line pl-4" aria-label="Timeline">
        {incident.timeline.length === 0 ? <li className="text-xs text-slate-500">War room is assembling…</li> : null}
        {timeline.map((e, i) => (
          <li key={`${e.ts}-${i}`} className="relative text-xs">
            <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-midnight" style={{ backgroundColor: e.agent ? AGENT_META[e.agent].color : "#64748b" }} aria-hidden />
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              {e.agent ? (
                <span className="flex items-center gap-1">
                  <AgentAvatar id={e.agent} size={14} /> {AGENT_META[e.agent].name}
                </span>
              ) : (
                <span>Azzy</span>
              )}
              <span>{clock(e.ts)}</span>
            </div>
            <p className="text-slate-200">{e.text}</p>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        {incident.task_id ? (
          <Link href={`/app/tasks/${incident.task_id}`} className="font-mono hover:text-brand-cyan">
            task {incident.task_id.slice(0, 8)} →
          </Link>
        ) : null}
        {incident.resolved_at ? <span>resolved {relTime(incident.resolved_at, now)}</span> : null}
        {open ? (
          <Button variant="success" size="sm" className="ml-auto" loading={busy} onClick={resolve} disabled={!writable} title={!writable ? "Read-only role" : undefined} aria-label={`Resolve incident ${incident.title}`} data-testid="incident-resolve">
            Mark resolved
          </Button>
        ) : null}
      </div>
    </article>
  );
}
