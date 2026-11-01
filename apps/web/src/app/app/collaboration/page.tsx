import type { Metadata } from "next";
import { CollaborationView } from "./CollaborationView";

export const metadata: Metadata = { title: "Collaboration" };

export default function CollaborationPage() {
  return <CollaborationView />;
}
