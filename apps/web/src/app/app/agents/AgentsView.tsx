"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AGENT_IDS, AGENT_META, type AgentId } from "@azzy/events";
import { AgentAvatar } from "@/components/AgentChip";
import { Card, PageHeader } from "@/components/Card";
import { Skeleton } from "@/components/EmptyState";
import { Progress } from "@/components/KV";
import { StatusDot } from "@/components/StatusDot";
import { api } from "@/lib/api";
import { usd } from "@/lib/format";
import { deriveStatus, PHASE_LABELS, STATUS_COLORS, STATUS_LABELS } from "@/lib/status";
import type { TeamRow } from "@/lib/types";
import { pendingApprovalFor, useAzzy } from "@/store/useAzzy";

const BLURB: Record<AgentId, string> = {
  jimmy: "AWS multi-account, ECS/EKS, Terraform, CI/CD, rollbacks and cloud cost. Leads incidents and deployments.",
  emir: "Reviews, debugs and fixes code with tests, opens PRs (never main), analyses data and evaluates models.",
  cyber: "SAST, secrets, IaC and container scans, IAM review, VAPT on authorised targets, release gates and audits.",
  sara: "Operations: KPI reports, planning, incident summaries, tickets, budgets and process automation.",
  marwah: "Marketing: campaigns, content, positioning, growth reports and launch plans.",
};

function AgentCard({ id, team }: { id: AgentId; team?: TeamRow }) {
  const a = useAzzy((s) => s.agents[id]);
  const bubble = useAzzy((s) => s.bubbles[id]);
  const approvals = useAzzy((s) => s.approvals);
  const pending = pendingApprovalFor(approvals, id);
  const status = deriveStatus({ phase: a.phase, arrived: true, hasBubble: Boolean(bubble), hasPendingApproval: Boolean(pending) });
  const meta = AGENT_META[id];
  const budgetPct = a.daily_budget_usd > 0 ? (a.today_usd / a.daily_budget_usd) * 100 : 0;
  return (
    <Link href={`/app/agents/${id}`} data-testid={`agent-card-${id}`} className="block transition hover:-translate-y-px">
      <Card className="relative h-full overflow-hidden p-4 hover:border-white/20">
        <span className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-20 blur-2xl" style={{ backgroundColor: meta.color }} aria-hidden />
        <div className="flex items-start gap-3">
          <AgentAvatar id={id} size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-white">{meta.name}</h2>
              <StatusDot color={STATUS_COLORS[status]} label={STATUS_LABELS[status]} pulse={status === "approval"} />
              <span className="text-[11px] text-slate-400">{STATUS_LABELS[status]}</span>
            </div>
            <p className="text-xs" style={{ color: meta.color }}>
              {meta.role}
            </p>
          </div>
          <span className="rounded-md border border-brand-gold/40 bg-brand-gold/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-gold">{a.rank}</span>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-300">{BLURB[id]}</p>
        <p className="mt-2 truncate text-[11px] text-slate-500">
          {PHASE_LABELS[a.phase]}
          {a.detail ? ` · ${a.detail}` : ""}
          {bubble ? ` · “${bubble.text}”` : ""}
        </p>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-lg bg-white/5 p-2">
            <dt className="text-[10px] uppercase tracking-wider text-slate-500">XP</dt>
            <dd className="font-semibold text-white">{a.xp}</dd>
          </div>
          <div className="rounded-lg bg-white/5 p-2">
            <dt className="text-[10px] uppercase tracking-wider text-slate-500">Done</dt>
            <dd className="font-semibold text-white">{a.tasks_done}</dd>
          </div>
          <div className="rounded-lg bg-white/5 p-2">
            <dt className="text-[10px] uppercase tracking-wider text-slate-500">Approvals</dt>
            <dd className="font-semibold text-white">{team?.approvals_requested ?? "—"}</dd>
          </div>
        </dl>
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-[11px] text-slate-400">
            <span>Spend today</span>
            <span>
              {usd(a.today_usd)} / {usd(a.daily_budget_usd, 0)}
            </span>
          </div>
          <Progress value={budgetPct} color={budgetPct > 85 ? "#F04DFF" : meta.color} label={`${meta.name} budget used`} />
        </div>
        {pending ? <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-200">Waiting for approval: {pending.tool}</p> : null}
      </Card>
    </Link>
  );
}

export function AgentsView() {
  const hydrated = useAzzy((s) => s.hydrated);
  const [team, setTeam] = useState<TeamRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .team()
      .then((t) => alive && setTeam(t))
      .catch(() => alive && setTeam([]));
    return () => {
      alive = false;
    };
  }, []);
  const agents = useAzzy((s) => s.agents);
  const ranked = AGENT_IDS.slice().sort((a, b) => agents[b].xp - agents[a].xp);

  return (
    <div>
      <PageHeader title="Agents" subtitle="Five specialists plus the Azzy Orchestrator. Open a profile to chat, inspect tools, memories and the live sandbox log." />
      {!hydrated ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {AGENT_IDS.map((id) => (
            <Skeleton key={id} className="h-64" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {AGENT_IDS.map((id) => (
            <AgentCard key={id} id={id} team={team?.find((t) => t.agent === id)} />
          ))}
        </div>
      )}
      <Card className="mt-6">
        <div className="px-4 pt-4 pb-2">
          <h2 className="text-sm font-semibold text-white">Leaderboard</h2>
          <p className="text-xs text-slate-400">XP: +25 per task done, +10 per approved risky action, +5 per memory.</p>
        </div>
        <div className="overflow-x-auto px-2 pb-3">
          <table className="w-full min-w-[520px] text-left text-xs">
            <thead className="text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-2 py-1.5">#</th>
                <th className="px-2 py-1.5">Agent</th>
                <th className="px-2 py-1.5">Rank</th>
                <th className="px-2 py-1.5 text-right">XP</th>
                <th className="px-2 py-1.5 text-right">Tasks done</th>
                <th className="px-2 py-1.5 text-right">Approvals</th>
                <th className="px-2 py-1.5 text-right">Spend today</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((id, i) => {
                const a = agents[id];
                const row = team?.find((t) => t.agent === id);
                return (
                  <tr key={id} className="border-t border-line text-slate-200">
                    <td className="px-2 py-2 text-slate-500">{i + 1}</td>
                    <td className="px-2 py-2">
                      <Link href={`/app/agents/${id}`} className="flex items-center gap-2 hover:text-brand-cyan">
                        <AgentAvatar id={id} size={20} /> {a.name}
                      </Link>
                    </td>
                    <td className="px-2 py-2">
                      <span className="rounded-md border border-brand-gold/40 bg-brand-gold/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-gold">{a.rank}</span>
                    </td>
                    <td className="px-2 py-2 text-right font-mono">{a.xp}</td>
                    <td className="px-2 py-2 text-right font-mono">{a.tasks_done}</td>
                    <td className="px-2 py-2 text-right font-mono">{row?.approvals_requested ?? "—"}</td>
                    <td className="px-2 py-2 text-right font-mono">{usd(a.today_usd)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
