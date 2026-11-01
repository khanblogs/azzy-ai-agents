import type { ReactNode } from "react";
import { PublicShell } from "@/components/PublicShell";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
