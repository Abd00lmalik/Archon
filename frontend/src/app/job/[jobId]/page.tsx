"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getJobReadContract, getReadProvider, JobRecord, parseJob, statusLabel } from "@/lib/contracts";
import { subscribeToJobUpdates } from "@/lib/events";
import { useWallet } from "@/lib/wallet-context";

function statusClasses(status: number) {
  if (status === 0) return "bg-white/5 text-[#9CA3AF]";
  if (status === 1) return "bg-[#6C5CE7]/15 text-[#B8AFF7]";
  if (status === 2) return "bg-[#00D1B2]/15 text-[#6EF2DE]";
  return "bg-emerald-500/15 text-emerald-300";
}

export default function JobDetailsPage() {
  const params = useParams<{ jobId: string }>();
  const { browserProvider } = useWallet();
  const [job, setJob] = useState<JobRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const jobId = useMemo(() => Number(params.jobId), [params.jobId]);

  const loadJob = useCallback(async () => {
    if (!Number.isInteger(jobId) || jobId < 0) {
      setError("Invalid job ID.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const contract = getJobReadContract();
      const rawJob = await contract.getJob(jobId);
      setJob(parseJob(rawJob));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load job.");
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void loadJob();
  }, [loadJob]);

  useEffect(() => {
    if (!Number.isInteger(jobId) || jobId < 0) {
      return () => undefined;
    }

    const unsubscribe = subscribeToJobUpdates(browserProvider ?? getReadProvider(), jobId, (status) => {
      setJob((previous) => (previous ? { ...previous, status } : previous));
      setToast("Status updated");
      setTimeout(() => setToast(""), 2000);
    });

    return unsubscribe;
  }, [browserProvider, jobId]);

  return (
    <section className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">Job Details</h1>
        <Link href="/" className="oris-button-secondary px-3 py-2 text-sm">
          Back to Jobs
        </Link>
      </div>

      {toast ? <div className="oris-card border border-cyan-400/25 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-200">{toast}</div> : null}
      {error ? <div className="oris-card border border-rose-500/25 bg-rose-500/10 px-4 py-2 text-sm text-rose-200">{error}</div> : null}

      {loading ? (
        <div className="oris-card px-4 py-5 text-sm text-[#9CA3AF]">Loading job...</div>
      ) : job ? (
        <div className="oris-card space-y-4 p-5 text-sm text-[#9CA3AF]">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[#EAEAF0]">#{job.jobId} {job.title}</h2>
            <span className={`rounded-full px-2 py-1 text-xs ${statusClasses(job.status)}`}>{statusLabel(job.status)}</span>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
            <span className="font-medium text-[#EAEAF0]">Description:</span> {job.description}
          </div>
          <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
            <span className="font-medium text-[#EAEAF0]">Client:</span> {job.client}
          </div>
          <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
            <span className="font-medium text-[#EAEAF0]">Agent:</span> {job.agent}
          </div>
          <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
            <span className="font-medium text-[#EAEAF0]">Deliverable:</span> {job.deliverableHash || "Not submitted"}
          </div>
        </div>
      ) : (
        <div className="oris-card px-4 py-5 text-sm text-[#9CA3AF]">Job not found.</div>
      )}
    </section>
  );
}