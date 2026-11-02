"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AGENT_META } from "@azzy/events";
import { api, ApiError } from "@/lib/api";
import { can, useAzzy } from "@/store/useAzzy";
import { Logo } from "./Brand";
import { IconSend } from "./Icons";
import { ThemeToggle } from "./ThemeToggle";
import { StatusDot } from "./StatusDot";

const WS_COLORS = { connected: "#22c55e", connecting: "#eab308", disconnected: "#ef4444" } as const;
const WS_LABELS = { connected: "live", connecting: "connecting", disconnected: "offline" } as const;

export function CommandBar() {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useAzzy((s) => s.toast);
  const upsertTask = useAzzy((s) => s.upsertTask);
  const me = useAzzy((s) => s.me);
  const ws = useAzzy((s) => s.ws);
  const office = useAzzy((s) => s.office.status);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const prompt = value.trim();
    if (!prompt || busy) return;
    setBusy(true);
    try {
      const task = await api.tasks.create(prompt);
      upsertTask(task);
      const lead = task.lead ? AGENT_META[task.lead].name : "Azzy Orchestrator";
      const team = task.assignees.filter((a) => a !== task.lead).map((a) => AGENT_META[a].name);
      const env = task.env_id ? ` · env ${task.env_id}` : "";
      toast({ tone: "success", title: `Routed to ${lead}${team.length ? ` (+ ${team.join(", ")})` : ""}`, body: `${task.title}${env}` });
      setValue("");
    } catch (err) {
      if (!(err instanceof ApiError && (err.status === 403 || err.status === 429))) {
        toast({ tone: "error", title: "Could not create task", body: err instanceof ApiError ? err.message : "Network error" });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <header
      className="sticky top-0 z-30 border-b border-line bg-base/80 backdrop-blur-md"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex items-center gap-2 px-3 py-2 md:px-5">
        <div className="flex items-center md:hidden">
          <Logo size={30} />
        </div>
        <form onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-2" role="search">
          <label htmlFor="command-input" className="sr-only">
            Command for Azzy
          </label>
          <div className="relative min-w-0 flex-1">
            <input
              id="command-input"
              ref={inputRef}
              data-testid="command-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder='Ask Azzy… e.g. "Investigate my failing ECS deployment, fix, test, assess and request approval"'
              autoComplete="off"
              enterKeyHint="send"
              disabled={!can(me, "write")}
              title={!can(me, "write") ? "Read-only role cannot create tasks" : undefined}
              className="h-10 w-full rounded-xl border border-line bg-midnight/80 pl-3 pr-9 text-sm text-white placeholder:text-slate-500 disabled:opacity-50 focus:border-brand-cyan/60 focus:outline-none focus:ring-2 focus:ring-brand-cyan/20"
            />
            <kbd
              className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1.5 text-[10px] text-slate-500 md:block"
              aria-hidden
            >
              /
            </kbd>
          </div>
          <button
            type="submit"
            data-testid="command-submit"
            aria-label="Send command"
            disabled={busy || !value.trim() || !can(me, "write")}
            title={!can(me, "write") ? "Read-only role cannot create tasks" : undefined}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-cyan text-navy transition hover:brightness-110 disabled:opacity-40"
          >
            <IconSend width={18} height={18} />
          </button>
        </form>
        <ThemeToggle />
        <div
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-line px-2 py-1 text-[11px] text-slate-300"
          data-testid="ws-status"
          data-state={ws}
          title={`WebSocket ${WS_LABELS[ws]}`}
        >
          <StatusDot color={WS_COLORS[ws]} label={`WebSocket ${WS_LABELS[ws]}`} pulse={ws !== "connected"} />
          <span>{WS_LABELS[ws]}</span>
          {office !== "nominal" ? (
            <span className="ml-1 rounded-full bg-white/10 px-1.5 capitalize text-slate-200">{office}</span>
          ) : null}
        </div>
      </div>
    </header>
  );
}
