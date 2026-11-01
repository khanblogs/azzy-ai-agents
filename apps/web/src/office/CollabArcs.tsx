"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { AGENT_META, type AgentId } from "@azzy/events";
import type { CollaborationEdge } from "@/lib/types";
import { useAzzy } from "@/store/useAzzy";
import { spotPosition, TABLE_CENTER } from "./layout";
import { agentPositions } from "./positions";

const RECENT_MS = 20_000;

function posOf(id: AgentId): THREE.Vector3 {
  const live = agentPositions.get(id);
  if (live) return live.clone();
  return new THREE.Vector3(...spotPosition(id, "desk"));
}

function buildCurve(from: THREE.Vector3, to: THREE.Vector3, lift: number) {
  const a = from.clone().setY(1.9);
  const b = to.clone().setY(1.9);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  mid.y += lift + a.distanceTo(b) * 0.18;
  return new THREE.QuadraticBezierCurve3(a, mid, b);
}

function Arc({ from, to, color, active, speed }: { from: AgentId; to: AgentId | null; color: string; active: boolean; speed: number }) {
  const [geom, setGeom] = useState<THREE.TubeGeometry | null>(null);
  const curveRef = useRef<THREE.QuadraticBezierCurve3 | null>(null);
  const pulse = useRef<THREE.Mesh>(null);
  const t = useRef(Math.random());

  // Rebuild the tube when endpoints move (characters walk); throttled to 4 Hz.
  useEffect(() => {
    let last = "";
    const tick = () => {
      const a = posOf(from);
      const b = to ? posOf(to) : new THREE.Vector3(TABLE_CENTER[0], 0, TABLE_CENTER[2]);
      const key = `${a.x.toFixed(1)},${a.z.toFixed(1)}|${b.x.toFixed(1)},${b.z.toFixed(1)}`;
      if (key === last) return;
      last = key;
      const curve = buildCurve(a, b, active ? 1.2 : 0.8);
      curveRef.current = curve;
      setGeom(new THREE.TubeGeometry(curve, 28, active ? 0.035 : 0.018, 6, false));
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [from, to, active]);

  // dispose the previous tube whenever a new one replaces it (and on unmount)
  useEffect(() => () => geom?.dispose(), [geom]);

  useFrame((_, dt) => {
    if (!active || !pulse.current || !curveRef.current) return;
    t.current = (t.current + dt * speed) % 1;
    const p = curveRef.current.getPoint(t.current);
    pulse.current.position.copy(p);
  });

  if (!geom) return null;
  return (
    <group>
      <mesh geometry={geom}>
        <meshBasicMaterial color={color} transparent opacity={active ? 0.85 : 0.22} toneMapped={false} depthWrite={false} />
      </mesh>
      {active ? (
        <mesh ref={pulse}>
          <sphereGeometry args={[0.1, 10, 10]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
      ) : null}
    </group>
  );
}

/**
 * Collaboration mode: a bright animated arc per agent.message in the last 20 s, plus a dim
 * persistent arc for every live edge reported by the store's recent message history.
 */
export function CollabArcs({ liveEdges }: { liveEdges: CollaborationEdge[] }) {
  const messages = useAzzy((s) => s.agentMessages);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const recent = useMemo(() => {
    const seen = new Set<string>();
    const out: { key: string; from: AgentId; to: AgentId | null; color: string }[] = [];
    for (const m of messages) {
      if (now - Date.parse(m.created_at) > RECENT_MS) continue;
      const key = `${m.from_agent}>${m.to_agent ?? "all"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, from: m.from_agent, to: m.to_agent, color: AGENT_META[m.from_agent].color });
      if (out.length >= 12) break;
    }
    return out;
  }, [messages, now]);

  const dim = useMemo(() => {
    const activeKeys = new Set(recent.map((r) => r.key));
    const out: { key: string; from: AgentId; to: AgentId; color: string }[] = [];
    const seen = new Set<string>();
    const push = (from: AgentId, to: AgentId) => {
      const key = `${from}>${to}`;
      if (seen.has(key) || activeKeys.has(key)) return;
      seen.add(key);
      out.push({ key, from, to, color: AGENT_META[from].color });
    };
    // Broadcast edges target the orchestrator ("azzy"), which the recent-arc path draws to the table (to = null).
    for (const e of liveEdges) if (e.to !== "azzy") push(e.from, e.to);
    for (const m of messages) if (m.to_agent) push(m.from_agent, m.to_agent);
    return out.slice(0, 20);
  }, [liveEdges, messages, recent]);

  return (
    <group>
      {dim.map((e) => (
        <Arc key={`d-${e.key}`} from={e.from} to={e.to} color={e.color} active={false} speed={0} />
      ))}
      {recent.map((e, i) => (
        <Arc key={`a-${e.key}`} from={e.from} to={e.to} color={e.color} active speed={0.45 + (i % 3) * 0.1} />
      ))}
    </group>
  );
}
