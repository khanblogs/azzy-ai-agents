"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { OFFICE_STATUS_COLORS } from "@/lib/status";
import { useAzzy } from "@/store/useAzzy";
import { WALL_CENTER, WALL_HALF_WIDTH } from "./layout";
import { paintTicker, paintWall, snapshotFromState, tickerText, WALL_H, WALL_W, type WallSnapshot } from "./wallPainter";

const THETA = (70 * Math.PI) / 180;
const RADIUS = WALL_HALF_WIDTH / Math.sin(THETA / 2);
const HEIGHT = 4.6;
const TICKER_FPS = 15;
const TICKER_SPEED = 110; // canvas px per second

export function LedWall() {
  const { ctx, texture } = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = WALL_W;
    c.height = WALL_H;
    const context = c.getContext("2d");
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.x = -1; // BackSide rendering mirrors U; flip it back so text reads left→right
    tex.offset.x = 1;
    tex.anisotropy = 8;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    return { ctx: context, texture: tex };
  }, []);

  const snapRef = useRef<WallSnapshot | null>(null);
  const tickerRef = useRef({ text: "", offset: 0, acc: 0, width: 1 });
  const needsFull = useRef(true);

  // Full repaint once per second (clock + KPIs), independent of the frame loop.
  useEffect(() => {
    const paint = () => {
      const snap = snapshotFromState(useAzzy.getState());
      snapRef.current = snap;
      tickerRef.current.text = tickerText(snap);
      needsFull.current = true;
    };
    paint();
    const id = setInterval(paint, 1000);
    return () => {
      clearInterval(id);
      texture.dispose();
    };
  }, [texture]);

  useFrame((_, delta) => {
    if (!ctx) return;
    const t = tickerRef.current;
    t.acc += delta;
    t.offset += delta * TICKER_SPEED;
    const snap = snapRef.current;
    if (!snap) return;
    const due = t.acc >= 1 / TICKER_FPS;
    if (!due && !needsFull.current) return;
    if (needsFull.current) {
      paintWall(ctx, snap, new Date());
      needsFull.current = false;
    }
    t.acc = 0;
    t.width = paintTicker(ctx, t.text, t.offset, OFFICE_STATUS_COLORS[snap.status]);
    texture.needsUpdate = true;
  });

  // Cylinder axis sits in front of the wall so the screen curves around the viewer.
  const center: [number, number, number] = [WALL_CENTER[0], WALL_CENTER[1], WALL_CENTER[2] + RADIUS];
  const thetaStart = Math.PI - THETA / 2;

  return (
    <group>
      {/* bezel */}
      <mesh position={center}>
        <cylinderGeometry args={[RADIUS + 0.06, RADIUS + 0.06, HEIGHT + 0.36, 48, 1, true, thetaStart - 0.012, THETA + 0.024]} />
        <meshStandardMaterial color="#05070d" roughness={0.6} metalness={0.4} side={THREE.BackSide} />
      </mesh>
      {/* screen */}
      <mesh position={center}>
        <cylinderGeometry args={[RADIUS, RADIUS, HEIGHT, 48, 1, true, thetaStart, THETA]} />
        <meshStandardMaterial
          map={texture}
          emissiveMap={texture}
          emissive="#ffffff"
          emissiveIntensity={1.15}
          color="#0a0a0a"
          roughness={0.95}
          metalness={0}
          side={THREE.BackSide}
          toneMapped={false}
        />
      </mesh>
      {/* glow lines above and below the screen */}
      <mesh position={[center[0], WALL_CENTER[1] + HEIGHT / 2 + 0.2, center[2]]}>
        <cylinderGeometry args={[RADIUS + 0.02, RADIUS + 0.02, 0.05, 48, 1, true, thetaStart, THETA]} />
        <meshBasicMaterial color="#00E5FF" side={THREE.BackSide} toneMapped={false} />
      </mesh>
      <mesh position={[center[0], WALL_CENTER[1] - HEIGHT / 2 - 0.2, center[2]]}>
        <cylinderGeometry args={[RADIUS + 0.02, RADIUS + 0.02, 0.05, 48, 1, true, thetaStart, THETA]} />
        <meshBasicMaterial color="#9747FF" side={THREE.BackSide} toneMapped={false} />
      </mesh>
      {/* soft light cast by the wall onto the desks */}
      <pointLight position={[0, 3.4, -2.2]} intensity={14} distance={11} decay={2} color="#8fd3ff" />
    </group>
  );
}
