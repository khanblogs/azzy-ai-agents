"use client";

import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { IconSpinner } from "./Icons";

type Variant = "primary" | "purple" | "ghost" | "danger" | "success" | "outline";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

const variants: Record<Variant, string> = {
  primary: "bg-brand-cyan text-navy hover:brightness-110 focus-visible:ring-brand-cyan shadow-[0_0_18px_rgba(0,229,255,0.22)]",
  purple: "bg-brand-purple text-white hover:brightness-110 focus-visible:ring-brand-purple shadow-[0_0_18px_rgba(151,71,255,0.25)]",
  ghost: "bg-white/5 text-slate-100 hover:bg-white/10 focus-visible:ring-white/40",
  outline: "border border-line bg-transparent text-slate-200 hover:bg-white/5 focus-visible:ring-white/40",
  danger: "bg-rose-500/90 text-white hover:bg-rose-400 focus-visible:ring-rose-300",
  success: "bg-emerald-500/90 text-black hover:bg-emerald-400 focus-visible:ring-emerald-300",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-5 text-base gap-2",
};

export function Button({ variant = "ghost", size = "md", loading, icon, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center rounded-xl font-medium transition-colors focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 select-none",
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {loading ? <IconSpinner width={16} height={16} /> : icon}
      {children}
    </button>
  );
}
