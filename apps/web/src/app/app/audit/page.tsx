import type { Metadata } from "next";
import { AuditView } from "./AuditView";

export const metadata: Metadata = { title: "Audit" };

export default function AuditPage() {
  return <AuditView />;
}
