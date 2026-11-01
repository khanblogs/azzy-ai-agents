"use client";

import clsx from "clsx";
import { useEffect, useState, type FormEvent } from "react";
import { UserRole } from "@azzy/events";
import { Button } from "@/components/Button";
import { DemoChip } from "@/components/Brand";
import { Card, CardHeader, PageHeader } from "@/components/Card";
import { CopyButton } from "@/components/CopyButton";
import { EmptyState, Skeleton } from "@/components/EmptyState";
import { IconLock, IconTrash, IconUser } from "@/components/Icons";
import { KV } from "@/components/KV";
import { api, ApiError } from "@/lib/api";
import { relTime } from "@/lib/format";
import type { ContactMessage, Settings, UserRow } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { can, useAzzy } from "@/store/useAzzy";

const field = "h-10 w-full rounded-xl border border-line bg-navy px-3 text-sm text-white placeholder:text-slate-600 focus:border-brand-cyan/60 focus:outline-none focus:ring-2 focus:ring-brand-cyan/20";
const label = "mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-400";
const ROLES = UserRole.options;

function ProfileCard() {
  const me = useAzzy((s) => s.me);
  const loadMe = useAzzy((s) => s.loadMe);
  const toast = useAzzy((s) => s.toast);
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      setSetup(await api.auth.mfaSetup());
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Could not start MFA setup", body: err instanceof ApiError ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  };
  const enable = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.auth.mfaEnable(otp.trim());
      toast({ tone: "success", title: "MFA enabled", body: "You will be asked for a code at every sign-in." });
      setSetup(null);
      setOtp("");
      await loadMe();
    } catch (err) {
      toast({ tone: "error", title: "Code rejected", body: err instanceof ApiError ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  };
  const disable = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.auth.mfaDisable(otp.trim());
      toast({ tone: "info", title: "MFA disabled" });
      setOtp("");
      await loadMe();
    } catch (err) {
      toast({ tone: "error", title: "Code rejected", body: err instanceof ApiError ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Profile & MFA" subtitle="Local auth + TOTP. OIDC is not implemented." />
      <div className="px-4 pb-4 text-xs">
        {!me ? <Skeleton className="h-16" /> : (
          <>
            <KV rows={[{ k: "Email", v: me.email }, { k: "Role", v: <span className="capitalize">{me.role}</span> }, { k: "MFA", v: me.mfa_enabled ? <span className="text-emerald-300">enabled</span> : <span className="text-slate-400">off</span> }]} />
            <div className="mt-3 rounded-xl border border-line bg-black/20 p-3" data-testid="mfa-panel">
              {!me.mfa_enabled && !setup ? (
                <Button size="sm" variant="purple" icon={<IconLock width={14} height={14} />} loading={busy} onClick={start} aria-label="Enable MFA" data-testid="mfa-setup">
                  Enable MFA (TOTP)
                </Button>
              ) : null}
              {setup ? (
                <form onSubmit={enable} className="space-y-2">
                  <p className="text-slate-300">Add this secret to your authenticator app, then enter the current 6-digit code.</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="rounded bg-white/5 px-2 py-1 font-mono text-[11px] tracking-widest text-white">{setup.secret}</code>
                    <CopyButton text={setup.secret} label="Copy secret" />
                    <CopyButton text={setup.otpauth_uri} label="Copy otpauth URI" />
                  </div>
                  <div className="flex gap-2">
                    <input aria-label="One-time code" inputMode="numeric" pattern="[0-9]{6}" required className={clsx(field, "max-w-[160px] tracking-[0.4em]")} value={otp} onChange={(e) => setOtp(e.target.value)} data-testid="mfa-otp" />
                    <Button type="submit" size="md" variant="primary" loading={busy} aria-label="Confirm MFA" data-testid="mfa-enable">
                      Confirm
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setSetup(null)} aria-label="Cancel MFA setup">
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : null}
              {me.mfa_enabled ? (
                <form onSubmit={disable} className="flex flex-wrap items-center gap-2">
                  <span className="text-slate-300">Disable MFA with a current code:</span>
                  <input aria-label="One-time code" inputMode="numeric" pattern="[0-9]{6}" required className={clsx(field, "max-w-[160px] tracking-[0.4em]")} value={otp} onChange={(e) => setOtp(e.target.value)} />
                  <Button type="submit" variant="danger" size="md" loading={busy} aria-label="Disable MFA" data-testid="mfa-disable">
                    Disable
                  </Button>
                </form>
              ) : null}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function UsersCard() {
  const me = useAzzy((s) => s.me);
  const toast = useAzzy((s) => s.toast);
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [form, setForm] = useState<{ email: string; password: string; role: UserRole }>({ email: "", password: "", role: "readonly" });
  const [busy, setBusy] = useState(false);
  const now = useNow(30_000);
  const admin = can(me, "admin");

  const load = () =>
    api.users
      .list()
      .then(setUsers)
      .catch(() => setUsers([]));
  useEffect(() => {
    if (admin) void load();
  }, [admin]);

  if (!admin) return null;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const u = await api.users.create({ email: form.email.trim(), password: form.password, role: form.role });
      setUsers((l) => [...(l ?? []), u]);
      setForm({ email: "", password: "", role: "readonly" });
      toast({ tone: "success", title: "User created", body: `${u.email} · ${u.role}` });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Could not create user", body: err instanceof ApiError ? err.message : "Network error" });
    } finally {
      setBusy(false);
    }
  };
  const update = async (u: UserRow, patch: { role?: UserRole; disabled?: boolean }) => {
    try {
      const next = await api.users.update(u.id, patch);
      setUsers((l) => (l ?? []).map((x) => (x.id === u.id ? next : x)));
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Update failed", body: err instanceof ApiError ? err.message : "Network error" });
    }
  };
  const remove = async (u: UserRow) => {
    if (!window.confirm(`Delete ${u.email}?`)) return;
    try {
      await api.users.remove(u.id);
      setUsers((l) => (l ?? []).filter((x) => x.id !== u.id));
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Delete failed", body: err instanceof ApiError ? err.message : "Network error" });
    }
  };

  return (
    <Card>
      <CardHeader title="Users" subtitle="Roles: admin, devops, developer, security, operations, marketing, readonly" />
      <div className="px-4 pb-4">
        <form onSubmit={create} className="mb-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]" data-testid="user-form">
          <div>
            <label htmlFor="u-email" className={label}>
              Email
            </label>
            <input id="u-email" type="email" required className={field} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="user-email" />
          </div>
          <div>
            <label htmlFor="u-pass" className={label}>
              Password
            </label>
            <input id="u-pass" type="password" required minLength={8} autoComplete="new-password" className={field} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="user-password" />
          </div>
          <div>
            <label htmlFor="u-role" className={label}>
              Role
            </label>
            <select id="u-role" className={field} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })} data-testid="user-role">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button type="submit" variant="primary" loading={busy} icon={<IconUser width={14} height={14} />} aria-label="Create user" data-testid="user-submit">
              Add
            </Button>
          </div>
        </form>
        {users === null ? <Skeleton className="h-20" /> : (
          <ul className="divide-y divide-line text-xs">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-2 py-2" data-testid="user-row">
                <span className="min-w-0 flex-1 truncate text-slate-200">{u.email}</span>
                <select aria-label={`Role for ${u.email}`} className="h-8 rounded-lg border border-line bg-navy px-2 text-xs text-slate-200" value={u.role} onChange={(e) => update(u, { role: e.target.value as UserRole })} disabled={u.email === me?.email}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] text-slate-500">{u.last_login ? `seen ${relTime(u.last_login, now)}` : "never signed in"}</span>
                <Button size="sm" variant="outline" onClick={() => update(u, { disabled: !u.disabled })} disabled={u.email === me?.email} title={u.email === me?.email ? "You cannot disable yourself" : undefined} aria-label={u.disabled ? `Enable ${u.email}` : `Disable ${u.email}`}>
                  {u.disabled ? "Enable" : "Disable"}
                </Button>
                <Button size="sm" variant="ghost" className="text-rose-300" icon={<IconTrash width={14} height={14} />} onClick={() => remove(u)} disabled={u.email === me?.email} title={u.email === me?.email ? "You cannot delete yourself" : "Delete user"} aria-label={`Delete ${u.email}`} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function PlatformCard() {
  const me = useAzzy((s) => s.me);
  const toast = useAzzy((s) => s.toast);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [budget, setBudget] = useState("");
  const [targets, setTargets] = useState("");
  const [retention, setRetention] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const admin = can(me, "admin");

  useEffect(() => {
    api.settings
      .get()
      .then((s) => {
        setSettings(s);
        setBudget(String(s.daily_budget_usd));
        setTargets(s.authorized_targets.join("\n"));
        setRetention(Object.fromEntries(Object.entries(s.retention).map(([k, v]) => [k, String(v)])));
      })
      .catch(() => setSettings(null));
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const next = await api.settings.update({
        daily_budget_usd: Number(budget),
        authorized_targets: targets.split(/\n|,/).map((t) => t.trim()).filter(Boolean),
        retention: Object.fromEntries(Object.entries(retention).map(([k, v]) => [k, Number(v)])),
      });
      setSettings(next);
      useAzzy.setState((s) => ({ costs: { ...s.costs, budget_usd: next.daily_budget_usd } }));
      toast({ tone: "success", title: "Settings saved" });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Could not save", body: err instanceof ApiError ? err.message : "Network error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Budgets, targets & retention" subtitle={settings ? `public URL ${settings.public_base_url || "—"} · approval timeout ${Math.round(settings.approval_timeout_seconds / 60)} min` : "loading…"} action={settings ? <DemoChip show={settings.demo} /> : null} />
      <div className="px-4 pb-4">
        {!settings ? <Skeleton className="h-24" /> : (
          <form onSubmit={save} className="space-y-3" data-testid="settings-form">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="s-budget" className={label}>
                  Daily budget (USD, all agents)
                </label>
                <input id="s-budget" type="number" min={0} step={0.5} className={field} value={budget} onChange={(e) => setBudget(e.target.value)} disabled={!admin} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {Object.keys(retention).map((k) => (
                  <div key={k}>
                    <label htmlFor={`ret-${k}`} className={label}>
                      {k.replace(/_/g, " ")}
                    </label>
                    <input id={`ret-${k}`} type="number" min={1} className={field} value={retention[k]} onChange={(e) => setRetention({ ...retention, [k]: e.target.value })} disabled={!admin} />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="s-targets" className={label}>
                Authorised scan targets (one per line) — nuclei / ZAP refuse anything else
              </label>
              <textarea id="s-targets" rows={4} className="w-full rounded-xl border border-line bg-navy px-3 py-2 font-mono text-xs text-white focus:border-brand-cyan/60 focus:outline-none" value={targets} onChange={(e) => setTargets(e.target.value)} disabled={!admin} placeholder="https://staging.client-a.example.com" />
            </div>
            <Button type="submit" variant="primary" loading={busy} disabled={!admin} title={!admin ? "Admin only" : undefined} aria-label="Save settings" data-testid="settings-save">
              Save
            </Button>
          </form>
        )}
      </div>
    </Card>
  );
}

function ContactInbox() {
  const me = useAzzy((s) => s.me);
  const [msgs, setMsgs] = useState<ContactMessage[] | null>(null);
  const now = useNow(30_000);
  const admin = can(me, "admin");
  useEffect(() => {
    if (!admin) return;
    api.settings
      .contactMessages()
      .then(setMsgs)
      .catch(() => setMsgs([]));
  }, [admin]);
  if (!admin) return null;
  return (
    <Card>
      <CardHeader title="Contact inbox" subtitle="Messages from the public /contact form" />
      <div className="px-4 pb-4 text-xs">
        {msgs === null ? <Skeleton className="h-16" /> : msgs.length === 0 ? <EmptyState title="Inbox empty" hint="Submissions from the public contact page land here." /> : (
          <ul className="space-y-2">
            {msgs.map((m) => (
              <li key={m.id} className="rounded-xl border border-line bg-black/20 p-3" data-testid="contact-row">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-white">{m.name}</span>
                  <a href={`mailto:${m.email}`} className="text-brand-cyan hover:underline">
                    {m.email}
                  </a>
                  <span className="ml-auto text-slate-500">{relTime(m.created_at, now)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-slate-200">{m.message}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export function SettingsView() {
  const me = useAzzy((s) => s.me);
  return (
    <div>
      <PageHeader title="Settings" subtitle={me?.role === "admin" ? "Profile, users, budgets, targets, retention and the contact inbox." : "Your profile and MFA. Platform settings are admin-only."} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ProfileCard />
        <PlatformCard />
        <div className="lg:col-span-2">
          <UsersCard />
        </div>
        <div className="lg:col-span-2">
          <ContactInbox />
        </div>
      </div>
    </div>
  );
}
