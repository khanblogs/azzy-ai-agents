import clsx from "clsx";
import Link from "next/link";
import { AGENT_META, type AgentId } from "@azzy/events";

export function AgentAvatar({ id, size = 24, className }: { id: AgentId; size?: number; className?: string }) {
  const meta = AGENT_META[id];
  const initials = meta.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      className={clsx("inline-flex shrink-0 items-center justify-center rounded-full font-bold text-black", className)}
      style={{ width: size, height: size, backgroundColor: meta.color, fontSize: Math.max(9, size * 0.42) }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

export function AgentChip({
  id,
  link = true,
  size = "sm",
  className,
  suffix,
}: {
  id: AgentId;
  link?: boolean;
  size?: "sm" | "md";
  className?: string;
  suffix?: string;
}) {
  const meta = AGENT_META[id];
  const inner = (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border border-line bg-white/5 pr-2",
        size === "sm" ? "h-6 pl-0.5 text-[11px]" : "h-8 pl-1 text-sm",
        link && "hover:bg-white/10",
        className,
      )}
    >
      <AgentAvatar id={id} size={size === "sm" ? 20 : 24} />
      <span className="text-slate-200">{meta.name}</span>
      {suffix ? <span className="text-slate-500">{suffix}</span> : null}
    </span>
  );
  return link ? (
    <Link href={`/agents/${id}`} aria-label={`Open ${meta.name} profile`}>
      {inner}
    </Link>
  ) : (
    inner
  );
}
