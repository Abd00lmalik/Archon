"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CommunityActivityRecord,
  expectedChainId,
  fetchCommunityActivitiesByRecipient,
  isApprovedSourceOperator,
  txAwardCommunityActivity,
  txClaimCommunityCredential
} from "@/lib/contracts";
import { useWallet } from "@/lib/wallet-context";

const COMMUNITY_TYPES = [
  { id: 0, label: "Discord Help", weight: 50 },
  { id: 1, label: "Moderation", weight: 80 },
  { id: 2, label: "Content Creation", weight: 90 },
  { id: 3, label: "Event Organization", weight: 120 },
  { id: 4, label: "Bug Report", weight: 100 }
] as const;

export default function CommunityPage() {
  const { account, browserProvider, connect } = useWallet();
  const [isOperator, setIsOperator] = useState(false);
  const [activities, setActivities] = useState<CommunityActivityRecord[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [recipient, setRecipient] = useState("");
  const [activityType, setActivityType] = useState(0);
  const [platform, setPlatform] = useState("discord");
  const [evidenceNote, setEvidenceNote] = useState("");

  const load = useCallback(async () => {
    if (!account) {
      setActivities([]);
      setIsOperator(false);
      return;
    }
    setLoading(true);
    try {
      const [list, approved] = await Promise.all([
        fetchCommunityActivitiesByRecipient(account),
        isApprovedSourceOperator("community", account)
      ]);
      setActivities(list);
      setIsOperator(approved);
    } catch {
      setActivities([]);
      setIsOperator(false);
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    void load();
  }, [load]);

  const withProvider = async () => {
    const provider = browserProvider ?? (await connect());
    if (!provider) throw new Error("Wallet connection was not established.");
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== expectedChainId) {
      throw new Error(`Switch wallet network to chain ID ${expectedChainId}.`);
    }
    return provider;
  };

  const handleAward = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setStatus("");
    try {
      const provider = await withProvider();
      const tx = await txAwardCommunityActivity(
        provider,
        recipient.trim(),
        activityType,
        platform.trim(),
        evidenceNote.trim()
      );
      setStatus(`Award transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus("Community activity awarded.");
      setRecipient("");
      setEvidenceNote("");
      await load();
    } catch (awardError) {
      setError(awardError instanceof Error ? awardError.message : "Failed to award community activity.");
    }
  };

  const handleClaim = async (activityId: number) => {
    setBusyId(activityId);
    setError("");
    setStatus("");
    try {
      const provider = await withProvider();
      const tx = await txClaimCommunityCredential(provider, activityId);
      setStatus(`Claim transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Community credential claimed for activity #${activityId}.`);
      await load();
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "Failed to claim credential.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-6">
      <div className="archon-card p-6">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">Community Source</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">
          Moderators can award on-chain community credits; recipients claim credentials.
        </p>
      </div>

      {status ? <div className="archon-card border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{status}</div> : null}
      {error ? <div className="archon-card border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

      {isOperator ? (
        <div className="archon-card p-6">
          <h2 className="text-lg font-semibold text-[#EAEAF0]">Moderator Award Panel</h2>
          <form onSubmit={handleAward} className="mt-4 space-y-3">
            <label className="block text-sm text-[#9CA3AF]">
              Recipient wallet
              <input
                className="archon-input mt-1"
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                required
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-[#9CA3AF]">
                Activity type
                <select
                  className="archon-input mt-1"
                  value={activityType}
                  onChange={(event) => setActivityType(Number(event.target.value))}
                >
                  {COMMUNITY_TYPES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-[#9CA3AF]">
                Platform
                <input
                  className="archon-input mt-1"
                  value={platform}
                  onChange={(event) => setPlatform(event.target.value)}
                  required
                />
              </label>
            </div>
            <label className="block text-sm text-[#9CA3AF]">
              Evidence note
              <textarea
                className="archon-input mt-1 min-h-20"
                value={evidenceNote}
                onChange={(event) => setEvidenceNote(event.target.value)}
                required
              />
            </label>
            <button type="submit" className="archon-button-primary w-full px-4 py-2.5 text-sm">
              Award Activity
            </button>
          </form>
        </div>
      ) : (
        <div className="archon-card p-6 text-sm text-[#9CA3AF]">
          <p className="text-[#EAEAF0]">How to earn community credentials</p>
          <p className="mt-2">
            Contribute in verified community channels (Discord, forum, social threads, moderation, events).
            Approved moderators can award your activity record.
          </p>
        </div>
      )}

      <div className="archon-card p-6">
        <h2 className="text-lg font-semibold text-[#EAEAF0]">Received Awards</h2>
        {loading ? (
          <p className="mt-3 text-sm text-[#9CA3AF]">Loading awards...</p>
        ) : activities.length === 0 ? (
          <p className="mt-3 text-sm text-[#9CA3AF]">No community awards received yet.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {activities.map((activity) => (
              <article key={activity.activityId} className="rounded-xl border border-white/10 bg-[#111214] p-3 text-sm text-[#9CA3AF]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-[#EAEAF0]">Award #{activity.activityId}</p>
                  <span className="rounded-full bg-white/5 px-2 py-1 text-xs">
                    Type {activity.activityType}
                  </span>
                </div>
                <p className="mt-1 text-xs">Platform: {activity.platform}</p>
                <p className="mt-1 text-xs">Note: {activity.evidenceNote}</p>
                <p className="mt-1 text-xs">Claimed: {activity.credentialClaimed ? "Yes" : "No"}</p>
                {!activity.credentialClaimed ? (
                  <button
                    type="button"
                    onClick={() => void handleClaim(activity.activityId)}
                    disabled={busyId === activity.activityId}
                    className="archon-button-secondary mt-3 px-3 py-2 text-xs"
                  >
                    {busyId === activity.activityId ? "Claiming..." : "Claim Credential"}
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
