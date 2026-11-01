import type { Metadata } from "next";
import { CTA, Feature, PageHero, Section } from "@/components/PublicSections";

export const metadata: Metadata = { title: "Capabilities" };

const TOOLS: [string, string, string][] = [
  ["env.registry · aws.accounts · aws.inventory", "low", "Read the environment and account registry, list resources"],
  ["aws.describe · aws.cost · cloudwatch.logs", "low", "Describe services, read cost explorer and logs"],
  ["github.read · sandbox.run · sql.read", "low", "Read repos, run untrusted code without network, read-only SQL"],
  ["semgrep · gitleaks · trivy · checkov", "low", "Static, secrets, container and IaC scanning"],
  ["pptx.build · xlsx.model · pdf.export · gmail.draft · slack.post", "low", "Produce artifacts and drafts"],
  ["aws.deploy · aws.rollback · ssh.safe_action", "medium → high in prod", "Change running systems; allowlisted SSH commands only"],
  ["github.branch_pr · gcal.schedule · nuclei.scan · zap.scan", "medium", "Open PRs on branches, schedule, dynamic scans on authorised targets"],
  ["gmail.send · zendesk.update", "high", "Anything that leaves the building"],
];

export default function CapabilitiesPage() {
  return (
    <div>
      <PageHero eyebrow="Capabilities" title="Safe tools only. No raw shell. Every call classified." lead="The policy engine resolves a risk level per call: low runs immediately, medium needs approval unless the environment auto-allows it, high always waits. Prod, deletes, IAM, schema changes and client sends are high." />
      <Section eyebrow="Tool catalogue" title="What the agents can touch.">
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-white/5 text-[11px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-2">Tools</th>
                <th className="px-4 py-2">Default risk</th>
                <th className="px-4 py-2">Purpose</th>
              </tr>
            </thead>
            <tbody>
              {TOOLS.map(([t, r, p]) => (
                <tr key={t} className="border-t border-white/10">
                  <td className="px-4 py-2 font-mono text-xs text-brand-cyan">{t}</td>
                  <td className="px-4 py-2 text-xs text-slate-300">{r}</td>
                  <td className="px-4 py-2 text-slate-400">{p}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section eyebrow="Beyond tools" title="Workflows, knowledge and memory.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Feature title="Agent-to-agent collaboration" accent="#F04DFF">
            Handoffs, requests and results are persisted messages. Bounds: depth ≤ 3, ≤ 60 messages per task, ≤ 2 retries per step, step timeout 5 min.
          </Feature>
          <Feature title="Knowledge base" accent="#9747FF">
            Runbooks and uploaded documents, chunked and embedded. Retrieval is scoped to global + the task’s environment or account.
          </Feature>
          <Feature title="Durable memory" accent="#00E5FF">
            One to three memories per task (facts, lessons, skill proposals) with retention policies and XP for learning.
          </Feature>
          <Feature title="Routines" accent="#FFB547">
            Cron from agent YAML: daily fleet report, weekly security audit, Monday growth report — runnable on demand.
          </Feature>
        </div>
      </Section>
      <CTA />
    </div>
  );
}
