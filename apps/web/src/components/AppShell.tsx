"use client";

import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { acquireSocket } from "@/lib/ws";
import { useAzzy } from "@/store/useAzzy";
import { FooterCredit } from "./Brand";
import { CommandBar } from "./CommandBar";
import { Sidebar, TabBar } from "./Nav";

function LiveProvider({ children }: { children: ReactNode }) {
  const hydrate = useAzzy((s) => s.hydrate);
  const loadMe = useAzzy((s) => s.loadMe);
  const sweep = useAzzy((s) => s.sweep);

  useEffect(() => {
    void hydrate();
    void loadMe();
    const release = acquireSocket();
    const timer = setInterval(() => sweep(), 500);
    return () => {
      clearInterval(timer);
      release();
    };
  }, [hydrate, loadMe, sweep]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Offline shell is a convenience; a failed registration must not break the app.
    });
  }, []);

  return <>{children}</>;
}

/** Portal shell for /app/*: sidebar (desktop), command bar, tab bar (mobile), footer credit. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <LiveProvider>
      <div className="flex min-h-[100svh]">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <CommandBar />
          <main key={pathname} className="main-pad min-w-0 flex-1 px-4 pt-4 animate-slideUp md:px-6 md:pt-6">
            {children}
          </main>
          <FooterCredit className="mb-16 md:mb-0" />
        </div>
      </div>
      <TabBar />
    </LiveProvider>
  );
}
