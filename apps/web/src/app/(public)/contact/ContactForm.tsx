"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { api, ApiError } from "@/lib/api";

const field = "w-full rounded-xl border border-line bg-navy px-3 text-sm text-white placeholder:text-slate-600 focus:border-brand-cyan/60 focus:outline-none focus:ring-2 focus:ring-brand-cyan/20";
const label = "mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-400";

export function ContactForm() {
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.contact({ name: form.name.trim(), email: form.email.trim(), message: form.message.trim() });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? (err.status === 429 ? "Too many messages — please try again in a minute." : err.message) : "Network error — please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Card className="max-w-xl p-6" data-testid="contact-success">
        <h3 className="text-lg font-semibold text-white">Thank you — message received.</h3>
        <p className="mt-2 text-sm text-slate-400">It is now in the portal’s contact inbox. We reply to {form.email}.</p>
      </Card>
    );
  }

  return (
    <Card className="max-w-xl p-6">
      <form onSubmit={submit} className="space-y-4" data-testid="contact-form">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="c-name" className={label}>
              Name
            </label>
            <input id="c-name" data-testid="contact-name" required className={`${field} h-11`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />
          </div>
          <div>
            <label htmlFor="c-email" className={label}>
              Email
            </label>
            <input id="c-email" data-testid="contact-email" type="email" required className={`${field} h-11`} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />
          </div>
        </div>
        <div>
          <label htmlFor="c-msg" className={label}>
            Message
          </label>
          <textarea id="c-msg" data-testid="contact-message" required rows={5} minLength={10} className={`${field} py-2`} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="What should your AI office take off your plate?" />
        </div>
        {error ? (
          <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" loading={busy} data-testid="contact-submit" aria-label="Send message">
          Send message
        </Button>
      </form>
    </Card>
  );
}
