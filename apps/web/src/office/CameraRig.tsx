"use client";

import { useEffect, useRef, type ComponentRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { AgentId } from "@azzy/events";
import { useAzzy } from "@/store/useAzzy";
import { CAMERA_DEFAULT, CAMERA_ISO, CAMERA_TABLE, CAMERA_WALL } from "./layout";
import { agentPositions } from "./positions";

const IDLE_MS = 8000;
const TWEEN_MS = 900;

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

interface Tween {
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  start: number;
}

export function CameraRig() {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const { camera } = useThree();
  const tween = useRef<Tween | null>(null);
  const lastInteraction = useRef(Date.now());
  const focusRequest = useAzzy((s) => s.focusRequest);
  const mode = useAzzy((s) => s.cameraMode);
  const selected = useAzzy((s) => s.selectedAgent);
  const lastNonce = useRef(0);
  const follow = useRef<AgentId | null>(null);

  const startTween = (toPos: THREE.Vector3, toTarget: THREE.Vector3) => {
    const c = controls.current;
    if (!c) return;
    tween.current = { fromPos: camera.position.clone(), toPos, fromTarget: c.target.clone(), toTarget, start: performance.now() };
    c.autoRotate = false;
    lastInteraction.current = Date.now();
  };

  const focusAgent = (id: AgentId) => {
    const p = agentPositions.get(id);
    if (!p) return;
    const target = new THREE.Vector3(p.x, 1.3, p.z);
    const dir = new THREE.Vector3(camera.position.x - p.x, 0, camera.position.z - p.z);
    if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
    dir.normalize();
    startTween(new THREE.Vector3(p.x + dir.x * 5.2, 3.6, p.z + dir.z * 5.2), target);
  };

  // Explicit focus requests: click, approval.requested, Wall / Reset buttons.
  useEffect(() => {
    if (focusRequest.nonce === lastNonce.current) return;
    lastNonce.current = focusRequest.nonce;
    follow.current = null;
    if (focusRequest.view === "wall") startTween(new THREE.Vector3(...CAMERA_WALL.position), new THREE.Vector3(...CAMERA_WALL.target));
    else if (focusRequest.view === "reset" || !focusRequest.agent) startTween(new THREE.Vector3(...CAMERA_DEFAULT.position), new THREE.Vector3(...CAMERA_DEFAULT.target));
    else {
      focusAgent(focusRequest.agent);
      follow.current = focusRequest.agent;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  // Camera modes (HUD chips).
  useEffect(() => {
    follow.current = null;
    switch (mode) {
      case "overview":
        startTween(new THREE.Vector3(...CAMERA_DEFAULT.position), new THREE.Vector3(...CAMERA_DEFAULT.target));
        break;
      case "focus":
        if (selected) {
          focusAgent(selected);
          follow.current = selected;
        }
        break;
      case "collaboration":
        startTween(new THREE.Vector3(...CAMERA_TABLE.position), new THREE.Vector3(...CAMERA_TABLE.target));
        break;
      case "execution":
        startTween(new THREE.Vector3(0, 6.5, 11), new THREE.Vector3(0, 1.2, 0));
        break;
      case "monitoring":
        startTween(new THREE.Vector3(...CAMERA_WALL.position), new THREE.Vector3(...CAMERA_WALL.target));
        break;
      case "iso":
        startTween(new THREE.Vector3(...CAMERA_ISO.position), new THREE.Vector3(...CAMERA_ISO.target));
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selected]);

  useFrame(() => {
    const c = controls.current;
    if (!c) return;
    const tw = tween.current;
    if (tw) {
      const t = Math.min(1, (performance.now() - tw.start) / TWEEN_MS);
      const k = easeOutCubic(t);
      camera.position.lerpVectors(tw.fromPos, tw.toPos, k);
      c.target.lerpVectors(tw.fromTarget, tw.toTarget, k);
      if (t >= 1) tween.current = null;
    } else if (follow.current && mode === "focus") {
      // keep the target glued to a walking agent
      const p = agentPositions.get(follow.current);
      if (p) {
        const want = new THREE.Vector3(p.x, 1.3, p.z);
        const d = want.clone().sub(c.target);
        if (d.lengthSq() > 0.0004) {
          c.target.addScaledVector(d, 0.08);
          camera.position.addScaledVector(d, 0.08);
        }
      }
    } else {
      const idle = Date.now() - lastInteraction.current > IDLE_MS;
      if (c.autoRotate !== idle) c.autoRotate = idle;
    }
    c.update();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      enablePan={false}
      minPolarAngle={0.9}
      maxPolarAngle={1.35}
      minDistance={6}
      maxDistance={40}
      autoRotateSpeed={0.5}
      target={CAMERA_DEFAULT.target}
      onStart={() => {
        tween.current = null;
        follow.current = null;
        lastInteraction.current = Date.now();
        if (controls.current) controls.current.autoRotate = false;
      }}
      onEnd={() => {
        lastInteraction.current = Date.now();
      }}
    />
  );
}
