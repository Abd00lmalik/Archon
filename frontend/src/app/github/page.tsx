"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  expectedChainId,
  fetchGitHubActivitiesByAgent,
  GitHubActivityRecord,
  txApproveGitHubActivity,
  txClaimGitHubCredential,
  txRejectGitHubActivity,
  txSubmitGitHubActivity
} from "@/lib/contracts";
import { useWallet } from "@/lib/wallet-context";

type Tab = "submit" | "submissions";

const ACTIVITY_TYPES = [
  { id: 0, label: "PR Merged", weight: 150 },
  { id: 1, label: "Issue Resolved", weight: 120 },
  { id: 2, label: "Repo Contribution", weight: 100 },
  { id: 3, label: "Code Review", weight: 80 },
  { id: 4, label: "Documentation Added", weight: 70 }
] as const;

function statusBadge(status: number) {
  if (status === 1) return "bg-emerald-500/15 text-emerald-200";
  if (status === 2) return "bg-rose-500/15 text-rose-200";
  return "bg-white/5 text-[#9CA3AF]";
}

function statusLabel(status: number) {
  if (status === 1) return "Approved";
  if (status === 2) return "Rejected";
  return "Pending";
}

export default function GitHubPage() {
  const { account, browserProvider, connect } = useWallet();
  const [tab, setTab] = useState<Tab>("submit");
  const [activityType, setActivityType] = useState<number>(0);
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [repoName, setRepoName] = useState("");
  const [activities, setActivities] = useState<GitHubActivityRecord[]>([]);
  const [reviewReasonById, setReviewReasonById] = useState<Record<number, string>>({});
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const selectedType = useMemo(() => ACTIVITY_TYPES.find((item) => item.id === activityType), [activityType]);

  const loadActivities = useCallback(async () => {
    if (!account) {
      setActivities([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const list = await fetchGitHubActivitiesByAgent(account);
      setActivities(list);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load submissions.");
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    void loadActivities();
  }, [loadActivities]);

  const withProvider = async () => {
    const provider = browserProvider ?? (await connect());
    if (!provider) throw new Error("Wallet connection was not established.");
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== expectedChainId) {
      throw new Error(`Switch wallet network to chain ID ${expectedChainId}.`);
    }
    return provider;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("");
    setError("");
    if (!evidenceUrl.trim().startsWith("https://github.com")) {
      setError("URL must start with https://github.com");
      return;
    }
    if (!repoName.trim()) {
      setError("Repository name is required.");
      return;
    }

    try {
      const provider = await withProvider();
      const tx = await txSubmitGitHubActivity(provider, activityType, evidenceUrl.trim(), repoName.trim());
      setStatus(`Submission transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus("Under review — platform verifiers typically respond within 24 hours.");
      setEvidenceUrl("");
      setRepoName("");
      setTab("submissions");
      await loadActivities();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to submit activity.");
    }
  };

  const handleClaim = async (activityId: number) => {
    setStatus("");
    setError("");
    setBusyId(activityId);
    try {
      const provider = await withProvider();
      const tx = await txClaimGitHubCredential(provider, activityId);
      setStatus(`Claim transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Credential claimed for GitHub activity #${activityId}.`);
      await loadActivities();
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "Failed to claim credential.");
    } finally {
      setBusyId(null);
    }
  };

  const handleApprove = async (activityId: number) => {
    setStatus("");
    setError("");
    setBusyId(activityId);
    try {
      const provider = await withProvider();
      const tx = await txApproveGitHubActivity(provider, activityId);
      setStatus(`Approve transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Activity #${activityId} approved.`);
      await loadActivities();
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : "Failed to approve activity.");
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (activityId: number) => {
    setStatus("");
    setError("");
    setBusyId(activityId);
    try {
      const provider = await withProvider();
      const reason = reviewReasonById[activityId] ?? "Needs more evidence";
      const tx = await txRejectGitHubActivity(provider, activityId, reason);
      setStatus(`Reject transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Activity #${activityId} rejected.`);
      await loadActivities();
    } catch (rejectError) {
      setError(rejectError instanceof Error ? rejectError.message : "Failed to reject activity.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-6">
      <div className="archon-card p-6">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">GitHub Activity</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">Submit verifiable GitHub work to earn weighted credentials.</p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTab("submit")}
            className={`rounded-full px-3 py-1.5 text-xs ${tab === "submit" ? "bg-[#6C5CE7]/35 text-[#EAEAF0]" : "bg-white/5 text-[#9CA3AF]"}`}
          >
            Submit Activity
          </button>
          <button
            type="button"
            onClick={() => setTab("submissions")}
            className={`rounded-full px-3 py-1.5 text-xs ${tab === "submissions" ? "bg-[#6C5CE7]/35 text-[#EAEAF0]" : "bg-white/5 text-[#9CA3AF]"}`}
          >
            My Submissions
          </button>
        </div>
      </div>

      {status ? <div className="archon-card border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{status}</div> : null}
      {error ? <div className="archon-card border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

      {tab === "submit" ? (
        <div className="archon-card p-6">
          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block text-sm text-[#9CA3AF]">
              Activity type
              <select
                className="archon-input mt-1"
                value={activityType}
                onChange={(event) => setActivityType(Number(event.target.value))}
              >
                {ACTIVITY_TYPES.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-[#9CA3AF]">
              GitHub URL
              <input
                className="archon-input mt-1"
                value={evidenceUrl}
                onChange={(event) => setEvidenceUrl(event.target.value)}
                placeholder="https://github.com/org/repo/pull/123"
                required
              />
            </label>
            <label className="block text-sm text-[#9CA3AF]">
              Repository name
              <input
                className="archon-input mt-1"
                value={repoName}
                onChange={(event) => setRepoName(event.target.value)}
                placeholder="org/repo"
                required
              />
            </label>
            <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-xs text-[#9CA3AF]">
              Reputation weight for this activity:{" "}
              <span className="font-semibold text-[#EAEAF0]">{selectedType?.weight ?? 0}</span>
            </div>
            <button type="submit" className="archon-button-primary w-full px-4 py-2.5 text-sm">
              Submit GitHub Activity
            </button>
          </form>
          <p className="mt-3 text-xs text-[#9CA3AF]">
            Under review — platform verifiers typically respond within 24 hours.
          </p>
        </div>
      ) : null}

      {tab === "submissions" ? (
        <div className="archon-card p-6">
          {loading ? (
            <p className="text-sm text-[#9CA3AF]">Loading submissions...</p>
          ) : activities.length === 0 ? (
            <p className="text-sm text-[#9CA3AF]">No submissions yet.</p>
          ) : (
            <div className="space-y-3">
              {activities.map((activity) => (
                <article key={activity.activityId} className="rounded-xl border border-white/10 bg-[#111214] p-3 text-sm text-[#9CA3AF]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-[#EAEAF0]">Activity #{activity.activityId}</p>
                    <span className={`rounded-full px-2 py-1 text-xs ${statusBadge(activity.status)}`}>
                      {statusLabel(activity.status)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs">Repo: {activity.repoName}</p>
                  <a href={activity.evidenceUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all text-xs text-[#8FD9FF] underline underline-offset-4">
                    {activity.evidenceUrl}
                  </a>
                  {activity.status === 2 && activity.rejectionReason ? (
                    <p className="mt-2 text-xs text-rose-200">Reason: {activity.rejectionReason}</p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {activity.status === 1 && !activity.credentialClaimed ? (
                      <button
                        type="button"
                        onClick={() => void handleClaim(activity.activityId)}
                        disabled={busyId === activity.activityId}
                        className="archon-button-primary px-3 py-2 text-xs"
                      >
                        {busyId === activity.activityId ? "Claiming..." : "Claim Credential"}
                      </button>
                    ) : null}
                    {activity.status === 0 ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleApprove(activity.activityId)}
                          disabled={busyId === activity.activityId}
                          className="archon-button-secondary px-3 py-2 text-xs"
                        >
                          {busyId === activity.activityId ? "Processing..." : "Approve (Verifier)"}
                        </button>
                        <input
                          className="archon-input w-full text-xs sm:w-60"
                          placeholder="Rejection reason"
                          value={reviewReasonById[activity.activityId] ?? ""}
                          onChange={(event) =>
                            setReviewReasonById((previous) => ({
                              ...previous,
                              [activity.activityId]: event.target.value
                            }))
                          }
                        />
                        <button
                          type="button"
                          onClick={() => void handleReject(activity.activityId)}
                          disabled={busyId === activity.activityId}
                          className="archon-button-secondary px-3 py-2 text-xs"
                        >
                          {busyId === activity.activityId ? "Processing..." : "Reject (Verifier)"}
                        </button>
                      </>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
