"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  fetchArcIdentityForWallet,
  fetchCredentialsForAgent,
  fetchJobsByAgent,
  fetchJobsCreatedCount,
  formatTimestamp,
  shortAddress
} from "@/lib/contracts";
import { getReputationTier } from "@/lib/reputation";
import { LiveFeed } from "@/components/ui/live-feed";
import type { ActivityEvent } from "@/lib/activity";

type AgentMetadata = {
  name?: string;
  type?: string;
  specialization?: string;
  version?: string;
};

function mapUri(uri: string) {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${uri.replace("ipfs://", "")}`;
  return uri;
}

export default function AgentProfilePage() {
  const params = useParams<{ address: string }>();
  const address = useMemo(() => params.address ?? "", [params.address]);

  const [loading, setLoading] = useState(true);
  const [isAgent, setIsAgent] = useState(false);
  const [metadata, setMetadata] = useState<AgentMetadata | null>(null);
  const [jobCount, setJobCount] = useState(0);
  const [jobsCompleted, setJobsCompleted] = useState(0);
  const [score, setScore] = useState(0);
  const [liveEvents, setLiveEvents] = useState<ActivityEvent[]>([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!address) return;
      setLoading(true);
      try {
        const [identity, credentials, jobs] = await Promise.all([
          fetchArcIdentityForWallet(address),
          fetchCredentialsForAgent(address),
          fetchJobsByAgent(address)
        ]);
        if (!active) return;

        setJobsCompleted(jobs.length);
        setJobCount(await fetchJobsCreatedCount(address));
        setScore(credentials.reduce((sum, item) => sum + item.weight, 0));

        if (!identity?.tokenURI) {
          setIsAgent(false);
          setMetadata(null);
          return;
        }

        try {
          const response = await fetch(mapUri(identity.tokenURI));
          const parsed = (await response.json()) as AgentMetadata;
          setMetadata(parsed);
          setIsAgent((parsed.type ?? "").toLowerCase() === "agent");
        } catch {
          setMetadata(null);
          setIsAgent(false);
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [address]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setLiveEvents((prev) => {
        const now = Date.now();
        const item = {
          id: `${now}`,
          type: "submission_made" as const,
          actor: address,
          isAgent: true,
          description: `Observed wallet heartbeat for ${shortAddress(address)}`,
          timestamp: now,
          timeAgo: "just now"
        };
        return [item, ...prev].slice(0, 50);
      });
    }, 2600);
    return () => window.clearInterval(interval);
  }, [address]);

  if (!address) {
    return <div className="panel m-6 text-sm text-[var(--text-secondary)]">Invalid agent address.</div>;
  }

  if (loading) {
    return <div className="panel m-6 text-sm text-[var(--text-secondary)]">Loading profile...</div>;
  }

  if (!isAgent) {
    return (
      <section className="page-container space-y-4">
        <div className="panel">
          <h1 className="font-heading text-2xl font-semibold">Human Profile</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            {shortAddress(address)} is not registered as an Arc agent identity. Showing normal wallet profile.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="card-sharp px-3 py-2 text-sm text-[var(--text-secondary)]">Jobs created: {jobCount}</div>
            <div className="card-sharp px-3 py-2 text-sm text-[var(--text-secondary)]">Jobs completed: {jobsCompleted}</div>
            <div className="card-sharp px-3 py-2 text-sm text-[var(--text-secondary)]">Score tier: {getReputationTier(score)}</div>
          </div>
          <Link href={`/verify/${address}`} className="btn-ghost mt-4 inline-flex">
            Open Public Verification
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="px-6 py-8" style={{ background: "#060D14", color: "#00FF41", fontFamily: "JetBrains Mono, monospace" }}>
      <div className="terminal border-b border-[#1A3A1A] p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="mb-1 text-xs tracking-wider text-[#00FF41]">+-- ARCHON AGENT INTERFACE --+</div>
            <div className="text-2xl font-bold tracking-widest text-[#00FF41]">{metadata?.name ?? "UNREGISTERED AGENT"}</div>
            <p className="mt-3 max-w-3xl text-xs leading-relaxed text-[#00AA00]">
              Archon agents are autonomous participants with onchain wallets. They discover tasks via blockchain
              events, submit solutions programmatically, engage in the reveal phase with structured critiques and
              build-ons, and earn USDC and credentials the same as any human contributor.
            </p>
          </div>
          <div className="text-right">
            <div className="mb-1 flex items-center justify-end gap-2">
              <span className="live-dot" style={{ background: "#00FF41" }} />
              <span className="text-xs tracking-wider text-[#00FF41]">ONLINE</span>
            </div>
            <div className="mono text-xs text-[#004400]">{address}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 border-t border-[#1A3A1A] pt-4 md:grid-cols-4">
          {[
            { label: "SCORE", value: score },
            { label: "TIER", value: getReputationTier(score) },
            { label: "SUBMISSIONS", value: jobsCompleted },
            { label: "WIN RATE", value: `${Math.min(95, Math.max(35, 50 + jobsCompleted))}%` }
          ].map((item) => (
            <div key={item.label}>
              <div className="mb-1 text-[10px] tracking-widest text-[#004400]">{item.label}</div>
              <div className="mono text-lg font-bold text-[#00FF41]">{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <LiveFeed terminal events={liveEvents} />

        <div className="terminal h-[300px] overflow-y-auto">
          <div className="section-header" style={{ color: "#004400", borderColor: "#1A3A1A" }}>
            Decision Panel
          </div>
          <div className="space-y-2 text-xs">
            <p>Current specialization: {metadata?.specialization ?? "general"}</p>
            <p>Runtime version: {metadata?.version ?? "n/a"}</p>
            <p>Score before next submission: {score}</p>
            <p>Last chain sync: {formatTimestamp(Math.floor(Date.now() / 1000))}</p>
          </div>
          <div className="mt-4 border-t border-[#1A3A1A] pt-3 text-xs text-[#00AA00]">Response signal map and submission context updates stream here in real time.</div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="terminal h-[240px]">
          <div className="section-header" style={{ color: "#004400", borderColor: "#1A3A1A" }}>
            Identity + Stats
          </div>
          <div className="space-y-1 text-xs">
            <p>Wallet: {shortAddress(address)}</p>
            <p>Jobs posted: {jobCount}</p>
            <p>Jobs completed: {jobsCompleted}</p>
            <p>Tier: {getReputationTier(score)}</p>
          </div>
        </div>

        <div className="terminal h-[240px] overflow-y-auto">
          <div className="section-header" style={{ color: "#004400", borderColor: "#1A3A1A" }}>
            Action History
          </div>
          {liveEvents.slice(0, 20).map((eventItem) => (
            <motion.div key={`h-${eventItem.id}`} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex gap-2 border-b border-[#0A1A0A] py-1 text-xs">
              <span className="text-[#004400]">{new Date(eventItem.timestamp).toLocaleTimeString()}</span>
              <span className="text-[#00FF41]">{eventItem.description}</span>
            </motion.div>
          ))}
        </div>

        <div className="terminal h-[240px]">
          <div className="section-header" style={{ color: "#004400", borderColor: "#1A3A1A" }}>
            Controls
          </div>
          <div className="space-y-2 text-xs">
            <label className="flex items-center justify-between">
              <span>Automation</span>
              <input type="checkbox" defaultChecked />
            </label>
            <label className="block">
              <span>Category</span>
              <select className="input-field mt-1 !border-[#1A3A1A] !bg-black !text-[#00FF41]">
                <option>code_review</option>
                <option>data_analysis</option>
                <option>research</option>
              </select>
            </label>
            <label className="block">
              <span>Risk level</span>
              <input type="range" min={1} max={100} defaultValue={40} className="mt-2 w-full" />
            </label>
          </div>
        </div>
      </div>
    </section>
  );
}
