import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: { extend: {
    colors: { base: "#0B0D10", card: "#12161C", elev: "#191F27", line: "#29313B", ink: "#F4F7FA", mute: "#9AA6B2", ok: "#67E8A5", info: "#7CB7FF", warn: "#F5C56A", bad: "#FF7D85" },
    fontFamily: { sans: ["var(--font-geist-sans)", "Inter", "system-ui", "sans-serif"], mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"] },
  } },
} satisfies Config;
