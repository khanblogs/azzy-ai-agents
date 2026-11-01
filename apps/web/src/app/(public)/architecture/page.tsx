import type { Metadata } from "next";
import { CTA, Feature, PageHero, Section } from "@/components/PublicSections";

export const metadata: Metadata = { title: "Architecture" };

export default function ArchitecturePage() {
  return (
    <div>
      <PageHero eyebrow="Architecture" title="One EC2, Docker Compose, typed events end to end." lead="nginx fronts the Next.js portal and the FastAPI API; a worker runs the agent loops; Redis streams carry every event; Postgres with pgvector keeps state, memory, knowledge and audit." />
      <Section eyebrow="High-level design" title="The whole system on one page.">
        <figure className="overflow-hidden rounded-3xl border border-white/10 bg-midnight/60 shadow-glass">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/hld.jpg" alt="High-level design: browser → nginx → web / api / worker → Redis, Postgres, LiteLLM → Bedrock, AWS accounts via AssumeRole, Tailscale SSH targets" className="h-auto w-full" data-testid="hld-image" />
          <figcaption className="px-4 py-3 text-xs text-slate-500">docs/hld-v2.jpg — the same diagram ships in the repository.</figcaption>
        </figure>
      </Section>
      <Section eyebrow="Components" title="What runs where.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Feature title="web (Next.js 15)" accent="#00E5FF">
            App router, React Three Fiber office, zustand store hydrated from /api/state and fed by the WebSocket. Standalone output, PWA manifest and service worker.
          </Feature>
          <Feature title="api (FastAPI)" accent="#9747FF">
            Auth (JWT cookie, TOTP, RBAC, CSRF header), REST under /api, WebSocket fan-out from the Redis stream, policy engine, orchestrator, audit.
          </Feature>
          <Feature title="worker" accent="#FFB547">
            Consumes azzy:tasks, runs the Hermes-style loop per agent, publishes phases, tool logs, costs, memories and agent messages; checks cancel flags between steps.
          </Feature>
          <Feature title="Redis streams" accent="#F04DFF">
            azzy:events for the UI and audit, azzy:tasks as the work queue, pub/sub for approval decisions, token buckets for rate limits, locks for deployments.
          </Feature>
          <Feature title="Postgres 16 + pgvector" accent="#34D399">
            Users, tasks, approvals, incidents, environments, AWS accounts, deployments, agent and chat messages, documents and chunks, artifacts, audit.
          </Feature>
          <Feature title="LiteLLM gateway" accent="#00E5FF">
            Bedrock primary via the EC2 IAM role, Anthropic / OpenAI fallback, per-agent token and USD caps; a deterministic stub in DEMO.
          </Feature>
        </div>
      </Section>
      <Section eyebrow="Infrastructure" title="Terraform for the host, CloudFormation for clients.">
        <ul className="grid gap-3 text-sm text-slate-300 md:grid-cols-2">
          {["EC2 Ubuntu 24.04 m7i.large with an IAM role for Bedrock, Secrets Manager, S3 backups and sts:AssumeRole", "Security group 443/80 only, Elastic IP, certbot TLS, nightly pg_dump to S3", "Client accounts: AzzyReadOnlyRole / AzzyAuditRole / AzzyDeploymentRole with External ID", "Tailscale ACLs: tag:servers and an azzy-deploy user with limited sudoers for allowlisted SSH actions", "Prometheus text metrics at /metrics on the internal network; health at /healthz", "GitHub Actions: build, tests, Playwright e2e and SSM deploy on main"].map((t) => (
            <li key={t} className="flex gap-3 rounded-2xl border border-white/10 bg-midnight/60 p-4">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-purple" />
              {t}
            </li>
          ))}
        </ul>
      </Section>
      <CTA />
    </div>
  );
}
