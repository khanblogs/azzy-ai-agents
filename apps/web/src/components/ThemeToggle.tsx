"use client";

import { useEffect, useState } from "react";
import { IconMoon, IconSun } from "./Icons";

/**
 * Dark/light theme toggle. Dark is the default (the original design);
 * the choice persists in localStorage ("azzy-theme") and is applied
 * pre-paint by the inline script in the root layout via
 * document.documentElement.dataset.theme. The 3D office canvas keeps
 * its own dark scene in both themes.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);

  const toggle = () => {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("azzy-theme", next);
    } catch {
      // storage unavailable (private mode) - the toggle still applies for this session
    }
    setTheme(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      data-testid="theme-toggle"
      aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
      title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line text-slate-300 transition hover:bg-white/10 hover:text-white"
    >
      {theme === "light" ? <IconMoon width={18} height={18} /> : <IconSun width={18} height={18} />}
    </button>
  );
}
