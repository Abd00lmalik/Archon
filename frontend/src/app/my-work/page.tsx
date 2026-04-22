"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  fetchAgentTasksByAddress,
  fetchJobsByAgent,
  fetchJobsByClient,
  getReadProvider,
  fetchSubmissionForAgent,
  formatTaskTitle,
  JobRecord,
  statusLabel,
  SubmissionRecord
} from "@/lib/contracts";
import { fetchLegacySubmissions, fetchLegacyTasks } from "@/lib/legacy-contracts";
import { UserDisplay } from "@/components/ui/user-display";
import { getDisplayId, makeTaskUrl } from "@/lib/task-id";
import { useWallet } from "@/lib/wallet-context";

type JobWithSubmission = {
  job: DisplayWorkJob;
  submission: SubmissionRecord | null;
};

type DisplayWorkJob = JobRecord & { isPastTask?: boolean; archiveKey?: string };

function submissionActionLabel(submission: SubmissionRecord | null) {
  if (!submission) return "Submit Work";
  if (submission.status === 1) return "Check Status";
  if (submission.status === 2 && !submission.credentialClaimed) return "Claim Credential";
  if (submission.status === 2 && submission.credentialClaimed) return "Completed";
  if (submission.status === 3) return "Resubmit Work";
  return "Open Job";
}

function taskDisplayKey(job: DisplayWorkJob) {
  return `task-${job.isPastTask ? job.archiveKey ?? "v1" : "current"}-${job.jobId}`;
}

export default function MyWorkPage() {
  const { account } = useWallet();
  const [jobsPosted, setJobsPosted] = useState<DisplayWorkJob[]>([]);
  const [jobsWorking, setJobsWorking] = useState<JobWithSubmission[]>([]);
  const [agentTasks, setAgentTasks] = useState<Awaited<ReturnType<typeof fetchAgentTasksByAddress>>>([]);
  const [displayIds, setDisplayIds] = useState<Record<string, string>>({});
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
        const [posted, working, tasks, legacyTasks] = await Promise.all([
          fetchJobsByClient(account),
          fetchJobsByAgent(account),
          fetchAgentTasksByAddress(account),
          fetchLegacyTasks(getReadProvider())
        ]);

        const workingWithSubmission = await Promise.all(
          working.map(async (job): Promise<JobWithSubmission> => ({
            job,
            submission: await fetchSubmissionForAgent(job.jobId, account)
          }))
        );
        const archivedPosted = legacyTasks.filter(
          (job) => job.client.toLowerCase() === account.toLowerCase()
        );
        const archivedWorking = (
          await Promise.all(
            legacyTasks.map(async (job): Promise<JobWithSubmission | null> => {
              const submissions = await fetchLegacySubmissions(getReadProvider(), job.jobId, job.archiveKey);
              const submission =
                submissions.find((entry) => entry.agent.toLowerCase() === account.toLowerCase()) ?? null;
              return submission ? { job, submission } : null;
            })
          )
        ).filter((entry): entry is JobWithSubmission => Boolean(entry));

        if (!active) return;
        setJobsPosted([...posted, ...archivedPosted]);
        setJobsWorking([...workingWithSubmission, ...archivedWorking]);
        setAgentTasks(tasks);
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
                  <article key={taskDisplayKey(job)} className="rounded-xl border border-white/10 bg-[#111214] p-4 text-sm text-[#9CA3AF]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-[#EAEAF0]">
                        {displayIds[taskDisplayKey(job)] ?? `#${job.jobId}`} {formatTaskTitle(job.title)}
                      </p>
                      <span className="rounded-full bg-white/5 px-2 py-1 text-xs">{statusLabel(job.status)}</span>
                    </div>
                    <p className="mt-2 text-xs">Submissions: {job.submissionCount}</p>
                    <div className="mt-2">
                      <UserDisplay address={job.client} showAvatar={true} avatarSize={22} />
                    </div>
                    <Link href={makeTaskUrl(job.jobId, job.isPastTask ?? false, job.archiveKey)} className="archon-button-secondary mt-3 inline-flex px-3 py-2 text-xs">
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
                  <article key={taskDisplayKey(job)} className="rounded-xl border border-white/10 bg-[#111214] p-4 text-sm text-[#9CA3AF]">
                    <p className="font-semibold text-[#EAEAF0]">
                      {displayIds[taskDisplayKey(job)] ?? `#${job.jobId}`} {formatTaskTitle(job.title)}
                    </p>
                    <p className="mt-1 text-xs">Status: {submission ? submissionActionLabel(submission) : "Accepted"}</p>
                    <div className="mt-2">
                      <UserDisplay address={job.client} showAvatar={true} avatarSize={22} />
                    </div>
                    {submission?.reviewerNote ? <p className="mt-1 text-xs">Reviewer note: {submission.reviewerNote}</p> : null}
                    <Link href={makeTaskUrl(job.jobId, job.isPastTask ?? false, job.archiveKey)} className="archon-button-secondary mt-3 inline-flex px-3 py-2 text-xs">
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
    </section>
  );
}


