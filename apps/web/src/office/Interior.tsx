"use client";

import { useMemo } from "react";
import { MeshReflectorMaterial, RoundedBox, Text } from "@react-three/drei";
import { BAR_CENTER, LOUNGE_CENTER, ROOM } from "./layout";

const CYAN = "#00E5FF";
const VIOLET = "#9747FF";

export function Floor({ reflective }: { reflective: boolean }) {
  const w = ROOM.halfWidth * 2 + 4;
  const d = ROOM.depthFront - ROOM.depthBack + 4;
  const z = (ROOM.depthFront + ROOM.depthBack) / 2;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, z]} receiveShadow>
      <planeGeometry args={[w, d]} />
      {reflective ? (
        <MeshReflectorMaterial
          blur={[300, 80]}
          resolution={512}
          mixBlur={0.9}
          mixStrength={9}
          roughness={0.9}
          depthScale={1.1}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.3}
          color="#0b0e18"
          metalness={0.55}
          mirror={0.4}
        />
      ) : (
        <meshStandardMaterial color="#0d111c" metalness={0.6} roughness={0.25} />
      )}
    </mesh>
  );
}

export function LedFloorLines() {
  const lines = useMemo(() => {
    const out: { pos: [number, number, number]; size: [number, number, number]; color: string }[] = [];
    // long lines along X in front of and behind the desks
    out.push({ pos: [0, 0.006, 2.6], size: [26, 0.012, 0.06], color: CYAN });
    out.push({ pos: [0, 0.006, -2.2], size: [26, 0.012, 0.06], color: VIOLET });
    // guide lines toward the orchestration table
    out.push({ pos: [-3.6, 0.006, -5.6], size: [0.06, 0.012, 6], color: CYAN });
    out.push({ pos: [3.6, 0.006, -5.6], size: [0.06, 0.012, 6], color: VIOLET });
    // short perpendicular ticks
    for (let x = -12; x <= 12; x += 4) out.push({ pos: [x, 0.006, 4.6], size: [0.06, 0.012, 1.2], color: x % 8 === 0 ? CYAN : VIOLET });
    return out;
  }, []);
  return (
    <group>
      {lines.map((l, i) => (
        <mesh key={i} position={l.pos}>
          <boxGeometry args={l.size} />
          <meshBasicMaterial color={l.color} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

export function Walls() {
  const H = ROOM.height;
  const W = ROOM.halfWidth * 2;
  const backZ = ROOM.depthBack;
  const frontZ = ROOM.depthFront;
  const midZ = (frontZ + backZ) / 2;
  const depth = frontZ - backZ;
  return (
    <group>
      {/* back wall: dark */}
      <mesh position={[0, H / 2, backZ]} receiveShadow>
        <planeGeometry args={[W, H]} />
        <meshStandardMaterial color="#0f1322" roughness={0.9} />
      </mesh>
      {/* side walls: cream */}
      <mesh position={[-ROOM.halfWidth, H / 2, midZ]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[depth, H]} />
        <meshStandardMaterial color="#e9e4d8" roughness={0.95} />
      </mesh>
      <mesh position={[ROOM.halfWidth, H / 2, midZ]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[depth, H]} />
        <meshStandardMaterial color="#e9e4d8" roughness={0.95} />
      </mesh>
      {/* ceiling */}
      <mesh position={[0, H, midZ]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[W, depth]} />
        <meshStandardMaterial color="#0a0d16" roughness={1} />
      </mesh>
      {/* light coves along side walls (cyan left, violet right) */}
      <mesh position={[-ROOM.halfWidth + 0.08, H - 0.5, midZ]}>
        <boxGeometry args={[0.05, 0.08, depth - 1]} />
        <meshBasicMaterial color={CYAN} toneMapped={false} />
      </mesh>
      <mesh position={[ROOM.halfWidth - 0.08, H - 0.5, midZ]}>
        <boxGeometry args={[0.05, 0.08, depth - 1]} />
        <meshBasicMaterial color={VIOLET} toneMapped={false} />
      </mesh>
      {/* low skirting coves */}
      <mesh position={[-ROOM.halfWidth + 0.06, 0.12, midZ]}>
        <boxGeometry args={[0.04, 0.05, depth - 1]} />
        <meshBasicMaterial color={CYAN} toneMapped={false} />
      </mesh>
      <mesh position={[ROOM.halfWidth - 0.06, 0.12, midZ]}>
        <boxGeometry args={[0.04, 0.05, depth - 1]} />
        <meshBasicMaterial color={VIOLET} toneMapped={false} />
      </mesh>
      {/* back wall cove */}
      <mesh position={[0, H - 0.45, backZ + 0.08]}>
        <boxGeometry args={[W - 1, 0.08, 0.05]} />
        <meshBasicMaterial color={VIOLET} toneMapped={false} />
      </mesh>
      {/* ceiling light panels */}
      {[-9, -3, 3, 9].map((x) =>
        [-9, -3, 3].map((z) => (
          <group key={`${x}-${z}`} position={[x, H - 0.03, z]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <planeGeometry args={[2.4, 1.2]} />
              <meshStandardMaterial color="#f8fafc" emissive="#dbeafe" emissiveIntensity={1.15} toneMapped={false} />
            </mesh>
          </group>
        )),
      )}
    </group>
  );
}

export function Plant({ position, scale = 1, variant = 0 }: { position: [number, number, number]; scale?: number; variant?: number }) {
  const greens = ["#2f855a", "#38a169", "#276749", "#48bb78"];
  const g = greens[variant % greens.length];
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.28, 0.22, 0.5, 14]} />
        <meshStandardMaterial color="#1f2937" roughness={0.6} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.24, 0.24, 0.04, 14]} />
        <meshStandardMaterial color="#3f2f1e" roughness={1} />
      </mesh>
      {variant % 2 === 0 ? (
        <group>
          <mesh position={[0, 0.9, 0]} castShadow>
            <sphereGeometry args={[0.42, 12, 12]} />
            <meshStandardMaterial color={g} roughness={0.9} />
          </mesh>
          <mesh position={[0.2, 1.25, 0.1]}>
            <sphereGeometry args={[0.3, 12, 12]} />
            <meshStandardMaterial color={g} roughness={0.9} />
          </mesh>
          <mesh position={[-0.22, 1.2, -0.1]}>
            <sphereGeometry args={[0.26, 12, 12]} />
            <meshStandardMaterial color={g} roughness={0.9} />
          </mesh>
        </group>
      ) : (
        <group>
          <mesh position={[0, 0.95, 0]} castShadow>
            <coneGeometry args={[0.45, 0.9, 10]} />
            <meshStandardMaterial color={g} roughness={0.9} />
          </mesh>
          <mesh position={[0, 1.45, 0]}>
            <coneGeometry args={[0.32, 0.7, 10]} />
            <meshStandardMaterial color={g} roughness={0.9} />
          </mesh>
          <mesh position={[0, 1.85, 0]}>
            <coneGeometry args={[0.18, 0.5, 10]} />
            <meshStandardMaterial color={g} roughness={0.9} />
          </mesh>
        </group>
      )}
    </group>
  );
}

export function Plants() {
  return (
    <group>
      <Plant position={[-13.5, 0, 7]} variant={0} scale={1.1} />
      <Plant position={[13.5, 0, 7]} variant={1} scale={1.1} />
      <Plant position={[-9, 0, 12]} variant={2} />
      <Plant position={[9, 0, -12]} variant={3} />
      <Plant position={[-4.3, 0, -12.5]} variant={1} scale={0.9} />
      <Plant position={[4.3, 0, -12.5]} variant={0} scale={0.9} />
      <Plant position={[-13.6, 0, -6]} variant={3} scale={0.8} />
      <Plant position={[13.6, 0, -6]} variant={2} scale={0.8} />
    </group>
  );
}

function Sofa({ position, rotation = 0, color }: { position: [number, number, number]; rotation?: number; color: string }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <RoundedBox args={[2.4, 0.45, 1]} radius={0.12} smoothness={3} position={[0, 0.3, 0]} castShadow>
        <meshStandardMaterial color={color} roughness={0.85} />
      </RoundedBox>
      <RoundedBox args={[2.4, 0.6, 0.3]} radius={0.1} smoothness={3} position={[0, 0.78, -0.38]} castShadow>
        <meshStandardMaterial color={color} roughness={0.85} />
      </RoundedBox>
      <RoundedBox args={[0.3, 0.5, 1]} radius={0.1} smoothness={3} position={[-1.2, 0.62, 0]}>
        <meshStandardMaterial color={color} roughness={0.85} />
      </RoundedBox>
      <RoundedBox args={[0.3, 0.5, 1]} radius={0.1} smoothness={3} position={[1.2, 0.62, 0]}>
        <meshStandardMaterial color={color} roughness={0.85} />
      </RoundedBox>
    </group>
  );
}

export function Lounge() {
  const [x, , z] = LOUNGE_CENTER;
  return (
    <group>
      <Sofa position={[x, 0, z + 1.6]} rotation={Math.PI} color="#334155" />
      <Sofa position={[x - 1.6, 0, z - 0.4]} rotation={-Math.PI / 2} color="#475569" />
      {/* coffee table */}
      <mesh position={[x + 0.6, 0.36, z - 0.2]} castShadow>
        <cylinderGeometry args={[0.6, 0.6, 0.06, 24]} />
        <meshStandardMaterial color="#e2e8f0" roughness={0.3} metalness={0.2} />
      </mesh>
      <mesh position={[x + 0.6, 0.18, z - 0.2]}>
        <cylinderGeometry args={[0.08, 0.1, 0.34, 10]} />
        <meshStandardMaterial color="#64748b" metalness={0.7} roughness={0.3} />
      </mesh>
      {/* rug */}
      <mesh position={[x, 0.004, z + 0.2]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[2.6, 32]} />
        <meshStandardMaterial color="#1e1b4b" roughness={1} />
      </mesh>
      <pointLight position={[x, 2.4, z]} intensity={8} distance={8} decay={2} color={VIOLET} />
      <Text position={[x, 0.02, z - 2.8]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.32} color="#64748b" anchorX="center" anchorY="middle">
        LOUNGE
      </Text>
    </group>
  );
}

export function FuelBar() {
  const [x, , z] = BAR_CENTER;
  return (
    <group>
      {/* counter */}
      <RoundedBox args={[1.1, 1.05, 4.6]} radius={0.06} smoothness={3} position={[x, 0.52, z]} castShadow>
        <meshStandardMaterial color="#111827" roughness={0.4} metalness={0.3} />
      </RoundedBox>
      <mesh position={[x, 1.07, z]}>
        <boxGeometry args={[1.3, 0.06, 4.8]} />
        <meshStandardMaterial color="#f1f5f9" roughness={0.2} metalness={0.1} />
      </mesh>
      {/* under-counter LED */}
      <mesh position={[x - 0.56, 0.12, z]}>
        <boxGeometry args={[0.03, 0.04, 4.5]} />
        <meshBasicMaterial color={CYAN} toneMapped={false} />
      </mesh>
      {/* stools */}
      {[-1.4, 0, 1.4].map((dz) => (
        <group key={dz} position={[x - 1.3, 0, z + dz]}>
          <mesh position={[0, 0.3, 0]}>
            <cylinderGeometry args={[0.04, 0.04, 0.6, 8]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.02, 0]}>
            <cylinderGeometry args={[0.22, 0.22, 0.04, 16]} />
            <meshStandardMaterial color="#64748b" metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.64, 0]} castShadow>
            <cylinderGeometry args={[0.24, 0.2, 0.09, 16]} />
            <meshStandardMaterial color={VIOLET} roughness={0.6} />
          </mesh>
        </group>
      ))}
      {/* back shelf against the right wall */}
      <mesh position={[x + 3.4, 1.6, z]}>
        <boxGeometry args={[0.3, 0.05, 4.2]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      {[-1.5, -0.5, 0.5, 1.5].map((dz, i) => (
        <mesh key={dz} position={[x + 3.4, 1.84, z + dz]}>
          <cylinderGeometry args={[0.1, 0.12, 0.4, 10]} />
          <meshStandardMaterial color={["#f59e0b", "#00E5FF", "#f472b6", "#a3e635"][i]} emissive={["#f59e0b", "#00E5FF", "#f472b6", "#a3e635"][i]} emissiveIntensity={0.35} roughness={0.3} />
        </mesh>
      ))}
      {/* glowing sign */}
      <group position={[x + 3.6, 3.1, z]} rotation={[0, -Math.PI / 2, 0]}>
        <mesh position={[0, 0, -0.03]}>
          <planeGeometry args={[3.4, 0.9]} />
          <meshStandardMaterial color="#05070d" />
        </mesh>
        <Text fontSize={0.52} color={CYAN} anchorX="center" anchorY="middle" letterSpacing={0.12} outlineWidth={0.02} outlineColor={CYAN} outlineBlur={0.08}>
          FUEL BAR
        </Text>
      </group>
      <pointLight position={[x + 2.2, 2.8, z]} intensity={10} distance={8} decay={2} color={CYAN} />
    </group>
  );
}

export function CeilingRing({ position, radius, color }: { position: [number, number, number]; radius: number; color: string }) {
  return (
    <mesh position={position} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[radius, 0.05, 8, 48]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  );
}
