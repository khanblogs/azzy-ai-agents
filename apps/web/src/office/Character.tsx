"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useCursor } from "@react-three/drei";
import * as THREE from "three";
import type { AgentId, Spot } from "@azzy/events";
import { AVATARS, type Avatar } from "./avatars";
import { spotFacing, spotPosition, spotSeated } from "./layout";
import { agentPositions } from "./positions";

const WALK_SPEED = 2.2; // world units per second
const TURN_DAMP = 8;
const ARRIVE_EPS = 0.04;

/* Proportions (world units): total ≈ 1.75 */
const HIP_Y = 0.86;
const SHOULDER_Y = 1.42;
const NECK_Y = 1.5;
const HEAD_Y = 1.66;
const HEAD_R = 0.2;

export interface CharacterProps {
  id: AgentId;
  color: string;
  spot: Spot;
  speaking: boolean;
  working: boolean;
  /** Execution mode: <1 dimmed, 1 normal, >1 spotlighted. */
  emphasis: number;
  onArrivedChange: (id: AgentId, arrived: boolean) => void;
  onClick: (id: AgentId) => void;
  children?: ReactNode;
}

function lerpAngle(a: number, b: number, t: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Gold fur with a random dark spot pattern — generated once per mount (Emir). */
function useSpotTexture(enabled: boolean, base: string) {
  return useMemo(() => {
    if (!enabled) return null;
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 256, 256);
    let seed = 1337;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 95; i++) {
      const x = rnd() * 256;
      const y = rnd() * 256;
      const rx = 4 + rnd() * 7;
      const ry = 3 + rnd() * 6;
      ctx.fillStyle = rnd() > 0.5 ? "#3b2a12" : "#2a1d0c";
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    return tex;
  }, [enabled, base]);
}

export function Character({ id, color, spot, speaking, working, emphasis, onArrivedChange, onClick, children }: CharacterProps) {
  const avatar = AVATARS[id];
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const eyes = useRef<THREE.Group>(null);
  const lidL = useRef<THREE.Mesh>(null);
  const lidR = useRef<THREE.Mesh>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const foreL = useRef<THREE.Group>(null);
  const foreR = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const shinL = useRef<THREE.Group>(null);
  const shinR = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);
  const spots = useSpotTexture(avatar.spots, avatar.skin);
  useEffect(() => () => spots?.dispose(), [spots]);

  const target = useMemo(() => new THREE.Vector3(...spotPosition(id, spot)), [id, spot]);
  const facing = useMemo(() => spotFacing(id, spot), [id, spot]);
  const seated = spotSeated(spot);

  const state = useRef({
    pos: new THREE.Vector3(...spotPosition(id, "desk")),
    yaw: spotFacing(id, "desk"),
    arrived: true,
    sit: 1,
    t: Math.random() * 10,
    blinkAt: 2 + Math.random() * 4,
    blink: 0,
    gazeYaw: 0,
    gazePitch: 0,
    tmp: new THREE.Vector3(),
  });

  useFrame(({ camera }, dt) => {
    const g = root.current;
    if (!g) return;
    const s = state.current;
    const delta = Math.min(dt, 0.1);
    s.t += delta;

    // ---- locomotion ----
    const dx = target.x - s.pos.x;
    const dz = target.z - s.pos.z;
    const dist = Math.hypot(dx, dz);
    const walking = dist > ARRIVE_EPS;
    if (walking) {
      const step = Math.min(dist, WALK_SPEED * delta);
      s.pos.x += (dx / dist) * step;
      s.pos.z += (dz / dist) * step;
      s.yaw = lerpAngle(s.yaw, Math.atan2(dx, dz), 1 - Math.exp(-TURN_DAMP * delta));
      if (s.arrived) {
        s.arrived = false;
        onArrivedChange(id, false);
      }
    } else {
      s.yaw = lerpAngle(s.yaw, facing, 1 - Math.exp(-TURN_DAMP * delta));
      if (!s.arrived) {
        s.arrived = true;
        onArrivedChange(id, true);
      }
    }
    const wantSit = !walking && seated ? 1 : 0;
    s.sit += (wantSit - s.sit) * (1 - Math.exp(-6 * delta));
    g.position.set(s.pos.x, 0, s.pos.z);
    g.rotation.y = s.yaw;
    const shared = agentPositions.get(id);
    if (shared) shared.set(s.pos.x, 0, s.pos.z);
    else agentPositions.set(id, s.pos.clone());

    // ---- body ----
    const t = s.t;
    const gait = Math.sin(t * 9);
    const bob = walking ? Math.abs(gait) * 0.05 : 0;
    if (body.current) body.current.position.y = bob - s.sit * 0.3;
    if (torso.current) {
      const breath = 1 + Math.sin(t * 1.6) * 0.01;
      torso.current.scale.set(1, breath, 1);
      torso.current.rotation.x = walking ? 0.06 : s.sit * 0.08;
    }

    // legs: swing when walking; thigh forward + shin down when seated
    const swing = walking ? gait * 0.6 : 0;
    const fold = -s.sit * 1.5;
    if (legL.current) legL.current.rotation.x = swing + fold;
    if (legR.current) legR.current.rotation.x = -swing + fold;
    const shinBend = s.sit * 1.45;
    if (shinL.current) shinL.current.rotation.x = shinBend + (walking ? Math.max(0, -gait) * 0.7 : 0);
    if (shinR.current) shinR.current.rotation.x = shinBend + (walking ? Math.max(0, gait) * 0.7 : 0);

    // arms: per-agent idle, typing when working at a seat, swing when walking
    const typing = !walking && working && s.sit > 0.5;
    let aL = 0;
    let aR = 0;
    let fL = 0;
    let fR = 0;
    let zL = 0.1;
    let zR = -0.1;
    if (walking) {
      aL = -swing * 0.7;
      aR = swing * 0.7;
      fL = -0.4;
      fR = -0.4;
    } else if (typing) {
      aL = -0.55 + Math.sin(t * 13) * 0.05;
      aR = -0.55 + Math.sin(t * 13 + 1.6) * 0.05;
      fL = -1.15 + Math.sin(t * 13 + 0.8) * 0.12;
      fR = -1.15 + Math.sin(t * 13 + 2.4) * 0.12;
      zL = 0.25;
      zR = -0.25;
    } else {
      switch (id) {
        case "jimmy": // arms crossed
          aL = -0.9;
          aR = -0.9;
          fL = -1.5;
          fR = -1.5;
          zL = 0.55;
          zR = -0.55;
          break;
        case "emir": // leaning in, one hand on the desk
          aL = -0.75;
          aR = -0.35 + Math.sin(t * 1.2) * 0.05;
          fL = -1.1;
          fR = -0.5;
          break;
        case "cyber": // nodding to music, hands relaxed
          aL = -0.2 + Math.sin(t * 2.6) * 0.06;
          aR = -0.2 - Math.sin(t * 2.6) * 0.06;
          fL = -0.6;
          fR = -0.6;
          break;
        case "sara": // swiping the tablet
          aL = -0.8;
          aR = -0.7 + Math.sin(t * 2.2) * 0.1;
          fL = -1.3;
          fR = -1.35 + Math.sin(t * 2.2 + 1) * 0.2;
          zL = 0.3;
          zR = -0.1;
          break;
        case "marwah": // gesturing while on a call
          aL = -0.6 + Math.sin(t * 1.7) * 0.15;
          aR = -1.4;
          fL = -1.0 + Math.sin(t * 1.7 + 0.5) * 0.25;
          fR = -2.1;
          zL = 0.35;
          zR = -0.55;
          break;
      }
    }
    const k = 1 - Math.exp(-7 * delta);
    if (armL.current) {
      armL.current.rotation.x += (aL - armL.current.rotation.x) * k;
      armL.current.rotation.z += (zL - armL.current.rotation.z) * k;
    }
    if (armR.current) {
      armR.current.rotation.x += (aR - armR.current.rotation.x) * k;
      armR.current.rotation.z += (zR - armR.current.rotation.z) * k;
    }
    if (foreL.current) foreL.current.rotation.x += (fL - foreL.current.rotation.x) * k;
    if (foreR.current) foreR.current.rotation.x += (fR - foreR.current.rotation.x) * k;

    // head: nod when speaking, music nod for cyber, look slightly down when typing
    if (head.current) {
      const nod = speaking ? Math.sin(t * 7) * 0.08 : id === "cyber" && !typing && !walking ? Math.sin(t * 5.2) * 0.05 : 0;
      const down = typing ? 0.14 : 0;
      head.current.rotation.x = nod + down + (walking ? -0.04 : 0);
      head.current.rotation.z = speaking ? Math.sin(t * 3.1) * 0.03 : 0;

      // gaze: eyes look toward the camera (clamped), eased
      if (eyes.current) {
        const local = s.tmp.copy(camera.position);
        head.current.worldToLocal(local);
        const wantYaw = clamp(Math.atan2(local.x, local.z), -0.35, 0.35);
        const wantPitch = clamp(-Math.atan2(local.y, Math.hypot(local.x, local.z)), -0.25, 0.25);
        s.gazeYaw += (wantYaw - s.gazeYaw) * (1 - Math.exp(-4 * delta));
        s.gazePitch += (wantPitch - s.gazePitch) * (1 - Math.exp(-4 * delta));
        eyes.current.rotation.set(s.gazePitch, s.gazeYaw, 0);
      }
    }

    // blink every 3–6 s
    s.blinkAt -= delta;
    if (s.blinkAt <= 0) {
      s.blink = 0.14;
      s.blinkAt = 3 + Math.random() * 3;
    }
    if (s.blink > 0) s.blink -= delta;
    const lid = s.blink > 0 ? 1 : 0.02;
    if (lidL.current) lidL.current.scale.y += (lid - lidL.current.scale.y) * 0.6;
    if (lidR.current) lidR.current.scale.y += (lid - lidR.current.scale.y) * 0.6;

    if (halo.current) {
      halo.current.visible = emphasis > 1;
      halo.current.rotation.z += delta * 0.8;
      const sc = 1 + Math.sin(t * 3) * 0.04;
      halo.current.scale.set(sc, sc, sc);
    }
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onClick(id);
  };

  const dim = emphasis < 1;
  const op = dim ? 0.35 : 1;
  const animal = avatar.kind !== "human";
  const skinMat = animal && spots ? <meshStandardMaterial map={spots} color="#ffffff" roughness={0.7} transparent={dim} opacity={op} /> : <meshStandardMaterial color={avatar.skin} roughness={animal ? 0.65 : 0.75} transparent={dim} opacity={op} />;
  const outfitMat = <meshStandardMaterial color={avatar.outfit} roughness={avatar.kind === "panther" ? 0.45 : 0.7} metalness={avatar.kind === "panther" ? 0.25 : 0} transparent={dim} opacity={op} />;
  const jacketColor = avatar.kind === "panther" ? "#0a0e1a" : avatar.kind === "cheetah" ? "#161b26" : id === "cyber" ? "#07070d" : id === "sara" ? "#172f6e" : "#efe8dc";
  const jacketMat = <meshStandardMaterial color={jacketColor} roughness={0.65} metalness={avatar.kind === "panther" ? 0.3 : 0} transparent={dim} opacity={op} />;
  const trouserColor = id === "marwah" ? "#2a2622" : id === "sara" ? "#111c3d" : id === "cyber" ? "#0e1016" : "#0f1422";

  return (
    <group
      ref={root}
      onClick={handleClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {/* invisible hit target so taps work on mobile */}
      <mesh position={[0, 0.9, 0]} visible={false}>
        <cylinderGeometry args={[0.5, 0.5, 1.9, 8]} />
        <meshBasicMaterial />
      </mesh>
      <mesh ref={halo} position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.55, 0.72, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.8} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>

      {/* legs: thigh (pivot at hip) → shin (pivot at knee) → shoe */}
      {[-1, 1].map((side) => (
        <group key={side} ref={side < 0 ? legL : legR} position={[side * 0.12, HIP_Y, 0]}>
          <mesh position={[0, -0.2, 0]} castShadow>
            <capsuleGeometry args={[0.085, 0.3, 4, 8]} />
            <meshStandardMaterial color={trouserColor} roughness={0.8} transparent={dim} opacity={op} />
          </mesh>
          <group ref={side < 0 ? shinL : shinR} position={[0, -0.4, 0]}>
            <mesh position={[0, -0.2, 0]} castShadow>
              <capsuleGeometry args={[0.07, 0.3, 4, 8]} />
              <meshStandardMaterial color={trouserColor} roughness={0.8} transparent={dim} opacity={op} />
            </mesh>
            <mesh position={[0, -0.43, 0.05]}>
              <boxGeometry args={[0.13, 0.07, 0.26]} />
              <meshStandardMaterial color={id === "marwah" ? "#8b5e3c" : "#0a0a0f"} roughness={0.5} transparent={dim} opacity={op} />
            </mesh>
          </group>
        </group>
      ))}

      <group ref={body}>
        <group ref={torso} position={[0, HIP_Y, 0]}>
          {/* hips + tapered torso (narrow at the waist, wide at the shoulders) */}
          <mesh position={[0, 0.08, 0]}>
            <cylinderGeometry args={[0.2, 0.16, 0.2, 14]} />
            {outfitMat}
          </mesh>
          <mesh position={[0, 0.34, 0]} scale={[animal ? 1.2 : 1.05, 1, 0.85]} castShadow>
            <capsuleGeometry args={[0.22, 0.3, 6, 14]} />
            {outfitMat}
          </mesh>
          {/* jacket / blazer shell, slightly larger and darker, open at the front */}
          <mesh position={[0, 0.33, -0.01]} scale={[animal ? 1.3 : 1.14, 1.02, 0.95]} castShadow>
            <cylinderGeometry args={[0.24, 0.21, 0.5, 18, 1, true, Math.PI * 0.12, Math.PI * 1.76]} />
            {jacketMat}
          </mesh>
          {/* inner top / shirt visible through the V */}
          <mesh position={[0, 0.36, 0.17]}>
            <boxGeometry args={[0.12, 0.42, 0.03]} />
            <meshStandardMaterial color={id === "sara" ? "#f8fafc" : id === "marwah" ? "#1f2937" : id === "cyber" ? "#15151e" : avatar.outfit} roughness={0.8} transparent={dim} opacity={op} />
          </mesh>
          {/* lapels */}
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * 0.11, 0.45, 0.2]} rotation={[0.15, 0, side * 0.5]}>
              <boxGeometry args={[0.1, 0.22, 0.02]} />
              {jacketMat}
            </mesh>
          ))}
          {/* shoulders */}
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * (animal ? 0.3 : 0.27), SHOULDER_Y - HIP_Y, 0]}>
              <sphereGeometry args={[animal ? 0.12 : 0.1, 12, 12]} />
              {avatar.kind === "panther" ? <meshStandardMaterial color="#0f172a" metalness={0.7} roughness={0.3} emissive={color} emissiveIntensity={0.25} transparent={dim} opacity={op} /> : jacketMat}
            </mesh>
          ))}
          {avatar.kind === "panther" ? <ArmourPlates accent={color} dim={dim} /> : null}
          {/* chest badge / lapel pin */}
          <mesh position={[id === "marwah" ? -0.12 : 0.12, 0.5, 0.22]}>
            {id === "marwah" ? <sphereGeometry args={[0.022, 8, 8]} /> : <boxGeometry args={[0.07, 0.05, 0.015]} />}
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={dim ? 0.2 : 0.8} metalness={0.4} roughness={0.3} transparent={dim} opacity={op} />
          </mesh>
          {/* cyber: purple sleeve stripes; emir: gold trim */}
          {id === "cyber" || id === "emir" ? (
            [-1, 1].map((side) => (
              <mesh key={side} position={[side * 0.27, 0.2, 0]}>
                <torusGeometry args={[0.095, 0.01, 6, 16]} />
                <meshBasicMaterial color={color} toneMapped={false} transparent={dim} opacity={op} />
              </mesh>
            ))
          ) : null}

          {/* neck */}
          <mesh position={[0, NECK_Y - HIP_Y, 0]}>
            <cylinderGeometry args={[0.065, 0.08, 0.14, 10]} />
            {skinMat}
          </mesh>

          {/* head */}
          <group ref={head} position={[0, HEAD_Y - HIP_Y, 0]}>
            <Head avatar={avatar} color={color} dim={dim} skinMat={skinMat} eyesRef={eyes} lidL={lidL} lidR={lidR} />
          </group>
        </group>

        {/* arms: upper (pivot at shoulder) → forearm (pivot at elbow) → hand */}
        {[-1, 1].map((side) => (
          <group key={side} ref={side < 0 ? armL : armR} position={[side * (animal ? 0.34 : 0.3), SHOULDER_Y, 0]}>
            <mesh position={[0, -0.17, 0]} castShadow>
              <capsuleGeometry args={[0.065, 0.24, 4, 8]} />
              {jacketMat}
            </mesh>
            <group ref={side < 0 ? foreL : foreR} position={[0, -0.33, 0]}>
              <mesh position={[0, -0.14, 0]}>
                <capsuleGeometry args={[0.055, 0.22, 4, 8]} />
                {id === "cyber" || id === "jimmy" ? jacketMat : <meshStandardMaterial color={avatar.skin} roughness={0.7} transparent={dim} opacity={op} />}
              </mesh>
              <mesh position={[0, -0.3, 0]}>
                <sphereGeometry args={[0.062, 10, 10]} />
                {skinMat}
              </mesh>
              {/* props held in the left hand */}
              {side < 0 && avatar.prop === "tablet" ? (
                <mesh position={[0.1, -0.32, 0.06]} rotation={[-0.6, 0.3, 0]}>
                  <boxGeometry args={[0.3, 0.2, 0.012]} />
                  <meshStandardMaterial color="#0f172a" emissive={color} emissiveIntensity={0.6} roughness={0.3} transparent={dim} opacity={op} />
                </mesh>
              ) : null}
              {side > 0 && id === "marwah" ? (
                <mesh position={[-0.02, -0.3, 0.05]} rotation={[0, 0, 0.3]}>
                  <boxGeometry args={[0.03, 0.12, 0.06]} />
                  <meshStandardMaterial color="#0f172a" roughness={0.4} transparent={dim} opacity={op} />
                </mesh>
              ) : null}
            </group>
          </group>
        ))}
      </group>
      {children}
    </group>
  );
}

function ArmourPlates({ accent, dim }: { accent: string; dim: boolean }) {
  const op = dim ? 0.35 : 1;
  return (
    <group>
      <mesh position={[0, 0.42, 0.2]} rotation={[0.1, 0, 0]}>
        <boxGeometry args={[0.36, 0.22, 0.05]} />
        <meshStandardMaterial color="#0f172a" metalness={0.7} roughness={0.3} emissive={accent} emissiveIntensity={0.18} transparent={dim} opacity={op} />
      </mesh>
      <mesh position={[0, 0.3, 0.24]}>
        <boxGeometry args={[0.02, 0.34, 0.01]} />
        <meshBasicMaterial color={accent} toneMapped={false} transparent={dim} opacity={op} />
      </mesh>
      <mesh position={[0, 0.5, 0.235]}>
        <boxGeometry args={[0.3, 0.012, 0.01]} />
        <meshBasicMaterial color={accent} toneMapped={false} transparent={dim} opacity={op} />
      </mesh>
      <mesh position={[0, 0.14, 0.2]}>
        <boxGeometry args={[0.3, 0.05, 0.03]} />
        <meshStandardMaterial color="#0f172a" metalness={0.7} roughness={0.3} transparent={dim} opacity={op} />
      </mesh>
    </group>
  );
}

function Head({
  avatar,
  color,
  dim,
  skinMat,
  eyesRef,
  lidL,
  lidR,
}: {
  avatar: Avatar;
  color: string;
  dim: boolean;
  skinMat: ReactNode;
  eyesRef: RefObject<THREE.Group | null>;
  lidL: RefObject<THREE.Mesh | null>;
  lidR: RefObject<THREE.Mesh | null>;
}) {
  const animal = avatar.kind !== "human";
  const op = dim ? 0.35 : 1;
  const eyeZ = animal ? 0.15 : 0.17;
  const eyeY = animal ? 0.05 : 0.03;
  return (
    <group>
      {/* skull + jaw (slightly squashed sphere) */}
      <mesh castShadow scale={[1, 1.04, animal ? 1 : 0.96]}>
        <sphereGeometry args={[HEAD_R, 20, 18]} />
        {skinMat}
      </mesh>
      <mesh position={[0, -0.1, 0.02]} scale={[0.86, 0.6, 0.86]}>
        <sphereGeometry args={[HEAD_R, 16, 12]} />
        {skinMat}
      </mesh>
      {/* nose / snout */}
      {animal ? (
        <group>
          <mesh position={[0, -0.03, 0.17]} scale={[1, 0.75, 1]}>
            <sphereGeometry args={[0.1, 12, 12]} />
            {skinMat}
          </mesh>
          <mesh position={[0, 0, 0.26]}>
            <sphereGeometry args={[0.03, 8, 8]} />
            <meshStandardMaterial color="#0a0a0a" roughness={0.4} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * 0.14, 0.22, -0.02]} rotation={[0, 0, -side * 0.3]}>
              <coneGeometry args={[0.065, 0.14, 8]} />
              {skinMat}
            </mesh>
          ))}
          {avatar.spots
            ? [-1, 1].map((side) => (
                <mesh key={side} position={[side * 0.07, -0.02, 0.185]} rotation={[0, 0, side * 0.2]}>
                  <boxGeometry args={[0.012, 0.09, 0.01]} />
                  <meshStandardMaterial color="#2a1d0c" />
                </mesh>
              ))
            : null}
        </group>
      ) : (
        <mesh position={[0, -0.01, 0.195]} scale={[0.6, 1, 0.8]}>
          <sphereGeometry args={[0.035, 8, 8]} />
          {skinMat}
        </mesh>
      )}
      {/* eyes: whites + pupils in a group that turns toward the camera; lids blink */}
      <group ref={eyesRef}>
        {[-1, 1].map((side) => (
          <group key={side} position={[side * 0.075, eyeY, eyeZ]}>
            <mesh>
              <sphereGeometry args={[0.03, 10, 10]} />
              {animal ? <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.2} transparent={dim} opacity={op} /> : <meshStandardMaterial color="#f8fafc" roughness={0.3} transparent={dim} opacity={op} />}
            </mesh>
            <mesh position={[0, 0, 0.024]}>
              <sphereGeometry args={[0.013, 8, 8]} />
              <meshStandardMaterial color="#0b0f19" />
            </mesh>
            <mesh ref={side < 0 ? lidL : lidR} position={[0, 0.005, 0.03]} scale={[1, 0.02, 1]}>
              <circleGeometry args={[0.034, 12]} />
              <meshStandardMaterial color={animal ? avatar.skin : "#3b2a1e"} side={THREE.DoubleSide} />
            </mesh>
          </group>
        ))}
      </group>
      {!animal ? <HumanHair avatar={avatar} /> : null}
      {avatar.glasses ? <Glasses tint={avatar.glassesTint} smart={animal} accent={color} /> : null}
      {avatar.headset ? <Headset accent={color} phones={avatar.hair === "hoodie"} /> : null}
    </group>
  );
}

function HumanHair({ avatar }: { avatar: Avatar }) {
  const mat = <meshStandardMaterial color={avatar.hairColor} roughness={0.9} />;
  switch (avatar.hair) {
    case "hoodie":
      return (
        <group>
          <mesh position={[0, 0.02, -0.03]} scale={[1.25, 1.2, 1.22]}>
            <sphereGeometry args={[HEAD_R + 0.02, 18, 14, Math.PI * 0.16, Math.PI * 1.68, 0, Math.PI * 0.8]} />
            <meshStandardMaterial color={avatar.outfit} roughness={0.95} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, -0.2, 0]} rotation={[0.25, 0, 0]}>
            <torusGeometry args={[0.23, 0.045, 8, 20]} />
            <meshStandardMaterial color={avatar.outfit} roughness={0.95} />
          </mesh>
          {/* a little hair visible under the hood */}
          <mesh position={[0, 0.1, 0.1]} scale={[1, 0.5, 1]}>
            <sphereGeometry args={[0.16, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            {mat}
          </mesh>
        </group>
      );
    case "hijab":
      return (
        <group>
          <mesh position={[0, 0.01, -0.01]} scale={[1.16, 1.16, 1.14]}>
            <sphereGeometry args={[HEAD_R + 0.01, 20, 14, Math.PI * 0.2, Math.PI * 1.6, 0, Math.PI * 0.98]} />
            <meshStandardMaterial color={avatar.hairColor} roughness={0.8} side={THREE.DoubleSide} />
          </mesh>
          {/* drape to the shoulders */}
          <mesh position={[0, -0.3, -0.04]} scale={[1.25, 1, 0.9]}>
            <capsuleGeometry args={[0.2, 0.18, 4, 14]} />
            <meshStandardMaterial color={avatar.hairColor} roughness={0.8} />
          </mesh>
          <mesh position={[0, -0.22, 0.14]} rotation={[0.3, 0, 0]}>
            <torusGeometry args={[0.17, 0.035, 8, 20, Math.PI]} />
            <meshStandardMaterial color={avatar.hairColor} roughness={0.8} />
          </mesh>
        </group>
      );
    case "long":
      return (
        <group>
          <mesh position={[0, 0.05, -0.02]} scale={[1.07, 1, 1.06]}>
            <sphereGeometry args={[HEAD_R + 0.01, 18, 12, 0, Math.PI * 2, 0, Math.PI / 1.75]} />
            {mat}
          </mesh>
          <mesh position={[0, -0.16, -0.12]} scale={[1, 1.1, 0.7]}>
            <sphereGeometry args={[HEAD_R, 14, 12, 0, Math.PI * 2, Math.PI / 3, Math.PI / 2]} />
            {mat}
          </mesh>
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * 0.17, -0.22, -0.04]} rotation={[0.05, 0, side * 0.08]}>
              <capsuleGeometry args={[0.055, 0.34, 4, 8]} />
              {mat}
            </mesh>
          ))}
          <mesh position={[0, -0.28, -0.14]} rotation={[0.1, 0, 0]}>
            <boxGeometry args={[0.28, 0.3, 0.08]} />
            {mat}
          </mesh>
          <mesh position={[0.04, 0.13, 0.15]} rotation={[0.55, 0, -0.15]}>
            <boxGeometry args={[0.24, 0.04, 0.14]} />
            {mat}
          </mesh>
        </group>
      );
    default:
      return (
        <mesh position={[0, 0.06, -0.02]} scale={[1.03, 0.75, 1.03]}>
          <sphereGeometry args={[HEAD_R + 0.005, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          {mat}
        </mesh>
      );
  }
}

function Glasses({ tint, smart, accent }: { tint: string; smart: boolean; accent: string }) {
  const frame = <meshStandardMaterial color="#0f172a" metalness={0.6} roughness={0.3} />;
  return (
    <group position={[0, 0.04, smart ? 0.19 : 0.18]}>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 0.075, 0, 0]}>
          <mesh>
            <torusGeometry args={[0.05, 0.008, 8, 20]} />
            {frame}
          </mesh>
          <mesh>
            <circleGeometry args={[0.046, 16]} />
            <meshStandardMaterial color={tint} transparent opacity={0.45} emissive={smart ? accent : tint} emissiveIntensity={smart ? 0.45 : 0.1} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          <mesh position={[side * 0.08, 0.01, -0.09]} rotation={[0, Math.PI / 2, 0]}>
            <boxGeometry args={[0.18, 0.01, 0.008]} />
            {frame}
          </mesh>
        </group>
      ))}
      <mesh>
        <boxGeometry args={[0.05, 0.008, 0.008]} />
        {frame}
      </mesh>
    </group>
  );
}

function Headset({ accent, phones }: { accent: string; phones: boolean }) {
  return (
    <group>
      <mesh position={[0, 0.08, 0]}>
        <torusGeometry args={[HEAD_R + 0.015, 0.016, 8, 24, Math.PI]} />
        <meshStandardMaterial color="#1f2937" metalness={0.6} roughness={0.3} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * (HEAD_R + 0.02), 0, 0]}>
          <mesh rotation={[0, Math.PI / 2, 0]}>
            <cylinderGeometry args={[phones ? 0.075 : 0.055, phones ? 0.075 : 0.055, 0.05, 14]} />
            <meshStandardMaterial color="#111827" metalness={0.5} roughness={0.4} />
          </mesh>
          <mesh position={[side * 0.03, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <torusGeometry args={[phones ? 0.05 : 0.038, 0.006, 6, 16]} />
            <meshBasicMaterial color={accent} toneMapped={false} />
          </mesh>
        </group>
      ))}
      {!phones ? (
        <mesh position={[-0.14, -0.09, 0.13]} rotation={[0, 0.6, 0.35]}>
          <cylinderGeometry args={[0.007, 0.007, 0.2, 6]} />
          <meshStandardMaterial color="#334155" />
        </mesh>
      ) : null}
    </group>
  );
}
