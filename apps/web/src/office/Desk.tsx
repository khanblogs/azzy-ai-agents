"use client";

import { RoundedBox, Text } from "@react-three/drei";
import * as THREE from "three";
import { AGENT_META, type AgentId } from "@azzy/events";
import { DESKS } from "./layout";

export interface DeskProps {
  id: AgentId;
  statusColor: string;
  /** Screens glow brighter while the agent is actively working. */
  active: boolean;
}

function Monitor({ x, tilt, color, active }: { x: number; tilt: number; color: string; active: boolean }) {
  return (
    <group position={[x, 1.02, -0.32]} rotation={[-0.08, tilt, 0]}>
      {/* stand */}
      <mesh position={[0, -0.12, 0.02]}>
        <boxGeometry args={[0.08, 0.2, 0.08]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, -0.21, 0.02]}>
        <cylinderGeometry args={[0.16, 0.18, 0.02, 16]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* bezel */}
      <RoundedBox args={[0.96, 0.58, 0.04]} radius={0.02} smoothness={2} position={[0, 0.17, 0]}>
        <meshStandardMaterial color="#0b0f19" roughness={0.4} metalness={0.5} />
      </RoundedBox>
      {/* screen */}
      <mesh position={[0, 0.17, 0.022]}>
        <planeGeometry args={[0.88, 0.5]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={active ? 1.6 : 0.55}
          roughness={0.6}
          toneMapped={false}
        />
      </mesh>
      {/* faux code lines */}
      {[0.3, 0.22, 0.14, 0.06, -0.02].map((y, i) => (
        <mesh key={i} position={[-0.3 + (i % 2) * 0.08, y, 0.026]}>
          <planeGeometry args={[0.2 + (i % 3) * 0.12, 0.02]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.55} />
        </mesh>
      ))}
    </group>
  );
}

export function Desk({ id, statusColor, active }: DeskProps) {
  const [x, , z] = DESKS[id];
  const color = AGENT_META[id].color;
  const name = AGENT_META[id].name;
  return (
    <group position={[x, 0, z]}>
      {/* floating white top, no legs */}
      <RoundedBox args={[2.8, 0.1, 1.3]} radius={0.04} smoothness={3} position={[0, 0.78, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#f8fafc" roughness={0.35} metalness={0.05} />
      </RoundedBox>
      {/* soft underglow / status strip */}
      <mesh position={[0, 0.71, 0]}>
        <boxGeometry args={[2.6, 0.02, 1.1]} />
        <meshBasicMaterial color={statusColor} toneMapped={false} transparent opacity={0.9} />
      </mesh>
      <pointLight position={[0, 0.6, 0]} intensity={2.2} distance={2.8} decay={2} color={statusColor} />
      {/* glass privacy panel at the back of the desk */}
      <mesh position={[0, 1.18, -0.62]}>
        <boxGeometry args={[2.8, 0.7, 0.03]} />
        <meshStandardMaterial color="#bae6fd" transparent opacity={0.25} roughness={0.08} metalness={0.1} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[0, 1.54, -0.62]}>
        <boxGeometry args={[2.8, 0.02, 0.04]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      {/* dual tilted monitors */}
      <Monitor x={-0.55} tilt={0.22} color={color} active={active} />
      <Monitor x={0.55} tilt={-0.22} color={color} active={active} />
      {/* keyboard + mouse, or Marwah's laptop */}
      {id === "marwah" ? (
        <group position={[0, 0.83, 0.25]}>
          <RoundedBox args={[0.62, 0.02, 0.42]} radius={0.01} smoothness={2}>
            <meshStandardMaterial color="#e2e8f0" metalness={0.5} roughness={0.35} />
          </RoundedBox>
          <group position={[0, 0.01, -0.2]} rotation={[-0.35, 0, 0]}>
            <RoundedBox args={[0.62, 0.4, 0.015]} radius={0.01} smoothness={2} position={[0, 0.2, 0]}>
              <meshStandardMaterial color="#cbd5e1" metalness={0.5} roughness={0.35} />
            </RoundedBox>
            <mesh position={[0, 0.2, 0.01]}>
              <planeGeometry args={[0.56, 0.34]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={active ? 1.2 : 0.4} toneMapped={false} />
            </mesh>
          </group>
        </group>
      ) : (
        <>
          <RoundedBox args={[0.7, 0.025, 0.22]} radius={0.01} smoothness={2} position={[0, 0.845, 0.3]}>
            <meshStandardMaterial color="#1e293b" roughness={0.6} />
          </RoundedBox>
          <RoundedBox args={[0.1, 0.03, 0.16]} radius={0.02} smoothness={2} position={[0.55, 0.845, 0.3]}>
            <meshStandardMaterial color="#1e293b" roughness={0.6} />
          </RoundedBox>
        </>
      )}
      {/* name plate at the front edge */}
      <group position={[0, 0.9, 0.6]} rotation={[-0.25, 0, 0]}>
        <RoundedBox args={[0.9, 0.16, 0.03]} radius={0.02} smoothness={2}>
          <meshStandardMaterial color="#0b0f19" roughness={0.3} metalness={0.6} />
        </RoundedBox>
        <Text position={[0, 0, 0.02]} fontSize={0.09} color={color} anchorX="center" anchorY="middle" letterSpacing={0.08}>
          {name.toUpperCase()}
        </Text>
      </group>
      {/* chair */}
      <group position={[0, 0, 1.1]}>
        <mesh position={[0, 0.42, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 0.4, 8]} />
          <meshStandardMaterial color="#64748b" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.03, 0]}>
          <cylinderGeometry args={[0.32, 0.32, 0.04, 5]} />
          <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.4} />
        </mesh>
        <RoundedBox args={[0.6, 0.1, 0.6]} radius={0.04} smoothness={2} position={[0, 0.64, 0]}>
          <meshStandardMaterial color="#1f2937" roughness={0.8} />
        </RoundedBox>
        <RoundedBox args={[0.56, 0.7, 0.08]} radius={0.04} smoothness={2} position={[0, 1.02, 0.3]}>
          <meshStandardMaterial color="#1f2937" roughness={0.8} />
        </RoundedBox>
      </group>
    </group>
  );
}
