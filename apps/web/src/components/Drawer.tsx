"use client";

import clsx from "clsx";
import { useEffect, type ReactNode } from "react";
import { IconClose } from "./Icons";

/** Right-side drawer on desktop, full-height sheet from the bottom on mobile. */
export function Drawer({
  open,
  onClose,
  title,
  children,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close panel"
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        className={clsx(
          "absolute flex flex-col border-line bg-panel shadow-glass",
          "inset-x-0 bottom-0 max-h-[88svh] rounded-t-3xl border-t",
          "md:inset-y-0 md:left-auto md:right-0 md:h-full md:max-h-none md:w-full md:rounded-none md:border-l md:border-t-0",
          width,
          "animate-slideUp",
        )}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 text-sm font-semibold text-white">{title}</div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <IconClose />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
      </div>
    </div>
  );
}
