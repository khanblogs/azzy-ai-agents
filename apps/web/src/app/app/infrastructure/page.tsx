import type { Metadata } from "next";
import { Suspense } from "react";
import { InfrastructureView } from "./InfrastructureView";

export const metadata: Metadata = { title: "Infrastructure" };

export default function InfrastructurePage() {
  return (
    <Suspense fallback={null}>
      <InfrastructureView />
    </Suspense>
  );
}
