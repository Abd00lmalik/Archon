"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import LandingPage from "@/app/landing/page";
import { UserDisplay } from "@/components/ui/user-display";
import { LiveFeed } from "@/components/ui/live-feed";
import { SectionHeader } from "@/components/ui/section-header";
import { StatBlock } from "@/components/ui/stat";
import { ActivityEvent, subscribeToActivity } from "@/lib/activity";
import {
  CredentialRecord,
  contractAddresses,
  deriveDisplayStatus,
  fetchAllJobs,
  formatTaskDescription,
  formatTaskTitle,
  formatUsdc,
  getReadProvider,
  JobRecord
} from "@/lib/contracts";
import {
  fetchLegacyTasks,
  fetchPrevV2Tasks,
  LEGACY_ADDRESSES,
  LegacyTaskRecord,
  PREV_V2_ADDRESS,
  PrevV2TaskRecord
} from "@/lib/legacy-contracts";
import { fetchUnifiedScore, getReputationTier } from "@/lib/reputation";
import { getDisplayId, makeTaskUrl } from "@/lib/task-id";
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

type TaskFilter = "all" | "open" | "submitted" | "reveal" | "closed";

const FILTER_OPTIONS: { value: TaskFilter; label: string; color: string }[] = [
  { value: "all", label: "ALL", color: "#E8F4FD" },
  { value: "open", label: "OPEN", color: "#00FFA3" },
  { value: "submitted", label: "SUBMITTED", color: "#F5A623" },
  { value: "reveal", label: "REVEAL PHASE", color: "#00E5FF" },
  { value: "closed", label: "CLOSED", color: "#7A9BB5" },
];

type DisplayJobRecord = JobRecord & {
  isPastTask?: boolean;
  isPrevV2?: boolean;
  archiveKey?: string;
  archiveOrder?: number;
  contractAddress?: string;
  isInRevealPhase?: boolean;
};

function taskDisplayKey(task: DisplayJobRecord) {
  return `${task.isPastTask ? `archive-${task.archiveKey ?? "v1"}` : "current"}-${task.jobId}`;
}

function matchesFilter(task: DisplayJobRecord, filter: TaskFilter): boolean {
  if (filter === "all") return true;

  const deadlinePassed = Number(task.deadline) > 0 && Math.floor(Date.now() / 1000) > Number(task.deadline);
  const status = Number(task.status);

  if (filter === "open") {
    return (status === 0 || status === 1) && !deadlinePassed;
  }
  if (filter === "submitted") {
    return status === 2 || status === 3;
  }
  if (filter === "reveal") {
    return status === 4;
  }
  if (filter === "closed") {
    return status === 5 || status === 6 || ((status === 0 || status === 1) && deadlinePassed);
  }
  return true;
}

export default function HomePage() {
  const { account } = useWallet();
  const [hydrated, setHydrated] = useState(false);
  const [restoreGraceElapsed, setRestoreGraceElapsed] = useState(false);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [legacyTasks, setLegacyTasks] = useState<LegacyTaskRecord[]>([]);
  const [prevV2Tasks, setPrevV2Tasks] = useState<PrevV2TaskRecord[]>([]);
  const [displayIds, setDisplayIds] = useState<Record<string, string>>({});
  const [showTaskSources, setShowTaskSources] = useState(true);
  const [myCredentials, setMyCredentials] = useState<CredentialRecord[]>([]);
  const [myScore, setMyScore] = useState(0);
  const [selectedFilter, setSelectedFilter] = useState<TaskFilter>("all");
  const [visibleCount, setVisibleCount] = useState(5);
  const [loading, setLoading] = useState(false);
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);

  const loadFeed = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    try {
      const [jobRows, unified] = await Promise.all([fetchAllJobs(), fetchUnifiedScore(getReadProvider(), account)]);
      setJobs(jobRows);
      setMyCredentials([...unified.v2Credentials, ...unified.legacyCredentials]);
      setMyScore(unified.totalScore);
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
    let active = true;
    fetchLegacyTasks(getReadProvider()).then((tasks) => {
      if (!active) return;
      const v1Tasks = tasks.filter((task) => task.archiveKey === "v1");
      console.log("[legacy] Loaded", v1Tasks.length, "V1 tasks");
      setLegacyTasks(v1Tasks);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetchPrevV2Tasks(getReadProvider()).then((tasks) => {
      if (!active) return;
      console.log("[prevV2] Loaded", tasks.length, "tasks");
      setPrevV2Tasks(tasks);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToActivity(setActivityEvents);
    return unsubscribe;
  }, []);

  const myTier = useMemo(() => getReputationTier(myScore), [myScore]);
  const allTasks = useMemo<DisplayJobRecord[]>(
    () => {
      const combined: DisplayJobRecord[] = [
        ...jobs.map((job) => ({ ...job, isPastTask: false })),
        ...prevV2Tasks.map((task) => ({
          ...task,
          isPastTask: true,
          isPrevV2: true,
          archiveKey: "prev-v2",
          contractAddress: PREV_V2_ADDRESS
        })),
        ...legacyTasks.map((task) => ({ ...task, isPastTask: true }))
      ];
      return combined.sort((a, b) => {
        if (!a.isPastTask && b.isPastTask) return -1;
        if (a.isPastTask && !b.isPastTask) return 1;
        if (a.isPastTask && b.isPastTask && (a.archiveOrder ?? 0) !== (b.archiveOrder ?? 0)) {
          return (b.archiveOrder ?? 0) - (a.archiveOrder ?? 0);
        }
        return Number(b.jobId) - Number(a.jobId);
      });
    },
    [jobs, legacyTasks, prevV2Tasks]
  );

  useEffect(() => {
    let active = true;
    const resolve = async () => {
      const map: Record<string, string> = {};
      for (const task of allTasks) {
        map[taskDisplayKey(task)] = await getDisplayId(task.jobId, task.isPastTask ?? false, task.archiveKey);
      }
      if (active) setDisplayIds(map);
    };
    if (allTasks.length > 0) {
      void resolve();
    } else {
      setDisplayIds({});
    }
    return () => {
      active = false;
    };
  }, [allTasks]);

  const filteredJobs = useMemo(
    () => allTasks.filter((job) => matchesFilter(job, selectedFilter)),
    [allTasks, selectedFilter]
  );
  const displayedJobs = selectedFilter === "all" ? allTasks : filteredJobs.slice(0, visibleCount);
  const hasMore = selectedFilter !== "all" && filteredJobs.length > visibleCount;

  useEffect(() => {
    console.log("[taskFeed] V2 total:", jobs.length);
    console.log("[taskFeed] PrevV2 total:", prevV2Tasks.length);
    console.log("[taskFeed] V1 total:", legacyTasks.length);
    console.log("[taskFeed] Archived total:", legacyTasks.length + prevV2Tasks.length);
    console.log("[taskFeed] Combined:", allTasks.length);
    console.log("[taskFeed] After filter:", displayedJobs.length);
    console.log("[taskFeed] Task IDs:", displayedJobs.map((task) => taskDisplayKey(task)));
  }, [allTasks.length, displayedJobs, jobs.length, legacyTasks.length, prevV2Tasks.length]);

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
            Tasks Open: {allTasks.filter((job) => matchesFilter(job, "open")).length}
          </div>
        </div>
      </aside>

      <main className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionHeader>Open Tasks</SectionHeader>
          <Link href="/create-job" className="btn-primary">Post Task</Link>
        </div>

        <div className="panel-elevated flex flex-wrap gap-2">
          {FILTER_OPTIONS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setSelectedFilter(filter.value)}
              style={{
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.08em",
                padding: "6px 14px",
                border: "1px solid",
                cursor: "pointer",
                transition: "all 0.15s",
                borderColor: selectedFilter === filter.value ? filter.color : "var(--border)",
                color: selectedFilter === filter.value ? filter.color : "var(--text-muted)",
                background: selectedFilter === filter.value ? `${filter.color}12` : "transparent",
              }}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {showTaskSources ? (
          <div className="panel-elevated text-xs">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="font-mono font-bold tracking-[0.14em] text-[var(--text-secondary)]">
                TASK SOURCES
              </div>
              <button
                type="button"
                className="font-mono text-[10px] text-[var(--text-muted)] hover:text-[var(--arc)]"
                onClick={() => setShowTaskSources(false)}
              >
                hide
              </button>
            </div>
            <div className="space-y-1 font-mono text-[10px] text-[var(--text-muted)]">
              <div className="flex justify-between gap-3">
                <span>V1 ({LEGACY_ADDRESSES.job.slice(0, 6)}...{LEGACY_ADDRESSES.job.slice(-4)})</span>
                <span>{legacyTasks.length} tasks</span>
              </div>
              <div className="flex justify-between gap-3">
                <span>PrevV2 ({PREV_V2_ADDRESS.slice(0, 6)}...{PREV_V2_ADDRESS.slice(-4)})</span>
                <span>{prevV2Tasks.length} tasks</span>
              </div>
              <div className="flex justify-between gap-3">
                <span>V2 ({contractAddresses.job.slice(0, 6)}...{contractAddresses.job.slice(-4)})</span>
                <span>{jobs.length} tasks</span>
              </div>
              <div className="mt-2 border-t border-[var(--border)] pt-2 flex justify-between gap-3 text-[var(--text-secondary)]">
                <span>Total in feed</span>
                <span>{allTasks.length} tasks</span>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => setShowTaskSources(true)}
          >
            Show Task Sources
          </button>
        )}

        {loading ? (
          <div className="panel text-sm text-[var(--text-secondary)]">Loading feed...</div>
        ) : displayedJobs.length === 0 ? (
          <div className="panel text-sm text-[var(--text-secondary)]">No tasks match this filter yet.</div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              {displayedJobs.map((task) => {
                const displayStatus = deriveDisplayStatus(task.status, task.deadline, task.revealPhaseEnd ?? 0n);
                const displayId = displayIds[taskDisplayKey(task)] ?? `#${task.jobId}`;
                return (
                  <Link
                    key={taskDisplayKey(task)}
                    href={makeTaskUrl(task.jobId, task.isPastTask ?? false, task.archiveKey)}
                    className="card-sharp cursor-pointer overflow-hidden p-0"
                    style={{ transition: "border-color 0.2s, box-shadow 0.2s" }}
                  >
                    <div className="task-status-accent" style={{ height: 2, background: displayStatus.color }} />

                    <div style={{ padding: "16px 20px 20px" }}>
                      <div className="mb-3 flex items-center justify-between">
                        <span
                          style={{
                            fontFamily: "JetBrains Mono, monospace",
                            fontSize: 11,
                            color: "var(--text-muted)",
                          }}
                        >
                          {displayId}
                        </span>
                        <div className="flex items-center gap-2">
                          <span
                            style={{
                              fontFamily: "JetBrains Mono, monospace",
                              fontSize: 11,
                              fontWeight: 700,
                              color: "var(--gold)",
                              background: "color-mix(in srgb, var(--gold) 12%, transparent)",
                              border: "1px solid color-mix(in srgb, var(--gold) 35%, transparent)",
                              padding: "2px 8px",
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
                              letterSpacing: "0.05em",
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
                          color: "var(--text-primary)",
                          lineHeight: 1.3,
                          marginBottom: 8,
                          textTransform: "none",
                        }}
                      >
                        {formatTaskTitle(task.title)}
                      </h3>

                      <p
                        style={{
                          fontFamily: "Inter, sans-serif",
                          fontSize: 13,
                          color: "var(--text-secondary)",
                          lineHeight: 1.5,
                          marginBottom: 16,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {formatTaskDescription(task.description)}
                      </p>

                      <div className="flex items-center justify-between pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                        <div
                          style={{
                            fontFamily: "JetBrains Mono, monospace",
                            fontSize: 10,
                            color: "var(--text-muted)",
                          }}
                          className="flex items-center gap-2"
                        >
                          <UserDisplay address={task.client} showAvatar={true} avatarSize={22} className="min-w-0" />
                          <span>|</span>
                          <span>{formatDeadline(task.deadline)}</span>
                        </div>
                        <span
                          style={{
                            fontFamily: "JetBrains Mono, monospace",
                            fontSize: 10,
                            color: "var(--text-muted)",
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
            {hasMore ? (
              <div className="mt-6 flex justify-center">
                <button
                  type="button"
                  onClick={() => setVisibleCount((previous) => previous + 5)}
                  className="btn-ghost"
                  style={{ minWidth: 200 }}
                >
                  Show More Tasks ({filteredJobs.length - visibleCount} remaining)
                </button>
              </div>
            ) : null}
          </>
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
