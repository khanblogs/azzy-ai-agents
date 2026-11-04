"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { SERVER_CENTER } from "./layout";

const CYAN = "#00E5FF";

/** Server-room corner (from the Azzy Labs concept mock): four racks against the
 * back wall behind a glass front. The LED dots blink continuously and turn red
 * while any registered environment reports health "down". */
export function ServerRoom({ alert }: { alert: boolean }) {
  const [cx, , cz] = SERVER_CENTER;
  const dots = useRef<THREE.Group>(null);
  const t = useRef(0);
  useFrame((_, dt) => {
    t.current += dt;
    const g = dots.current;
    if (!g) return;
    g.children.forEach((child, i) => {
      const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.opacity = Math.sin(t.current * 2.6 + i * 1.93) > -0.3 ? 1 : 0.2;
    });
  });
  const rackXs = [-1.83, -0.61, 0.61, 1.83];
  const dotColor = (i: number) => (alert ? "#f87171" : i % 3 === 0 ? "#34D399" : CYAN);
  return (
    <group position={[cx, 0, cz]}>
      {/* floor pad */}
      <mesh position={[0, 0.02, 0.35]} receiveShadow>
        <boxGeometry args={[4.9, 0.04, 2.2]} />
        <meshStandardMaterial color="#0a0e1a" roughness={0.6} metalness={0.3} />
      </mesh>
      {rackXs.map((x, r) => (
        <group key={r} position={[x, 0, 0]}>
          <mesh position={[0, 1.15, 0]} castShadow>
            <boxGeometry args={[1.05, 2.3, 0.75]} />
            <meshStandardMaterial color="#0a0f1e" roughness={0.5} metalness={0.4} />
          </mesh>
          <mesh position={[0, 1.15, 0.39]}>
            <boxGeometry args={[0.92, 2.12, 0.03]} />
            <meshStandardMaterial color="#101a30" roughness={0.35} metalness={0.5} />
          </mesh>
          <mesh position={[0, 2.32, 0.39]}>
            <boxGeometry args={[0.92, 0.045, 0.02]} />
            <meshBasicMaterial color={alert ? "#f87171" : CYAN} toneMapped={false} />
          </mesh>
        </group>
      ))}
      {/* blinking LED dots on the rack fronts (local coords inside the group) */}
      <group ref={dots}>
        {rackXs.flatMap((x, r) =>
          [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <mesh key={`${r}-${i}`} position={[x + (i % 2 === 0 ? -0.24 : 0.24), 0.45 + Math.floor(i / 2) * 0.42, 0.41]}>
              <sphereGeometry args={[0.032, 8, 8]} />
              <meshBasicMaterial color={dotColor(r * 8 + i)} toneMapped={false} transparent />
            </mesh>
          )),
        )}
      </group>
      {/* glass front + side frames */}
      <mesh position={[0, 1.3, 1.15]}>
        <planeGeometry args={[4.9, 2.6]} />
        <meshStandardMaterial color="#bae6fd" transparent opacity={0.1} roughness={0.08} metalness={0.1} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {[-2.45, 2.45].map((x) => (
        <mesh key={x} position={[x, 1.3, 1.15]}>
          <boxGeometry args={[0.06, 2.6, 0.06]} />
          <meshStandardMaterial color="#1e293b" roughness={0.4} metalness={0.6} />
        </mesh>
      ))}
      {/* glowing sign */}
      <group position={[0, 3.05, 0.45]}>
        <mesh position={[0, 0, -0.03]}>
          <planeGeometry args={[3.2, 0.8]} />
          <meshStandardMaterial color="#05070d" />
        </mesh>
        <Text fontSize={0.44} color={CYAN} anchorX="center" anchorY="middle" letterSpacing={0.12} outlineWidth={0.018} outlineColor={CYAN} outlineBlur={0.07}>
          SERVER ROOM
        </Text>
      </group>
    </group>
  );
}
