"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CredentialCard } from "@/components/credential-card";
import { generateDID } from "@/lib/did";
import { subscribeToCredentials } from "@/lib/events";
import {
  CredentialRecord,
  expectedChainId,
  fetchArcIdentityForWallet,
  fetchCredentialsForAgent,
  getReadProvider,
  getSourceLabelForDisplay,
  shortAddress
} from "@/lib/contracts";
import {
  calculateWeightedScore,
  getNextTier,
  getPointsToNextTier,
  getReputationTier,
  getScoreBreakdown,
  getSourceColor,
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

export default function ProfilePage() {
  const { account, chainId, browserProvider, connect } = useWallet();
  const [credentials, setCredentials] = useState<CredentialRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [activeFilter, setActiveFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [arcIdentity, setArcIdentity] = useState<{ tokenId: number; tokenURI: string } | null>(null);

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

  useEffect(() => {
    if (!account) return () => undefined;
    const unsubscribe = subscribeToCredentials(
      browserProvider ?? getReadProvider(),
      account,
      (credential) => {
        setCredentials((previous) => {
          if (previous.some((item) => item.credentialId === credential.credentialId)) {
            return previous;
          }
          return [credential, ...previous];
        });
      }
    );
    return unsubscribe;
  }, [account, browserProvider]);

  const profileChainId = chainId ?? expectedChainId;
  const did = account ? generateDID(account, profileChainId) : "";
  const score = useMemo(() => calculateWeightedScore(credentials), [credentials]);
  const tier = useMemo(() => getReputationTier(score), [score]);
  const nextTier = useMemo(() => getNextTier(score), [score]);
  const pointsToNextTier = useMemo(() => getPointsToNextTier(score), [score]);
  const scoreBreakdown = useMemo(() => getScoreBreakdown(credentials), [credentials]);
  const tierProgressPercent = useMemo(() => {
    if (pointsToNextTier <= 0) return 100;
    const progress = (1 - pointsToNextTier / Math.max(score + pointsToNextTier, 1)) * 100;
    return Math.min(100, Math.max(0, progress));
  }, [pointsToNextTier, score]);
  const scoreBreakdownText = useMemo(() => {
    const entries = Object.entries(scoreBreakdown);
    if (entries.length === 0) return "No source breakdown yet.";
    return entries.map(([sourceType, value]) => `${getSourceLabel(sourceType)}: ${value} pts`).join(" · ");
  }, [scoreBreakdown]);

  const filteredCredentials = useMemo(() => {
    if (activeFilter === "all") return credentials;
    return credentials.filter((credential) => normalizeSource(credential.sourceType) === activeFilter);
  }, [activeFilter, credentials]);

  useEffect(() => {
    let active = true;
    const loadIdentity = async () => {
      if (!account) {
        setArcIdentity(null);
        return;
      }
      try {
        const identity = await fetchArcIdentityForWallet(account);
        if (!active) return;
        setArcIdentity(identity);
      } catch {
        if (!active) return;
        setArcIdentity(null);
      }
    };
    void loadIdentity();
    return () => {
      active = false;
    };
  }, [account]);

  const copyToClipboard = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(`${label} copied`);
      setTimeout(() => setCopyStatus(""), 1500);
    } catch {
      setCopyStatus(`Failed to copy ${label.toLowerCase()}`);
      setTimeout(() => setCopyStatus(""), 1500);
    }
  };

  return (
    <section className="space-y-6">
      <div className="archon-card p-6">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">Unified Reputation Dashboard</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">
          Credentials from jobs, GitHub, agent tasks, community work, peer attestations, and governance.
        </p>

        {!account ? (
          <div className="mt-5 rounded-xl border border-amber-300/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Wallet not connected.{" "}
            <button type="button" onClick={() => void connect()} className="underline underline-offset-4">
              Connect wallet
            </button>
            .
          </div>
        ) : (
          <div className="mt-5 grid gap-3 text-sm text-[#9CA3AF]">
            <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
              <span className="font-medium text-[#EAEAF0]">Wallet:</span> {shortAddress(account)}
              <button
                type="button"
                aria-label="Copy wallet address"
                onClick={() => void copyToClipboard(account, "Wallet address")}
                className="archon-button-secondary ml-2 px-2 py-0.5 text-xs"
              >
                Copy
              </button>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
              <span className="font-medium text-[#EAEAF0]">Public verification link:</span>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void copyToClipboard(`${window.location.origin}/verify/${account}`, "Verification link")}
                  className="archon-button-secondary px-2 py-0.5 text-xs"
                >
                  Copy
                </button>
                <a
                  href={`/verify/${account}`}
                  target="_blank"
                  rel="noreferrer"
                  className="archon-button-secondary inline-flex px-2 py-0.5 text-xs"
                >
                  Open
                </a>
                <span className="text-xs text-[#9CA3AF]">Anyone can verify your credentials at this link.</span>
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
              <span className="font-medium text-[#EAEAF0]">Connected chain:</span> {chainId ?? "unknown"}
              {chainId !== null && chainId !== expectedChainId ? ` (switch to ${expectedChainId})` : ""}
            </div>
            <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
              <span className="font-medium text-[#EAEAF0]">DID:</span> {did}
              <button
                type="button"
                onClick={() => void copyToClipboard(did, "DID")}
                className="archon-button-secondary ml-2 px-2 py-0.5 text-xs"
              >
                Copy DID
              </button>
              <p className="mt-1 text-xs text-[#9CA3AF]">
                Your DID is a portable identifier that will follow your credentials across wallet rotations in future versions.
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
              <span className="font-medium text-[#EAEAF0]">Arc Agent ID:</span>{" "}
              {arcIdentity ? (
                <a
                  href={`https://testnet.arcscan.app/token/0x8004A818BFB912233c491871b3d84c89A494BD9e?a=${arcIdentity.tokenId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#8FD9FF] underline underline-offset-4"
                >
                  #{arcIdentity.tokenId}
                </a>
              ) : (
                <span className="text-[#9CA3AF]">Not registered - register when you launch your agent</span>
              )}
              {arcIdentity?.tokenURI ? (
                <p className="mt-1 break-all text-xs text-[#9CA3AF]">Metadata: {arcIdentity.tokenURI}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Refresh credentials"
                onClick={() => void loadCredentials()}
                className="archon-button-secondary px-3 py-2 text-xs"
              >
                Refresh
              </button>
              {copyStatus ? <span className="text-xs text-[#00D1B2]">{copyStatus}</span> : null}
            </div>
          </div>
        )}
      </div>

      {error ? (
        <div className="archon-card border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="archon-card p-6">
        <h2 className="text-lg font-semibold tracking-wide text-[#EAEAF0]">Reputation Score</h2>
        <p className="mt-1 text-sm text-[#9CA3AF]">Score = sum of credential weights (capped at 2000).</p>

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <div>
            <div className="text-3xl font-semibold text-[#EAEAF0]">{score}</div>
            <div className="text-sm font-semibold text-[#00D1B2]">{tier}</div>
          </div>
          <div className="min-w-[220px] flex-1">
            <div className="mb-1 flex justify-between text-xs text-[#9CA3AF]">
              <span>
                Current tier: <span className="text-[#EAEAF0]">{tier}</span>
              </span>
              <span className="text-[#808894]">Next: {nextTier}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-[#00D1B2] transition-all duration-700"
                style={{ width: `${tierProgressPercent}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-[#9CA3AF]">
              {pointsToNextTier > 0 ? `${pointsToNextTier} points to ${nextTier}` : "Top tier reached"}
            </p>
          </div>
        </div>

        <p className="mt-4 text-sm text-[#9CA3AF]">{scoreBreakdownText}</p>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(scoreBreakdown).map(([sourceType, value]) => (
            <div key={sourceType} className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-sm">
              <span className="font-medium" style={{ color: getSourceColor(sourceType) }}>
                {getSourceLabel(sourceType)}:
              </span>{" "}
              <span className="text-[#EAEAF0]">{value} pts</span>
            </div>
          ))}
          {Object.keys(scoreBreakdown).length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-sm text-[#9CA3AF]">
              No score breakdown yet.
            </div>
          ) : null}
        </div>
      </div>

      <div className="archon-card p-6">
        <h2 className="text-lg font-semibold tracking-wide text-[#EAEAF0]">Credential Timeline</h2>
        <p className="mt-1 text-sm text-[#9CA3AF]">Permanent source-tagged records across all activity types.</p>

        <div className="mt-4 flex flex-wrap gap-2">
          {FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              onClick={() => setActiveFilter(filter.key)}
              className={`rounded-full px-3 py-1.5 text-xs transition-all ${
                activeFilter === filter.key
                  ? "bg-[#6C5CE7]/35 text-[#EAEAF0]"
                  : "bg-white/5 text-[#9CA3AF] hover:bg-white/10 hover:text-[#EAEAF0]"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {!account ? (
          <p className="mt-4 text-sm text-[#9CA3AF]">Connect your wallet to view credentials.</p>
        ) : loading ? (
          <p className="mt-4 text-sm text-[#9CA3AF]">Loading credentials...</p>
        ) : credentials.length === 0 ? (
          <div className="mt-4 rounded-xl border border-white/10 bg-[#111214] p-4">
            <p className="text-sm font-semibold text-[#EAEAF0]">Your reputation trail is empty. Here is how to start:</p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <Link href="/" className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-[#9CA3AF] hover:border-[#00D1B2]/40">
                Complete a Task {"->"} earn 100 pts
              </Link>
              <Link href="/governance" className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-[#9CA3AF] hover:border-[#00D1B2]/40">
                Vote in a DAO {"->"} earn 90 pts
              </Link>
              <Link href="/community" className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-[#9CA3AF] hover:border-[#00D1B2]/40">
                Contribute to community {"->"} earn 50-120 pts
              </Link>
            </div>
          </div>
        ) : filteredCredentials.length === 0 ? (
          <p className="mt-4 text-sm text-[#9CA3AF]">No credentials for this filter yet.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {filteredCredentials.map((credential) => (
              <div key={credential.credentialId} className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-[#9CA3AF]">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: getSourceColor(credential.sourceType) }}
                  />
                  <span>{getSourceLabelForDisplay(credential.sourceType)}</span>
                </div>
                <CredentialCard credential={credential} provider={browserProvider ?? getReadProvider()} />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
