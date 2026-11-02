import type { Config } from "tailwindcss";

/** Palette mirrors BRAND in packages/events (navy base, midnight panels, cyan/purple/magenta/gold accents). */
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: "rgb(var(--c-navy) / <alpha-value>)",
        midnight: "rgb(var(--c-panel) / <alpha-value>)",
        base: "rgb(var(--c-navy) / <alpha-value>)",
        panel: "rgb(var(--c-panel) / <alpha-value>)",
        line: "rgb(var(--c-line) / <alpha-value>)",
        brand: {
          cyan: "#00E5FF",
          purple: "#9747FF",
          magenta: "#F04DFF",
          gold: "#FFB547",
          green: "#34D399",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: {
        glow: "0 0 24px rgba(0, 229, 255, 0.22)",
        glowPurple: "0 0 24px rgba(151, 71, 255, 0.25)",
        glass: "0 8px 32px rgba(0, 0, 0, 0.45)",
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #00E5FF 0%, #9747FF 55%, #F04DFF 100%)",
      },
      keyframes: {
        pulseDot: { "0%, 100%": { opacity: "1" }, "50%": { opacity: "0.35" } },
        slideUp: { from: { transform: "translateY(12px)", opacity: "0" }, to: { transform: "translateY(0)", opacity: "1" } },
        dash: { to: { strokeDashoffset: "-40" } },
        floaty: { "0%, 100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-6px)" } },
      },
      animation: {
        pulseDot: "pulseDot 1.6s ease-in-out infinite",
        slideUp: "slideUp 220ms ease-out",
        dash: "dash 1.2s linear infinite",
        floaty: "floaty 5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
