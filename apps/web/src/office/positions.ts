import * as THREE from "three";
import type { AgentId } from "@azzy/events";

/** Live world positions of the characters, written by Character every frame and read by the camera rig. */
export const agentPositions = new Map<AgentId, THREE.Vector3>();
