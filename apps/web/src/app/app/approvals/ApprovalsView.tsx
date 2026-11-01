"use client";

import { useMemo } from "react";
import { ApprovalCard } from "@/components/ApprovalCard";
import { PageHeader } from "@/components/Card";
import { EmptyState, Skeleton } from "@/components/EmptyState";
import { useNow } from "@/lib/useNow";
import { useAzzy } from "@/store/useAzzy";

export function ApprovalsView() {
  const approvals = useAzzy((s) => s.approvals);
  const hydrated = useAzzy((s) => s.hydrated);
  const me = useAzzy((s) => s.me);
  const now = useNow(1000);
  const pending = useMemo(() => approvals.filter((a) => a.status === "pending"), [approvals]);
  const history = useMemo(() => approvals.filter((a) => a.status !== "pending"), [approvals]);

  return (
    <div>
      <PageHeader
        title="Approvals"
        subtitle={`Medium and high-risk tool calls wait here until a permitted role decides. Agents block for up to an hour.${me ? ` You are signed in as ${me.role}.` : ""}`}
      />
      <section aria-labelledby="pending-h" className="mb-8">
        <h2 id="pending-h" className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          Pending
          <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[11px] text-rose-200">{pending.length}</span>
        </h2>
        {!hydrated ? (
          <Skeleton className="h-40" />
        ) : pending.length === 0 ? (
          <EmptyState title="Nothing waiting on you" hint="When an agent hits a risky action (prod deploy, rollback, client email) it shows up here and in its speech bubble." />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {pending.map((a) => (
              <ApprovalCard key={a.id} approval={a} now={now} />
            ))}
          </div>
        )}
      </section>
      <section aria-labelledby="history-h">
        <h2 id="history-h" className="mb-3 text-sm font-semibold text-white">
          History <span className="text-xs font-normal text-slate-500">last {history.length}</span>
        </h2>
        {!hydrated ? (
          <Skeleton className="h-24" />
        ) : history.length === 0 ? (
          <EmptyState title="No decisions yet" hint="Approved, rejected and expired requests are kept here and in the audit log." />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {history.map((a) => (
              <ApprovalCard key={a.id} approval={a} now={now} compact />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
