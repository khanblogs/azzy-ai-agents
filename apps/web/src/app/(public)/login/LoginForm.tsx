"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { api, ApiError } from "@/lib/api";

const field =
  "h-11 w-full rounded-xl border border-line bg-navy px-3 text-sm text-white focus:border-brand-cyan/60 focus:outline-none focus:ring-2 focus:ring-brand-cyan/20";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [needOtp, setNeedOtp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.auth.login(email.trim(), password, needOtp && otp ? otp.trim() : undefined);
      try {
        localStorage.setItem("azzy.signedIn", "1");
      } catch {
        // ignore
      }
      const next = params.get("next");
      const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/app";
      router.replace(target);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403 && err.message === "mfa_required") {
          setNeedOtp(true);
          setError(otp ? "That code was not accepted. Try the next one." : "Enter the 6-digit code from your authenticator app.");
        } else if (err.status === 401) setError("Invalid email or password.");
        else if (err.status === 429) setError("Too many attempts. Wait a minute and try again.");
        else setError(err.message);
      } else setError("Network error — is the API up?");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-6">
      <form onSubmit={submit} className="space-y-4" aria-describedby={error ? "login-error" : undefined}>
        <div>
          <label htmlFor="email" className="mb-1 block text-xs font-medium text-slate-300">
            Email
          </label>
          <input id="email" data-testid="login-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-xs font-medium text-slate-300">
            Password
          </label>
          <input id="password" data-testid="login-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
        </div>
        {needOtp ? (
          <div>
            <label htmlFor="otp" className="mb-1 block text-xs font-medium text-slate-300">
              One-time code (MFA)
            </label>
            <input id="otp" data-testid="login-otp" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required value={otp} onChange={(e) => setOtp(e.target.value)} className={`${field} tracking-[0.4em]`} />
          </div>
        ) : null}
        {error ? (
          <p id="login-error" role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} data-testid="login-submit" aria-label="Sign in">
          Sign in
        </Button>
        <p className="text-center text-[11px] text-slate-500">
          The admin account comes from <code className="font-mono">OWNER_EMAIL</code> / <code className="font-mono">OWNER_PASSWORD</code>. Local auth + TOTP only (OIDC is not implemented).
        </p>
      </form>
    </Card>
  );
}
