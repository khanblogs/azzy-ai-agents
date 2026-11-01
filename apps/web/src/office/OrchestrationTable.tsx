"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { AGENT_IDS } from "@azzy/events";
import { CeilingRing } from "./Interior";
import { TABLE_ANGLES, TABLE_CENTER, TABLE_RADIUS, TABLE_STOOL_RADIUS } from "./layout";

const DEG = Math.PI / 180;

/** Central holographic orchestration table — the orchestrator's presence in the office. */
export function OrchestrationTable({ active }: { active: boolean }) {
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
      {/* holographic "A" + orbiting rings */}
      <group ref={holo} position={[0, 1.75, 0]}>
        <Text fontSize={0.9} color="#00E5FF" anchorX="center" anchorY="middle" outlineWidth={0.03} outlineColor="#9747FF" outlineBlur={0.2} fillOpacity={0.9}>
          A
        </Text>
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
