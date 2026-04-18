"use client";

export type Theme = "dark" | "light";

export function getTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem("archon-theme") as Theme | null;
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function setTheme(theme: Theme) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme);
  }
  if (typeof window !== "undefined") {
    window.localStorage.setItem("archon-theme", theme);
  }
}

export function toggleTheme(): Theme {
  const current = typeof document !== "undefined" ? document.documentElement.getAttribute("data-theme") : "dark";
  const next: Theme = current === "light" ? "dark" : "light";
  setTheme(next);
  return next;
}

export function initTheme(): Theme {
  const theme = getTheme();
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme);
  }
  return theme;
}

