"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { AGENT_META, type AgentId } from "@azzy/events";
import { useAzzy } from "@/store/useAzzy";
import { DESKS } from "./layout";

const W = 512;
const H = 224;
const LINE_H = 22;

/** Floating holographic panel above each desk streaming that agent's live tool-log lines. */
export function HoloScreen({ id, dim }: { id: AgentId; dim: boolean }) {
  const color = AGENT_META[id].color;
  const [x, , z] = DESKS[id];
  const { ctx, texture } = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    return { ctx: c.getContext("2d"), texture: tex };
  }, []);
  const lines = useRef<string[]>([]);
  const offset = useRef(0);
  const acc = useRef(0);
  const dirty = useRef(true);

  useEffect(() => {
    const compute = () => {
      const s = useAzzy.getState();
      const a = s.agents[id];
      const logs = s.toolLogs[id].slice(0, 7).reverse();
      const out = logs.map((l) => `${l.ok ? "✓" : "✗"} ${l.tool} ${Object.values(l.args).slice(0, 1).map(String).join("")}`.slice(0, 40));
      if (out.length === 0) out.push(`${a.phase.replace(/_/g, " ")} · ${a.detail || "standing by"}`.slice(0, 40));
      lines.current = out;
      dirty.current = true;
    };
    compute();
    const unsub = useAzzy.subscribe((s, prev) => {
      if (s.toolLogs[id] !== prev.toolLogs[id] || s.agents[id] !== prev.agents[id]) compute();
    });
    return () => {
      unsub();
      texture.dispose();
    };
  }, [id, texture]);

  useFrame((_, dt) => {
    if (!ctx) return;
    acc.current += dt;
    offset.current += dt * 6;
    if (acc.current < 0.12 && !dirty.current) return; // ≤ ~8 fps
    acc.current = 0;
    dirty.current = false;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(5, 8, 22, 0.55)";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
    ctx.globalAlpha = 1;
    ctx.font = "700 16px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = color;
    ctx.textBaseline = "middle";
    ctx.fillText(`${AGENT_META[id].name.toUpperCase()} · LIVE LOG`, 14, 18);
    ctx.font = "500 17px ui-monospace, Menlo, monospace";
    const rows = lines.current;
    const shift = offset.current % LINE_H;
    rows.forEach((row, i) => {
      const y = 48 + i * LINE_H - (rows.length >= 7 ? shift : 0);
      ctx.globalAlpha = 0.55 + (i / Math.max(1, rows.length)) * 0.45;
      ctx.fillStyle = row.startsWith("✗") ? "#ff7b9c" : "#dbeafe";
      ctx.fillText(row, 14, y);
    });
    ctx.globalAlpha = 1;
    // scanline
    const sy = (offset.current * 10) % H;
    ctx.fillStyle = `${color}55`;
    ctx.fillRect(0, sy, W, 2);
    texture.needsUpdate = true;
  });

  return (
    <mesh position={[x, 1.95, z - 0.5]} rotation={[-0.14, 0, 0]}>
      <planeGeometry args={[1.5, 0.66]} />
      <meshBasicMaterial map={texture} transparent opacity={dim ? 0.2 : 0.72} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
