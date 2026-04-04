"use client";

import Image from "next/image";
import Link from "next/link";
import { ethers } from "ethers";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AgentTaskRecord,
  CredentialRecord,
  expectedChainId,
  fetchAllJobs,
  fetchOpenAgentTasks,
  formatTimestamp,
  formatUsdc,
  getJobWriteContract,
  getReadProvider,
  getRegistryReadContract,
  getSourceLabelForDisplay,
  statusLabel,
  isContractsConfigured,
  isJobOpen,
  JobRecord,
  parseCredential
} from "@/lib/contracts";
import { subscribeToNewJobs, subscribeToOpenTasks } from "@/lib/events";
import { useWallet } from "@/lib/wallet-context";

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
  const { account, browserProvider, connect } = useWallet();
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [tasks, setTasks] = useState<AgentTaskRecord[]>([]);
  const [recentCredentials, setRecentCredentials] = useState<CredentialRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyJobId, setBusyJobId] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [stats, setStats] = useState({
    totalCredentials: 0,
    totalUsdcPaidOut: "0",
    totalWalletsVerified: 0
  });

  const configured = useMemo(() => isContractsConfigured(), []);

  const loadFeed = useCallback(async () => {
    if (!configured) return;
    setLoading(true);
    setError("");
    try {
      const [jobRows, taskRows] = await Promise.all([fetchAllJobs(), fetchOpenAgentTasks()]);
      setJobs(jobRows.slice(0, 12));
      setTasks(taskRows.filter((task) => task.status === 0).slice(0, 8));

      const registry = getRegistryReadContract();
      const totalCredentials = Number(await registry.totalCredentials());
      const credentials: CredentialRecord[] = [];
      const wallets = new Set<string>();
      const start = Math.max(1, totalCredentials - 9);
      for (let credentialId = totalCredentials; credentialId >= start; credentialId--) {
        const credential = parseCredential(await registry.getCredential(credentialId));
        if (credential.agent !== ethers.ZeroAddress) {
          credentials.push(credential);
          wallets.add(credential.agent.toLowerCase());
        }
      }
      setRecentCredentials(credentials);

      const jobPayout = jobRows.reduce((sum, job) => sum + BigInt(job.paidOutUSDC || "0"), 0n);
      const taskPayout = taskRows.reduce((sum, task) => sum + BigInt(task.rewardClaimed ? task.rewardUSDC : "0"), 0n);
      setStats({
        totalCredentials,
        totalUsdcPaidOut: formatUsdc(jobPayout + taskPayout),
        totalWalletsVerified: wallets.size
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load activity feed.");
    } finally {
      setLoading(false);
    }
  }, [configured]);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  useEffect(() => {
    if (!configured) return () => undefined;
    const provider = browserProvider ?? getReadProvider();
    const unsubs = [
      subscribeToNewJobs(provider, (job) => {
        setJobs((previous) => {
          if (previous.some((existing) => existing.jobId === job.jobId)) return previous;
          return [job, ...previous].slice(0, 12);
        });
      }),
      subscribeToOpenTasks(provider, () => {
        void loadFeed();
      })
    ];
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [browserProvider, configured, loadFeed]);

  const handleAccept = async (jobId: number) => {
    setError("");
    setStatus("");
    setBusyJobId(jobId);

    try {
      const provider = browserProvider ?? (await connect());
      if (!provider) throw new Error("Wallet connection was not established.");
      const network = await provider.getNetwork();
      if (Number(network.chainId) !== expectedChainId) {
        throw new Error(`Switch wallet network to chain ID ${expectedChainId}.`);
      }

      const jobContract = await getJobWriteContract(provider);
      const tx = await jobContract.acceptJob(jobId);
      setStatus(`Accept transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`You accepted job #${jobId}.`);
      await loadFeed();
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : "Failed to accept job.");
    } finally {
      setBusyJobId(null);
    }
  };

  return (
    <section className="space-y-8">
      <div className="archon-card p-6 text-center md:p-8">
        <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4">
          <Image src="/logo.svg" alt="Archon" width={220} height={70} priority />
          <h1 className="text-3xl font-semibold tracking-wide text-[#EAEAF0]">Archon</h1>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="archon-card p-4">
          <p className="text-xs uppercase tracking-wide text-[#9CA3AF]">Credentials Minted</p>
          <p className="mt-2 text-2xl font-semibold text-[#EAEAF0]">{stats.totalCredentials}</p>
        </div>
        <div className="archon-card p-4">
          <p className="text-xs uppercase tracking-wide text-[#9CA3AF]">USDC Paid Out</p>
          <p className="mt-2 text-2xl font-semibold text-[#EAEAF0]">{stats.totalUsdcPaidOut}</p>
        </div>
        <div className="archon-card p-4">
          <p className="text-xs uppercase tracking-wide text-[#9CA3AF]">Wallets Verified</p>
          <p className="mt-2 text-2xl font-semibold text-[#EAEAF0]">{stats.totalWalletsVerified}</p>
        </div>
      </div>

      {status ? (
        <div className="archon-card border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {status}
        </div>
      ) : null}
      {error ? (
        <div className="archon-card border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
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
                    Credential #{credential.credentialId} · {credential.agent.slice(0, 8)}...{credential.agent.slice(-4)}
                  </p>
                  <p className="text-xs text-[#9CA3AF]">{formatTimestamp(credential.issuedAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${sourceBadgeClass(credential.sourceType)}`}>
                    {getSourceLabelForDisplay(credential.sourceType)}
                  </span>
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-[#9CA3AF]">
                    +{credential.weight} pts
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-wide text-[#EAEAF0]">Recent Jobs</h2>
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
            Create Job
          </Link>
        </div>
      </div>

      {!configured ? (
        <div className="archon-card border border-amber-300/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Contracts are not configured yet. Run contract deployment and redeploy frontend.
        </div>
      ) : null}

      {loading && jobs.length === 0 ? (
        <div role="status" aria-busy="true" aria-label="Loading jobs" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((item) => (
            <div key={item} className="archon-card h-52 animate-pulse p-4" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="archon-card px-5 py-10 text-center text-sm text-[#9CA3AF]">No jobs available yet.</div>
      ) : (
        <div aria-label="Job listings" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.map((job) => {
            const canAccept = isJobOpen(job) && account !== null && account.toLowerCase() !== job.client.toLowerCase();
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
                  <p>Reward Pool: {formatUsdc(job.rewardUSDC)} USDC</p>
                  <p>Paid Out: {formatUsdc(job.paidOutUSDC)} USDC</p>
                  <p>Deadline: {formatTimestamp(job.deadline)}</p>
                  <p>
                    Accepted: {job.acceptedCount} | Approved: {job.approvedCount}
                  </p>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <Link href={`/job/${job.jobId}`} className="text-xs text-[#6C5CE7] transition-all duration-200 hover:text-[#8D80F0]">
                    View details
                  </Link>
                  {isJobOpen(job) ? (
                    <button
                      type="button"
                      disabled={!canAccept || busyJobId === job.jobId}
                      onClick={() => void handleAccept(job.jobId)}
                      className="archon-button-primary px-3 py-1.5 text-xs transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busyJobId === job.jobId ? "Accepting..." : "Accept"}
                    </button>
                  ) : (
                    <span className="text-xs text-[#9CA3AF]">Closed</span>
                  )}
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
