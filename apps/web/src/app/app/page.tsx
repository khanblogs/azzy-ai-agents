import type { Metadata } from "next";
import { CommandCenter } from "./CommandCenter";

export const metadata: Metadata = { title: "Command Center" };

export default function CommandCenterPage() {
  return <CommandCenter />;
}
