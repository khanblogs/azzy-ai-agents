import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AGENT_IDS, AGENT_META, type AgentId } from "@azzy/events";
import { AgentProfile } from "./AgentProfile";

export function generateStaticParams() {
  return AGENT_IDS.map((id) => ({ id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const meta = (AGENT_IDS as string[]).includes(id) ? AGENT_META[id as AgentId] : null;
  return { title: meta ? `${meta.name} · ${meta.short}` : "Agent" };
}

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(AGENT_IDS as string[]).includes(id)) notFound();
  return <AgentProfile id={id as AgentId} />;
}
