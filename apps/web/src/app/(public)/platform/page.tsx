import type { Metadata } from "next";
import { CTA, Feature, PageHero, Section } from "@/components/PublicSections";

export const metadata: Metadata = { title: "Platform" };

const PAGES = [
  ["Command Center", "Live KPIs, office status, approvals, active tasks, agent messages and spend."],
  ["Virtual Agent Office", "3D office with five desks, a holographic orchestration table, LED wall and five camera modes."],
  ["Agents & chat", "Profile, tools, memories, live sandbox log and a streaming chat with each agent."],
  ["Collaboration", "SVG graph of agent-to-agent handoffs with the orchestrator as hub."],
  ["Tasks", "Pipeline board, cancel, drawer with the messages tab."],
  ["AWS Accounts", "Three-step onboarding wizard: scope → CloudFormation → verify."],
  ["Infrastructure", "Environments with health probes and a per-account inventory viewer."],
  ["Deployments", "Pre-checks, approval, execution lock, verification, rollback."],
  ["Monitoring", "System metrics, environment health, incidents and the LED-wall feed."],
  ["Security", "Findings, release gate, authorised targets, run audit."],
  ["Knowledge", "Runbooks and documents with permission-aware retrieval."],
  ["Reports", "Decks, models and PDFs produced by the agents."],
  ["Approvals", "Pending and history, role-gated Approve / Reject with countdown."],
  ["Integrations · Settings · Audit", "Connector status, MFA, users, budgets, retention, contact inbox, append-only audit."],
];

export default function PlatformPage() {
  return (
    <div>
      <PageHero eyebrow="Platform" title="A command center for an office that runs itself — within the limits you set." lead="Everything the agents do is an event. The portal subscribes to all of them, so every page is live without refreshing." />
      <Section eyebrow="Portal" title="Sixteen pages, one WebSocket." lead="Built with Next.js 15, React Three Fiber and zustand; charts and graphs are hand-drawn SVG, no heavy dependencies.">
        <div className="grid gap-3 md:grid-cols-2">
          {PAGES.map(([t, d]) => (
            <div key={t} className="flex gap-3 rounded-2xl border border-white/10 bg-midnight/60 p-4">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-cyan" />
              <div>
                <h3 className="text-sm font-semibold text-white">{t}</h3>
                <p className="mt-1 text-sm text-slate-400">{d}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>
      <Section eyebrow="Modes" title="DEMO=1 by default. DEMO=0 when you are ready." lead="In DEMO mode the LLM is a deterministic stub and every tool returns realistic, labelled output — the whole system runs end-to-end with zero cloud keys.">
        <div className="grid gap-4 md:grid-cols-3">
          <Feature title="Honest labelling" accent="#FFB547">
            Every simulated payload carries demo: true and the UI shows a DEMO chip. Buttons that cannot act are disabled with the reason.
          </Feature>
          <Feature title="Same code path" accent="#00E5FF">
            Routing, policy, approvals, collaboration bounds and audit behave identically in both modes — only the tool back-ends change.
          </Feature>
          <Feature title="Switching" accent="#9747FF">
            Set DEMO=0, provide Bedrock (or Anthropic / OpenAI) credentials, AWS roles and Tailscale, then restart the stack.
          </Feature>
        </div>
      </Section>
      <CTA />
    </div>
  );
}
