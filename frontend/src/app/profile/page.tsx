"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CredentialCard } from "@/components/credential-card";
import { generateDID } from "@/lib/did";
import { subscribeToCredentials } from "@/lib/events";
import {
  CredentialRecord,
  expectedChainId,
  getReadProvider,
  getValidationRegistryReadContract,
  parseCredential,
  shortAddress
} from "@/lib/contracts";
import { calculateReputationScore, getReputationTier, getTierColor } from "@/lib/reputation";
import { useWallet } from "@/lib/wallet-context";

function getProgressMeta(score: number) {
  if (score >= 500) {
    return { progress: 100, remaining: 0, nextTier: "Max tier" };
  }
  if (score >= 300) {
    return { progress: ((score - 300) / 200) * 100, remaining: 500 - score, nextTier: "Elite" };
  }
  if (score >= 150) {
    return { progress: ((score - 150) / 150) * 100, remaining: 300 - score, nextTier: "Expert" };
  }
  if (score >= 50) {
    return { progress: ((score - 50) / 100) * 100, remaining: 150 - score, nextTier: "Verified" };
  }
  return { progress: (score / 50) * 100, remaining: 50 - score, nextTier: "Contributor" };
}

export default function ProfilePage() {
  const { account, chainId, browserProvider, connect } = useWallet();
  const [credentials, setCredentials] = useState<CredentialRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");

  const loadCredentials = useCallback(async () => {
    if (!account) {
      setCredentials([]);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const registry = getValidationRegistryReadContract();
      const credentialIds = (await registry.getCredentials(account)) as unknown[];
      const normalized = credentialIds.map((jobId) => parseCredential(account, jobId));
      setCredentials(normalized.reverse());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load credentials.");
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    void loadCredentials();
  }, [loadCredentials]);

  useEffect(() => {
    if (!account) {
      return () => undefined;
    }

    const unsubscribe = subscribeToCredentials(browserProvider ?? getReadProvider(), account, ({ agent, jobId, credentialId }) => {
      setCredentials((previous) => {
        if (previous.some((credential) => credential.jobId === jobId)) {
          return previous;
        }
        return [
          {
            credentialId,
            agent,
            jobId,
            issuedAt: Math.floor(Date.now() / 1000),
            issuedBy: "0x0000000000000000000000000000000000000000"
          },
          ...previous
        ];
      });
    });

    return unsubscribe;
  }, [account, browserProvider]);

  const profileChainId = chainId ?? expectedChainId;
  const did = account ? generateDID(account, profileChainId) : "";
  const score = useMemo(() => calculateReputationScore(credentials), [credentials]);
  const tier = useMemo(() => getReputationTier(score), [score]);
  const tierColor = useMemo(() => getTierColor(tier), [tier]);
  const progressMeta = useMemo(() => getProgressMeta(score), [score]);

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
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">Profile</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">Identity, credentials, and reputation in Archon.</p>

        {!account ? (
          <div className="mt-5 rounded-xl border border-amber-300/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Wallet not connected. <button type="button" onClick={() => void connect()} className="underline underline-offset-4">Connect wallet</button>.
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

      {error ? <div className="archon-card border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

      <div className="archon-card p-6">
        <h2 className="text-lg font-semibold tracking-wide text-[#EAEAF0]">Reputation</h2>
        <p className="mt-1 text-sm text-[#9CA3AF]">Score = credentials x 10 (capped at 1000).</p>

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <div>
            <div className="text-3xl font-semibold text-[#EAEAF0]">{score}</div>
            <div className={`text-sm font-semibold ${tierColor}`}>{tier}</div>
          </div>
          <div className="min-w-[220px] flex-1">
            <div className="mb-1 flex justify-between text-xs text-[#9CA3AF]">
              <span>Progress to {progressMeta.nextTier}</span>
              <span>{Math.max(0, progressMeta.remaining)} points left</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-[#00D1B2] transition-all duration-700"
                style={{ width: `${Math.min(100, Math.max(0, progressMeta.progress))}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="archon-card p-6">
        <h2 className="text-lg font-semibold tracking-wide text-[#EAEAF0]">Credentials</h2>
        <p className="mt-1 text-sm text-[#9CA3AF]">Permanent records bound to wallet and job.</p>

        {!account ? (
          <p className="mt-4 text-sm text-[#9CA3AF]">Connect your wallet to view credentials.</p>
        ) : loading ? (
          <p className="mt-4 text-sm text-[#9CA3AF]">Loading credentials...</p>
        ) : credentials.length === 0 ? (
          <p className="mt-4 text-sm text-[#9CA3AF]">No credentials minted yet.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {credentials.map((credential) => (
              <CredentialCard
                key={`${credential.agent}-${credential.jobId}`}
                credential={credential}
                provider={browserProvider ?? getReadProvider()}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
