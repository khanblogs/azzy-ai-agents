import type { Metadata } from "next";
import { CTA, Feature, PageHero, Section } from "@/components/PublicSections";

export const metadata: Metadata = { title: "Security" };

export default function SecurityPublicPage() {
  return (
    <div>
      <PageHero eyebrow="Security model" title="Built on the assumption that an agent will eventually try something it shouldn’t." lead="So the guard rails do not depend on the model behaving: allowlists, policy, approvals, scoping, scrubbing and audit sit between every agent and the world." />
      <Section eyebrow="Controls" title="Layers, not promises.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Feature title="Tool allowlist" accent="#9747FF">
            Agents can only call tools named in their YAML and in policy.yaml’s global allowlist. There is no shell tool; ssh.safe_action accepts seven verbs.
          </Feature>
          <Feature title="Risk classification" accent="#F04DFF">
            Overrides → environment rules → tool defaults → default medium. Prod deploys, IAM reads, DDL in SQL and PRs to main are forced to high.
          </Feature>
          <Feature title="Approvals with RBAC" accent="#FFB547">
            Only admin or the agent’s domain role may decide; requests expire after an hour; every decision is audited with actor and IP.
          </Feature>
          <Feature title="Injection guard + PII scrub" accent="#00E5FF">
            Every tool output is checked for prompt-injection patterns and scrubbed of PII before a model sees it.
          </Feature>
          <Feature title="AWS least privilege" accent="#34D399">
            Three role scopes, External ID encrypted at rest and never returned, per-tool scope requirements, read-only inventory calls.
          </Feature>
          <Feature title="Platform hardening" accent="#9747FF">
            httpOnly SameSite cookies, TOTP MFA, login rate limit, CSRF header on writes, append-only audit, secrets by reference only.
          </Feature>
        </div>
      </Section>
      <Section eyebrow="Honesty" title="Limitations, stated plainly." lead="OIDC is not implemented (local auth + TOTP only). Single-node pilot without HA. LangGraph is not used — the orchestrator is our own typed state machine. Grafana / Prometheus dashboards are not bundled (metrics endpoint only). Scanners run only if their binaries are in the image. Real-mode integrations are not verified in CI." />
      <CTA title="Review it yourself" lead="The policy file, the role templates and the audit trail are all in the repository and the portal." />
    </div>
  );
}
