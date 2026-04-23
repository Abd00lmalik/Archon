"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  fetchAgentTasksByAddress,
  getReadProvider,
  deriveDisplayStatus,
  formatTaskTitle,
  SubmissionRecord
} from "@/lib/contracts";
import { UserDisplay } from "@/components/ui/user-display";
import { fetchAllTasks, getTaskUrl, loadTaskSubmissions, UnifiedTask } from "@/lib/task-adapter";
import { useWallet } from "@/lib/wallet-context";

type JobWithSubmission = {
  job: UnifiedTask;
  submission: SubmissionRecord | null;
};

function submissionActionLabel(submission: SubmissionRecord | null) {
  if (!submission) return "Submit Work";
  if (submission.status === 1) return "Check Status";
  if (submission.status === 2 && !submission.credentialClaimed) return "Claim Credential";
  if (submission.status === 2 && submission.credentialClaimed) return "Completed";
  if (submission.status === 3) return "Resubmit Work";
  return "Open Job";
}

export default function MyWorkPage() {
  const { account } = useWallet();
  const [jobsPosted, setJobsPosted] = useState<UnifiedTask[]>([]);
  const [jobsWorking, setJobsWorking] = useState<JobWithSubmission[]>([]);
  const [agentTasks, setAgentTasks] = useState<Awaited<ReturnType<typeof fetchAgentTasksByAddress>>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const allTasks = useMemo(
    () => [
      ...jobsPosted,
      ...jobsWorking.map(({ job }) => job)
    ],
    [jobsPosted, jobsWorking]
  );

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (!account) {
        setJobsPosted([]);
        setJobsWorking([]);
        setAgentTasks([]);
        return;
      }

      setLoading(true);
      setError("");
      try {
        const provider = getReadProvider();
        const [tasks, agentTaskRows] = await Promise.all([
          fetchAllTasks(provider),
          fetchAgentTasksByAddress(account)
        ]);

        const posted = tasks.filter((task) => task.client.toLowerCase() === account.toLowerCase());
        const working = (
          await Promise.all(
            tasks.map(async (job): Promise<JobWithSubmission | null> => {
              const submissions = await loadTaskSubmissions(job, provider);
              const submission = submissions.find((entry) => entry.agent.toLowerCase() === account.toLowerCase()) ?? null;
              return submission ? { job, submission } : null;
            })
          )
        ).filter((entry): entry is JobWithSubmission => Boolean(entry));

        if (!active) return;
        setJobsPosted(posted);
        setJobsWorking(working);
        setAgentTasks(agentTaskRows);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load your work dashboard.");
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [account]);

  return (
    <section className="space-y-5">
      <div className="archon-card p-6">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">My Work</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">Track everything you posted, accepted, submitted, and claimed.</p>
      </div>

      {error ? (
        <div className="archon-card border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      ) : null}

      {!account ? (
        <div className="archon-card px-4 py-6 text-sm text-[#9CA3AF]">Connect wallet to view your action hub.</div>
      ) : null}

      {account ? (
        <>
          <div className="archon-card p-6">
            <h2 className="text-lg font-semibold text-[#EAEAF0]">Jobs You Posted</h2>
            {loading ? (
              <p className="mt-3 text-sm text-[#9CA3AF]">Loading...</p>
            ) : jobsPosted.length === 0 ? (
              <div className="mt-3 text-sm text-[#9CA3AF]">
                <p>You haven&apos;t posted any tasks yet.</p>
                <Link href="/create-job" className="archon-button-primary mt-3 inline-flex px-3 py-2 text-xs">Post a Task</Link>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                {jobsPosted.map((job) => (
                  <article key={`posted-${job.displayId}`} className="rounded-xl border border-white/10 bg-[#111214] p-4 text-sm text-[#9CA3AF]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-[#EAEAF0]">
                        #{job.displayId} {formatTaskTitle(job.title)}
                      </p>
                      <span
                        className="rounded-full px-2 py-1 text-xs"
                        style={{
                          color: deriveDisplayStatus(job.status, job.deadline, job.revealPhaseEnd).color,
                          background: "rgba(255,255,255,0.05)"
                        }}
                      >
                        {deriveDisplayStatus(job.status, job.deadline, job.revealPhaseEnd).label}
                      </span>
                    </div>
                    <p className="mt-2 text-xs">Submissions: {job.submissionCount}</p>
                    <div className="mt-2">
                      <UserDisplay address={job.client} showAvatar={true} avatarSize={22} />
                    </div>
                    <Link href={getTaskUrl(job)} className="archon-button-secondary mt-3 inline-flex px-3 py-2 text-xs">
                      Review Submissions
                    </Link>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="archon-card p-6">
            <h2 className="text-lg font-semibold text-[#EAEAF0]">Jobs You&apos;re Working On</h2>
            {jobsWorking.length === 0 ? (
              <p className="mt-3 text-sm text-[#9CA3AF]">You have not accepted any jobs yet.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {jobsWorking.map(({ job, submission }) => (
                  <article key={`working-${job.displayId}`} className="rounded-xl border border-white/10 bg-[#111214] p-4 text-sm text-[#9CA3AF]">
                    <p className="font-semibold text-[#EAEAF0]">
                      #{job.displayId} {formatTaskTitle(job.title)}
                    </p>
                    <p className="mt-1 text-xs">Status: {submission ? submissionActionLabel(submission) : "Accepted"}</p>
                    <div className="mt-2">
                      <UserDisplay address={job.client} showAvatar={true} avatarSize={22} />
                    </div>
                    {submission?.reviewerNote ? <p className="mt-1 text-xs">Reviewer note: {submission.reviewerNote}</p> : null}
                    <Link href={getTaskUrl(job)} className="archon-button-secondary mt-3 inline-flex px-3 py-2 text-xs">
                      {submissionActionLabel(submission)}
                    </Link>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="archon-card p-6">
            <h2 className="text-lg font-semibold text-[#EAEAF0]">Agent Tasks</h2>
            {agentTasks.length === 0 ? (
              <p className="mt-3 text-sm text-[#9CA3AF]">No agent tasks assigned yet.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {agentTasks.map((task) => (
                  <article key={task.taskId} className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-xs text-[#9CA3AF]">
                    <p className="text-[#EAEAF0]">Task #{task.taskId}</p>
                    <p>Status: {task.status}</p>
                    <div className="mt-2">
                      <UserDisplay address={task.taskPoster} showAvatar={true} avatarSize={20} />
                    </div>
                    <Link href="/tasks" className="mt-2 inline-flex text-[#8FD9FF] underline underline-offset-4">
                      Open in Tasks Hub
                    </Link>
                  </article>
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}

      {allTasks.length > 0 ? null : null}
    </section>
  );
}

