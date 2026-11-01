import type { Metadata } from "next";
import { DeploymentsView } from "./DeploymentsView";

export const metadata: Metadata = { title: "Deployments" };

export default function DeploymentsPage() {
  return <DeploymentsView />;
}
