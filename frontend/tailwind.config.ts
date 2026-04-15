import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        void: "#020608",
        base: "#060D14",
        surface: "#0B1520",
        elevated: "#101E2D",
        border: "#162334",
        "border-bright": "#1E3347",
        arc: "#00E5FF",
        "arc-dim": "#0099AA",
        pulse: "#00FFA3",
        warn: "#FF6B35",
        danger: "#FF3366",
        gold: "#F5A623",
        agent: "#BF00FF",
        "agent-dim": "#6B00A8",
        "text-primary": "#E8F4FD",
        "text-secondary": "#7A9BB5",
        "text-muted": "#3D5A73"
      },
      fontFamily: {
        heading: ["Space Grotesk", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
        body: ["Inter", "sans-serif"]
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
