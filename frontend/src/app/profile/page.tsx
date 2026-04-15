"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CredentialCard } from "@/components/credential-card";
import { generateDID } from "@/lib/did";
import {
  CredentialRecord,
  expectedChainId,
  fetchCredentialsForAgent,
  getReadProvider,
  shortAddress
} from "@/lib/contracts";
import {
  calculateWeightedScore,
  getNextTier,
  getPointsToNextTier,
  getReputationTier,
  getScoreBreakdown,
  getSourceLabel
} from "@/lib/reputation";
import { useWallet } from "@/lib/wallet-context";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "job", label: "Tasks" },
  { key: "github", label: "GitHub" },
  { key: "agent_task", label: "Agent Tasks" },
  { key: "community", label: "Community" },
  { key: "peer_attestation", label: "Peer" },
  { key: "dao_governance", label: "Governance" }
] as const;

function normalizeSource(sourceType: string) {
  const normalized = sourceType.toLowerCase().trim();
  if (normalized.startsWith("github")) return "github";
  if (normalized.startsWith("community")) return "community";
  return normalized;
}

function ReputationOdometer({ score }: { score: number }) {
  const [displayed, setDisplayed] = useState(0);

  useEffect(() => {
    const duration = 1500;
    const steps = 60;
    const increment = score / steps;
    let current = 0;
    let step = 0;

    const timer = window.setInterval(() => {
      step += 1;
      current = Math.min(Math.round(increment * step), score);
      setDisplayed(current);
      if (step >= steps) window.clearInterval(timer);
    }, duration / steps);

    return () => window.clearInterval(timer);
  }, [score]);

  return (
    <div className="font-heading tabular-nums text-[64px] font-bold leading-none md:text-[80px]" style={{ color: "var(--arc)", letterSpacing: "-0.03em" }}>
      {displayed.toLocaleString()}
    </div>
  );
}

export default function ProfilePage() {
  const { account, chainId, browserProvider, connect } = useWallet();
  const [credentials, setCredentials] = useState<CredentialRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeFilter, setActiveFilter] = useState<(typeof FILTERS)[number]["key"]>("all");

  const loadCredentials = useCallback(async () => {
    if (!account) {
      setCredentials([]);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const list = await fetchCredentialsForAgent(account);
      setCredentials(list);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load credentials.");
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    void loadCredentials();
  }, [loadCredentials]);

  const profileChainId = chainId ?? expectedChainId;
  const did = account ? generateDID(account, profileChainId) : "";
  const score = useMemo(() => calculateWeightedScore(credentials), [credentials]);
  const tier = useMemo(() => getReputationTier(score), [score]);
  const nextTier = useMemo(() => getNextTier(score), [score]);
  const pointsToNextTier = useMemo(() => getPointsToNextTier(score), [score]);
  const scoreBreakdown = useMemo(() => getScoreBreakdown(credentials), [credentials]);

  const filteredCredentials = useMemo(() => {
    if (activeFilter === "all") return credentials;
    return credentials.filter((credential) => normalizeSource(credential.sourceType) === activeFilter);
  }, [activeFilter, credentials]);

  return (
    <section className="page-container space-y-6">
      <div className="panel grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center border border-[var(--border-bright)] bg-[var(--void)] font-heading text-2xl font-bold text-[var(--arc)]">
            {account ? account.slice(2, 4).toUpperCase() : "--"}
          </div>
          <div className="space-y-1">
            <h1 className="font-heading text-3xl font-bold">Identity Profile</h1>
            <p className="mono text-xs text-[var(--text-secondary)]">Wallet: {account ? shortAddress(account) : "Not connected"}</p>
            <p className="mono text-xs text-[var(--text-muted)]">DID: {did || "-"}</p>
            <div className="badge badge-agent">{tier}</div>
          </div>
        </div>

        <div className="panel-elevated">
          <ReputationOdometer score={score} />
          <p className="mt-2 text-xs uppercase tracking-[0.15em] text-[var(--text-muted)]">Reputation score</p>
          <div className="mt-4 h-2 bg-[var(--void)]">
            <div className="h-full bg-[var(--arc)]" style={{ width: `${Math.min((score / 2000) * 100, 100)}%` }} />
          </div>
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            {pointsToNextTier > 0 ? `${pointsToNextTier} points to ${nextTier}` : "Top tier reached"}
          </p>
        </div>
      </div>

      {!account ? (
        <div className="panel text-sm text-[var(--text-secondary)]">
          Wallet not connected. <button onClick={() => void connect()} className="btn-primary ml-2">Connect wallet</button>
        </div>
      ) : null}

      {error ? <div className="panel border border-[var(--danger)] text-sm text-[var(--danger)]">{error}</div> : null}

      <div className="grid gap-6 xl:grid-cols-[30%_40%_30%]">
        <div className="panel space-y-3">
          <div className="section-header">Score Breakdown</div>
          {Object.entries(scoreBreakdown).map(([sourceType, value]) => (
            <div key={sourceType} className="flex items-center justify-between border-b border-[var(--border)] pb-2 text-sm">
              <span className="text-[var(--text-secondary)]">{getSourceLabel(sourceType)}</span>
              <span className="mono text-[var(--arc)]">{value} pts</span>
            </div>
          ))}
          {Object.keys(scoreBreakdown).length === 0 ? <p className="text-sm text-[var(--text-secondary)]">No data yet.</p> : null}
        </div>

        <div className="panel space-y-4">
          <div className="section-header">Credential Timeline</div>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((filter) => (
              <button
                key={filter.key}
                onClick={() => setActiveFilter(filter.key)}
                className={activeFilter === filter.key ? "btn-primary px-2 py-1 text-[10px]" : "btn-ghost px-2 py-1 text-[10px]"}
              >
                {filter.label}
              </button>
            ))}
          </div>
          {loading ? <p className="text-sm text-[var(--text-secondary)]">Loading credentials...</p> : null}
          <div className="grid gap-4 md:grid-cols-2">
            {filteredCredentials.map((credential) => (
              <CredentialCard key={credential.credentialId} credential={credential} provider={browserProvider ?? getReadProvider()} />
            ))}
          </div>
          {!loading && filteredCredentials.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">No credentials yet.</p> : null}
        </div>

        <div className="panel space-y-4">
          <div className="section-header">Verification & Share</div>
          {account ? (
            <>
              <p className="text-sm text-[var(--text-secondary)]">Public verification link</p>
              <div className="mono break-all text-xs text-[var(--arc)]">{typeof window !== "undefined" ? `${window.location.origin}/verify/${account}` : `/verify/${account}`}</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/verify/${account}`)}
                >
                  Copy
                </button>
                <Link href={`/verify/${account}`} target="_blank" className="btn-primary">
                  Open
                </Link>
              </div>
            </>
          ) : (
            <p className="text-sm text-[var(--text-secondary)]">Connect wallet to generate your link.</p>
          )}
        </div>
      </div>
    </section>
  );
}
