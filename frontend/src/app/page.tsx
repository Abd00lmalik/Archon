"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import LandingPage from "@/app/landing/page";
import { LiveFeed } from "@/components/ui/live-feed";
import { SectionHeader } from "@/components/ui/section-header";
import { StatBlock } from "@/components/ui/stat";
import {
  AgentTaskRecord,
  CredentialRecord,
  fetchAllJobs,
  fetchCredentialsForAgent,
  fetchOpenAgentTasks,
  formatTimestamp,
  formatUsdc,
  getSourceLabelForDisplay,
  JobRecord,
  statusLabel
} from "@/lib/contracts";
import { subscribeToNewJobs, subscribeToOpenTasks } from "@/lib/events";
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

function statusBadgeClass(status: number) {
  if (status === 0) return "badge badge-pulse";
  if (status === 1) return "badge badge-warn";
  if (status === 2) return "badge badge-gold";
  return "badge badge-muted";
}

const FILTERS = ["All", "Tasks", "Tournaments", "Agentic"] as const;

export default function HomePage() {
  const { account, browserProvider } = useWallet();
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [agentTasks, setAgentTasks] = useState<AgentTaskRecord[]>([]);
  const [myCredentials, setMyCredentials] = useState<CredentialRecord[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<(typeof FILTERS)[number]>("All");
  const [loading, setLoading] = useState(false);

  const loadFeed = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    try {
      const [jobRows, taskRows, credentials] = await Promise.all([
        fetchAllJobs(),
        fetchOpenAgentTasks(),
        fetchCredentialsForAgent(account)
      ]);
      setJobs(jobRows);
      setAgentTasks(taskRows);
      setMyCredentials(credentials);
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  useEffect(() => {
    if (!account) return () => undefined;
    const provider = browserProvider;
    const unsubs = [
      subscribeToNewJobs(provider, () => void loadFeed()),
      subscribeToOpenTasks(provider, () => void loadFeed())
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [account, browserProvider, loadFeed]);

  const myScore = useMemo(() => calculateWeightedScore(myCredentials), [myCredentials]);
  const myTier = useMemo(() => getReputationTier(myScore), [myScore]);

  const liveEvents = useMemo(() => {
    const jobEvents = jobs.slice(0, 10).map((job) => ({
      id: `job-${job.jobId}`,
      timestamp: formatTimestamp(job.createdAt),
      icon: "#",
      text: `Task #${job.jobId} posted: ${job.title}`,
      meta: `${formatUsdc(job.rewardUSDC)} USDC`
    }));

    const credEvents = myCredentials.slice(0, 10).map((credential) => ({
      id: `cred-${credential.credentialId}`,
      timestamp: formatTimestamp(credential.issuedAt),
      icon: "+",
      text: `${getSourceLabelForDisplay(credential.sourceType)} credential minted`,
      meta: `+${credential.weight} pts`
    }));

    return [...credEvents, ...jobEvents].slice(0, 20);
  }, [jobs, myCredentials]);

  const visibleJobs = useMemo(() => {
    if (selectedFilter === "Agentic") return [];
    if (selectedFilter === "Tournaments") return jobs.filter((job) => job.approvedCount > 1 || job.submissionCount > 4);
    return jobs;
  }, [jobs, selectedFilter]);

  if (!account) {
    return <LandingPage />;
  }

  return (
    <section className="page-container grid gap-6 xl:grid-cols-[240px_1fr_300px]">
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
          <div className="mono text-xs text-[var(--text-secondary)]">Agentic Open: {agentTasks.length}</div>
        </div>
      </aside>

      <main className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionHeader>Open Tasks</SectionHeader>
          <Link href="/create-job" className="btn-primary">Post Task</Link>
        </div>

        <div className="panel-elevated flex flex-wrap gap-2">
          {FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setSelectedFilter(filter)}
              className={selectedFilter === filter ? "btn-primary px-3 py-2 text-xs" : "btn-ghost px-3 py-2 text-xs"}
            >
              {filter}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="panel text-sm text-[var(--text-secondary)]">Loading feed...</div>
        ) : visibleJobs.length === 0 ? (
          <div className="panel text-sm text-[var(--text-secondary)]">No tasks match this filter yet.</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {visibleJobs.slice(0, 20).map((task) => {
              const status = statusLabel(task.status);
              const statusColor = task.status === 0 ? "var(--pulse)" : task.status === 1 ? "var(--warn)" : "var(--arc)";
              return (
                <Link key={task.jobId} href={`/job/${task.jobId}`} className="card-sharp group cursor-pointer overflow-hidden p-0">
                  <div className="h-[2px]" style={{ background: statusColor }} />
                  <div className="p-5">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="mono text-xs text-[var(--text-muted)]">#{task.jobId}</span>
                      <div className="flex items-center gap-2">
                        <span className="badge badge-gold mono">{formatUsdc(task.rewardUSDC)} USDC</span>
                        <span className={statusBadgeClass(task.status)}>{status}</span>
                      </div>
                    </div>

                    <h3 className="font-heading mb-2 text-base font-semibold transition-colors group-hover:text-[var(--arc)]">
                      {task.title}
                    </h3>

                    <p className="mb-4 line-clamp-2 text-sm leading-relaxed text-[var(--text-secondary)]">{task.description}</p>

                    <div className="flex items-center justify-between border-t border-[var(--border)] pt-3">
                      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                        <span className="mono">{task.client.slice(0, 6)}...{task.client.slice(-4)}</span>
                        <span>-</span>
                        <span>{formatDeadline(task.deadline)}</span>
                      </div>
                      <span className="text-xs text-[var(--text-muted)]">{task.submissionCount} submissions</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>

      <aside className="panel h-fit">
        <SectionHeader>Live Activity</SectionHeader>
        <LiveFeed events={liveEvents} />
      </aside>
    </section>
  );
}
