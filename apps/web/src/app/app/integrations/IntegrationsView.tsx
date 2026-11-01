"use client";

import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { DemoChip } from "@/components/Brand";
import { Card, PageHeader } from "@/components/Card";
import { EmptyState, Skeleton } from "@/components/EmptyState";
import { IconPlug } from "@/components/Icons";
import { api, ApiError } from "@/lib/api";
import type { Integration } from "@/lib/types";
import { can, useAzzy } from "@/store/useAzzy";

const CATEGORY_ORDER = ["source control", "ci/cd", "messaging", "productivity", "support", "llm", "network", "aws", "scanners", "testing"];

function IntegrationCard({ it }: { it: Integration }) {
  const me = useAzzy((s) => s.me);
  const toast = useAzzy((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const admin = can(me, "admin");
  const test = async () => {
    setBusy(true);
    try {
      const r = await api.integrations.test(it.id);
      setResult(r);
      toast({ tone: r.ok ? "success" : "error", title: `${it.name}: ${r.ok ? "ok" : "failed"}`, body: r.detail });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Test failed", body: err instanceof ApiError ? err.message : "Network error" });
    } finally {
      setBusy(false);
    }
  };
  const color = it.configured ? "#34D399" : "#64748b";
  return (
    <Card className="flex flex-col p-4" data-testid="integration-card" data-integration-id={it.id}>
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-slate-300">
          <IconPlug width={16} height={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-white">{it.name}</h2>
          <p className="text-[10px] uppercase tracking-wider text-slate-500">{it.category}</p>
        </div>
        <DemoChip show={it.demo} />
      </div>
      <p className="mt-2 flex-1 text-xs text-slate-400">{it.detail}</p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
          {it.configured ? "configured" : "not configured"}
        </span>
        <Button size="sm" variant="outline" loading={busy} onClick={test} disabled={!admin || !it.configured} title={!admin ? "Admin only" : !it.configured ? "Configure it in infra/.env first" : it.demo ? "Simulated probe (DEMO)" : "Run a real probe"} aria-label={`Test ${it.name}`}>
          Test
        </Button>
      </div>
      {result ? <p className={clsx("mt-2 rounded-lg px-2 py-1 text-[11px]", result.ok ? "bg-emerald-500/10 text-emerald-200" : "bg-rose-500/10 text-rose-200")}>{result.detail}</p> : null}
    </Card>
  );
}

export function IntegrationsView() {
  const [list, setList] = useState<Integration[] | null>(null);
  useEffect(() => {
    api.integrations
      .list()
      .then(setList)
      .catch(() => setList([]));
  }, []);
  const groups = useMemo(() => {
    const m = new Map<string, Integration[]>();
    for (const it of list ?? []) m.set(it.category, [...(m.get(it.category) ?? []), it]);
    return Array.from(m.entries()).sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a[0].toLowerCase());
      const ib = CATEGORY_ORDER.indexOf(b[0].toLowerCase());
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a[0].localeCompare(b[0]);
    });
  }, [list]);
  const configured = (list ?? []).filter((i) => i.configured).length;

  return (
    <div>
      <PageHeader title="Integrations" subtitle={list ? `${configured} of ${list.length} configured · derived from environment variables and binaries present in the image. Secrets are never returned.` : "loading…"} />
      {list === null ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState title="No integrations reported" hint="The API lists github, gitlab, jenkins, slack, gmail, gcal, zendesk, bedrock, anthropic, openai, tailscale, ssm and the scanners." />
      ) : (
        groups.map(([cat, items]) => (
          <section key={cat} className="mb-6" aria-labelledby={`cat-${cat}`}>
            <h2 id={`cat-${cat}`} className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {cat}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {items.map((it) => (
                <IntegrationCard key={it.id} it={it} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
