import { AGENT_META, PIPELINE_ORDER, type AgentId } from "@azzy/events";
import { usd, uptime as fmtUptime } from "@/lib/format";
import { OFFICE_STATUS_COLORS } from "@/lib/status";
import type { AzzyState } from "@/store/useAzzy";

/*
 * The curved LED wall is a 2560×560 canvas (ticker strip in the bottom 60 px). The wall mesh is
 * ≈ 21.3 × 4.6 world units, so the canvas aspect (4.57) matches the surface and text is not stretched.
 * Everything is sized to read from the default camera: nothing smaller than 22 px on the canvas.
 */
export const WALL_W = 2560;
export const WALL_H = 560;
export const TICKER_H = 60;
const PAD = 48;

export interface WallSnapshot {
  status: AzzyState["office"]["status"];
  note: string;
  counts: Record<string, number>;
  todayUsd: number;
  budgetUsd: number;
  tasksDone: number;
  topRank: string;
  uptimeSec: number;
  updates: { agent: AgentId | null; text: string }[];
  pending: number;
  demo: boolean;
  agents: { name: string; color: string; phase: string; spot: string; usd: number; budget: number }[];
}

export function snapshotFromState(s: AzzyState): WallSnapshot {
  const counts: Record<string, number> = {};
  for (const st of PIPELINE_ORDER) counts[st] = 0;
  counts.failed = 0;
  for (const t of s.tasks) counts[t.state] = (counts[t.state] ?? 0) + 1;
  const agents = Object.values(s.agents);
  const top = agents.slice().sort((a, b) => b.xp - a.xp)[0];
  const uptimeSec = s.uptimeAt ? s.uptimeSeconds + Math.floor((Date.now() - s.uptimeAt) / 1000) : s.uptimeSeconds;
  return {
    status: s.office.status,
    note: s.office.note,
    counts,
    todayUsd: s.costs.today_usd,
    budgetUsd: s.costs.budget_usd,
    tasksDone: agents.reduce((n, a) => n + a.tasks_done, 0),
    topRank: top ? `${top.rank} · ${top.name.split(" ")[0]}` : "—",
    uptimeSec,
    updates: s.updates.slice(0, 4),
    pending: s.approvals.filter((a) => a.status === "pending").length,
    demo: s.demo,
    agents: agents.map((a) => ({
      name: a.name,
      color: a.color,
      phase: a.phase.replace(/_/g, " "),
      spot: a.spot,
      usd: a.today_usd,
      budget: a.daily_budget_usd,
    })),
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

function pill(ctx: CanvasRenderingContext2D, x: number, cy: number, label: string, color: string, dot = true) {
  ctx.font = `800 28px ${FONT}`;
  const w = ctx.measureText(label).width + (dot ? 78 : 48);
  roundRect(ctx, x, cy - 25, w, 50, 25);
  ctx.fillStyle = `${color}26`;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  if (dot) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + 28, cy, 9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.textAlign = "left";
  ctx.fillStyle = "#f8fafc";
  ctx.fillText(label, x + (dot ? 50 : 24), cy + 1);
  return w;
}

const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** Draws everything except the ticker strip. */
export function paintWall(ctx: CanvasRenderingContext2D, snap: WallSnapshot, now: Date) {
  const W = WALL_W;
  const H = WALL_H - TICKER_H;
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#070b19");
  grad.addColorStop(0.55, "#0b1126");
  grad.addColorStop(1, "#120e26");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // soft light blooms so the panel never reads as flat black
  const bloom = (x: number, y: number, r: number, c: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, c);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  bloom(260, 90, 520, "rgba(0,229,255,0.10)");
  bloom(W - 300, H - 60, 560, "rgba(151,71,255,0.12)");

  // hairline grid
  ctx.strokeStyle = "rgba(255,255,255,0.03)";
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }

  ctx.textBaseline = "middle";

  // ---- header band (y 0–104)
  ctx.textAlign = "left";
  ctx.font = `800 46px ${FONT}`;
  ctx.fillStyle = "#f8fafc";
  ctx.fillText("AZZY AI AGENTS", PAD, 52);
  ctx.font = `600 22px ${FONT}`;
  ctx.fillStyle = "#6b7aa8";
  ctx.fillText(snap.demo ? "V2.0  ·  LIVE WALL  ·  DEMO MODE" : "V2.0  ·  LIVE WALL", PAD + 400, 55);

  const statusColor = OFFICE_STATUS_COLORS[snap.status];
  let px = W / 2 - 160;
  px += pill(ctx, px, 52, snap.status.toUpperCase(), statusColor) + 16;
  if (snap.pending > 0) pill(ctx, px, 52, `${snap.pending} APPROVAL${snap.pending === 1 ? "" : "S"} WAITING`, "#F04DFF");

  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const date = now.toLocaleDateString([], { weekday: "short", day: "2-digit", month: "short" });
  ctx.textAlign = "right";
  ctx.font = `800 58px ${FONT}`;
  ctx.fillStyle = "#f8fafc";
  ctx.fillText(time, W - PAD, 46);
  ctx.font = `600 22px ${FONT}`;
  ctx.fillStyle = "#6b7aa8";
  ctx.fillText(date.toUpperCase(), W - PAD, 88);

  // divider
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.fillRect(PAD, 108, W - PAD * 2, 2);

  // ---- KPI row (y 126–246)
  const tiles: { label: string; value: string; color: string }[] = [
    { label: "NEEDS WORK", value: String(snap.counts.needs_work ?? 0), color: "#00E5FF" },
    { label: "IN REVIEW", value: String(snap.counts.needs_review ?? 0), color: "#9747FF" },
    { label: "IN QA", value: String(snap.counts.needs_qa ?? 0), color: "#F04DFF" },
    { label: "READY", value: String(snap.counts.ready ?? 0), color: "#34D399" },
    { label: "DONE TODAY", value: String(snap.tasksDone), color: "#22c55e" },
    { label: "SPEND TODAY", value: `${usd(snap.todayUsd)} / ${usd(snap.budgetUsd, 0)}`, color: "#FFB547" },
    { label: "UPTIME", value: fmtUptime(snap.uptimeSec), color: "#38bdf8" },
  ];
  const gap = 16;
  const tw = (W - PAD * 2 - gap * (tiles.length - 1)) / tiles.length;
  const ty = 126;
  const th = 120;
  tiles.forEach((t, i) => {
    const x = PAD + i * (tw + gap);
    roundRect(ctx, x, ty, tw, th, 14);
    ctx.fillStyle = "rgba(255,255,255,0.045)";
    ctx.fill();
    ctx.strokeStyle = `${t.color}66`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = t.color;
    roundRect(ctx, x + 14, ty + 18, 5, th - 36, 3);
    ctx.fill();
    ctx.textAlign = "left";
    ctx.font = `700 20px ${FONT}`;
    ctx.fillStyle = "#8b98c4";
    ctx.fillText(t.label, x + 34, ty + 32);
    ctx.font = `800 ${t.value.length > 9 ? 36 : 50}px ${FONT}`;
    ctx.fillStyle = "#f8fafc";
    ctx.fillText(ellipsize(ctx, t.value, tw - 48), x + 34, ty + 80);
  });

  // ---- lower band (y 266–484): live feed (left 60%) + team now (right 40%)
  const by = 266;
  const bh = H - by - 16;
  const feedW = Math.floor((W - PAD * 2) * 0.6) - 12;
  const teamX = PAD + feedW + 24;
  const teamW = W - PAD - teamX;

  roundRect(ctx, PAD, by, feedW, bh, 16);
  ctx.fillStyle = "rgba(255,255,255,0.035)";
  ctx.fill();
  ctx.textAlign = "left";
  ctx.font = `700 20px ${FONT}`;
  ctx.fillStyle = "#8b98c4";
  ctx.fillText("LIVE FEED", PAD + 24, by + 28);
  const rows = snap.updates.slice(0, 4);
  if (rows.length === 0) {
    ctx.font = `500 26px ${FONT}`;
    ctx.fillStyle = "#4b5784";
    ctx.fillText("Waiting for the first task…", PAD + 24, by + 84);
  }
  rows.forEach((u, i) => {
    const y = by + 76 + i * 48;
    const color = u.agent ? AGENT_META[u.agent].color : "#94a3b8";
    const name = u.agent ? AGENT_META[u.agent].name.split(" ")[0] : "Azzy";
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(PAD + 34, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `800 26px ${FONT}`;
    ctx.fillStyle = color;
    ctx.fillText(name, PAD + 56, y);
    const nw = ctx.measureText(name).width;
    ctx.font = `500 26px ${FONT}`;
    ctx.fillStyle = i === 0 ? "#f1f5f9" : "#b6c0e0";
    ctx.fillText(ellipsize(ctx, u.text, feedW - 100 - nw), PAD + 70 + nw, y);
  });

  roundRect(ctx, teamX, by, teamW, bh, 16);
  ctx.fillStyle = "rgba(255,255,255,0.035)";
  ctx.fill();
  ctx.font = `700 20px ${FONT}`;
  ctx.fillStyle = "#8b98c4";
  ctx.fillText("TEAM NOW", teamX + 24, by + 28);
  ctx.textAlign = "right";
  ctx.fillText(`TOP · ${snap.topRank.toUpperCase()}`, teamX + teamW - 24, by + 28);
  const rowH = (bh - 56) / Math.max(1, snap.agents.length);
  snap.agents.forEach((a, i) => {
    const y = by + 56 + i * rowH + rowH / 2;
    ctx.fillStyle = a.color;
    ctx.beginPath();
    ctx.arc(teamX + 40, y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = "left";
    ctx.font = `800 24px ${FONT}`;
    ctx.fillStyle = "#f8fafc";
    ctx.fillText(a.name.split(" ")[0], teamX + 64, y);
    ctx.font = `500 22px ${FONT}`;
    ctx.fillStyle = "#9aa6d1";
    ctx.fillText(ellipsize(ctx, `${a.phase} · ${a.spot}`, teamW * 0.42), teamX + 180, y);
    // budget bar + spend
    const bx = teamX + teamW * 0.62;
    const bw = teamW * 0.24;
    const frac = a.budget > 0 ? Math.min(1, a.usd / a.budget) : 0;
    roundRect(ctx, bx, y - 5, bw, 10, 5);
    ctx.fillStyle = "rgba(255,255,255,0.09)";
    ctx.fill();
    if (frac > 0) {
      roundRect(ctx, bx, y - 5, Math.max(10, bw * frac), 10, 5);
      ctx.fillStyle = frac > 0.85 ? "#f87171" : a.color;
      ctx.fill();
    }
    ctx.textAlign = "right";
    ctx.font = `700 22px ${FONT}`;
    ctx.fillStyle = "#dbe2f5";
    ctx.fillText(usd(a.usd), teamX + teamW - 24, y);
  });
}

export function tickerText(snap: WallSnapshot): string {
  const parts: string[] = [];
  parts.push(`OFFICE ${snap.status.toUpperCase()}`);
  parts.push(`SPEND ${usd(snap.todayUsd)} OF ${usd(snap.budgetUsd, 0)}`);
  parts.push(`${snap.pending} APPROVAL${snap.pending === 1 ? "" : "S"} PENDING`);
  parts.push(`${snap.counts.needs_human ?? 0} NEED A HUMAN`);
  parts.push(`${snap.tasksDone} DONE TODAY`);
  for (const u of snap.updates) {
    const name = u.agent ? AGENT_META[u.agent].name.split(" ")[0].toUpperCase() : "AZZY";
    parts.push(`${name}: ${u.text}`);
  }
  return parts.join("      ◆      ");
}

/** Redraws only the bottom ticker strip. Returns the text width (for wrapping the offset). */
export function paintTicker(ctx: CanvasRenderingContext2D, text: string, offset: number, accent: string): number {
  const y = WALL_H - TICKER_H;
  ctx.fillStyle = "#05070d";
  ctx.fillRect(0, y, WALL_W, TICKER_H);
  ctx.fillStyle = accent;
  ctx.fillRect(0, y, WALL_W, 3);
  ctx.font = `700 28px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = "#cbd5e1";
  const tw = ctx.measureText(text).width + 240;
  let x = WALL_W - (offset % (tw + WALL_W));
  // draw twice so the loop is seamless
  ctx.fillText(text, x, y + TICKER_H / 2 + 1);
  x += tw;
  if (x < WALL_W) ctx.fillText(text, x, y + TICKER_H / 2 + 1);
  return tw;
}
