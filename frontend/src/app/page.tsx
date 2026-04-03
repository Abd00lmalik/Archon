"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  expectedChainId,
  getJobReadContract,
  getJobWriteContract,
  getReadProvider,
  isContractsConfigured,
  JobRecord,
  parseJob,
  statusLabel,
  ZERO_ADDRESS
} from "@/lib/contracts";
import { subscribeToNewJobs } from "@/lib/events";
import { useWallet } from "@/lib/wallet-context";

function statusClasses(status: number) {
  if (status === 0) return "bg-white/5 text-[#9CA3AF]";
  if (status === 1) return "bg-[#6C5CE7]/15 text-[#B8AFF7]";
  if (status === 2) return "bg-[#00D1B2]/15 text-[#6EF2DE]";
  return "bg-emerald-500/15 text-emerald-300";
}

export default function HomePage() {
  const { account, browserProvider, connect } = useWallet();
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [animatedJobIds, setAnimatedJobIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyJobId, setBusyJobId] = useState<number | null>(null);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");

  const configured = useMemo(() => isContractsConfigured(), []);

  const loadJobs = useCallback(async () => {
    if (!configured) {
      return;
    }

    setLoading(true);
    setError("");
    try {
      const jobContract = getJobReadContract();
      const rawJobs = (await jobContract.getAllJobs()) as unknown[];
      const parsed = rawJobs.map((raw) => parseJob(raw)).sort((a, b) => b.jobId - a.jobId);
      setJobs(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load jobs.");
    } finally {
      setLoading(false);
    }
  }, [configured]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    if (!configured) {
      return () => undefined;
    }

    const unsubscribe = subscribeToNewJobs(getReadProvider(), (job) => {
      setJobs((previous) => {
        if (previous.some((existing) => existing.jobId === job.jobId)) {
          return previous;
        }
        return [job, ...previous];
      });
      setAnimatedJobIds((previous) => [...new Set([job.jobId, ...previous])]);
      setTimeout(() => {
        setAnimatedJobIds((previous) => previous.filter((id) => id !== job.jobId));
      }, 1200);
    });

    return unsubscribe;
  }, [configured]);

  const handleAccept = async (jobId: number) => {
    setError("");
    setStatus("");
    setBusyJobId(jobId);

    try {
      const provider = browserProvider ?? (await connect());
      if (!provider) {
        throw new Error("Wallet connection was not established.");
      }

      const network = await provider.getNetwork();
      if (Number(network.chainId) !== expectedChainId) {
        throw new Error(`Switch wallet network to chain ID ${expectedChainId}.`);
      }

      const jobContract = await getJobWriteContract(provider);
      const tx = await jobContract.acceptJob(jobId);
      setStatus(`Accept transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Job ${jobId} accepted.`);
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept job.");
    } finally {
      setBusyJobId(null);
    }
  };

  return (
    <section className="space-y-8">
      <div className="archon-card p-6 text-center md:p-10">
        <div className="mx-auto flex w-full max-w-xl flex-col items-center">
          <Image src="/logo.svg" alt="Archon" width={220} height={70} priority />
          <h1 className="mt-6 text-4xl font-semibold tracking-wide text-[#EAEAF0] md:text-5xl">Archon</h1>
          <p className="mt-2 text-base text-[#9CA3AF]">Verifiable work. On-chain.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-wide text-[#EAEAF0]">Open Workstream</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Refresh jobs"
            onClick={() => void loadJobs()}
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
          Contracts are not configured yet. Run <code>npm run dev</code> from project root.
        </div>
      ) : null}

      {status ? <div className="archon-card border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{status}</div> : null}
      {error ? <div className="archon-card border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

      {loading ? (
        <div role="status" aria-busy="true" aria-label="Loading jobs" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((item) => (
            <div key={item} className="archon-card h-44 animate-pulse p-4" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="archon-card px-5 py-10 text-center text-sm text-[#9CA3AF]">No jobs available yet. Create the first posting.</div>
      ) : (
        <div aria-label="Job listings" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.map((job) => {
            const canAccept = job.status === 0 && account !== null && account.toLowerCase() !== job.client.toLowerCase();
            return (
              <article key={job.jobId} className={`archon-card p-5 ${animatedJobIds.includes(job.jobId) ? "animate-slide-up" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/job/${job.jobId}`} className="text-base font-semibold tracking-wide text-[#EAEAF0] hover:text-[#00D1B2]">
                    #{job.jobId} {job.title}
                  </Link>
                  <span className={`rounded-full px-2 py-1 text-xs ${statusClasses(job.status)}`}>{statusLabel(job.status)}</span>
                </div>

                <p className="mt-3 text-sm text-[#9CA3AF]">{job.description}</p>

                <div className="mt-4 space-y-1 text-xs text-[#9CA3AF]">
                  <p>Client: {job.client.slice(0, 8)}...{job.client.slice(-6)}</p>
                  <p>
                    Agent: {job.agent === ZERO_ADDRESS ? "Unassigned" : `${job.agent.slice(0, 8)}...${job.agent.slice(-6)}`}
                  </p>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <Link href={`/job/${job.jobId}`} className="text-xs text-[#6C5CE7] transition-all duration-200 hover:text-[#8D80F0]">
                    View details
                  </Link>
                  {job.status === 0 ? (
                    <button
                      type="button"
                      disabled={!canAccept || busyJobId === job.jobId}
                      onClick={() => void handleAccept(job.jobId)}
                      className="archon-button-primary px-3 py-1.5 text-xs transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busyJobId === job.jobId ? "Accepting..." : "Accept"}
                    </button>
                  ) : (
                    <span className="text-xs text-[#9CA3AF]">No action</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

