"use client";

import clsx from "clsx";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/Button";
import { DemoChip } from "@/components/Brand";
import { Card, CardHeader, PageHeader } from "@/components/Card";
import { EmptyState, Skeleton } from "@/components/EmptyState";
import { IconRefresh, IconTrash } from "@/components/Icons";
import { Pill } from "@/components/KV";
import { StatusDot } from "@/components/StatusDot";
import { api, ApiError } from "@/lib/api";
import { relTime } from "@/lib/format";
import { HEALTH_COLORS } from "@/lib/status";
import type { Environment, EnvKind, EnvMethod, Inventory, InventoryResource, NewEnvironmentInput, Stage } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { can, useAzzy } from "@/store/useAzzy";

const SEEDED = new Set(["client-a-staging", "client-b-vps", "hq"]);
const METHOD_LABEL: Record<EnvMethod, string> = { assume_role: "AssumeRole", access_key: "Access key", tailscale_ssh: "Tailscale SSH" };
const KIND_STYLE: Record<EnvKind, string> = {
  prod: "bg-rose-500/15 text-rose-200 border-rose-500/30",
  staging: "bg-brand-cyan/15 text-brand-cyan border-brand-cyan/30",
  hq: "bg-brand-purple/15 text-violet-200 border-brand-purple/30",
};
const AUTO_ALLOW_OPTIONS = ["aws.deploy", "aws.rollback", "ssh.safe_action", "github.branch_pr", "gcal.schedule", "nuclei.scan", "zap.scan"];

function EnvCard({ env, now }: { env: Environment; now: number }) {
  const toast = useAzzy((s) => s.toast);
  const me = useAzzy((s) => s.me);
  const upsertEnvironment = useAzzy((s) => s.upsertEnvironment);
  const removeEnvironment = useAzzy((s) => s.removeEnvironment);
  const [busy, setBusy] = useState<"check" | "delete" | null>(null);
  const color = HEALTH_COLORS[env.health] ?? HEALTH_COLORS.unknown;
  const seeded = SEEDED.has(env.id);
  const admin = can(me, "admin");

  const check = async () => {
    setBusy("check");
    try {
      const res = await api.environments.check(env.id);
      upsertEnvironment(res);
      toast({ tone: res.health === "healthy" ? "success" : "info", title: `${res.name}: ${res.health}`, body: res.latency_ms !== null ? `${res.latency_ms} ms · ${res.version ?? "no version"}` : undefined });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Health check failed", body: err instanceof ApiError ? err.message : "Network error" });
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete environment "${env.name}"?`)) return;
    setBusy("delete");
    try {
      await api.environments.remove(env.id);
      removeEnvironment(env.id);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Could not delete", body: err instanceof ApiError ? err.message : "Network error" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-4" data-testid="env-card" data-env-id={env.id}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot color={color} label={`Health ${env.health}`} pulse={env.health !== "healthy"} size={10} />
            <h3 className="truncate text-sm font-semibold text-white">{env.name}</h3>
            <DemoChip show={Boolean(env.demo)} />
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-slate-500">{env.id}</p>
        </div>
        <div className="flex gap-1">
          {env.stage ? <span className="rounded-md border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-300">{env.stage}</span> : null}
          <span className={clsx("rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase", KIND_STYLE[env.kind])}>{env.kind}</span>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-slate-500">Health</dt>
        <dd className="capitalize" style={{ color }}>
          {env.health}
        </dd>
        <dt className="text-slate-500">Version</dt>
        <dd className="font-mono text-slate-200">{env.version ?? "—"}</dd>
        <dt className="text-slate-500">Latency</dt>
        <dd className="text-slate-200">{env.latency_ms !== null ? `${env.latency_ms} ms` : "—"}</dd>
        <dt className="text-slate-500">Method</dt>
        <dd>
          <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-slate-200">{METHOD_LABEL[env.method]}</span>
        </dd>
        <dt className="text-slate-500">Target</dt>
        <dd className="truncate font-mono text-slate-300" title={env.target}>
          {env.target}
        </dd>
        <dt className="text-slate-500">Region</dt>
        <dd className="text-slate-200">{env.region ?? "—"}</dd>
        <dt className="text-slate-500">AWS account</dt>
        <dd className="font-mono text-slate-300">{env.account_id ?? "—"}</dd>
        <dt className="text-slate-500">Auto-allow</dt>
        <dd className="flex flex-wrap gap-1">{env.auto_allow.length === 0 ? <span className="text-slate-500">none</span> : env.auto_allow.map((t) => <span key={t} className="rounded bg-emerald-500/10 px-1 font-mono text-[10px] text-emerald-200">{t}</span>)}</dd>
        <dt className="text-slate-500">Checked</dt>
        <dd className="text-slate-200">{relTime(env.last_checked, now)}</dd>
      </dl>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" variant="outline" icon={<IconRefresh width={14} height={14} />} loading={busy === "check"} onClick={check} disabled={!can(me, "write")} title={!can(me, "write") ? "Read-only role" : undefined} aria-label={`Check health of ${env.name}`}>
          Check
        </Button>
        {!seeded ? (
          <Button size="sm" variant="ghost" className="ml-auto text-rose-300" icon={<IconTrash width={14} height={14} />} loading={busy === "delete"} onClick={remove} disabled={!admin} title={!admin ? "Admin only" : undefined} aria-label={`Delete ${env.name}`}>
            Delete
          </Button>
        ) : (
          <span className="ml-auto text-[11px] text-slate-600">seeded</span>
        )}
      </div>
    </Card>
  );
}

const EMPTY: NewEnvironmentInput = { name: "", kind: "staging", method: "assume_role", target: "", region: "ap-south-1", external_id: "", secret_ref: "", auto_allow: [], account_id: null, stage: "staging" };

function AddEnvironmentForm() {
  const toast = useAzzy((s) => s.toast);
  const me = useAzzy((s) => s.me);
  const accounts = useAzzy((s) => s.awsAccounts);
  const upsertEnvironment = useAzzy((s) => s.upsertEnvironment);
  const [form, setForm] = useState<NewEnvironmentInput>(EMPTY);
  const [busy, setBusy] = useState(false);
  const admin = can(me, "admin");
  const set = <K extends keyof NewEnvironmentInput>(k: K, v: NewEnvironmentInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload: NewEnvironmentInput = {
        name: form.name.trim(),
        kind: form.kind,
        method: form.method,
        target: form.target.trim(),
        stage: form.stage,
        ...(form.region?.trim() ? { region: form.region.trim() } : {}),
        ...(form.external_id?.trim() ? { external_id: form.external_id.trim() } : {}),
        ...(form.secret_ref?.trim() ? { secret_ref: form.secret_ref.trim() } : {}),
        ...(form.account_id ? { account_id: form.account_id } : {}),
        auto_allow: form.auto_allow ?? [],
      };
      const env = await api.environments.create(payload);
      upsertEnvironment(env);
      toast({ tone: "success", title: "Environment added", body: env.name });
      setForm(EMPTY);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Could not add environment", body: err instanceof ApiError ? err.message : "Network error" });
    } finally {
      setBusy(false);
    }
  };

  const field = "h-10 w-full rounded-xl border border-line bg-navy px-3 text-sm text-white placeholder:text-slate-600 focus:border-brand-cyan/60 focus:outline-none focus:ring-2 focus:ring-brand-cyan/20";
  const label = "mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-400";
  const targetHint = form.method === "assume_role" ? "arn:aws:iam::111122223333:role/AzzyDeploymentRole" : form.method === "tailscale_ssh" ? "100.101.102.103 (Tailscale IP) or hostname" : "AWS account id or alias";

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-white">Add environment</h2>
      <p className="mb-3 text-xs text-slate-400">Secrets never land in Postgres: reference a Secrets Manager name instead.{!admin ? " Admin only." : ""}</p>
      <form data-testid="env-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="env-name" className={label}>
            Name
          </label>
          <input id="env-name" required className={field} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Client C — staging" />
        </div>
        <div>
          <label htmlFor="env-kind" className={label}>
            Kind
          </label>
          <select id="env-kind" className={field} value={form.kind} onChange={(e) => set("kind", e.target.value as EnvKind)}>
            <option value="staging">staging</option>
            <option value="prod">prod</option>
            <option value="hq">hq</option>
          </select>
        </div>
        <div>
          <label htmlFor="env-stage" className={label}>
            Stage
          </label>
          <select id="env-stage" className={field} value={form.stage ?? "staging"} onChange={(e) => set("stage", e.target.value as Stage)}>
            {(["dev", "uat", "staging", "prod"] as Stage[]).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="env-method" className={label}>
            Method
          </label>
          <select id="env-method" className={field} value={form.method} onChange={(e) => set("method", e.target.value as EnvMethod)}>
            <option value="assume_role">assume_role</option>
            <option value="access_key">access_key</option>
            <option value="tailscale_ssh">tailscale_ssh</option>
          </select>
        </div>
        <div>
          <label htmlFor="env-account" className={label}>
            AWS account
          </label>
          <select id="env-account" className={field} value={form.account_id ?? ""} onChange={(e) => set("account_id", e.target.value || null)}>
            <option value="">none</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.account_id})
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="env-target" className={label}>
            Target
          </label>
          <input id="env-target" required className={field} value={form.target} onChange={(e) => set("target", e.target.value)} placeholder={targetHint} />
        </div>
        <div>
          <label htmlFor="env-region" className={label}>
            Region
          </label>
          <input id="env-region" className={field} value={form.region ?? ""} onChange={(e) => set("region", e.target.value)} placeholder="ap-south-1" />
        </div>
        <div>
          <label htmlFor="env-external" className={label}>
            External ID
          </label>
          <input id="env-external" className={field} value={form.external_id ?? ""} onChange={(e) => set("external_id", e.target.value)} placeholder="only for assume_role" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="env-secret" className={label}>
            Secret ref (Secrets Manager name)
          </label>
          <input id="env-secret" className={field} value={form.secret_ref ?? ""} onChange={(e) => set("secret_ref", e.target.value)} placeholder="azzy/env/client-c" />
        </div>
        <fieldset className="sm:col-span-2">
          <legend className={label}>Auto-allow (medium-risk tools that skip approval here)</legend>
          <div className="flex flex-wrap gap-2">
            {AUTO_ALLOW_OPTIONS.map((t) => {
              const on = form.auto_allow?.includes(t) ?? false;
              return (
                <label key={t} className={clsx("flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 font-mono text-[11px]", on ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-line text-slate-300")}>
                  <input type="checkbox" checked={on} onChange={(e) => set("auto_allow", e.target.checked ? [...(form.auto_allow ?? []), t] : (form.auto_allow ?? []).filter((x) => x !== t))} />
                  {t}
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="sm:col-span-2">
          <Button type="submit" variant="primary" loading={busy} disabled={!admin} title={!admin ? "Admin only" : undefined} aria-label="Add environment" data-testid="env-submit">
            Add environment
          </Button>
        </div>
      </form>
    </Card>
  );
}

const RESOURCE_LABELS: Record<string, string> = { ec2: "EC2", ecs: "ECS", eks: "EKS", lambda: "Lambda", s3: "S3", rds: "RDS", cloudfront: "CloudFront", waf: "WAF", route53: "Route 53" };

function InventoryViewer({ initialAccount }: { initialAccount: string | null }) {
  const accounts = useAzzy((s) => s.awsAccounts);
  const [accountId, setAccountId] = useState<string>(initialAccount ?? "");
  const [region, setRegion] = useState<string>("");
  const [inv, setInv] = useState<Inventory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<string>("ec2");

  const account = accounts.find((a) => a.id === accountId) ?? null;
  useEffect(() => {
    if (!accountId && accounts.length > 0) setAccountId(accounts[0].id);
  }, [accounts, accountId]);
  useEffect(() => {
    if (account && !account.regions.includes(region)) setRegion(account.regions[0] ?? "");
  }, [account, region]);

  const load = async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.awsAccounts.inventory(accountId, region || undefined);
      setInv(r);
      const first = Object.keys(r.resources).find((k) => (r.resources[k]?.length ?? 0) > 0);
      if (first) setKind(first);
    } catch (err) {
      setInv(null);
      setError(err instanceof ApiError ? err.message : "Failed to load inventory");
    } finally {
      setLoading(false);
    }
  };

  const rows: InventoryResource[] = inv?.resources[kind] ?? [];
  const columns = useMemo(() => {
    const keys = new Set<string>();
    for (const r of rows.slice(0, 20)) for (const k of Object.keys(r)) keys.add(k);
    return Array.from(keys).slice(0, 7);
  }, [rows]);

  const field = "h-9 rounded-xl border border-line bg-navy px-3 text-xs text-white focus:border-brand-cyan/60 focus:outline-none";
  return (
    <Card>
      <CardHeader title="Inventory viewer" subtitle="Read-only resource listing per verified account and region" action={inv ? <DemoChip show={inv.demo} /> : null} />
      <div className="px-4 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="inv-account">
            Account
          </label>
          <select id="inv-account" className={field} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.length === 0 ? <option value="">No accounts</option> : null}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.status}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="inv-region">
            Region
          </label>
          <select id="inv-region" className={field} value={region} onChange={(e) => setRegion(e.target.value)}>
            {(account?.regions ?? []).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <Button size="sm" variant="primary" onClick={load} loading={loading} disabled={!accountId || account?.status !== "verified"} title={account && account.status !== "verified" ? "Verify the account first" : undefined} aria-label="Load inventory" data-testid="inventory-load">
            Load inventory
          </Button>
          {inv ? <span className="text-[11px] text-slate-500">generated {relTime(inv.generated_at)}</span> : null}
        </div>
        {error ? <p className="mt-3 text-xs text-rose-300">{error}</p> : null}
        {!inv && !error ? <p className="mt-3 text-xs text-slate-500">Pick a verified account and region, then load. In DEMO mode the data is labelled as simulated.</p> : null}
        {inv ? (
          <>
            <div className="mt-3 flex flex-wrap gap-1" role="tablist" aria-label="Resource types">
              {Object.keys(inv.resources).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={clsx("rounded-lg px-2.5 py-1 text-[11px] font-medium", kind === k ? "bg-white/10 text-white" : "text-slate-400 hover:text-white")}>
                  {RESOURCE_LABELS[k] ?? k} <span className="text-slate-500">{inv.resources[k]?.length ?? 0}</span>
                </button>
              ))}
            </div>
            <div className="mt-2 overflow-x-auto">
              {rows.length === 0 ? (
                <p className="py-4 text-center text-xs text-slate-500">No {RESOURCE_LABELS[kind] ?? kind} resources in {inv.region}.</p>
              ) : (
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                    <tr>
                      {columns.map((c) => (
                        <th key={c} className="px-2 py-1.5">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 100).map((r, i) => (
                      <tr key={String(r.id ?? r.name ?? i)} className="border-t border-line text-slate-200">
                        {columns.map((c) => {
                          const v = r[c];
                          const text = v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);
                          const isStatus = c === "status" || c === "state" || c === "health";
                          return (
                            <td key={c} className="max-w-[220px] truncate px-2 py-1.5 font-mono" title={text}>
                              {isStatus ? <Pill color={/running|active|healthy|available|ok|enabled/i.test(text) ? "#34D399" : /stopp|fail|down|error/i.test(text) ? "#ef4444" : "#FFB547"}>{text}</Pill> : text}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : null}
      </div>
    </Card>
  );
}

export function InfrastructureView() {
  const envs = useAzzy((s) => s.environments);
  const hydrated = useAzzy((s) => s.hydrated);
  const accounts = useAzzy((s) => s.awsAccounts);
  const params = useSearchParams();
  const now = useNow(5000);

  useEffect(() => {
    if (accounts.length > 0) return;
    api.awsAccounts
      .list()
      .then((list) => useAzzy.setState({ awsAccounts: list }))
      .catch(() => undefined);
  }, [accounts.length]);

  const healthy = envs.filter((e) => e.health === "healthy").length;
  return (
    <div>
      <PageHeader title="Infrastructure" subtitle={`${envs.length} environments · ${healthy} healthy · inventory from ${accounts.filter((a) => a.status === "verified").length} verified AWS account(s)`} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {!hydrated ? (
            <>
              <Skeleton className="h-48" />
              <Skeleton className="h-48" />
            </>
          ) : envs.length === 0 ? (
            <EmptyState title="No environments registered" hint="Add one with the form — Client A staging, Client B VPS and HQ are seeded in DEMO mode." />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {envs.map((e) => (
                <EnvCard key={e.id} env={e} now={now} />
              ))}
            </div>
          )}
          <InventoryViewer initialAccount={params.get("account")} />
        </div>
        <AddEnvironmentForm />
      </div>
    </div>
  );
}
