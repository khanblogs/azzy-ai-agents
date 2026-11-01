"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { PUBLIC_LINKS } from "@/lib/nav";
import { FooterCredit, Wordmark } from "./Brand";
import { IconClose, IconMenu } from "./Icons";

export function PublicShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  useEffect(() => {
    setOpen(false);
    // The cookie is httpOnly, so presence is inferred from a lightweight flag set after login.
    try {
      setHasSession(localStorage.getItem("azzy.signedIn") === "1");
    } catch {
      // ignore
    }
  }, [pathname]);

  return (
    <div className="flex min-h-[100svh] flex-col">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-navy/80 backdrop-blur-md" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Wordmark size={38} />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Site">
            {PUBLIC_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className={clsx("rounded-lg px-3 py-1.5 text-sm transition", pathname === l.href ? "bg-white/10 text-white" : "text-slate-300 hover:text-white")}>
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link href={hasSession ? "/app" : "/login"} className="inline-flex h-9 items-center rounded-xl bg-brand-cyan px-4 text-sm font-semibold text-navy shadow-glow hover:brightness-110" data-testid="cta-login">
              {hasSession ? "Open portal" : "Sign in"}
            </Link>
            <button type="button" className="rounded-lg p-2 text-slate-300 md:hidden" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {open ? <IconClose /> : <IconMenu />}
            </button>
          </div>
        </div>
        {open ? (
          <nav className="border-t border-line bg-midnight px-4 py-3 md:hidden" aria-label="Site">
            <ul className="grid grid-cols-2 gap-1">
              {PUBLIC_LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="block rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-white/5">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </header>
      <main className="flex-1" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {children}
      </main>
      <FooterCredit />
    </div>
  );
}
