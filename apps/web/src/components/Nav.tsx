"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { isActive, MOBILE_PRIMARY, NAV_GROUPS, NAV_ITEMS, type NavItem } from "@/lib/nav";
import { useAzzy, usePendingApprovals } from "@/store/useAzzy";
import { Wordmark } from "./Brand";
import { IconClose, IconLogout, IconMore } from "./Icons";

function Badge({ n, small }: { n: number; small?: boolean }) {
  if (n <= 0) return null;
  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center rounded-full bg-rose-500 font-bold text-white",
        small ? "absolute right-1/4 top-1.5 h-4 min-w-4 px-1 text-[10px]" : "ml-auto h-5 min-w-5 px-1.5 text-[11px]",
      )}
      aria-label={`${n} pending approvals`}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

function useLogout() {
  const router = useRouter();
  return async () => {
    try {
      await api.auth.logout();
    } finally {
      try {
        localStorage.removeItem("azzy.signedIn");
      } catch {
        // ignore
      }
      useAzzy.setState({ me: null });
      router.push("/login");
      router.refresh();
    }
  };
}

export function Sidebar() {
  const pathname = usePathname();
  const pending = usePendingApprovals().length;
  const demo = useAzzy((s) => s.demo);
  const me = useAzzy((s) => s.me);
  const logout = useLogout();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("azzy.sidebar") === "collapsed");
    } catch {
      // storage unavailable
    }
  }, []);
  const toggle = () => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("azzy.sidebar", next ? "collapsed" : "open");
      } catch {
        // ignore
      }
      return next;
    });
  };

  return (
    <aside
      className={clsx(
        "hidden md:sticky md:top-0 md:flex md:h-[100svh] md:shrink-0 md:flex-col md:border-r md:border-line md:bg-midnight/70 md:backdrop-blur-md transition-[width]",
        collapsed ? "md:w-[68px]" : "md:w-64",
      )}
      aria-label="Sidebar"
    >
      <div className={clsx("flex items-center px-3 pb-3 pt-4", collapsed ? "justify-center" : "justify-between")}>
        {collapsed ? <Wordmark href="/app" size={32} className="[&>span]:hidden" /> : <Wordmark href="/app" subtitle={demo ? "v2.0 · DEMO mode" : "v2.0"} />}
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-2" aria-label="Primary">
        {NAV_GROUPS.map((g) => (
          <div key={g.label}>
            {!collapsed ? <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{g.label}</div> : <div className="mx-3 mb-1 border-t border-line" />}
            <ul className="space-y-0.5">
              {g.items.map((item) => {
                const active = isActive(pathname, item);
                return (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      data-testid={`nav-${item.key}`}
                      aria-current={active ? "page" : undefined}
                      aria-label={item.label}
                      title={collapsed ? item.label : undefined}
                      className={clsx(
                        "relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                        collapsed && "justify-center px-0",
                        active ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-100",
                      )}
                    >
                      <item.Icon className={clsx("shrink-0", active ? "text-brand-cyan" : "text-slate-500")} />
                      {!collapsed ? <span className="truncate">{item.label}</span> : null}
                      {item.key === "approvals" ? collapsed ? (pending > 0 ? <span className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-rose-500" aria-label={`${pending} pending approvals`} /> : null) : <Badge n={pending} /> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-line px-2 py-3">
        {!collapsed && me ? (
          <div className="mb-2 truncate px-3 text-[11px] text-slate-500" title={me.email}>
            {me.email} · <span className="capitalize text-slate-400">{me.role}</span>
          </div>
        ) : null}
        <div className={clsx("flex gap-1", collapsed && "flex-col items-center")}>
          <button type="button" onClick={logout} aria-label="Log out" className={clsx("flex flex-1 items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-400 hover:bg-white/5 hover:text-slate-100", collapsed && "justify-center px-0")}>
            <IconLogout className="text-slate-500" />
            {!collapsed ? "Log out" : null}
          </button>
          <button type="button" onClick={toggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="rounded-xl px-2 py-2 text-slate-500 hover:bg-white/5 hover:text-white">
            <span aria-hidden className="text-sm">{collapsed ? "»" : "«"}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}

function MobileLink({ item, active, pending, onClick }: { item: NavItem; active: boolean; pending: number; onClick?: () => void }) {
  return (
    <Link
      href={item.href}
      data-testid={`nav-${item.key}-mobile`}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={clsx("relative flex h-14 flex-col items-center justify-center gap-0.5 text-[10px]", active ? "text-brand-cyan" : "text-slate-500")}
    >
      <item.Icon width={20} height={20} />
      <span className="truncate px-0.5">{item.key === "home" ? "Home" : item.label}</span>
      {item.key === "approvals" ? <Badge n={pending} small /> : null}
    </Link>
  );
}

export function TabBar() {
  const pathname = usePathname();
  const pending = usePendingApprovals().length;
  const me = useAzzy((s) => s.me);
  const logout = useLogout();
  const [more, setMore] = useState(false);
  const primary = MOBILE_PRIMARY.map((k) => NAV_ITEMS.find((i) => i.key === k)!);
  const rest = NAV_ITEMS.filter((i) => !MOBILE_PRIMARY.includes(i.key));
  const moreActive = rest.some((i) => isActive(pathname, i));

  useEffect(() => {
    setMore(false);
  }, [pathname]);

  return (
    <>
      {more ? (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="More pages">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/60" onClick={() => setMore(false)} />
          <div data-testid="more-sheet" className="absolute inset-x-0 bottom-0 max-h-[80svh] overflow-y-auto rounded-t-3xl border-t border-line bg-midnight p-3 pb-20 shadow-glass animate-slideUp" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 5rem)" }}>
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-sm font-semibold text-white">More</span>
              <button type="button" onClick={() => setMore(false)} aria-label="Close" className="rounded-lg p-1 text-slate-400">
                <IconClose />
              </button>
            </div>
            <ul className="grid grid-cols-3 gap-1">
              {rest.map((item) => {
                const active = isActive(pathname, item);
                return (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      data-testid={`nav-${item.key}-mobile`}
                      aria-label={item.label}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setMore(false)}
                      className={clsx("flex h-20 flex-col items-center justify-center gap-1.5 rounded-2xl border text-[11px]", active ? "border-brand-cyan/40 bg-brand-cyan/10 text-white" : "border-line bg-black/20 text-slate-300")}
                    >
                      <item.Icon width={22} height={22} className={active ? "text-brand-cyan" : "text-slate-400"} />
                      <span className="text-center leading-tight">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex items-center justify-between rounded-2xl border border-line bg-black/20 px-3 py-2 text-xs text-slate-400">
              <span className="truncate">{me ? `${me.email} · ${me.role}` : "Signed in"}</span>
              <button type="button" onClick={logout} aria-label="Log out" className="flex items-center gap-1 text-slate-200">
                <IconLogout width={16} height={16} /> Log out
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <nav
        data-testid="tab-bar"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-navy/90 backdrop-blur-md md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Primary"
      >
        <ul className="grid grid-cols-5">
          {primary.map((item) => (
            <li key={item.key}>
              <MobileLink item={item} active={isActive(pathname, item)} pending={pending} />
            </li>
          ))}
          <li>
            <button
              type="button"
              data-testid="tab-more"
              aria-label="More pages"
              aria-expanded={more}
              onClick={() => setMore((v) => !v)}
              className={clsx("flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[10px]", more || moreActive ? "text-brand-cyan" : "text-slate-500")}
            >
              <IconMore width={20} height={20} />
              <span>More</span>
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
