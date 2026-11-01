import type { Metadata } from "next";
import { OfficeView } from "@/office/OfficeView";

export const metadata: Metadata = { title: "Agent Office" };

export default function OfficePage() {
  return (
    <div>
      <h1 className="sr-only">Virtual Agent Office</h1>
      <OfficeView />
    </div>
  );
}
