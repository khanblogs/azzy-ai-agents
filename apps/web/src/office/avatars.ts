import type { AgentId } from "@azzy/events";

export type AvatarKind = "panther" | "cheetah" | "human";
export type HairStyle = "hoodie" | "hijab" | "long" | "none";

export interface Avatar {
  kind: AvatarKind;
  /** fur (animal kinds) or skin (human) */
  skin: string;
  outfit: string;
  accent: string;
  hair: HairStyle;
  hairColor: string;
  headset: boolean;
  glasses: boolean;
  glassesTint: string;
  spots: boolean;
  /** hand-held prop drawn when seated */
  prop: "tablet" | "laptop" | null;
}

/** Mirror of the `avatar:` blocks in packages/agents/*.yaml (the web bundle has no YAML parser). */
export const AVATARS: Record<AgentId, Avatar> = {
  jimmy: { kind: "panther", skin: "#0b0f1a", outfit: "#111827", accent: "#00E5FF", hair: "none", hairColor: "#0b0f1a", headset: true, glasses: false, glassesTint: "#60a5fa", spots: false, prop: null },
  emir: { kind: "cheetah", skin: "#d9a441", outfit: "#1f2937", accent: "#FFB547", hair: "none", hairColor: "#d9a441", headset: true, glasses: true, glassesTint: "#38bdf8", spots: true, prop: null },
  cyber: { kind: "human", skin: "#c68642", outfit: "#0b0b12", accent: "#9747FF", hair: "hoodie", hairColor: "#0b0b12", headset: true, glasses: true, glassesTint: "#60a5fa", spots: false, prop: null },
  sara: { kind: "human", skin: "#f1c27d", outfit: "#1e3a8a", accent: "#F04DFF", hair: "hijab", hairColor: "#efe6d8", headset: false, glasses: false, glassesTint: "#60a5fa", spots: false, prop: "tablet" },
  marwah: { kind: "human", skin: "#e0ac69", outfit: "#f5f0e6", accent: "#34D399", hair: "long", hairColor: "#3b2a1e", headset: false, glasses: false, glassesTint: "#60a5fa", spots: false, prop: "laptop" },
};
