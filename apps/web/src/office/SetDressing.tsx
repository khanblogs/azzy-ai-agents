"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { POD_CENTER, SERVER_CENTER } from "./layout";
import { CeilingRing } from "./Interior";

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

/** Sunset city windows on the left wall (concept poster's left side): a single
 * painted canvas texture — gradient sky, sun, skyline silhouette with lit
 * windows — reused across three framed panels. No external assets. */
export function SunsetWindows() {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 576;
    const g = c.getContext("2d");
    if (g) {
      let seed = 42;
      const rnd = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      const sky = g.createLinearGradient(0, 0, 0, 576);
      sky.addColorStop(0, "#1e1b4b");
      sky.addColorStop(0.4, "#7c2d52");
      sky.addColorStop(0.68, "#ea580c");
      sky.addColorStop(0.85, "#f59e0b");
      sky.addColorStop(1, "#fbbf24");
      g.fillStyle = sky;
      g.fillRect(0, 0, 1024, 576);
      // sun + glow
      const glow = g.createRadialGradient(700, 372, 8, 700, 372, 150);
      glow.addColorStop(0, "rgba(253,224,71,0.6)");
      glow.addColorStop(1, "rgba(253,224,71,0)");
      g.fillStyle = glow;
      g.fillRect(520, 192, 360, 360);
      g.fillStyle = "#fde68a";
      g.beginPath();
      g.arc(700, 372, 46, 0, Math.PI * 2);
      g.fill();
      // far skyline
      g.fillStyle = "rgba(59,29,94,0.55)";
      let x = 0;
      while (x < 1024) {
        const w = 40 + rnd() * 70;
        const h = 90 + rnd() * 130;
        g.fillRect(x, 470 - h, w, h);
        x += w + 6;
      }
      // near skyline with lit windows
      x = 0;
      while (x < 1024) {
        const w = 55 + rnd() * 85;
        const h = 150 + rnd() * 190;
        const top = 576 - h;
        g.fillStyle = "#12081f";
        g.fillRect(x, top, w, h);
        g.fillStyle = "rgba(252,211,77,0.85)";
        for (let wx = x + 8; wx < x + w - 8; wx += 15) {
          for (let wy = top + 12; wy < 560; wy += 19) {
            if (rnd() > 0.45) g.fillRect(wx, wy, 5, 7);
          }
        }
        x += w + 8;
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, []);
  return (
    <group>
      {[-4.5, 0.5, 5.5].map((z) => (
        <group key={z} position={[-15.82, 3.55, z]} rotation={[0, Math.PI / 2, 0]}>
          <mesh position={[0, 0, -0.04]}>
            <boxGeometry args={[5.0, 2.9, 0.08]} />
            <meshStandardMaterial color="#111827" roughness={0.4} metalness={0.5} />
          </mesh>
          <mesh>
            <planeGeometry args={[4.7, 2.6]} />
            <meshBasicMaterial map={tex} toneMapped={false} />
          </mesh>
          <mesh position={[0, 0, 0.012]}>
            <boxGeometry args={[0.05, 2.6, 0.02]} />
            <meshStandardMaterial color="#111827" roughness={0.4} metalness={0.5} />
          </mesh>
          <mesh position={[0, 0, 0.012]}>
            <boxGeometry args={[4.7, 0.05, 0.02]} />
            <meshStandardMaterial color="#111827" roughness={0.4} metalness={0.5} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Glass meeting pod (concept mock) in the back-right corner. Decorative set
 * dressing — live meetings still happen at the orchestration table. */
export function MeetingPod() {
  const [px, , pz] = POD_CENTER;
  const W = 5;
  const D = 4.6;
  const H = 3.1;
  const glassMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#bae6fd",
        transparent: true,
        opacity: 0.13,
        roughness: 0.06,
        metalness: 0.1,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    [],
  );
  const frame = <meshStandardMaterial color="#1e293b" roughness={0.4} metalness={0.6} />;
  return (
    <group position={[px, 0, pz]}>
      {/* floor pad */}
      <mesh position={[0, 0.02, 0]} receiveShadow>
        <boxGeometry args={[W + 0.4, 0.04, D + 0.4]} />
        <meshStandardMaterial color="#0d1230" roughness={0.5} metalness={0.35} />
      </mesh>
      {/* glass walls (front keeps a door gap on its left half) */}
      <mesh position={[0, H / 2, -D / 2]} material={glassMat}>
        <planeGeometry args={[W, H]} />
      </mesh>
      <mesh position={[-W / 2, H / 2, 0]} rotation={[0, Math.PI / 2, 0]} material={glassMat}>
        <planeGeometry args={[D, H]} />
      </mesh>
      <mesh position={[W / 2, H / 2, 0]} rotation={[0, Math.PI / 2, 0]} material={glassMat}>
        <planeGeometry args={[D, H]} />
      </mesh>
      <mesh position={[W / 4, H / 2, D / 2]} material={glassMat}>
        <planeGeometry args={[W / 2, H]} />
      </mesh>
      {/* corner posts + top frame */}
      {[
        [-W / 2, -D / 2],
        [W / 2, -D / 2],
        [-W / 2, D / 2],
        [W / 2, D / 2],
      ].map(([x, z]) => (
        <mesh key={`${x}-${z}`} position={[x, H / 2, z]}>
          <boxGeometry args={[0.07, H, 0.07]} />
          {frame}
        </mesh>
      ))}
      <mesh position={[0, H, -D / 2]}>
        <boxGeometry args={[W + 0.08, 0.08, 0.08]} />
        {frame}
      </mesh>
      <mesh position={[0, H, D / 2]}>
        <boxGeometry args={[W + 0.08, 0.08, 0.08]} />
        {frame}
      </mesh>
      <mesh position={[-W / 2, H, 0]}>
        <boxGeometry args={[0.08, 0.08, D + 0.08]} />
        {frame}
      </mesh>
      <mesh position={[W / 2, H, 0]}>
        <boxGeometry args={[0.08, 0.08, D + 0.08]} />
        {frame}
      </mesh>
      {/* round table + stools */}
      <mesh position={[0, 0.74, 0]} castShadow>
        <cylinderGeometry args={[0.85, 0.85, 0.05, 28]} />
        <meshStandardMaterial color="#0f172a" metalness={0.5} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0.37, 0]}>
        <cylinderGeometry args={[0.07, 0.09, 0.72, 10]} />
        <meshStandardMaterial color="#64748b" metalness={0.8} roughness={0.3} />
      </mesh>
      {[0, 90, 180, 270].map((deg) => {
        const a = (deg * Math.PI) / 180;
        return (
          <mesh key={deg} position={[Math.cos(a) * 1.3, 0.45, Math.sin(a) * 1.3]} castShadow>
            <cylinderGeometry args={[0.26, 0.22, 0.09, 16]} />
            <meshStandardMaterial color="#1e293b" roughness={0.7} />
          </mesh>
        );
      })}
      <CeilingRing position={[0, H - 0.18, 0]} radius={1.1} color="#9747FF" />
      <pointLight position={[0, 2.4, 0]} intensity={6} distance={7} decay={2} color="#9747FF" />
      <Text position={[0, H + 0.48, 0]} fontSize={0.3} color="#c4b5fd" anchorX="center" anchorY="middle" letterSpacing={0.16}>
        AGENT MEETING POD
      </Text>
    </group>
  );
}

