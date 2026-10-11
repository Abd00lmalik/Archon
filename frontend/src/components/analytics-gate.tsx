"use client";

import { useEffect, useState, type ReactNode } from "react";
import { fetchAnalyticsGateAddresses } from "@/lib/contracts";
import { useWallet } from "@/lib/wallet-context";

export function AnalyticsGate({ children }: { children: ReactNode }) {
  const { account } = useWallet();
  const [allowed, setAllowed] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAnalyticsGateAddresses()
      .then((addresses) => {
        if (!cancelled) setAllowed(addresses);
      })
      .catch(() => {
        if (!cancelled) setAllowed([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!account) {
    return (
      <main className="page-container min-h-[70vh] flex flex-col items-center justify-center p-6">
        <div className="panel max-w-md w-full border border-border bg-surface/30 p-6 rounded-2xl text-center space-y-3">
          <h2 className="heading text-xl font-bold text-text-primary">Analytics Restricted</h2>
          <p className="font-mono text-sm text-text-secondary">
            Connect the fee collector or treasury wallet to view platform analytics.
          </p>
        </div>
      </main>
    );
  }

  if (allowed === null) {
    return (
      <main className="page-container min-h-[70vh] flex flex-col items-center justify-center p-6">
        <div className="panel max-w-md w-full border border-border bg-surface/30 p-6 rounded-2xl text-center">
          <p className="font-mono text-sm text-text-secondary animate-pulse">Verifying access…</p>
        </div>
      </main>
    );
  }

  if (!allowed.includes(account.toLowerCase())) {
    return (
      <main className="page-container min-h-[70vh] flex flex-col items-center justify-center p-6">
        <div className="panel max-w-md w-full border border-danger/30 bg-danger/5 p-6 rounded-2xl text-center space-y-3">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border-2 border-danger text-2xl font-bold text-danger">!</div>
          <h2 className="heading text-xl font-bold text-text-primary">Access restricted</h2>
          <p className="font-mono text-sm text-text-secondary">
            Only the fee collector or treasury wallet can view analytics.
          </p>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
