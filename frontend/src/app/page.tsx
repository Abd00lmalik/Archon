"use client";

import Link from "next/link";
import { ethers } from "ethers";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AgentTaskRecord,
  CredentialRecord,
  fetchAllJobs,
  fetchCredentialsForAgent,
  fetchMilestoneEscrowTotal,
  fetchMaxApprovalsForJob,
  fetchJobsByAgent,
  fetchJobsCreatedCount,
  fetchOpenAgentTasks,
  fetchRegistryCredentialStatsApprox,
  fetchSubmissionForAgent,
  formatTimestamp,
  formatUsdc,
  getJobReadContract,
  getReadProvider,
  getRegistryReadContract,
  getSourceLabelForDisplay,
  isContractsConfigured,
  JobRecord,
  parseCredential,
  statusLabel,
  SubmissionRecord
} from "@/lib/contracts";
import { subscribeToNewJobs, subscribeToOpenTasks } from "@/lib/events";
import { calculateWeightedScore, getReputationTier } from "@/lib/reputation";
import { useWallet } from "@/lib/wallet-context";

type JobViewerState = {
  submission: SubmissionRecord | null;
  accepted: boolean;
};

function statusClasses(status: number) {
  if (status === 0) return "bg-[#00D1B2]/15 text-[#6EF2DE]";
  return "bg-white/5 text-[#9CA3AF]";
}

function sourceBadgeClass(sourceType: string) {
  if (sourceType === "github") return "bg-[#8B5CF6]/20 text-[#C4B5FD]";
  if (sourceType === "agent_task") return "bg-[#3B82F6]/20 text-[#93C5FD]";
  if (sourceType === "community") return "bg-[#F59E0B]/20 text-[#FCD34D]";
  if (sourceType === "peer_attestation") return "bg-[#EC4899]/20 text-[#F9A8D4]";
  if (sourceType === "dao_governance") return "bg-[#6366F1]/20 text-[#A5B4FC]";
  return "bg-[#00D1B2]/15 text-[#6EF2DE]";
}

export default function HomePage() {
  const { account, browserProvider } = useWallet();
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [tasks, setTasks] = useState<AgentTaskRecord[]>([]);
  const [recentCredentials, setRecentCredentials] = useState<CredentialRecord[]>([]);
  const [viewerStateByJob, setViewerStateByJob] = useState<Record<number, JobViewerState>>({});
  const [creatorJobCount, setCreatorJobCount] = useState<Record<string, number>>({});
  const [maxApprovalsByJob, setMaxApprovalsByJob] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showWelcomeBanner, setShowWelcomeBanner] = useState(false);
  const [myCredentialCount, setMyCredentialCount] = useState(0);
  const [myScore, setMyScore] = useState(0);
  const [myTier, setMyTier] = useState("Surveyor");
  const jobsSectionRef = useRef<HTMLDivElement | null>(null);
  const [statTargets, setStatTargets] = useState({
    totalCredentials: null as number | null,
    openTasks: null as number | null,
    totalEscrowUsdc: null as number | null,
    verifiedWallets: null as number | null
  });
  const [animatedStats, setAnimatedStats] = useState({
    totalCredentials: 0,
    openTasks: 0,
    totalEscrowUsdc: 0,
    verifiedWallets: 0
  });

  const configured = useMemo(() => isContractsConfigured(), []);

  const loadFeed = useCallback(async () => {
    if (!configured) return;
    setLoading(true);
    setError("");

    try {
      const [jobRows, taskRows] = await Promise.all([fetchAllJobs(), fetchOpenAgentTasks()]);
      const visibleJobs = jobRows.slice(0, 12);
      setJobs(visibleJobs);
      setTasks(taskRows.filter((task) => task.status === 0).slice(0, 8));

      const approvalEntries = await Promise.all(
        visibleJobs.map(async (job) => [job.jobId, await fetchMaxApprovalsForJob(job.jobId)] as const)
      );
      setMaxApprovalsByJob(Object.fromEntries(approvalEntries));

      const uniqueCreators = Array.from(new Set(visibleJobs.map((job) => job.client.toLowerCase())));
      const creatorCounts = await Promise.all(
        uniqueCreators.map(async (creator) => [creator, await fetchJobsCreatedCount(creator)] as const)
      );
      setCreatorJobCount(Object.fromEntries(creatorCounts));

      if (account) {
        const readContract = getJobReadContract();
        const viewerEntries = await Promise.all(
          visibleJobs.map(async (job) => {
            const [submission, accepted] = await Promise.all([
              fetchSubmissionForAgent(job.jobId, account),
              (async () => {
                try {
                  return (await readContract.isAccepted(job.jobId, account)) as boolean;
                } catch {
                  return false;
                }
              })()
            ]);
            return [job.jobId, { submission, accepted }] as const;
          })
        );
        setViewerStateByJob(Object.fromEntries(viewerEntries));
      } else {
        setViewerStateByJob({});
        setMyCredentialCount(0);
        setMyScore(0);
        setMyTier("Surveyor");
      }

      if (account) {
        try {
          const myCredentials = await fetchCredentialsForAgent(account);
          const weighted = calculateWeightedScore(myCredentials);
          setMyCredentialCount(myCredentials.length);
          setMyScore(weighted);
          setMyTier(getReputationTier(weighted));
        } catch {
          setMyCredentialCount(0);
          setMyScore(0);
          setMyTier("Surveyor");
        }
      }

      const escrowTotal = jobRows.reduce((sum, job) => {
        const pool = BigInt(job.rewardUSDC || "0");
        const paid = BigInt(job.paidOutUSDC || "0");
        if (pool <= paid) return sum;
        return sum + (pool - paid);
      }, 0n);

      try {
        const registry = getRegistryReadContract();
        const totalCredentials = Number(await registry.totalCredentials());
        const credentials: CredentialRecord[] = [];
        const start = Math.max(1, totalCredentials - 9);
        for (let credentialId = totalCredentials; credentialId >= start; credentialId--) {
          const credential = parseCredential(await registry.getCredential(credentialId));
          if (credential.agent !== ethers.ZeroAddress) {
            credentials.push(credential);
          }
        }
        setRecentCredentials(credentials);
      } catch {
        setRecentCredentials([]);
      }

      try {
        const milestoneEscrowTotal = await fetchMilestoneEscrowTotal();
        const totalEscrow = escrowTotal + milestoneEscrowTotal;
        const registryStats = await fetchRegistryCredentialStatsApprox(500);
        const openTaskCount = jobRows.filter((job) => job.status === 0).length;
        setStatTargets({
          totalCredentials: registryStats.totalCredentials,
          openTasks: openTaskCount,
          totalEscrowUsdc: Number(formatUsdc(totalEscrow)),
          verifiedWallets: registryStats.totalCredentials
        });
      } catch {
        setStatTargets({
          totalCredentials: null,
          openTasks: null,
          totalEscrowUsdc: null,
          verifiedWallets: null
        });
      }
    } catch (loadError) {
      setStatTargets({
        totalCredentials: null,
        openTasks: null,
        totalEscrowUsdc: null,
        verifiedWallets: null
      });
      setError(loadError instanceof Error ? loadError.message : "Failed to load activity feed.");
    } finally {
      setLoading(false);
    }
  }, [account, configured]);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  useEffect(() => {
    if (!configured) return () => undefined;
    const provider = browserProvider ?? getReadProvider();
    const unsubs = [
      subscribeToNewJobs(provider, () => {
        void loadFeed();
      }),
      subscribeToOpenTasks(provider, () => {
        void loadFeed();
      })
    ];
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [browserProvider, configured, loadFeed]);

  useEffect(() => {
    const animationDurationMs = 900;
    const stepMs = 30;
    const totalSteps = Math.max(1, Math.floor(animationDurationMs / stepMs));
    let currentStep = 0;
    const interval = setInterval(() => {
      currentStep += 1;
      const progress = Math.min(1, currentStep / totalSteps);
      setAnimatedStats({
        totalCredentials:
          statTargets.totalCredentials == null ? 0 : Math.round(statTargets.totalCredentials * progress),
        openTasks: statTargets.openTasks == null ? 0 : Math.round(statTargets.openTasks * progress),
        totalEscrowUsdc:
          statTargets.totalEscrowUsdc == null
            ? 0
            : Number((statTargets.totalEscrowUsdc * progress).toFixed(2)),
        verifiedWallets:
          statTargets.verifiedWallets == null ? 0 : Math.round(statTargets.verifiedWallets * progress)
      });
      if (progress >= 1) {
        clearInterval(interval);
      }
    }, stepMs);

    return () => clearInterval(interval);
  }, [statTargets]);

  useEffect(() => {
    let active = true;
    const checkWelcome = async () => {
      if (!account) {
        setShowWelcomeBanner(false);
        return;
      }
      const dismissKey = `archon.welcome.dismissed.${account.toLowerCase()}`;
      if (typeof window !== "undefined" && window.localStorage.getItem(dismissKey) === "true") {
        setShowWelcomeBanner(false);
        return;
      }

      try {
        const [credentials, jobsAsAgent] = await Promise.all([
          fetchCredentialsForAgent(account),
          fetchJobsByAgent(account)
        ]);
        let hasSubmitted = false;
        for (const job of jobsAsAgent) {
          const submission = await fetchSubmissionForAgent(job.jobId, account);
          if (submission && submission.submittedAt > 0) {
            hasSubmitted = true;
            break;
          }
        }
        if (!active) return;
        setShowWelcomeBanner(credentials.length === 0 && !hasSubmitted);
      } catch {
        if (!active) return;
        setShowWelcomeBanner(false);
      }
    };
    void checkWelcome();
    return () => {
      active = false;
    };
  }, [account]);

  const dismissWelcome = () => {
    if (!account || typeof window === "undefined") return;
    window.localStorage.setItem(`archon.welcome.dismissed.${account.toLowerCase()}`, "true");
    setShowWelcomeBanner(false);
  };

  const statValue = (target: number | null, value: number, kind: "int" | "usdc" = "int") => {
    if (target == null) return "—";
    if (kind === "usdc") return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return Math.round(value).toLocaleString();
  };

  return (
    <section className="space-y-8">
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#0A1F2E] to-[#145B7D] p-6 md:p-8">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-3xl font-semibold tracking-wide text-[#EAEAF0]">CredentialHook</h1>
          <p className="mt-2 text-sm text-[#C9D0DB]">Universal On-Chain Reputation on Arc</p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-[#0A0A0B]/45 p-4">
              <p className="text-5xl font-bold text-[#00FFC8] transition-all duration-200">{statValue(statTargets.totalCredentials, animatedStats.totalCredentials)}</p>
              <p className="mt-2 text-sm text-[#9CA3AF]">Credentials Minted</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#0A0A0B]/45 p-4">
              <p className="text-5xl font-bold text-[#00FFC8] transition-all duration-200">{statValue(statTargets.openTasks, animatedStats.openTasks)}</p>
              <p className="mt-2 text-sm text-[#9CA3AF]">Open Tasks Available</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#0A0A0B]/45 p-4">
              <p className="text-5xl font-bold text-[#00FFC8] transition-all duration-200">{statValue(statTargets.totalEscrowUsdc, animatedStats.totalEscrowUsdc, "usdc")}</p>
              <p className="mt-2 text-sm text-[#9CA3AF]">USDC in Escrow</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#0A0A0B]/45 p-4">
              <p className="text-5xl font-bold text-[#00FFC8] transition-all duration-200">{statValue(statTargets.verifiedWallets, animatedStats.verifiedWallets)}</p>
              <p className="mt-2 text-sm text-[#9CA3AF]">Credentials Issued</p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => jobsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="archon-button-primary px-4 py-2.5 text-sm transition-all duration-200"
            >
              Browse Open Tasks
            </button>
            <Link href="/earn" className="archon-button-primary px-4 py-2.5 text-sm transition-all duration-200">
              How It Works
            </Link>
          </div>
        </div>
      </div>

      {showWelcomeBanner ? (
        <div className="archon-card border border-[#00D1B2]/30 bg-[#00D1B2]/10 p-4">
          <p className="text-sm font-semibold text-[#EAEAF0]">Welcome to CredentialHook</p>
          <p className="mt-1 text-xs text-[#C9D0DB]">
            Build verifiable on-chain reputation. Every credential you earn is permanent and publicly verifiable.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/" className="archon-button-secondary px-3 py-2 text-xs">
              Browse Tasks
            </Link>
            <Link href="/earn" className="archon-button-secondary px-3 py-2 text-xs">
              Learn How It Works
            </Link>
            <button type="button" onClick={dismissWelcome} className="archon-button-primary px-3 py-2 text-xs">
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {account ? (
        <div className="archon-card p-4 text-sm text-[#9CA3AF]">
          Your score: <span className="font-semibold text-[#EAEAF0]">{myScore} pts</span>{" "}
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-[#EAEAF0]">{myTier}</span> ·{" "}
          <span className="font-semibold text-[#EAEAF0]">{myCredentialCount}</span> credentials ·{" "}
          <Link href="/profile" className="text-[#8FD9FF] underline underline-offset-4">
            View Profile
          </Link>{" "}
          ·{" "}
          <Link href="/my-work" className="text-[#8FD9FF] underline underline-offset-4">
            My Work
          </Link>
        </div>
      ) : null}

      {error ? (
        <div className="archon-card border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      ) : null}

      <div className="archon-card p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-[#EAEAF0]">Recent Credentials Minted</h2>
          <Link href="/profile" className="text-xs text-[#9CA3AF] hover:text-[#EAEAF0]">
            View profile
          </Link>
        </div>
        {recentCredentials.length === 0 ? (
          <p className="mt-3 text-sm text-[#9CA3AF]">{loading ? "Loading credentials..." : "No credentials minted yet."}</p>
        ) : (
          <div className="mt-3 space-y-2">
            {recentCredentials.map((credential) => (
              <div
                key={credential.credentialId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-sm"
              >
                <div>
                  <p className="text-[#EAEAF0]">
                    Credential #{credential.credentialId} | {credential.agent.slice(0, 8)}...{credential.agent.slice(-4)}
                  </p>
                  <p className="text-xs text-[#9CA3AF]">{formatTimestamp(credential.issuedAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${sourceBadgeClass(credential.sourceType)}`}>
                    {getSourceLabelForDisplay(credential.sourceType)}
                  </span>
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-[#9CA3AF]">+{credential.weight} pts</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div ref={jobsSectionRef} className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-wide text-[#EAEAF0]">Open Tasks</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Refresh jobs and tasks"
            onClick={() => void loadFeed()}
            className="archon-button-secondary px-3 py-2 text-sm transition-all duration-200"
          >
            Refresh
          </button>
          <Link href="/create-job" className="archon-button-primary px-4 py-2 text-sm transition-all duration-200">
            Create Task
          </Link>
        </div>
      </div>

      {loading && jobs.length === 0 ? (
        <div role="status" aria-busy="true" aria-label="Loading jobs" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((item) => (
            <div key={item} className="archon-card h-56 animate-pulse p-4" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="archon-card px-5 py-10 text-center text-sm text-[#9CA3AF]">No jobs available yet. Create the first posting.</div>
      ) : (
        <div aria-label="Job listings" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.map((job) => {
            const creatorKey = job.client.toLowerCase();
            const creatorCount = creatorJobCount[creatorKey] ?? 0;
            const viewerState = viewerStateByJob[job.jobId];
            const isCreator = Boolean(account && account.toLowerCase() === creatorKey);
            const hasSubmission = Boolean(viewerState?.submission);

            return (
              <article key={job.jobId} className="archon-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/job/${job.jobId}`} className="text-base font-semibold tracking-wide text-[#EAEAF0] hover:text-[#00D1B2]">
                    #{job.jobId} {job.title}
                  </Link>
                  <span className={`rounded-full px-2 py-1 text-xs ${statusClasses(job.status)}`}>{statusLabel(job.status)}</span>
                </div>

                <p className="mt-3 line-clamp-3 text-sm text-[#9CA3AF]">{job.description}</p>

                <div className="mt-4 space-y-1 text-xs text-[#9CA3AF]">
                  <p className="text-sm font-semibold text-[#EAEAF0]">
                    {BigInt(job.rewardUSDC || "0") > 0n
                      ? `${formatUsdc(job.rewardUSDC)} USDC pool · up to ${
                          maxApprovalsByJob[job.jobId] ?? 1
                        } winners`
                      : "Credential only"}
                  </p>
                  <p>Paid Out: {formatUsdc(job.paidOutUSDC)} USDC</p>
                  <p>Deadline: {formatTimestamp(job.deadline)}</p>
                  <p>Creator: {creatorCount} jobs posted</p>
                  <p>
                    Accepted: {job.acceptedCount} | Submissions: {job.submissionCount} | Approved: {job.approvedCount}
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Link href={`/job/${job.jobId}`} className="archon-button-secondary px-3 py-1.5 text-xs">
                    View Job
                  </Link>

                  {account ? (
                    isCreator ? (
                      <Link href={`/job/${job.jobId}`} className="archon-button-primary px-3 py-1.5 text-xs">
                        Review Submissions ({job.submissionCount})
                      </Link>
                    ) : hasSubmission ? (
                      <Link href={`/job/${job.jobId}`} className="archon-button-primary px-3 py-1.5 text-xs">
                        View My Submission
                      </Link>
                    ) : (
                      <Link href={`/job/${job.jobId}`} className="archon-button-primary px-3 py-1.5 text-xs">
                        View & Apply
                      </Link>
                    )
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="archon-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-[#EAEAF0]">Open Agent Tasks</h2>
          <Link href="/tasks" className="text-xs text-[#9CA3AF] hover:text-[#EAEAF0]">
            Open Tasks Hub
          </Link>
        </div>
        {tasks.length === 0 ? (
          <p className="mt-3 text-sm text-[#9CA3AF]">No open agent tasks right now.</p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {tasks.map((task) => (
              <article key={task.taskId} className="rounded-xl border border-white/10 bg-[#111214] p-3">
                <p className="text-sm font-medium text-[#EAEAF0]">Task #{task.taskId}</p>
                <p className="mt-1 line-clamp-2 text-xs text-[#9CA3AF]">{task.taskDescription}</p>
                <p className="mt-2 text-xs text-[#9CA3AF]">Reward: {formatUsdc(task.rewardUSDC)} USDC</p>
                <p className="text-xs text-[#9CA3AF]">Deadline: {formatTimestamp(task.deadline)}</p>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}


