import type { Metadata } from "next";
import { KnowledgeView } from "./KnowledgeView";

export const metadata: Metadata = { title: "Knowledge" };

export default function KnowledgePage() {
  return <KnowledgeView />;
}
