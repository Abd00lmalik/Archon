"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import LandingPage from "@/app/landing/page";
import { UserDisplay } from "@/components/ui/user-display";
import { LiveFeed } from "@/components/ui/live-feed";
import { SectionHeader } from "@/components/ui/section-header";
import { StatBlock } from "@/components/ui/stat";
import { ActivityEvent, initActivityFeed, subscribeToActivity } from "@/lib/activity";
import {
  CredentialRecord,
  deriveDisplayStatus,
  fetchAllJobs,
  fetchCredentialsForAgent,
  formatTaskDescription,
  formatTaskTitle,
  formatUsdc,
  JobRecord,
} from "@/lib/contracts";
import { calculateWeightedScore, getReputationTier } from "@/lib/reputation";
import { useWallet } from "@/lib/wallet-context";

function formatDeadline(deadline: number) {
  const now = Math.floor(Date.now() / 1000);
  const diff = deadline - now;
  if (diff <= 0) return "closed";
  const hours = Math.floor(diff / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  if (hours <= 0) return `${mins}m left`;
  return `${hours}h ${mins}m left`;
}

const FILTERS = ["All", "Tasks", "Tournaments"] as const;

export default function HomePage() {
  const { account } = useWallet();
  const [hydrated, setHydrated] = useState(false);
  const [restoreGraceElapsed, setRestoreGraceElapsed] = useState(false);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [myCredentials, setMyCredentials] = useState<CredentialRecord[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<(typeof FILTERS)[number]>("All");
  const [loading, setLoading] = useState(false);
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);

  const loadFeed = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    try {
      const [jobRows, credentials] = await Promise.all([fetchAllJobs(), fetchCredentialsForAgent(account)]);
      setJobs(jobRows);
      setMyCredentials(credentials);
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    setHydrated(true);
    const timer = window.setTimeout(() => setRestoreGraceElapsed(true), 700);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  useEffect(() => {
    initActivityFeed();
    const unsubscribe = subscribeToActivity(setActivityEvents);
    return unsubscribe;
  }, []);

  const myScore = useMemo(() => calculateWeightedScore(myCredentials), [myCredentials]);
  const myTier = useMemo(() => getReputationTier(myScore), [myScore]);

  const visibleJobs = useMemo(() => {
    if (selectedFilter === "Tournaments") return jobs;
    return jobs;
  }, [jobs, selectedFilter]);

  const hasStoredWallet =
    hydrated && typeof window !== "undefined" && Boolean(window.localStorage.getItem("archon_last_wallet"));

  if (!hydrated || (!account && hasStoredWallet && !restoreGraceElapsed)) {
    return (
      <section className="page-container flex min-h-[40vh] items-center justify-center">
        <div className="flex items-center gap-3 font-mono text-sm text-[var(--text-secondary)]">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--arc-dim)] border-t-[var(--arc)]" />
          Loading Archon...
        </div>
      </section>
    );
  }

  if (!account) {
    return <LandingPage />;
  }

  return (
    <section className="page-container grid gap-6 xl:grid-cols-[240px_1fr_320px]">
      <aside className="panel h-fit space-y-6">
        <SectionHeader>Your Command</SectionHeader>
        <StatBlock value={myScore} label="Score" accent="var(--arc)" />
        <div className="badge badge-agent">{myTier}</div>

        <div className="space-y-2 text-sm">
          <Link href="/" className="nav-link block">Browse Tasks</Link>
          <Link href="/my-work" className="nav-link block">My Work</Link>
          <Link href="/profile" className="nav-link block">Profile</Link>
        </div>

        <div className="space-y-2 border-t border-[var(--border)] pt-4">
          <div className="mono text-xs text-[var(--text-secondary)]">Credentials: {myCredentials.length}</div>
          <div className="mono text-xs text-[var(--text-secondary)]">
            Tasks Open: {jobs.filter((job) => deriveDisplayStatus(job.status, job.deadline, job.revealPhaseEnd ?? 0n).code === 0).length}
          </div>
        </div>
      </aside>

      <main className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionHeader>Open Tasks</SectionHeader>
          <Link href="/create-job" className="btn-primary">Post Task</Link>
        </div>

        <div className="panel-elevated flex flex-wrap gap-2">
          {FILTERS.map((filter) => {
            if (filter === "Tournaments") {
              return (
                <button
                  key={filter}
                  type="button"
                  disabled
                  className="cursor-not-allowed border border-dashed border-[#162334] px-4 py-2 text-xs font-mono tracking-wider text-[#3D5A73] opacity-40"
                >
                  TOURNAMENTS
                  <span className="ml-2 border border-[#3D5A73] px-1 text-[9px]">SOON</span>
                </button>
              );
            }

            return (
              <button
                key={filter}
                type="button"
                onClick={() => setSelectedFilter(filter)}
                className={selectedFilter === filter ? "btn-primary px-3 py-2 text-xs" : "btn-ghost px-3 py-2 text-xs"}
              >
                {filter}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="panel text-sm text-[var(--text-secondary)]">Loading feed...</div>
        ) : visibleJobs.length === 0 ? (
          <div className="panel text-sm text-[var(--text-secondary)]">No tasks match this filter yet.</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {visibleJobs.slice(0, 20).map((task) => {
              const displayStatus = deriveDisplayStatus(
                task.status,
                task.deadline,
                task.revealPhaseEnd ?? 0n
              );
              return (
                <Link
                  key={task.jobId}
                  href={`/job/${task.jobId}`}
                  className="card-sharp cursor-pointer overflow-hidden p-0"
                  style={{ transition: "border-color 0.2s, box-shadow 0.2s" }}
                >
                  <div style={{ height: 2, background: displayStatus.color }} />

                  <div style={{ padding: "16px 20px 20px" }}>
                    <div className="mb-3 flex items-center justify-between">
                      <span
                        style={{
                          fontFamily: "JetBrains Mono, monospace",
                          fontSize: 11,
                          color: "#3D5A73"
                        }}
                      >
                        #{task.jobId}
                      </span>
                      <div className="flex items-center gap-2">
                        <span
                          style={{
                            fontFamily: "JetBrains Mono, monospace",
                            fontSize: 11,
                            fontWeight: 700,
                            color: "#F5A623",
                            background: "rgba(245,166,35,0.1)",
                            border: "1px solid rgba(245,166,35,0.3)",
                            padding: "2px 8px"
                          }}
                        >
                          {(Number(formatUsdc(task.rewardUSDC)) || 0).toFixed(1)} USDC
                        </span>
                        <span
                          style={{
                            fontFamily: "JetBrains Mono, monospace",
                            fontSize: 10,
                            fontWeight: 700,
                            color: displayStatus.color,
                            background: `${displayStatus.color}10`,
                            border: `1px solid ${displayStatus.color}40`,
                            padding: "2px 8px",
                            letterSpacing: "0.05em"
                          }}
                        >
                          {displayStatus.label.toUpperCase()}
                        </span>
                      </div>
                    </div>

                    <h3
                      style={{
                        fontFamily: "Space Grotesk, sans-serif",
                        fontWeight: 600,
                        fontSize: 15,
                        color: "#E8F4FD",
                        lineHeight: 1.3,
                        marginBottom: 8,
                        textTransform: "none"
                      }}
                    >
                      {formatTaskTitle(task.title)}
                    </h3>

                    <p
                      style={{
                        fontFamily: "Inter, sans-serif",
                        fontSize: 13,
                        color: "#7A9BB5",
                        lineHeight: 1.5,
                        marginBottom: 16,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden"
                      }}
                    >
                      {formatTaskDescription(task.description)}
                    </p>

                    <div className="flex items-center justify-between pt-3" style={{ borderTop: "1px solid #162334" }}>
                      <div
                        style={{
                          fontFamily: "JetBrains Mono, monospace",
                          fontSize: 10,
                          color: "#3D5A73"
                        }}
                        className="flex items-center gap-2"
                      >
                        <UserDisplay address={task.client} showAvatar={true} avatarSize={22} className="min-w-0" />
                        <span>·</span>
                        <span>{formatDeadline(task.deadline)}</span>
                      </div>
                      <span
                        style={{
                          fontFamily: "JetBrains Mono, monospace",
                          fontSize: 10,
                          color: "#3D5A73"
                        }}
                      >
                        {task.submissionCount} submission{task.submissionCount !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>

      <aside className="panel h-fit p-0">
        <div className="px-4 pt-4">
          <SectionHeader>Live Activity</SectionHeader>
        </div>
        <LiveFeed events={activityEvents} maxVisible={10} />
      </aside>
    </section>
  );
}
