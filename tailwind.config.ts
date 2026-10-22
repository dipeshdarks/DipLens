import type { Config } from "tailwindcss";
export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./content/**/*.{mdx,md}",
  ],
  theme: { extend: {
    colors: {
      base: "rgb(var(--c-base) / <alpha-value>)",
      card: "rgb(var(--c-card) / <alpha-value>)",
      elev: "rgb(var(--c-elev) / <alpha-value>)",
      line: "rgb(var(--c-line) / <alpha-value>)",
      ink: "rgb(var(--c-ink) / <alpha-value>)",
      mute: "rgb(var(--c-mute) / <alpha-value>)",
      ok: "rgb(var(--c-ok) / <alpha-value>)",
      info: "rgb(var(--c-info) / <alpha-value>)",
      warn: "rgb(var(--c-warn) / <alpha-value>)",
      bad: "rgb(var(--c-bad) / <alpha-value>)",
    },
    fontFamily: { sans: ["var(--font-geist-sans)", "Inter", "system-ui", "sans-serif"], mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"] },
  } },
} satisfies Config;
