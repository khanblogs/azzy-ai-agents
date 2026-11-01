import clsx from "clsx";
import type { ReactNode } from "react";

export function EmptyState({ title, hint, action, className }: { title: string; hint: string; action?: ReactNode; className?: string }) {
  return (
    <div
      className={clsx(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 py-10 text-center",
        className,
      )}
    >
      <div className="mb-2 h-2 w-2 rounded-full bg-slate-600" aria-hidden />
      <p className="text-sm font-medium text-slate-200">{title}</p>
      <p className="mt-1 max-w-sm text-xs text-slate-500">{hint}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton-shimmer rounded-xl bg-white/5", className)} aria-hidden />;
}
