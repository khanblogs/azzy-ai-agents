"use client";

import clsx from "clsx";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import type { AwsAccount, AwsScope } from "@azzy/events";
import { Button } from "@/components/Button";
import { DemoChip } from "@/components/Brand";
import { Card, CardHeader, PageHeader } from "@/components/Card";
import { CopyButton } from "@/components/CopyButton";
import { EmptyState, Skeleton } from "@/components/EmptyState";
import { IconTrash } from "@/components/Icons";
import { Pill } from "@/components/KV";
import { api, ApiError } from "@/lib/api";
import { relTime } from "@/lib/format";
import { ACCOUNT_STATUS_COLORS } from "@/lib/status";
import type { NewAwsAccountInput, Stage } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { can, useAzzy } from "@/store/useAzzy";

const SCOPES: { key: AwsScope; role: string; title: string; desc: string; perms: string[] }[] = [
  { key: "readonly", role: "AzzyReadOnlyRole", title: "Read-only", desc: "Inventory, health and cost visibility. Nothing can be changed.", perms: ["ec2:Describe*", "ecs:List*/Describe*", "logs:Describe*/Filter*", "ce:GetCostAndUsage"] },
  { key: "audit", role: "AzzyAuditRole", title: "Audit", desc: "Read-only plus IAM and Config review for Cyber's security audits.", perms: ["everything in read-only", "iam:GetAccountAuthorizationDetails", "config:DescribeConfigRules"] },
  { key: "deploy", role: "AzzyDeploymentRole", title: "Deployment", desc: "Audit plus ECS service updates — always gated by an approval in prod.", perms: ["everything in audit", "ecs:UpdateService", "iam:SimulatePrincipalPolicy (dry run)"] },
];

const REGIONS = ["ap-south-1", "us-east-1", "us-west-2", "eu-west-1", "eu-central-1", "ap-southeast-1"];

function snippet(scope: AwsScope, externalId: string) {
  const role = SCOPES.find((s) => s.key === scope)!.role;
  return `# Deploy in the client account (CloudFormation). Replace AZZY_ACCOUNT_ID with the AZZY host account id.
aws cloudformation deploy \\
  --stack-name azzy-agent-role \\
  --template-file infra/cloudformation/azzy-agent-role.yaml \\
  --capabilities CAPABILITY_NAMED_IAM \\
  --parameter-overrides Scope=${scope} RoleName=${role} \\
      AzzyAccountId=AZZY_ACCOUNT_ID ExternalId=${externalId || "<generate-a-random-external-id>"}

# Resulting role ARN to paste in the next step:
#   arn:aws:iam::<CLIENT_ACCOUNT_ID>:role/${role}`;
}

function randomExternalId() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "azzy-";
  const buf = new Uint8Array(20);
  crypto.getRandomValues(buf);
  for (const b of buf) out += alphabet[b % alphabet.length];
  return out;
}

function Wizard({ onCreated }: { onCreated: (a: AwsAccount) => void }) {
  const toast = useAzzy((s) => s.toast);
  const me = useAzzy((s) => s.me);
  const admin = can(me, "admin");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [scope, setScope] = useState<AwsScope>("readonly");
  const [externalId, setExternalId] = useState("");
  const [form, setForm] = useState<{ name: string; account_id: string; role_arn: string; stage: Stage; regions: string[] }>({ name: "", account_id: "", role_arn: "", stage: "dev", regions: ["ap-south-1"] });
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<AwsAccount | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    setExternalId(randomExternalId());
  }, []);

  const field = "h-10 w-full rounded-xl border border-line bg-navy px-3 text-sm text-white placeholder:text-slate-600 focus:border-brand-cyan/60 focus:outline-none focus:ring-2 focus:ring-brand-cyan/20";
  const label = "mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-400";
  const idOk = /^\d{12}$/.test(form.account_id);
  const arnOk = /^arn:aws:iam::\d{12}:role\/[\w+=,.@-]+$/.test(form.role_arn.trim());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!idOk) return;
    setBusy(true);
    try {
      const input: NewAwsAccountInput = { name: form.name.trim(), account_id: form.account_id.trim(), role_arn: form.role_arn.trim() || `arn:aws:iam::${form.account_id.trim()}:role/${SCOPES.find((s) => s.key === scope)!.role}`, external_id: externalId, scope, regions: form.regions, stage: form.stage };
      const acc = await api.awsAccounts.create(input);
      setCreated(acc);
      onCreated(acc);
      setStep(3);
      toast({ tone: "success", title: "Account registered", body: `${acc.name} · pending verification` });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Could not add account", body: err instanceof ApiError ? err.message : "Network error" });
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!created) return;
    setVerifying(true);
    try {
      const acc = await api.awsAccounts.verify(created.id);
      setCreated(acc);
      onCreated(acc);
      toast({ tone: acc.status === "verified" ? "success" : "error", title: `Verification ${acc.status}`, body: acc.error ?? `${acc.permissions.filter((p) => p.ok).length}/${acc.permissions.length} permission probes passed` });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Verification failed", body: err instanceof ApiError ? err.message : "Network error" });
    } finally {
      setVerifying(false);
    }
  };

  const reset = () => {
    setStep(1);
    setCreated(null);
    setForm({ name: "", account_id: "", role_arn: "", stage: "dev", regions: ["ap-south-1"] });
    setExternalId(randomExternalId());
  };

  return (
    <Card className="p-4" data-testid="account-wizard">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Onboard an AWS account</h2>
        <ol className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500" aria-label="Wizard steps">
          {["Scope", "Role", "Verify"].map((s, i) => (
            <li key={s} className={clsx("rounded-full px-2 py-0.5", step === i + 1 ? "bg-brand-cyan/15 text-brand-cyan" : step > i + 1 ? "text-emerald-300" : "")} aria-current={step === i + 1 ? "step" : undefined}>
              {i + 1}. {s}
            </li>
          ))}
        </ol>
      </div>
      {!admin ? <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">Only admins can register AWS accounts. You can review the steps below.</p> : null}

      {step === 1 ? (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">Pick the least privilege the agents need. Each scope maps to a CloudFormation role with a fixed name.</p>
          <div className="grid gap-2 md:grid-cols-3">
            {SCOPES.map((s) => (
              <button
                key={s.key}
                type="button"
                data-testid={`account-scope-${s.key}`}
                aria-pressed={scope === s.key}
                onClick={() => setScope(s.key)}
                className={clsx("rounded-xl border p-3 text-left transition", scope === s.key ? "border-brand-cyan/60 bg-brand-cyan/10 shadow-glow" : "border-line bg-black/20 hover:border-white/20")}
              >
                <div className="text-sm font-semibold text-white">{s.title}</div>
                <div className="font-mono text-[10px] text-brand-cyan">{s.role}</div>
                <p className="mt-1 text-[11px] text-slate-400">{s.desc}</p>
                <ul className="mt-2 space-y-0.5 text-[10px] text-slate-500">
                  {s.perms.map((p) => (
                    <li key={p}>· {p}</li>
                  ))}
                </ul>
              </button>
            ))}
          </div>
          <div className="flex justify-end">
            <Button variant="primary" data-testid="wizard-next" onClick={() => setStep(2)} aria-label="Next step">
              Next: CloudFormation →
            </Button>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <form onSubmit={submit} className="space-y-3">
          <div className="rounded-xl border border-line bg-black/30 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-200">1 · Create the role in the client account</span>
              <CopyButton text={snippet(scope, externalId)} label="Copy snippet" testId="copy-snippet" />
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-300" data-testid="cf-snippet">
              {snippet(scope, externalId)}
            </pre>
            <p className="mt-2 text-[11px] text-slate-500">
              External ID <span className="font-mono text-slate-300">{externalId}</span> is stored encrypted and never shown again.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="acc-name" className={label}>
                Name
              </label>
              <input id="acc-name" data-testid="account-name" required className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Demo Sandbox" />
            </div>
            <div>
              <label htmlFor="acc-id" className={label}>
                Account ID (12 digits)
              </label>
              <input id="acc-id" data-testid="account-id" required inputMode="numeric" pattern="[0-9]{12}" className={clsx(field, form.account_id && !idOk && "border-rose-500/60")} value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value.replace(/\D/g, "").slice(0, 12) })} placeholder="123456789012" />
            </div>
            <div>
              <label htmlFor="acc-stage" className={label}>
                Stage
              </label>
              <select id="acc-stage" className={field} value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value as Stage })}>
                {(["dev", "uat", "staging", "prod"] as Stage[]).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="acc-arn" className={label}>
                Role ARN
              </label>
              <input id="acc-arn" data-testid="account-role-arn" className={clsx(field, form.role_arn && !arnOk && "border-rose-500/60")} value={form.role_arn} onChange={(e) => setForm({ ...form, role_arn: e.target.value })} placeholder={`arn:aws:iam::${form.account_id || "123456789012"}:role/${SCOPES.find((s) => s.key === scope)!.role}`} />
              <p className="mt-1 text-[11px] text-slate-500">Leave empty to use the default role name for the chosen scope.</p>
            </div>
            <fieldset className="sm:col-span-2">
              <legend className={label}>Regions</legend>
              <div className="flex flex-wrap gap-2">
                {REGIONS.map((r) => {
                  const on = form.regions.includes(r);
                  return (
                    <label key={r} className={clsx("flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 font-mono text-[11px]", on ? "border-brand-cyan/50 bg-brand-cyan/10 text-white" : "border-line text-slate-300")}>
                      <input type="checkbox" checked={on} onChange={(e) => setForm({ ...form, regions: e.target.checked ? [...form.regions, r] : form.regions.filter((x) => x !== r) })} />
                      {r}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </div>
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => setStep(1)} aria-label="Back to scope">
              ← Back
            </Button>
            <Button type="submit" variant="primary" data-testid="account-submit" loading={busy} disabled={!admin || !idOk || !form.name.trim() || form.regions.length === 0} title={!admin ? "Admin only" : !idOk ? "Account id must be 12 digits" : undefined} aria-label="Register account">
              Register account →
            </Button>
          </div>
        </form>
      ) : null}

      {step === 3 && created ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-line bg-black/30 p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-white">{created.name}</span>
              <span className="font-mono text-slate-400">{created.account_id}</span>
              <Pill color={ACCOUNT_STATUS_COLORS[created.status]}>
                <span data-testid="account-status">{created.status}</span>
              </Pill>
              <DemoChip show={created.demo} />
            </div>
            <p className="mt-1 font-mono text-[11px] text-slate-400">{created.role_arn}</p>
            {created.error ? <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-rose-200">{created.error}</p> : null}
            {created.permissions.length > 0 ? (
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {created.permissions.map((p) => (
                  <li key={p.name} className={clsx("flex items-center gap-1.5 font-mono text-[11px]", p.ok ? "text-emerald-300" : "text-rose-300")}>
                    {p.ok ? "✓" : "✗"} {p.name}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <p className="text-xs text-slate-400">Verification runs sts:AssumeRole with your External ID and probes the permissions for the chosen scope.</p>
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={reset} aria-label="Add another account">
              Add another
            </Button>
            <Button variant="primary" data-testid="account-verify" loading={verifying} onClick={verify} disabled={!admin} title={!admin ? "Admin only" : undefined} aria-label="Verify account">
              {created.status === "verified" ? "Re-verify" : "Verify now"}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function AccountRow({ acc, now }: { acc: AwsAccount; now: number }) {
  const toast = useAzzy((s) => s.toast);
  const me = useAzzy((s) => s.me);
  const upsertAccount = useAzzy((s) => s.upsertAccount);
  const removeAccount = useAzzy((s) => s.removeAccount);
  const [busy, setBusy] = useState<"verify" | "delete" | null>(null);
  const admin = can(me, "admin");
  const color = ACCOUNT_STATUS_COLORS[acc.status];

  const verify = async () => {
    setBusy("verify");
    try {
      const a = await api.awsAccounts.verify(acc.id);
      upsertAccount(a);
      toast({ tone: a.status === "verified" ? "success" : "error", title: `${a.name}: ${a.status}`, body: a.error ?? undefined });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Verification failed", body: err instanceof ApiError ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Remove ${acc.name} (${acc.account_id})?`)) return;
    setBusy("delete");
    try {
      await api.awsAccounts.remove(acc.id);
      removeAccount(acc.id);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Could not remove account", body: err instanceof ApiError ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  return (
    <li data-testid="account-row" data-account-id={acc.id} data-aws-account-id={acc.account_id} className="rounded-xl border border-line bg-black/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-white">{acc.name}</span>
        <span className="font-mono text-xs text-slate-400">{acc.account_id}</span>
        <Pill color={color}>
          <span data-testid="account-status">{acc.status}</span>
        </Pill>
        <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-300">{acc.scope}</span>
        <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-300">{acc.stage}</span>
        <DemoChip show={acc.demo} />
        <span className="ml-auto text-[11px] text-slate-500">{acc.last_verified ? `verified ${relTime(acc.last_verified, now)}` : "never verified"}</span>
      </div>
      <p className="mt-1 truncate font-mono text-[11px] text-slate-500" title={acc.role_arn}>
        {acc.role_arn} {acc.has_external_id ? "· external id set" : "· no external id"}
      </p>
      <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-slate-400">
        {acc.regions.map((r) => (
          <span key={r} className="rounded bg-white/5 px-1 font-mono">
            {r}
          </span>
        ))}
      </div>
      {acc.error ? <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-200">{acc.error}</p> : null}
      {acc.permissions.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5">
          {acc.permissions.map((p) => (
            <li key={p.name} className={clsx("font-mono text-[10px]", p.ok ? "text-emerald-300" : "text-rose-300")}>
              {p.ok ? "✓" : "✗"} {p.name}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" variant="outline" data-testid="account-verify" loading={busy === "verify"} onClick={verify} disabled={!admin} title={!admin ? "Admin only" : undefined} aria-label={`Verify ${acc.name}`}>
          Verify
        </Button>
        <Link href={`/app/infrastructure?account=${acc.id}`} className="text-[11px] text-brand-cyan hover:underline">
          Inventory →
        </Link>
        <Button size="sm" variant="ghost" className="ml-auto text-rose-300" icon={<IconTrash width={14} height={14} />} loading={busy === "delete"} onClick={remove} disabled={!admin} title={!admin ? "Admin only" : "Remove account"} aria-label={`Remove ${acc.name}`}>
          Remove
        </Button>
      </div>
    </li>
  );
}

export function AwsAccountsView() {
  const accounts = useAzzy((s) => s.awsAccounts);
  const upsertAccount = useAzzy((s) => s.upsertAccount);
  const [loaded, setLoaded] = useState(false);
  const now = useNow(10_000);

  useEffect(() => {
    let alive = true;
    api.awsAccounts
      .list()
      .then((list) => {
        if (!alive) return;
        useAzzy.setState({ awsAccounts: list });
      })
      .catch(() => undefined)
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  const verified = accounts.filter((a) => a.status === "verified").length;

  return (
    <div>
      <PageHeader title="AWS Accounts" subtitle={`${accounts.length} registered · ${verified} verified · cross-account access via AssumeRole + External ID, least-privilege by scope.`} />
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Card>
            <CardHeader title="Registered accounts" subtitle="Status updates live on account.changed" />
            <div className="px-3 pb-3">
              {!loaded && accounts.length === 0 ? <Skeleton className="h-32" /> : null}
              {loaded && accounts.length === 0 ? <EmptyState title="No AWS accounts yet" hint="Use the wizard to onboard one. In DEMO mode, ids starting with 1–4 verify successfully." /> : null}
              <ul className="space-y-2">
                {accounts.map((a) => (
                  <AccountRow key={a.id} acc={a} now={now} />
                ))}
              </ul>
            </div>
          </Card>
        </div>
        <div className="lg:col-span-2">
          <Wizard onCreated={upsertAccount} />
        </div>
      </div>
    </div>
  );
}
