"use client";

import clsx from "clsx";
import { useState, type ReactNode } from "react";
import { IconChevron } from "./Icons";

/**
 * Collapsible bottom sheet used on the office page for mobile; on desktop it renders as an
 * ordinary side panel (the parent decides placement via className).
 */
export function Sheet({
  title,
  children,
  className,
  defaultOpen = false,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      className={clsx("rounded-2xl border border-line bg-panel/80 backdrop-blur-md shadow-glass", className)}
      aria-label={typeof title === "string" ? title : undefined}
    >
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-white md:cursor-default"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={typeof title === "string" ? `${open ? "Collapse" : "Expand"} ${title}` : "Toggle panel"}
      >
        <span className="flex items-center gap-2">
          <span className="mx-auto hidden h-1 w-10 rounded-full bg-slate-600" aria-hidden />
          {title}
        </span>
        <IconChevron className={clsx("transition-transform md:hidden", open ? "-rotate-90" : "rotate-90")} />
      </button>
      <div className={clsx("px-3 pb-3 md:block", open ? "block" : "hidden")}>{children}</div>
    </section>
  );
}
