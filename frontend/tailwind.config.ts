import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        void: "var(--void)",
        base: "var(--base)",
        surface: "var(--surface)",
        elevated: "var(--elevated)",
        border: "var(--border)",
        "border-bright": "var(--border-bright)",
        arc: "var(--arc)",
        "arc-dim": "var(--arc-dim)",
        pulse: "var(--pulse)",
        warn: "var(--warn)",
        danger: "var(--danger)",
        gold: "var(--gold)",
        agent: "var(--agent-primary)",
        "agent-dim": "var(--agent-dim)",
        "text-primary": "var(--text-primary)",
        "text-secondary": "var(--text-secondary)",
        "text-muted": "var(--text-muted)"
      },
      fontFamily: {
        heading: ["Space Grotesk", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
        body: ["Inter", "system-ui", "sans-serif"],
        sans: ["Inter", "system-ui", "sans-serif"]
      },
      animation: {
        "float-up": "float-up 0.5s ease-out forwards",
        "pulse-dot": "pulse-dot 2s ease-in-out infinite",
        scan: "scan-line 3s linear infinite"
      }
    }
  },
  plugins: []
};

export default config;
