import type { Metadata } from "next";
import { SecurityView } from "./SecurityView";

export const metadata: Metadata = { title: "Security" };

export default function SecurityPage() {
  return <SecurityView />;
}
