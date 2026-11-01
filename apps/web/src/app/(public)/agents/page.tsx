import type { Metadata } from "next";
import { AGENT_IDS } from "@azzy/events";
import { AgentShowcaseCard, CTA, PageHero, Section } from "@/components/PublicSections";

export const metadata: Metadata = { title: "Agents" };

export default function AgentsPublicPage() {
  return (
    <div>
      <PageHero eyebrow="Agents" title="Meet the five — and the orchestrator behind them." lead="Each agent is defined in YAML: system prompt, allowlisted tools, daily budget, routines and skills. The orchestrator (Azzy) routes work, plans and manages approvals; it is represented in the office by the holographic table, never as a character." />
      <Section eyebrow="Roster" title="Specialists with narrow, auditable powers.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {AGENT_IDS.map((id) => (
            <AgentShowcaseCard key={id} id={id} />
          ))}
        </div>
      </Section>
      <Section eyebrow="Routing" title="How a request finds its owner." lead="A keyword router (with Hinglish verbs) picks the lead and assignees; in real mode one LLM call may refine it. Multi-step requests become a workflow with handoffs between agents.">
        <div className="grid gap-3 text-sm text-slate-300 md:grid-cols-5">
          {[
            ["Jimmy", "deploy · rollback · ecs · eks · ec2 · terraform · k8s · logs · cloudwatch · infra · cost · dns · cloudfront · waf"],
            ["Emir", "code · bug · fix · review · pr · test · refactor · api · schema · model · train · data · notebook"],
            ["Cyber", "security · vapt · pentest · scan · audit · iam · owasp · compliance · secrets · zap · nuclei · release gate"],
            ["Sara", "kpi · report · ops · plan · schedule · ticket · budget · incident summary · resource"],
            ["Marwah", "marketing · campaign · brand · content · social · seo · newsletter · positioning · growth · launch"],
          ].map(([n, k]) => (
            <div key={n} className="rounded-2xl border border-white/10 bg-midnight/60 p-4">
              <h3 className="font-semibold text-white">{n}</h3>
              <p className="mt-1 text-xs text-slate-400">{k}</p>
            </div>
          ))}
        </div>
      </Section>
      <CTA title="Chat with them" lead="Every agent has a conversation pane in the portal. Ask Jimmy what environments exist, ask Cyber what the last scan found." />
    </div>
  );
}
