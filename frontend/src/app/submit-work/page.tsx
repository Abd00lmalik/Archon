"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  fetchJobsByAgent,
  formatTaskDescription,
  formatTaskTitle,
  formatTimestamp,
  formatUsdc,
  JobRecord,
  statusLabel
} from "@/lib/contracts";
import { useWallet } from "@/lib/wallet-context";

export default function SubmitWorkPage() {
  const router = useRouter();
  const { account } = useWallet();
  const [jobIdInput, setJobIdInput] = useState("");
  const [acceptedJobs, setAcceptedJobs] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!account) {
        setAcceptedJobs([]);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const jobs = await fetchJobsByAgent(account);
        if (!active) return;
        setAcceptedJobs(jobs);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load accepted jobs.");
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [account]);

  const handleGoToJob = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = Number(jobIdInput);
    if (!Number.isInteger(parsed) || parsed < 0) {
      setError("Enter a valid numeric Job ID.");
      return;
    }
    router.push(`/job/${parsed}`);
  };

  return (
    <section className="mx-auto max-w-3xl space-y-5">
      <div className="archon-card p-6 md:p-7">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">Submit Your Work</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">To submit work on a job, go to the job page directly.</p>

        {error ? (
          <div className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
        ) : null}

        <form onSubmit={handleGoToJob} className="mt-5 flex flex-wrap items-end gap-3">
          <label className="flex-1 text-sm text-[#EAEAF0]">
            Enter Job ID
            <input
              type="number"
              min={0}
              className="archon-input mt-1"
              value={jobIdInput}
              onChange={(event) => setJobIdInput(event.target.value)}
              placeholder="0"
            />
          </label>
          <button type="submit" className="archon-button-primary px-4 py-2.5 text-sm">
            Go to Job
          </button>
        </form>
      </div>

      <div className="archon-card p-6">
        <h2 className="text-lg font-semibold text-[#EAEAF0]">Jobs You Accepted</h2>
        {!account ? (
          <p className="mt-3 text-sm text-[#9CA3AF]">Connect wallet to see your accepted jobs.</p>
        ) : loading ? (
          <p className="mt-3 text-sm text-[#9CA3AF]">Loading accepted jobs...</p>
        ) : acceptedJobs.length === 0 ? (
          <p className="mt-3 text-sm text-[#9CA3AF]">You have not accepted any jobs yet.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {acceptedJobs.map((job) => (
              <article key={job.jobId} className="rounded-xl border border-white/10 bg-[#111214] p-4 text-sm text-[#9CA3AF]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-[#EAEAF0]">#{job.jobId} {formatTaskTitle(job.title)}</p>
                  <span className="rounded-full bg-white/5 px-2 py-1 text-xs">{statusLabel(job.status)}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-xs">{formatTaskDescription(job.description)}</p>
                <p className="mt-2 text-xs">Reward: {formatUsdc(job.rewardUSDC)} USDC</p>
                <p className="text-xs">Deadline: {formatTimestamp(job.deadline)}</p>
                <Link href={`/job/${job.jobId}`} className="archon-button-secondary mt-3 inline-flex px-3 py-2 text-xs">
                  Open Job
                </Link>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

