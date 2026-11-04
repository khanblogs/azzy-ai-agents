import type { AgentId, Spot } from "@azzy/events";

export type Vec3 = [number, number, number];

/** Desk centres from CONTRACT-v2 §10 (X right, Z toward camera). Characters sit at z = +1.1 facing -Z. */
export const DESKS: Record<AgentId, Vec3> = {
  jimmy: [-8, 0, 0],
  emir: [-4, 0, 0],
  cyber: [0, 0, 0],
  sara: [4, 0, 0],
  marwah: [8, 0, 0],
};

export const SEAT_Z_OFFSET = 1.1;

/** Central orchestration table (replaces the v1 meeting pod). Five stools at 72° spacing, radius 1.8. */
export const TABLE_CENTER: Vec3 = [0, 0, 7];
export const TABLE_RADIUS = 1.35;
export const TABLE_STOOL_RADIUS = 1.8;
export const TABLE_ANGLES: Record<AgentId, number> = { jimmy: 18, emir: 90, cyber: 162, sara: 234, marwah: 306 };

export const BAR_CENTER: Vec3 = [12.5, 0, 4];
/** Server-room corner: racks against the back wall, left side. */
export const SERVER_CENTER: Vec3 = [-12.4, 0, -8.15];
export const LOUNGE_CENTER: Vec3 = [-12.5, 0, 4];
export const WALL_CENTER: Vec3 = [0, 3.7, -3.8];
export const WALL_HALF_WIDTH = 10;

const DEG = Math.PI / 180;

export function tableSeat(id: AgentId): Vec3 {
  const a = TABLE_ANGLES[id] * DEG;
  return [TABLE_CENTER[0] + Math.cos(a) * TABLE_STOOL_RADIUS, 0, TABLE_CENTER[2] + Math.sin(a) * TABLE_STOOL_RADIUS];
}

const ORDER: AgentId[] = ["jimmy", "emir", "cyber", "sara", "marwah"];

/** Where an agent stands / sits for a given spot. Bar, lounge and wall fan agents out so they never overlap. */
export function spotPosition(id: AgentId, spot: Spot): Vec3 {
  const i = ORDER.indexOf(id);
  switch (spot) {
    case "desk": {
      const d = DESKS[id];
      return [d[0], 0, d[2] + SEAT_Z_OFFSET];
    }
    case "table":
      return tableSeat(id);
    case "bar":
      return [BAR_CENTER[0] - 1.2, 0, BAR_CENTER[2] + 2.2 - i * 1.1];
    case "lounge":
      return [LOUNGE_CENTER[0] + 1.4, 0, LOUNGE_CENTER[2] + 2.2 - i * 1.1];
    case "wall":
      return [-6 + i * 3, 0, WALL_CENTER[2] + 3.0];
    default:
      return [0, 0, 0];
  }
}

/** Yaw (radians, around +Y) the character should face once it has arrived at a spot. */
export function spotFacing(id: AgentId, spot: Spot): number {
  switch (spot) {
    case "desk":
      return Math.PI; // face -Z (toward the monitors and wall)
    case "table": {
      const p = tableSeat(id);
      return Math.atan2(TABLE_CENTER[0] - p[0], TABLE_CENTER[2] - p[2]);
    }
    case "bar":
      return Math.PI / 2; // face +X (the counter)
    case "lounge":
      return -Math.PI / 2;
    case "wall":
      return Math.PI;
    default:
      return 0;
  }
}

/** Whether the character is seated at this spot. */
export function spotSeated(spot: Spot): boolean {
  return spot === "desk" || spot === "table" || spot === "bar" || spot === "lounge";
}

export const CAMERA_DEFAULT = { position: [0, 9, 19.5] as Vec3, target: [0, 1.6, -1.5] as Vec3 };
export const CAMERA_WALL = { position: [0, 4.4, 9] as Vec3, target: [0, 3.7, -3.8] as Vec3 };
export const CAMERA_TABLE = { position: [0, 6.5, 14.5] as Vec3, target: [0, 1.2, 7] as Vec3 };
/** Isometric-style diagonal view, like the Azzy Labs concept mock. */
export const CAMERA_ISO = { position: [16.5, 13.5, 16.5] as Vec3, target: [0, 1.0, 1.5] as Vec3 };

export const ROOM = { halfWidth: 16, depthBack: -9, depthFront: 14, height: 6.8 };
export const AGENT_ORDER = ORDER;
