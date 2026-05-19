"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { UserDisplay } from "@/components/ui/user-display";
import { LiveFeed } from "@/components/ui/live-feed";
import { SectionHeader } from "@/components/ui/section-header";
import { StatBlock } from "@/components/ui/stat";
import { ActivityEvent, subscribeToActivity } from "@/lib/activity";
import {
  CredentialRecord,
  deriveDisplayStatus,
  formatTaskDescription,
  formatTaskTitle,
  formatUsdc,
  getReadProvider
} from "@/lib/contracts";
import { fetchUnifiedScore, getReputationTier } from "@/lib/reputation";
import { fetchAllTasks, fetchRecentTasks, getTaskUrl, UnifiedTask } from "@/lib/task-adapter";
import { useWallet } from "@/lib/wallet-context";

function formatDeadline(deadline: bigint | number) {
  const now = Math.floor(Date.now() / 1000);
  const diff = Number(deadline) - now;
  if (diff <= 0) return "closed";
  const hours = Math.floor(diff / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  if (hours <= 0) return `${mins}m left`;
  return `${hours}h ${mins}m left`;
}

type TaskFilter = "all" | "open" | "submitted" | "reveal" | "closed";
const PAGE_SIZE = 4;
const RECENT_TASK_LIMIT = 10;
const FEED_CACHE_TTL = 60_000;
const feedCache: Map<string, { data: unknown; ts: number }> = new Map();

const perf = {
  start: (label: string) => {
    if (process.env.NODE_ENV === "development") console.time(`[archon] ${label}`);
  },
  end: (label: string) => {
    if (process.env.NODE_ENV === "development") console.timeEnd(`[archon] ${label}`);
  }
};

function getCached<T>(key: string): T | null {
  const cached = feedCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.ts > FEED_CACHE_TTL) {
    feedCache.delete(key);
    return null;
  }
  return cached.data as T;
}

function setCached(key: string, data: unknown) {
  feedCache.set(key, { data, ts: Date.now() });
}

const FILTER_OPTIONS: { value: TaskFilter; label: string; color: string }[] = [
  { value: "all", label: "ALL", color: "#E8F4FD" },
  { value: "open", label: "OPEN", color: "#00FFA3" },
  { value: "submitted", label: "UNDER REVIEW", color: "#F5A623" },
  { value: "reveal", label: "REVEAL PHASE", color: "#00E5FF" },
  { value: "closed", label: "CLOSED", color: "#7A9BB5" },
];

function matchesFilter(task: UnifiedTask, filter: TaskFilter): boolean {
  if (filter === "all") return true;

  const display = deriveDisplayStatus(
    task.status,
    task.deadline,
    task.revealPhaseEnd,
    task.submissionCount
  );

  if (filter === "open") {
    return display.label === "Open";
  }
  if (filter === "submitted") {
    return display.label === "Under Review";
  }
  if (filter === "reveal") {
    return display.label === "Reveal Phase";
  }
  if (filter === "closed") {
    return display.label === "Closed";
  }
  return true;
}

export default function HomePage() {
  const { account } = useWallet();
  const [hydrated, setHydrated] = useState(false);
  const [restoreGraceElapsed, setRestoreGraceElapsed] = useState(false);
  const [tasks, setTasks] = useState<UnifiedTask[]>([]);
  const [myCredentials, setMyCredentials] = useState<CredentialRecord[]>([]);
  const [myScore, setMyScore] = useState(0);
  const [selectedFilter, setSelectedFilter] = useState<TaskFilter>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    try {
      const cachedTasks = getCached<UnifiedTask[]>("public-feed-recent");
      if (cachedTasks) {
        setTasks(cachedTasks);
        setLoading(false);
      }

      perf.start("provider-init");
      const provider = getReadProvider();
      perf.end("provider-init");

      perf.start("feed-batch-fetch");
      const recentTasks = await fetchRecentTasks(provider, RECENT_TASK_LIMIT);
      perf.end("feed-batch-fetch");
      setTasks(recentTasks);
      setCached("public-feed-recent", recentTasks);
      perf.start("feed-render");
      perf.end("feed-render");

      void (async () => {
        try {
          const enrichedRecent = await fetchAllTasks(provider, true, {
            limitLatest: RECENT_TASK_LIMIT,
            includeRevealMeta: true
          });
          setTasks((prev) => {
            const enrichedMap = new Map(enrichedRecent.map((t) => [t.displayId, t]));
            return prev.map((task) => enrichedMap.get(task.displayId) ?? task);
          });
          setCached("public-feed-recent", enrichedRecent);
        } catch {
          // non-blocking enrichment
        }
      })();
    } finally {
      setLoading(false);
    }
  }, []);

  const loadWalletStats = useCallback(async () => {
    if (!account) {
      setMyCredentials([]);
      setMyScore(0);
      return;
    }
    const cacheKey = `wallet-stats:${account.toLowerCase()}`;
    const cached = getCached<{ credentials: CredentialRecord[]; score: number }>(cacheKey);
    if (cached) {
      setMyCredentials(cached.credentials);
      setMyScore(cached.score);
      return;
    }

    try {
      const provider = getReadProvider();
      const unified = await fetchUnifiedScore(provider, account);
      const credentials = [...unified.v2Credentials, ...unified.legacyCredentials];
      const score = unified.totalScore;
      setMyCredentials(credentials);
      setMyScore(score);
      setCached(cacheKey, { credentials, score });
    } catch {
      // keep non-critical wallet stats resilient
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
    void loadWalletStats();
  }, [loadWalletStats]);

  useEffect(() => {
    const unsubscribe = subscribeToActivity(setActivityEvents);
    return unsubscribe;
  }, []);

  const myTier = useMemo(() => getReputationTier(myScore), [myScore]);
  const allTasks = tasks;
  const filteredTasks = useMemo(
    () => allTasks.filter((task) => matchesFilter(task, selectedFilter)),
    [allTasks, selectedFilter]
  );
  const displayedTasks = filteredTasks.slice(0, visibleCount);
  const hasMore = filteredTasks.length > visibleCount;

  const handleFilterChange = (newFilter: TaskFilter) => {
    setSelectedFilter(newFilter);
    setVisibleCount(PAGE_SIZE);
  };

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

  return (
    <section className="page-container grid gap-6 xl:grid-cols-[240px_1fr_320px]">
      <aside className="panel h-fit space-y-6">
        <SectionHeader>Your Command</SectionHeader>
        <StatBlock value={account ? myScore : "-"} label="Score" accent="var(--arc)" />
        <div className="badge badge-agent">{account ? myTier : "Connect Wallet"}</div>

        <div className="space-y-2 text-sm">
          <Link href="/" className="nav-link block">Browse Tasks</Link>
          <Link href="/my-work" className="nav-link block">My Work</Link>
          <Link href="/profile" className="nav-link block">Profile</Link>
        </div>

        <div className="space-y-2 border-t border-[var(--border)] pt-4">
          <div className="mono text-xs text-[var(--text-secondary)]">
            Credentials: {account ? myCredentials.length : "-"}
          </div>
          <div className="mono text-xs text-[var(--text-secondary)]">
            Tasks Open: {allTasks.filter((task) => matchesFilter(task, "open")).length}
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
              onClick={() => handleFilterChange(filter.value)}
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

        {loading ? (
          <div className="panel text-sm text-[var(--text-secondary)]">Loading feed...</div>
        ) : displayedTasks.length === 0 ? (
          <div className="panel text-sm text-[var(--text-secondary)]">No tasks match this filter yet.</div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              {displayedTasks.map((task) => {
                const displayStatus = deriveDisplayStatus(
                  task.status,
                  task.deadline,
                  task.revealPhaseEnd,
                  task.submissionCount
                );
                return (
                  <Link
                    key={`task-${task.displayId}`}
                    href={getTaskUrl(task)}
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
                          #{task.displayId}
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
                          className="flex min-w-0 items-center gap-2"
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
                  onClick={() => setVisibleCount((previous) => previous + PAGE_SIZE)}
                  className="btn-ghost"
                  style={{ minWidth: 240, fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}
                >
                  Show more tasks ({filteredTasks.length - visibleCount} remaining)
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
