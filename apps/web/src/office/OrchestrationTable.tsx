"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { AGENT_IDS } from "@azzy/events";
import { CeilingRing } from "./Interior";
import { TABLE_ANGLES, TABLE_CENTER, TABLE_RADIUS, TABLE_STOOL_RADIUS } from "./layout";

const DEG = Math.PI / 180;

/** Procedural holographic mini-city on the table disc — the concept poster's centrepiece.
 * Sixteen small emissive blocks on one shared geometry pattern; rotates slowly against the logo. */
function HoloCity({ glow }: { glow: string }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y -= dt * 0.18;
  });
  const buildings = useMemo(() => {
    const pts: [number, number][] = [
      [0.0, 0.0], [0.42, 0.18], [-0.4, 0.3], [0.25, -0.42], [-0.28, -0.38], [0.62, -0.15],
      [-0.65, -0.05], [0.1, 0.62], [-0.15, 0.58], [0.55, 0.45], [-0.55, 0.5], [0.78, 0.28],
      [-0.8, -0.3], [0.35, -0.68], [-0.05, -0.72], [0.05, 0.25],
    ];
    return pts.map(([x, z], i) => ({ x, z, h: 0.14 + ((i * 37) % 10) * 0.035, w: 0.13 + ((i * 13) % 3) * 0.03 }));
  }, []);
  return (
    <group ref={ref} position={[0, 0.79, 0]}>
      {buildings.map((b, i) => (
        <mesh key={i} position={[b.x, b.h / 2, b.z]}>
          <boxGeometry args={[b.w, b.h, b.w]} />
          <meshStandardMaterial color="#082f49" emissive={glow} emissiveIntensity={0.55} transparent opacity={0.8} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

/** Central holographic orchestration table — the orchestrator's presence in the office. */
export function OrchestrationTable({ active, detail = true }: { active: boolean; detail?: boolean }) {
  const [cx, , cz] = TABLE_CENTER;
  const holo = useRef<THREE.Group>(null);
  const ringA = useRef<THREE.Mesh>(null);
  const ringB = useRef<THREE.Mesh>(null);
  const t = useRef(0);

  useFrame((_, dt) => {
    t.current += dt;
    if (holo.current) {
      holo.current.rotation.y += dt * (active ? 1.2 : 0.5);
      holo.current.position.y = 1.75 + Math.sin(t.current * 1.4) * 0.05;
    }
    if (ringA.current) ringA.current.rotation.z += dt * 0.6;
    if (ringB.current) ringB.current.rotation.z -= dt * 0.4;
  });

  const glow = active ? "#00E5FF" : "#9747FF";
  // Brand logo as the hologram (two crossed planes so it never disappears edge-on while spinning).
  const logo = useMemo(() => {
    const tex = new THREE.TextureLoader().load("/brand/azzy-logo-256.png");
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }, []);

  return (
    <group position={[cx, 0, cz]}>
      {/* floor ring */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.0, 3.1, 72]} />
        <meshBasicMaterial color={glow} toneMapped={false} side={THREE.DoubleSide} transparent opacity={0.9} />
      </mesh>
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[3.0, 64]} />
        <meshStandardMaterial color="#0d1330" roughness={0.5} metalness={0.4} />
      </mesh>
      {/* table: dark glass disc on a lit pedestal */}
      <mesh position={[0, 0.36, 0]}>
        <cylinderGeometry args={[0.45, 0.6, 0.72, 24]} />
        <meshStandardMaterial color="#0b1025" metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.74, 0]} castShadow>
        <cylinderGeometry args={[TABLE_RADIUS, TABLE_RADIUS, 0.07, 48]} />
        <meshStandardMaterial color="#0f172a" metalness={0.5} roughness={0.2} />
      </mesh>
      <mesh position={[0, 0.78, 0]}>
        <cylinderGeometry args={[TABLE_RADIUS - 0.12, TABLE_RADIUS - 0.12, 0.012, 48]} />
        <meshStandardMaterial color="#061a2a" emissive={glow} emissiveIntensity={0.5} roughness={0.2} transparent opacity={0.9} />
      </mesh>
      <mesh position={[0, 0.78, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[TABLE_RADIUS - 0.12, TABLE_RADIUS - 0.06, 64]} />
        <meshBasicMaterial color={glow} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      {/* holographic city on the table disc (concept-poster centrepiece) */}
      {detail ? <HoloCity glow={glow} /> : null}
      {/* holographic "A" + orbiting rings */}
      <group ref={holo} position={[0, 1.75, 0]}>
        {[0, Math.PI / 2].map((ry) => (
          <mesh key={ry} rotation={[0, ry, 0]}>
            <planeGeometry args={[1.35, 1.35]} />
            <meshBasicMaterial map={logo} transparent opacity={0.92} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
          </mesh>
        ))}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.72, 0]}>
          <ringGeometry args={[0.55, 0.72, 48]} />
          <meshBasicMaterial color={glow} transparent opacity={0.35} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
        <mesh ref={ringA} rotation={[Math.PI / 2.4, 0, 0]}>
          <torusGeometry args={[0.72, 0.012, 8, 64]} />
          <meshBasicMaterial color="#00E5FF" toneMapped={false} transparent opacity={0.8} />
        </mesh>
        <mesh ref={ringB} rotation={[Math.PI / 1.7, 0.6, 0]}>
          <torusGeometry args={[0.9, 0.01, 8, 64]} />
          <meshBasicMaterial color="#9747FF" toneMapped={false} transparent opacity={0.7} />
        </mesh>
      </group>
      {/* light beam from table to hologram */}
      <mesh position={[0, 1.3, 0]}>
        <cylinderGeometry args={[0.35, 0.9, 1.0, 24, 1, true]} />
        <meshBasicMaterial color={glow} transparent opacity={0.07} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
      {/* five stools at 72° spacing */}
      {AGENT_IDS.map((id) => {
        const a = TABLE_ANGLES[id] * DEG;
        const x = Math.cos(a) * TABLE_STOOL_RADIUS;
        const z = Math.sin(a) * TABLE_STOOL_RADIUS;
        return (
          <group key={id} position={[x, 0, z]}>
            <mesh position={[0, 0.22, 0]}>
              <cylinderGeometry args={[0.04, 0.04, 0.44, 8]} />
              <meshStandardMaterial color="#94a3b8" metalness={0.8} roughness={0.3} />
            </mesh>
            <mesh position={[0, 0.02, 0]}>
              <cylinderGeometry args={[0.2, 0.2, 0.03, 16]} />
              <meshStandardMaterial color="#64748b" metalness={0.8} roughness={0.3} />
            </mesh>
            <mesh position={[0, 0.46, 0]}>
              <cylinderGeometry args={[0.26, 0.22, 0.08, 16]} />
              <meshStandardMaterial color="#1e293b" roughness={0.7} />
            </mesh>
          </group>
        );
      })}
      <CeilingRing position={[0, 3.6, 0]} radius={1.6} color={glow} />
      <pointLight position={[0, 2.4, 0]} intensity={active ? 20 : 9} distance={10} decay={2} color={glow} />
      <Text position={[0, 4.1, 0]} fontSize={0.26} color="#94a3b8" anchorX="center" anchorY="middle" letterSpacing={0.18}>
        AZZY ORCHESTRATOR
      </Text>
    </group>
  );
}
