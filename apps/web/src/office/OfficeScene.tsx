"use client";

import { Component, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { ContactShadows, Environment } from "@react-three/drei";
import type { AgentId } from "@azzy/events";
import { deriveStatus, STATUS_COLORS, type VisualStatus } from "@/lib/status";
import type { CollaborationEdge } from "@/lib/types";
import { AGENT_IDS, pendingApprovalFor, useAzzy } from "@/store/useAzzy";
import { CameraRig } from "./CameraRig";
import { Character } from "./Character";
import { CollabArcs } from "./CollabArcs";
import { Desk } from "./Desk";
import { HoloScreen } from "./HoloScreen";
import { Floor, FuelBar, LedFloorLines, Lounge, Plants, Walls } from "./Interior";
import { CAMERA_DEFAULT, ROOM } from "./layout";
import { LedWall } from "./LedWall";
import { OrchestrationTable } from "./OrchestrationTable";
import { NameTag, SpeechBubble } from "./Overlays";

function useLowPower() {
  const [low, setLow] = useState(false);
  useEffect(() => {
    const cores = navigator.hardwareConcurrency ?? 4;
    const mobile = window.matchMedia("(max-width: 767px)").matches || /Mobi|Android/i.test(navigator.userAgent);
    setLow(cores < 4 || mobile);
  }, []);
  return low;
}

function usePageHidden() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  return hidden;
}

/** Swallows errors from optional decorations (e.g. an HDR that failed to download) without taking the scene down. */
class SilentBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    // intentionally silent: the scene has its own lights
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Keeps the IBL subtle: three ≥ r163 exposes `scene.environmentIntensity` (drei's prop of the same name is newer, so set it here). */
function EnvironmentIntensity({ value }: { value: number }) {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const prev = scene.environmentIntensity;
    scene.environmentIntensity = value;
    return () => {
      scene.environmentIntensity = prev;
    };
  }, [scene, value]);
  return null;
}

function EnvironmentLighting() {
  const [online, setOnline] = useState(false);
  useEffect(() => {
    setOnline(navigator.onLine !== false);
  }, []);
  if (!online) return null;
  return (
    <SilentBoundary>
      <Suspense fallback={null}>
        <Environment preset="city" />
        <EnvironmentIntensity value={0.3} />
      </Suspense>
    </SilentBoundary>
  );
}

function Agents() {
  const agents = useAzzy((s) => s.agents);
  const bubbles = useAzzy((s) => s.bubbles);
  const approvals = useAzzy((s) => s.approvals);
  const tasks = useAzzy((s) => s.tasks);
  const mode = useAzzy((s) => s.cameraMode);
  const selected = useAzzy((s) => s.selectedAgent);
  const setSelected = useAzzy((s) => s.setSelectedAgent);
  const requestFocus = useAzzy((s) => s.requestFocus);
  const setCameraMode = useAzzy((s) => s.setCameraMode);
  const [arrived, setArrived] = useState<Record<AgentId, boolean>>({ jimmy: true, emir: true, cyber: true, sara: true, marwah: true });

  const onArrivedChange = useCallback((id: AgentId, v: boolean) => {
    setArrived((prev) => (prev[id] === v ? prev : { ...prev, [id]: v }));
  }, []);

  const onClick = useCallback(
    (id: AgentId) => {
      setSelected(id);
      setCameraMode("focus");
      requestFocus(id, "agent");
    },
    [setSelected, requestFocus, setCameraMode],
  );

  const activeTaskAgents = useMemo(() => {
    const set = new Set<AgentId>();
    for (const t of tasks) {
      if (["done", "failed", "cancelled"].includes(t.state)) continue;
      if (t.lead) set.add(t.lead);
      for (const a of t.assignees) set.add(a);
    }
    for (const id of AGENT_IDS) if (agents[id].task_id && agents[id].phase !== "idle") set.add(id);
    return set;
  }, [tasks, agents]);

  const statuses = useMemo(() => {
    const out = {} as Record<AgentId, VisualStatus>;
    for (const id of AGENT_IDS) {
      const a = agents[id];
      out[id] = deriveStatus({ phase: a.phase, arrived: arrived[id], hasBubble: Boolean(bubbles[id]), hasPendingApproval: Boolean(pendingApprovalFor(approvals, id)) });
    }
    return out;
  }, [agents, arrived, bubbles, approvals]);

  return (
    <>
      {AGENT_IDS.map((id) => {
        const a = agents[id];
        const status = statuses[id];
        const bubble = bubbles[id];
        const approval = pendingApprovalFor(approvals, id);
        const working = a.phase !== "idle" && a.phase !== "away" && a.phase !== "meeting" && a.phase !== "waiting_approval";
        let emphasis = 1;
        if (mode === "execution") emphasis = activeTaskAgents.has(id) ? 1.5 : 0.3;
        else if (mode === "focus" && selected) emphasis = selected === id ? 1.5 : 0.8;
        return (
          <group key={id}>
            <Desk id={id} statusColor={STATUS_COLORS[status]} active={working && a.spot === "desk"} />
            <HoloScreen id={id} dim={emphasis < 1} />
            <Character id={id} color={a.color} spot={a.spot} speaking={Boolean(bubble)} working={working} emphasis={emphasis} onArrivedChange={onArrivedChange} onClick={onClick}>
              <NameTag id={id} status={status} position={[0, 2.3, 0]} />
              <SpeechBubble id={id} text={bubble?.text ?? null} approval={approval} position={[0, 2.95, 0]} />
            </Character>
          </group>
        );
      })}
    </>
  );
}

export function OfficeScene({ liveEdges }: { liveEdges: CollaborationEdge[] }) {
  const lowPower = useLowPower();
  const hidden = usePageHidden();
  const office = useAzzy((s) => s.office.status);
  const mode = useAzzy((s) => s.cameraMode);

  return (
    <Canvas
      data-testid="office-canvas"
      className="office-canvas"
      dpr={[1, 1.75]}
      shadows={!lowPower}
      frameloop={hidden ? "never" : "always"}
      camera={{ position: CAMERA_DEFAULT.position, fov: 50, near: 0.1, far: 140 }}
      gl={{ antialias: !lowPower, powerPreference: "high-performance", alpha: false }}
      onCreated={({ gl }) => {
        gl.setClearColor("#050816");
      }}
    >
      <color attach="background" args={["#050816"]} />
      <fog attach="fog" args={["#050816", 26, 50]} />

      <ambientLight intensity={0.32} />
      <hemisphereLight args={["#cbd5e1", "#0b1025", 0.5]} />
      <spotLight
        position={[-6, 9, 6]}
        angle={0.75}
        penumbra={0.6}
        intensity={180}
        distance={44}
        decay={2}
        color="#e0f2fe"
        castShadow={!lowPower}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0004}
      />
      <spotLight position={[7, 9, 4]} angle={0.75} penumbra={0.6} intensity={140} distance={44} decay={2} color="#f5f3ff" />
      <pointLight position={[-14, 3, -2]} intensity={24} distance={14} decay={2} color="#00E5FF" />
      <pointLight position={[14, 3, -2]} intensity={24} distance={14} decay={2} color="#9747FF" />
      <pointLight position={[0, 5.5, -12]} intensity={16} distance={14} decay={2} color="#9747FF" />

      <EnvironmentLighting />

      <Floor reflective={!lowPower} />
      <LedFloorLines />
      <Walls />
      <Plants />
      <Lounge />
      <FuelBar />
      <OrchestrationTable active={office === "meeting" || mode === "collaboration"} />
      <LedWall />
      <Agents />
      {mode === "collaboration" ? <CollabArcs liveEdges={liveEdges} /> : null}

      {!lowPower ? <ContactShadows position={[0, 0.01, (ROOM.depthFront + ROOM.depthBack) / 2]} opacity={0.5} scale={44} blur={2.2} far={6} resolution={512} color="#000000" /> : null}

      <CameraRig />
    </Canvas>
  );
}
