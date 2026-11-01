export function Sparkline({ values, color = "#00E5FF", width = 120, height = 32, className, label }: { values: number[]; color?: string; width?: number; height?: number; className?: string; label: string }) {
  const v = values.length > 1 ? values : [0, ...values];
  const max = Math.max(0.0001, ...v);
  const min = Math.min(0, ...v);
  const span = max - min || 1;
  const pts = v.map((y, i) => [(i / (v.length - 1)) * (width - 2) + 1, height - 2 - ((y - min) / span) * (height - 4)] as const);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${d} L${pts[pts.length - 1][0].toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`;
  const gid = `sg-${color.replace("#", "")}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} role="img" aria-label={label}>
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.2" fill={color} />
    </svg>
  );
}
