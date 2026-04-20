"use client";

import { useEffect } from "react";
import { initActivityFeed } from "@/lib/activity";

export function AppInit() {
  useEffect(() => {
    initActivityFeed();
  }, []);

  return null;
}
