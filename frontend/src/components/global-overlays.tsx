"use client";

import { useEffect, useState } from "react";
import { Tutorial, TUTORIAL_STORAGE_KEY } from "@/components/tutorial";
import { WalletPicker } from "@/components/wallet-picker";

export const OPEN_TUTORIAL_EVENT = "archon:open-tutorial";

export function GlobalOverlays() {
  const [showTutorial, setShowTutorial] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return () => undefined;

    const seen = window.localStorage.getItem(TUTORIAL_STORAGE_KEY);
    if (!seen) {
      setShowTutorial(true);
    }

    const openTutorial = () => setShowTutorial(true);
    window.addEventListener(OPEN_TUTORIAL_EVENT, openTutorial);

    return () => {
      window.removeEventListener(OPEN_TUTORIAL_EVENT, openTutorial);
    };
  }, []);

  return (
    <>
      <WalletPicker />
      <Tutorial isOpen={showTutorial} onClose={() => setShowTutorial(false)} />
    </>
  );
}
