import clsx from "clsx";
import type { RiskLevel } from "@azzy/events";
import { RISK_COLORS } from "@/lib/status";

export function RiskBadge({ risk, className }: { risk: RiskLevel; className?: string }) {
  const c = RISK_COLORS[risk];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ring-1",
        c.bg,
        c.fg,
        c.ring,
        className,
      )}
      aria-label={`Risk ${risk}`}
    >
      {risk === "high" ? "▲" : risk === "medium" ? "■" : "●"} {risk}
    </span>
  );
}
