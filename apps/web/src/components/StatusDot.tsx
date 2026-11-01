import clsx from "clsx";

export function StatusDot({
  color,
  label,
  pulse,
  size = 8,
  className,
}: {
  color: string;
  label: string;
  pulse?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5", className)} role="status" aria-label={label} title={label}>
      <span
        className={clsx("inline-block rounded-full", pulse && "animate-pulseDot")}
        style={{ width: size, height: size, backgroundColor: color, boxShadow: `0 0 ${size}px ${color}66` }}
      />
    </span>
  );
}

export function StatusPill({ color, label, className }: { color: string; label: string; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        className,
      )}
      style={{ borderColor: `${color}55`, color, backgroundColor: `${color}14` }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
