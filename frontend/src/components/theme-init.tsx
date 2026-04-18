"use client";

import { useEffect } from "react";
import { initTheme } from "@/lib/theme";

export function ThemeInit() {
  useEffect(() => {
    initTheme();
  }, []);

  return null;
}

