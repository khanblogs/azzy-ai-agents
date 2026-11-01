import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CREATOR_CREDIT, PRODUCT_NAME, PRODUCT_VERSION } from "@azzy/events";
import { AgentGrid, CTA, Feature, Section } from "@/components/PublicSections";

export const metadata: Metadata = { title: `${PRODUCT_NAME} ${PRODUCT_VERSION} — a self-hosted office of AI agents` };

const STEPS = [
  { n: "01", t: "You ask", d: "One sentence in the command bar — English or Hinglish. The orchestrator routes it to the right agents and environment." },
  { n: "02", t: "Agents plan and act", d: "Think → tool → observe → act → learn. Only allowlisted tools, every output scrubbed before it reaches a model." },
  { n: "03", t: "Risk pauses for you", d: "Medium and high-risk calls (prod deploys, client emails, IAM) wait for an approval — in the office bubble or on your phone." },
  { n: "04", t: "They hand off and verify", d: "Jimmy → Emir → Cyber → Sara: persisted handoffs, release gate, post-deploy health, memories written." },
];

export default function HomePage() {
  return (
    <div>
      <section className="relative overflow-hidden border-b border-line/60">
        <div className="hero-bg absolute inset-0" aria-hidden />
        <span className="hero-blob left-[-10%] top-[10%] h-[28rem] w-[28rem] bg-brand-cyan/20" aria-hidden />
        <span className="hero-blob right-[-10%] top-[30%] h-[30rem] w-[30rem] bg-brand-purple/25" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 md:grid-cols-[1.1fr_0.9fr] md:py-28">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-cyan">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-cyan animate-pulseDot" /> {PRODUCT_VERSION} · self-hosted
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-white md:text-6xl md:leading-[1.05]">
              Five AI agents.
              <br />
              One office. <span className="text-gradient">Your approval</span> before anything risky.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-300 md:text-lg">
              {PRODUCT_NAME} runs DevOps, development, security, operations and marketing agents on your own server — with safe tools, multi-account AWS, a release gate and a 3D office you can watch.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/login" className="inline-flex h-12 items-center rounded-xl bg-brand-gold px-6 text-sm font-semibold text-navy shadow-[0_0_28px_rgba(255,181,71,0.35)] transition hover:brightness-110 active:scale-[0.98]" data-testid="hero-cta">
                Enter the portal
              </Link>
              <Link href="/agents" className="inline-flex h-12 items-center rounded-xl border border-white/15 bg-white/5 px-6 text-sm font-medium text-white backdrop-blur transition hover:bg-white/10">
                Meet the agents
              </Link>
            </div>
            <dl className="mt-10 grid max-w-lg grid-cols-3 gap-4 text-left">
              {[
                ["5", "specialist agents"],
                ["26", "allowlisted tools"],
                ["0", "raw shell commands"],
              ].map(([v, k]) => (
                <div key={k}>
                  <dt className="text-2xl font-semibold text-white">{v}</dt>
                  <dd className="text-[11px] uppercase tracking-wider text-slate-500">{k}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="relative mx-auto w-full max-w-md">
            <span className="absolute inset-0 -z-10 rounded-full bg-brand-cyan/10 blur-3xl" aria-hidden />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/azzy-logo.png" alt="AZZY AI AGENTS logo" width={640} height={640} className="mx-auto w-[78%] drop-shadow-[0_0_40px_rgba(0,229,255,0.25)] animate-floaty md:w-full" />
          </div>
        </div>
      </section>

      <Section id="agents" eyebrow="The team" title="Five specialists and an orchestrator that never acts alone." lead="Each agent has its own tools, budget, routines and memory. Azzy — the orchestrator — routes, plans and manages approvals; it is a system, not a character.">
        <AgentGrid compact />
        <div className="mt-6 text-right">
          <Link href="/agents" className="text-sm text-brand-cyan hover:underline">
            Full agent profiles →
          </Link>
        </div>
      </Section>

      <Section eyebrow="Capabilities" title="Everything a small platform team does — behind a policy engine." lead="Safe tools only. No raw shell. Every medium/high-risk call is classified and, where needed, held for a human.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Feature title="Multi-account AWS" accent="#00E5FF">
            AssumeRole with External ID, three CloudFormation roles (read-only, audit, deployment), verified permissions and a read-only inventory viewer.
          </Feature>
          <Feature title="Deployments with guard rails" accent="#FFB547">
            Pre-checks, per-environment locks, approval for prod, post-deploy health and one-click rollback — each tracked as a deployment record.
          </Feature>
          <Feature title="Security that gates releases" accent="#9747FF">
            SAST, secrets, IaC, container and dynamic scans on authorised targets. A critical finding blocks the gate and says exactly what to fix.
          </Feature>
          <Feature title="Collaboration you can see" accent="#F04DFF">
            Persisted agent-to-agent handoffs, a live graph, bounded delegation (depth, retries, timeouts) and a 3D office with a holographic orchestration table.
          </Feature>
        </div>
      </Section>

      <Section eyebrow="How it works" title="From a sentence to a verified deployment." lead="The spec workflow — “Investigate my failing ECS deployment, fix the application issue, test it, perform a security assessment and request approval before deploying” — runs across four agents in under a minute plus your approval.">
        <ol className="grid gap-4 md:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="rounded-2xl border border-white/10 bg-midnight/60 p-5">
              <span className="font-mono text-xs text-brand-cyan">{s.n}</span>
              <h3 className="mt-2 text-base font-semibold text-white">{s.t}</h3>
              <p className="mt-2 text-sm text-slate-400">{s.d}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section eyebrow="Architecture" title="One server. Docker Compose. Nothing leaves without a reason." lead="Next.js portal, FastAPI + worker, Redis streams, Postgres with pgvector, LiteLLM to Bedrock. Terraform for the host, CloudFormation for client accounts, Tailscale for SSH.">
        <div className="grid items-center gap-6 md:grid-cols-[1fr_1.2fr]">
          <ul className="space-y-3 text-sm text-slate-300">
            {["Event bus on Redis streams — every phase, tool call, approval and cost is a typed event", "Postgres 16 + pgvector for tasks, approvals, memories, knowledge, audit", "Injection guard + PII scrub on every tool output before it reaches a model", "Prometheus metrics endpoint, append-only audit, TOTP MFA, RBAC by domain"].map((t) => (
              <li key={t} className="flex gap-3">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-cyan" />
                {t}
              </li>
            ))}
            <li>
              <Link href="/architecture" className="text-brand-cyan hover:underline">
                See the high-level design →
              </Link>
            </li>
          </ul>
          <Link href="/architecture" className="block overflow-hidden rounded-2xl border border-white/10 shadow-glass transition hover:border-white/20">
            <Image src="/brand/hld.jpg" alt="High-level design of AZZY AI AGENTS" width={1600} height={900} className="h-auto w-full" />
          </Link>
        </div>
      </Section>

      <Section eyebrow="Security model" title="Designed so the agents cannot surprise you." lead="Honesty is a feature: simulated data is always labelled, buttons that cannot act are disabled with a reason, and limitations are documented.">
        <div className="grid gap-4 md:grid-cols-3">
          <Feature title="Least privilege" accent="#9747FF">
            Per-agent tool allowlists, per-environment auto-allow, scope requirements per AWS call and a policy that forces prod changes to high risk.
          </Feature>
          <Feature title="Human in the loop" accent="#F04DFF">
            Approvals time out after an hour, are role-gated, auditable and reachable from the office bubble, the approvals page and mobile.
          </Feature>
          <Feature title="Secrets stay secret" accent="#00E5FF">
            Secrets Manager references instead of values, External IDs encrypted at rest and never returned, CSRF header on every write.
          </Feature>
        </div>
        <p className="mt-6 text-xs text-slate-500">Known limitations: OIDC not implemented (local auth + TOTP), single-node pilot, no bundled Grafana, scanners run only when their binaries are in the image, real-mode integrations unverified in CI.</p>
      </Section>

      <CTA />
      <p className="sr-only">
        {PRODUCT_NAME} {PRODUCT_VERSION} · {CREATOR_CREDIT}
      </p>
    </div>
  );
}
