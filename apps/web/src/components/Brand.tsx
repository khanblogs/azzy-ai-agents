import clsx from "clsx";
import Image from "next/image";
import Link from "next/link";
import { CREATOR_CREDIT, PRODUCT_NAME, PRODUCT_VERSION } from "@azzy/events";

export function Logo({ size = 36, className, priority }: { size?: number; className?: string; priority?: boolean }) {
  return (
    <Image
      src={size > 256 ? "/brand/azzy-logo.png" : "/brand/azzy-logo-256.png"}
      alt="AZZY AI AGENTS logo"
      width={size}
      height={size}
      priority={priority}
      className={clsx("rounded-xl", className)}
    />
  );
}

export function Wordmark({ href = "/", size = 36, subtitle, className }: { href?: string; size?: number; subtitle?: string; className?: string }) {
  return (
    <Link href={href} className={clsx("flex items-center gap-2.5", className)} aria-label={`${PRODUCT_NAME} home`}>
      <Logo size={size} />
      <span className="leading-tight">
        <span className="block text-sm font-bold tracking-[0.12em] text-white">{PRODUCT_NAME}</span>
        <span className="block text-[11px] text-slate-400">{subtitle ?? PRODUCT_VERSION}</span>
      </span>
    </Link>
  );
}

export function FooterCredit({ className }: { className?: string }) {
  return (
    <footer className={clsx("border-t border-line/70 px-4 py-4 text-center text-[11px] text-slate-500", className)}>
      <span data-testid="footer-credit">
        {PRODUCT_NAME} {PRODUCT_VERSION} · {CREATOR_CREDIT}
      </span>
    </footer>
  );
}

/** Honesty rule (CONTRACT-v2 §12): any card showing simulated data carries this chip. */
export function DemoChip({ show = true, className }: { show?: boolean; className?: string }) {
  if (!show) return null;
  return (
    <span
      className={clsx("inline-flex items-center rounded-md border border-brand-gold/40 bg-brand-gold/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-gold", className)}
      title="Simulated data (DEMO mode)"
      aria-label="Demo data"
    >
      Demo
    </span>
  );
}
