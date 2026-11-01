import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";
import { AGENT_IDS, AGENT_META, type AgentId } from "@azzy/events";

export const AGENT_BLURB: Record<AgentId, { tagline: string; does: string[]; avatar: string }> = {
  jimmy: {
    tagline: "Keeps every environment deployable, observable and cheap.",
    does: ["Multi-account AWS via AssumeRole + External ID", "ECS / EKS / EC2, Terraform, CI/CD", "Deploy, verify, roll back — with approvals in prod", "CloudWatch logs and cost reviews"],
    avatar: "Black-panther humanoid in an armoured tech suit, cyan accents, headset",
  },
  emir: {
    tagline: "Reads, fixes and tests code before anyone ships it.",
    does: ["Code review and root-cause analysis", "Fixes with tests, PRs on branches (never main)", "Data analysis in a network-less sandbox", "Model training and honest evaluation"],
    avatar: "Golden-cheetah humanoid, smart glasses, dark tech jacket, headset",
  },
  cyber: {
    tagline: "Scans, audits and gates every release.",
    does: ["SAST, secrets, IaC and container scanning", "IAM review across verified accounts", "VAPT with nuclei / ZAP on authorised targets only", "Release gate: blocked on any critical finding"],
    avatar: "Human, black hoodie up, blue-tinted glasses, headphones",
  },
  sara: {
    tagline: "Runs the business side of the office.",
    does: ["KPI reports, plans and schedules", "Incident summaries an executive reads in a minute", "Tickets, budgets and resource planning", "Decks, models and PDFs with consistent numbers"],
    avatar: "Human, light hijab, navy blazer, tablet",
  },
  marwah: {
    tagline: "Turns product work into growth.",
    does: ["Campaign plans and content calendars", "Positioning and launch briefs", "Growth reports with spend vs plan", "Client-facing drafts — sent only after approval"],
    avatar: "Human, long modern hair, cream blazer, laptop",
  },
};

export function Section({ id, eyebrow, title, lead, children, className }: { id?: string; eyebrow?: string; title: string; lead?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section id={id} className={clsx("mx-auto w-full max-w-6xl px-4 py-14 md:py-20", className)}>
      {eyebrow ? <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-cyan">{eyebrow}</p> : null}
      <h2 className="text-2xl font-semibold tracking-tight text-white md:text-[34px] md:leading-tight">{title}</h2>
      {lead ? <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-400 md:text-base">{lead}</p> : null}
      {children ? <div className="mt-8">{children}</div> : null}
    </section>
  );
}

export function PageHero({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead: ReactNode; children?: ReactNode }) {
  return (
    <div className="relative overflow-hidden border-b border-line/60">
      <div className="hero-bg pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-4 py-16 md:py-24">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-cyan">{eyebrow}</p>
        <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-white md:text-5xl md:leading-[1.08]">{title}</h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-300 md:text-lg">{lead}</p>
        {children ? <div className="mt-8">{children}</div> : null}
      </div>
    </div>
  );
}

export function AgentShowcaseCard({ id, compact }: { id: AgentId; compact?: boolean }) {
  const meta = AGENT_META[id];
  const b = AGENT_BLURB[id];
  return (
    <article
      data-testid={`agent-card-${id}`}
      className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-midnight/70 p-5 shadow-glass backdrop-blur transition duration-300 hover:-translate-y-1 hover:border-white/20"
      style={{ boxShadow: `inset 0 1px 0 rgba(255,255,255,0.04)` }}
    >
      <span className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full opacity-20 blur-3xl transition duration-500 group-hover:opacity-40" style={{ backgroundColor: meta.color }} aria-hidden />
      <div className="relative flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl text-lg font-bold text-navy shadow-glow" style={{ backgroundColor: meta.color }} aria-hidden>
          {meta.name[0]}
        </span>
        <div>
          <h3 className="text-lg font-semibold text-white">{meta.name}</h3>
          <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: meta.color }}>
            {meta.role}
          </p>
        </div>
      </div>
      <p className="relative mt-3 text-sm text-slate-300">{b.tagline}</p>
      {!compact ? (
        <ul className="relative mt-3 space-y-1.5 text-xs text-slate-400">
          {b.does.map((d) => (
            <li key={d} className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
              {d}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="relative mt-4 text-[11px] text-slate-500">{b.avatar}</p>
    </article>
  );
}

export function AgentGrid({ compact }: { compact?: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {AGENT_IDS.map((id, i) => (
        <div key={id} className="animate-floaty" style={{ animationDelay: `${i * 0.4}s` }}>
          <AgentShowcaseCard id={id} compact={compact} />
        </div>
      ))}
    </div>
  );
}

export function Feature({ title, children, accent = "#00E5FF" }: { title: string; children: ReactNode; accent?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-midnight/60 p-5 transition hover:border-white/20">
      <span className="mb-3 block h-1 w-10 rounded-full" style={{ backgroundColor: accent }} aria-hidden />
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">{children}</p>
    </div>
  );
}

export function CTA({ title = "See the office running", lead = "Sign in to the portal — in DEMO mode everything runs end-to-end without cloud keys." }: { title?: string; lead?: string }) {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 pb-20">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-midnight via-[#0d1230] to-[#140a2e] p-8 text-center shadow-glass md:p-14">
        <span className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-brand-cyan/20 blur-3xl" aria-hidden />
        <span className="pointer-events-none absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-brand-purple/25 blur-3xl" aria-hidden />
        <h2 className="relative text-2xl font-semibold tracking-tight text-white md:text-4xl">{title}</h2>
        <p className="relative mx-auto mt-3 max-w-xl text-sm text-slate-300 md:text-base">{lead}</p>
        <div className="relative mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/login" className="inline-flex h-11 items-center rounded-xl bg-brand-gold px-6 text-sm font-semibold text-navy shadow-[0_0_24px_rgba(255,181,71,0.35)] transition hover:brightness-110 active:scale-[0.98]">
            Sign in to the portal
          </Link>
          <Link href="/architecture" className="inline-flex h-11 items-center rounded-xl border border-white/15 px-6 text-sm font-medium text-white transition hover:bg-white/5">
            Read the architecture
          </Link>
        </div>
      </div>
    </section>
  );
}
