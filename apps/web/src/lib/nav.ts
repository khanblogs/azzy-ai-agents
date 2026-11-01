import type { ComponentType, SVGProps } from "react";
import {
  IconApprovals,
  IconAudit,
  IconBook,
  IconChat,
  IconCloud,
  IconGraph,
  IconHome,
  IconMonitor,
  IconOffice,
  IconPlug,
  IconReport,
  IconRocket,
  IconServer,
  IconSettings,
  IconShield,
  IconTasks,
} from "@/components/Icons";

export type RouteKey =
  | "home"
  | "office"
  | "agents"
  | "collaboration"
  | "tasks"
  | "aws-accounts"
  | "infrastructure"
  | "deployments"
  | "monitoring"
  | "security"
  | "knowledge"
  | "reports"
  | "approvals"
  | "integrations"
  | "settings"
  | "audit";

export interface NavItem {
  key: RouteKey;
  href: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operate",
    items: [
      { key: "home", href: "/app", label: "Command Center", Icon: IconHome },
      { key: "office", href: "/app/office", label: "Agent Office", Icon: IconOffice },
      { key: "agents", href: "/app/agents", label: "Agents", Icon: IconChat },
      { key: "collaboration", href: "/app/collaboration", label: "Collaboration", Icon: IconGraph },
      { key: "tasks", href: "/app/tasks", label: "Tasks", Icon: IconTasks },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      { key: "aws-accounts", href: "/app/aws-accounts", label: "AWS Accounts", Icon: IconCloud },
      { key: "infrastructure", href: "/app/infrastructure", label: "Infrastructure", Icon: IconServer },
      { key: "deployments", href: "/app/deployments", label: "Deployments", Icon: IconRocket },
      { key: "monitoring", href: "/app/monitoring", label: "Monitoring", Icon: IconMonitor },
    ],
  },
  {
    label: "Govern",
    items: [
      { key: "security", href: "/app/security", label: "Security", Icon: IconShield },
      { key: "knowledge", href: "/app/knowledge", label: "Knowledge", Icon: IconBook },
      { key: "reports", href: "/app/reports", label: "Reports", Icon: IconReport },
      { key: "approvals", href: "/app/approvals", label: "Approvals", Icon: IconApprovals },
    ],
  },
  {
    label: "Admin",
    items: [
      { key: "integrations", href: "/app/integrations", label: "Integrations", Icon: IconPlug },
      { key: "settings", href: "/app/settings", label: "Settings", Icon: IconSettings },
      { key: "audit", href: "/app/audit", label: "Audit", Icon: IconAudit },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Primary mobile tabs; everything else goes under "More". */
export const MOBILE_PRIMARY: RouteKey[] = ["home", "office", "tasks", "approvals"];

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/app") return pathname === "/app";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export const PUBLIC_LINKS: { href: string; label: string }[] = [
  { href: "/platform", label: "Platform" },
  { href: "/agents", label: "Agents" },
  { href: "/capabilities", label: "Capabilities" },
  { href: "/architecture", label: "Architecture" },
  { href: "/security", label: "Security" },
  { href: "/contact", label: "Contact" },
];
