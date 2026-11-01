"use client";

import clsx from "clsx";
import { useAzzy } from "@/store/useAzzy";
import { IconClose } from "./Icons";

export function Toasts() {
  const toasts = useAzzy((s) => s.toasts);
  const dismiss = useAzzy((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[70] flex flex-col items-center gap-2 px-4"
      style={{ top: "calc(env(safe-area-inset-top) + 64px)" }}
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={clsx(
            "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border px-4 py-3 shadow-glass backdrop-blur-md animate-slideUp",
            t.tone === "success" && "border-emerald-500/40 bg-emerald-950/80",
            t.tone === "error" && "border-rose-500/40 bg-rose-950/80",
            t.tone === "info" && "border-cyan-500/30 bg-panel/90",
          )}
          role="status"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white">{t.title}</p>
            {t.body ? <p className="mt-0.5 text-xs text-slate-300">{t.body}</p> : null}
          </div>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss notification"
            className="rounded-md p-1 text-slate-400 hover:text-white"
          >
            <IconClose width={16} height={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
