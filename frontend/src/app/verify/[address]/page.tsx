"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ethers } from "ethers";
import { useEffect, useMemo, useState } from "react";
import { CredentialCard } from "@/components/credential-card";
import { CredentialRecord, fetchCredentialsForAgent } from "@/lib/contracts";
import {
  calculateWeightedScore,
  getNextTier,
  getPointsToNextTier,
  getReputationTier,
  getSourceLabel
} from "@/lib/reputation";

function normalizeSource(sourceType: string) {
  const normalized = sourceType.toLowerCase().trim();
  if (normalized === "job") return "task";
  if (normalized.startsWith("community")) return "community";
  return normalized;
}

export default function VerifyWalletPage() {
  const params = useParams<{ address: string }>();
  const address = params?.address ?? "";
  const [credentials, setCredentials] = useState<CredentialRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");

  useEffect(() => {
    let active = true;

    const loadCredentials = async () => {
      if (!address || !ethers.isAddress(address)) {
        setCredentials([]);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const result = await fetchCredentialsForAgent(address);
        if (!active) return;
        setCredentials(result);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load credentials.");
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadCredentials();

    return () => {
      active = false;
    };
  }, [address]);

  const score = useMemo(() => calculateWeightedScore(credentials), [credentials]);
  const tier = useMemo(() => getReputationTier(score), [score]);
  const nextTier = useMemo(() => getNextTier(score), [score]);
  const pointsToNextTier = useMemo(() => getPointsToNextTier(score), [score]);
  const totalWeight = useMemo(() => credentials.reduce((sum, item) => sum + item.weight, 0), [credentials]);

  const grouped = useMemo(() => {
    const map: Record<string, CredentialRecord[]> = {};
    for (const credential of credentials) {
      const key = normalizeSource(credential.sourceType);
      map[key] = map[key] ?? [];
      map[key].push(credential);
    }
    return map;
  }, [credentials]);

  const sources = useMemo(() => Object.keys(grouped), [grouped]);

  const progress = useMemo(() => {
    if (pointsToNextTier <= 0) return 100;
    return Math.max(0, Math.min(100, (score / (score + pointsToNextTier)) * 100));
  }, [pointsToNextTier, score]);

  const copyLink = async () => {
    if (typeof window === "undefined") return;
    await navigator.clipboard.writeText(`${window.location.origin}/verify/${address}`);
    setCopyMessage("Verification link copied");
    setTimeout(() => setCopyMessage(""), 1500);
  };

  if (!address || !ethers.isAddress(address)) {
    return (
      <section className="archon-card p-6">
        <h1 className="text-2xl font-semibold text-[#EAEAF0]">Credential Verification</h1>
        <p className="mt-3 text-sm text-rose-300">Invalid wallet address.</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="archon-card p-6">
        <h1 className="text-2xl font-semibold text-[#EAEAF0]">Credential Verification</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">Public credential record for this wallet on Arc.</p>
        <div className="mt-4 space-y-2 text-sm">
          <p className="break-all text-[#EAEAF0]">{address}</p>
          <a
            href={`https://testnet.arcscan.app/address/${address}`}
            target="_blank"
            rel="noreferrer"
            className="text-[#8FD9FF] underline underline-offset-4"
          >
            View on Arc Explorer
          </a>
        </div>
      </div>

      <div className="archon-card p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-[#9CA3AF]">Reputation Score</p>
            <p className="text-3xl font-semibold text-[#EAEAF0]">{score} / 2000</p>
            <p className="text-sm text-[#00FFC8]">{tier}</p>
          </div>
          <p className="text-xs text-[#9CA3AF]">
            {pointsToNextTier > 0 ? `${pointsToNextTier} pts to ${nextTier}` : "Top tier reached"}
          </p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
          <div className="h-full bg-[#00FFC8]" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="archon-card border border-emerald-400/30 bg-emerald-500/10 p-5 text-sm text-emerald-100">
        <p className="font-medium">Verified on Arc Testnet</p>
        <p className="mt-1 text-emerald-200/90">
          All credentials below are cryptographically verified on-chain and cannot be altered or deleted.
        </p>
      </div>

      <div className="archon-card p-6">
        <div className="grid gap-3 text-sm text-[#9CA3AF] md:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
            <span className="text-xs uppercase tracking-wide">Total credentials</span>
            <p className="mt-1 text-lg text-[#EAEAF0]">{credentials.length}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
            <span className="text-xs uppercase tracking-wide">Total weight</span>
            <p className="mt-1 text-lg text-[#EAEAF0]">{totalWeight} pts</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
            <span className="text-xs uppercase tracking-wide">Highest tier</span>
            <p className="mt-1 text-lg text-[#EAEAF0]">{tier}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
            <span className="text-xs uppercase tracking-wide">Sources</span>
            <p className="mt-1 text-sm text-[#EAEAF0]">
              {sources.length ? sources.map((item) => getSourceLabel(item)).join(", ") : "None"}
            </p>
          </div>
        </div>
      </div>

      <div className="archon-card p-6">
        <h2 className="text-lg font-semibold text-[#EAEAF0]">Share this verification</h2>
        <p className="mt-1 text-sm text-[#9CA3AF]">
          This page is always publicly accessible - share it to prove on-chain reputation.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void copyLink()} className="archon-button-primary px-3 py-2 text-xs">
            Copy link
          </button>
          <Link href={`/profile`} className="archon-button-secondary px-3 py-2 text-xs">
            Open profile
          </Link>
          {copyMessage ? <span className="text-xs text-[#00FFC8]">{copyMessage}</span> : null}
        </div>
      </div>

      {loading ? <p className="text-sm text-[#9CA3AF]">Loading credentials...</p> : null}
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}

      {!loading && !error ? (
        <div className="space-y-8">
          {sources.length === 0 ? (
            <div className="archon-card p-6 text-sm text-[#9CA3AF]">No credentials found for this wallet yet.</div>
          ) : (
            sources.map((sourceType) => (
              <div key={sourceType} className="space-y-3">
                <h3 className="text-lg font-semibold text-[#EAEAF0]">{getSourceLabel(sourceType)}</h3>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {grouped[sourceType].map((credential) => (
                    <CredentialCard key={credential.credentialId} credential={credential} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}
