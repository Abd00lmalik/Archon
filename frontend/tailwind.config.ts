import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0F172A",
        sand: "#F8FAFC",
        mint: "#16A34A",
        steel: "#64748B"
      }
    }
  },
  plugins: []
};

export default config;
