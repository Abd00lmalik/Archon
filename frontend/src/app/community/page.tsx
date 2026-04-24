"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CommunityActivityRecord,
  CommunityApplicationRecord,
  expectedChainId,
  fetchCommunityActivitiesByRecipient,
  fetchCommunityApplicationsByApplicant,
  fetchCommunityModeratorProfile,
  fetchCommunityModerators,
  fetchPendingCommunityApplications,
  formatTimestamp,
  ModeratorProfileRecord,
  shortAddress,
  txApproveCommunityApplication,
  txClaimCommunityCredential,
  txRejectCommunityApplication,
  txSubmitCommunityApplication
} from "@/lib/contracts";
import { useWallet } from "@/lib/wallet-context";

const COMMUNITY_TYPES = [
  {
    id: 0,
    title: "Bug Report",
    label: "Reported a verified bug with reproduction steps",
    description:
      "Identified and reported a verified bug with clear reproduction steps.",
    evidence: "GitHub issue link or detailed report URL",
    weight: 100
  },
  {
    id: 1,
    title: "Open Source Contribution",
    label: "Merged PR to a recognized open source project",
    description:
      "Had a pull request merged into a recognized open source project.",
    evidence: "Merged GitHub PR link",
    weight: 150
  },
  {
    id: 2,
    title: "Built a dApp",
    label: "Built and deployed a working decentralized application",
    description: "Built and deployed a working dApp with a live deployment and source code.",
    evidence: "Live URL plus GitHub repository",
    weight: 200
  },
  {
    id: 3,
    title: "Smart Contract Deployment",
    label: "Deployed and verified a smart contract",
    description: "Deployed and verified a smart contract on a public network.",
    evidence: "Block explorer verification link",
    weight: 180
  },
  {
    id: 4,
    title: "Repository Contribution",
    label: "Meaningful code contribution to a public repository",
    description: "Made a meaningful code contribution to a public repository.",
    evidence: "GitHub commit or PR link",
    weight: 130
  },
  {
    id: 5,
    title: "Technical Tutorial",
    label: "Published technical tutorial or documentation",
    description: "Published a technical tutorial, guide, or documentation for blockchain/Web3 development.",
    evidence: "Published article or documentation link",
    weight: 110
  },
  {
    id: 6,
    title: "Security Audit Contribution",
    label: "Contributed to a protocol audit or security review",
    description: "Contributed to a smart contract or protocol security audit.",
    evidence: "Published audit report link",
    weight: 160
  },
  {
    id: 7,
    title: "Protocol Integration",
    label: "Built an integration between two protocols",
    description: "Built a working integration between two protocols or services.",
    evidence: "Deployment link and source code",
    weight: 140
  }
] as const;

const PLATFORMS = ["discord", "telegram", "twitter", "forum", "github"] as const;
const CONTRIBUTION_CATEGORIES = [
  "Bug Report",
  "Open Source PR",
  "dApp Built",
  "Contract Deployed",
  "Repo Contribution",
  "Technical Tutorial",
  "Security Audit",
  "Protocol Integration",
  "Other"
] as const;

type ModeratorApplicationDraft = {
  wallet: string;
  profileLink: string;
  experience: string;
  categories: string[];
  submittedAt: number;
};

function parseCommunityApplication(raw: unknown): CommunityApplicationRecord {
  const tuple = raw as Record<string, unknown> & unknown[];
  return {
    applicationId: Number(tuple.applicationId ?? tuple[0] ?? 0),
    applicant: String(tuple.applicant ?? tuple[1] ?? ""),
    activityDescription: String(tuple.activityDescription ?? tuple[2] ?? ""),
    evidenceLink: String(tuple.evidenceLink ?? tuple[3] ?? ""),
    platform: String(tuple.platform ?? tuple[4] ?? ""),
    submittedAt: Number(tuple.submittedAt ?? tuple[5] ?? 0),
    status: Number(tuple.status ?? tuple[6] ?? 0),
    reviewedBy: String(tuple.reviewedBy ?? tuple[7] ?? ""),
    reviewNote: String(tuple.reviewNote ?? tuple[8] ?? "")
  };
}

function statusMeta(status: number) {
  if (status === 1) return { label: "Approved", className: "bg-emerald-500/15 text-emerald-200" };
  if (status === 2) return { label: "Rejected", className: "bg-rose-500/15 text-rose-200" };
  return { label: "Pending", className: "bg-white/5 text-[#9CA3AF]" };
}

export default function CommunityPage() {
  const { account, browserProvider, connect } = useWallet();
  const [moderators, setModerators] = useState<ModeratorProfileRecord[]>([]);
  const [myModeratorProfile, setMyModeratorProfile] = useState<ModeratorProfileRecord | null>(null);
  const [applications, setApplications] = useState<CommunityApplicationRecord[]>([]);
  const [pendingApplications, setPendingApplications] = useState<CommunityApplicationRecord[]>([]);
  const [awards, setAwards] = useState<CommunityActivityRecord[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [busyApplicationId, setBusyApplicationId] = useState<number | null>(null);
  const [busyAwardId, setBusyAwardId] = useState<number | null>(null);

  const [activityDescription, setActivityDescription] = useState("");
  const [evidenceLink, setEvidenceLink] = useState("");
  const [platform, setPlatform] = useState("discord");
  const [selectedType, setSelectedType] = useState(0);
  const [selectedModerator, setSelectedModerator] = useState("");
  const [modApp, setModApp] = useState({
    profileLink: "",
    experience: "",
    categories: [] as string[]
  });
  const [storedModApplication, setStoredModApplication] = useState<ModeratorApplicationDraft | null>(null);

  const [reviewTypeById, setReviewTypeById] = useState<Record<number, number>>({});
  const [reviewNoteById, setReviewNoteById] = useState<Record<number, string>>({});
  const [rejectNoteById, setRejectNoteById] = useState<Record<number, string>>({});

  const activeModerator = myModeratorProfile?.active === true;
  const hasModerators = moderators.length > 0;

  const pendingAwards = useMemo(() => awards.filter((award) => !award.credentialClaimed), [awards]);

  const awardByApplication = useMemo(() => {
    const pending = [...pendingAwards];
    const map: Record<number, CommunityActivityRecord | undefined> = {};
    for (const application of applications) {
      if (application.status !== 1) continue;
      const index = pending.findIndex(
        (award) =>
          award.platform.toLowerCase() === application.platform.toLowerCase() &&
          award.evidenceNote === application.activityDescription &&
          award.issuedBy.toLowerCase() === application.reviewedBy.toLowerCase()
      );
      if (index >= 0) {
        map[application.applicationId] = pending[index];
        pending.splice(index, 1);
      }
    }
    return map;
  }, [applications, pendingAwards]);

  const withProvider = async () => {
    const provider = browserProvider ?? (await connect());
    if (!provider) throw new Error("Wallet connection was not established.");
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== expectedChainId) {
      throw new Error(`Switch wallet network to chain ID ${expectedChainId}.`);
    }
    return provider;
  };

  const load = useCallback(async () => {
    setError("");
    try {
      const teamPromise = fetchCommunityModerators();
      if (!account) {
        const team = await teamPromise;
        setModerators(team);
        setApplications([]);
        setPendingApplications([]);
        setAwards([]);
        setMyModeratorProfile(null);
        setApplicationsLoading(false);
        return;
      }

      setApplicationsLoading(true);
      const [team, profile, myApplications, myAwards] = await Promise.all([
        teamPromise,
        fetchCommunityModeratorProfile(account),
        fetchCommunityApplicationsByApplicant(account),
        fetchCommunityActivitiesByRecipient(account)
      ]);
      setModerators(team);
      setMyModeratorProfile(profile);
      setApplications(myApplications.map((raw) => parseCommunityApplication(raw)));
      setAwards(myAwards);

      if (profile?.active) {
        const pending = await fetchPendingCommunityApplications();
        setPendingApplications(pending.map((raw) => parseCommunityApplication(raw)));
      } else {
        setPendingApplications([]);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load community data.");
    } finally {
      setApplicationsLoading(false);
    }
  }, [account]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!account || typeof window === "undefined") {
      setStoredModApplication(null);
      return;
    }
    try {
      const raw = window.localStorage.getItem(`archon_mod_application_${account}`);
      if (!raw) {
        setStoredModApplication(null);
        return;
      }
      const parsed = JSON.parse(raw) as ModeratorApplicationDraft;
      setStoredModApplication(parsed);
    } catch {
      setStoredModApplication(null);
    }
  }, [account]);

  useEffect(() => {
    if (moderators.length > 0 && !selectedModerator) {
      setSelectedModerator(moderators[0].wallet);
    }
  }, [moderators, selectedModerator]);

  const handleApplyModerator = () => {
    setStatus("");
    setError("");
    if (!account) {
      setError("Connect wallet first.");
      return;
    }
    if (!modApp.profileLink.trim()) {
      setError("Profile or portfolio link is required.");
      return;
    }
    if (modApp.experience.trim().length < 40) {
      setError("Experience summary must be at least 40 characters.");
      return;
    }
    if (modApp.categories.length === 0) {
      setError("Select at least one contribution category.");
      return;
    }
    const application: ModeratorApplicationDraft = {
      wallet: account,
      profileLink: modApp.profileLink.trim(),
      experience: modApp.experience.trim(),
      categories: modApp.categories,
      submittedAt: Date.now()
    };
    try {
      window.localStorage.setItem(`archon_mod_application_${account}`, JSON.stringify(application));
      setStoredModApplication(application);
      setStatus(
        "Moderator application submitted. A platform operator will review and approve moderator roles via the admin CLI."
      );
    } catch {
      setError("Failed to save moderator application locally. Please try again.");
    }
  };

  const handleSubmitApplication = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("");
    setError("");

    if (activityDescription.trim().length < 100) {
      setError("Technical description must be at least 100 characters.");
      return;
    }
    if (!evidenceLink.trim()) {
      setError("Evidence link is required for technical activity applications.");
      return;
    }
    if (moderators.length > 0 && !selectedModerator) {
      setError("Select a moderator for this application.");
      return;
    }

    try {
      const provider = await withProvider();
      const selected = COMMUNITY_TYPES.find((type) => type.id === selectedType);
      const moderatorNote = selectedModerator ? `[Preferred Moderator: ${selectedModerator}] ` : "";
      const normalizedDescription = `${moderatorNote}[Requested Type: ${selected?.title ?? "General"}] ${activityDescription.trim()}`;
      const tx = await txSubmitCommunityApplication(
        provider,
        normalizedDescription,
        evidenceLink.trim(),
        platform.trim().toLowerCase()
      );
      setStatus(`Application submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(
        "Application submitted. A moderator will review within 48 hours. You can check the status in 'Your Applications' above."
      );
      setActivityDescription("");
      setEvidenceLink("");
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to submit application.");
    }
  };

  const handleClaim = async (activityId: number) => {
    setBusyAwardId(activityId);
    setStatus("");
    setError("");
    try {
      const provider = await withProvider();
      const tx = await txClaimCommunityCredential(provider, activityId);
      setStatus(`Claim submitted: ${tx.hash}`);
      await tx.wait();
      setStatus("Community credential claimed.");
      await load();
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "Failed to claim credential.");
    } finally {
      setBusyAwardId(null);
    }
  };

  const handleApprove = async (applicationId: number) => {
    setBusyApplicationId(applicationId);
    setStatus("");
    setError("");
    try {
      const provider = await withProvider();
      const activityType = reviewTypeById[applicationId] ?? 0;
      const note = reviewNoteById[applicationId] ?? "";
      const tx = await txApproveCommunityApplication(provider, applicationId, activityType, note);
      setStatus(`Approval submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Application #${applicationId} approved.`);
      await load();
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : "Failed to approve application.");
    } finally {
      setBusyApplicationId(null);
    }
  };

  const handleReject = async (applicationId: number) => {
    setBusyApplicationId(applicationId);
    setStatus("");
    setError("");
    const note = rejectNoteById[applicationId]?.trim() ?? "";
    if (!note) {
      setError("Rejection note is required.");
      setBusyApplicationId(null);
      return;
    }
    try {
      const provider = await withProvider();
      const tx = await txRejectCommunityApplication(provider, applicationId, note);
      setStatus(`Rejection submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Application #${applicationId} rejected.`);
      await load();
    } catch (rejectError) {
      setError(rejectError instanceof Error ? rejectError.message : "Failed to reject application.");
    } finally {
      setBusyApplicationId(null);
    }
  };

  return (
    <section className="space-y-6">
      <div className="archon-card p-6">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">Community Credentials</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">
          Earn credentials for verified technical contributions - reviewed by Archon moderators.
        </p>
      </div>

      {status ? (
        <div className="archon-card border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {status}
        </div>
      ) : null}
      {error ? (
        <div className="archon-card border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      ) : null}

      <div className="archon-card p-6">
        <h2 className="text-lg font-semibold text-[#EAEAF0]">Become a Moderator</h2>
        {!account ? (
          <p className="mt-3 text-sm text-[#9CA3AF]">Connect wallet to apply as a moderator.</p>
        ) : myModeratorProfile?.active ? (
          <p className="mt-3 text-sm text-emerald-300">Your wallet is already an active moderator.</p>
        ) : storedModApplication ? (
          <div className="mt-3 rounded-xl border border-amber-300/35 bg-amber-500/10 p-4 text-sm text-amber-200">
            <p className="font-medium">Application pending review</p>
            <p className="mt-1 text-xs">Submitted: {new Date(storedModApplication.submittedAt).toLocaleString()}</p>
            <p className="mt-1 text-xs">Categories: {storedModApplication.categories.join(", ")}</p>
            <p className="mt-2 text-xs text-[#9CA3AF]">
              Platform operators approve moderator roles via admin CLI scripts in the contracts workspace.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <label className="block text-sm text-[#9CA3AF]">
              Profile / GitHub / proof link
              <input
                className="archon-input mt-1"
                value={modApp.profileLink}
                onChange={(event) => setModApp((prev) => ({ ...prev, profileLink: event.target.value }))}
                placeholder="https://..."
              />
            </label>
            <label className="block text-sm text-[#9CA3AF]">
              Relevant experience
              <textarea
                className="archon-input mt-1 min-h-24"
                value={modApp.experience}
                onChange={(event) => setModApp((prev) => ({ ...prev, experience: event.target.value }))}
                placeholder="Summarize your technical review/moderation experience."
              />
            </label>
            <div>
              <p className="text-sm text-[#9CA3AF]">Contribution categories</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {CONTRIBUTION_CATEGORIES.map((category) => {
                  const selected = modApp.categories.includes(category);
                  return (
                    <label key={category} className="flex items-center gap-2 rounded border border-white/10 p-2 text-xs text-[#9CA3AF]">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(event) =>
                          setModApp((prev) => ({
                            ...prev,
                            categories: event.target.checked
                              ? [...prev.categories, category]
                              : prev.categories.filter((item) => item !== category)
                          }))
                        }
                      />
                      <span>{category}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <button type="button" onClick={handleApplyModerator} className="archon-button-primary px-4 py-2 text-sm">
              Submit Moderator Application
            </button>
            <p className="text-xs text-[#9CA3AF]">
              Approval is completed by a platform operator using the admin CLI once your application is reviewed.
            </p>
          </div>
        )}
      </div>

      <div className="archon-card p-6">
        <h2 className="text-lg font-semibold text-[#EAEAF0]">Who Reviews Your Application</h2>
        <div className="mt-3 rounded-xl border border-white/10 bg-[#111214] px-4 py-3 text-sm text-[#9CA3AF]">
          <p className="font-medium text-[#EAEAF0]">Our Moderation Team</p>
          <p className="mt-1">
            These verified moderators review all community applications. When you submit, one of them will respond
            within 48 hours.
          </p>
        </div>

        {!hasModerators ? (
          <div className="mt-4 rounded-xl border border-amber-300/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Moderation team is being assembled. Community credentials will open soon - check back shortly.
          </div>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {moderators.map((moderator) => (
              <article key={moderator.wallet} className="rounded-xl border border-white/10 bg-[#111214] p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xs text-[#EAEAF0]">
                    {moderator.wallet.slice(2, 4).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1 text-sm text-[#9CA3AF]">
                    <p className="font-semibold text-[#EAEAF0]">{moderator.name || "Community Moderator"}</p>
                    <p className="mt-1">{moderator.role || "Moderator"}</p>
                    <p className="mt-1">Wallet: {shortAddress(moderator.wallet)}</p>
                    {moderator.profileURI ? (
                      <a
                        href={moderator.profileURI}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-[#8FD9FF] underline underline-offset-4"
                      >
                        View Profile
                      </a>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="archon-card p-6">
        <h2 className="text-lg font-semibold text-[#EAEAF0]">Activity Types You Can Apply For</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {COMMUNITY_TYPES.map((item) => (
            <article key={item.id} className="rounded-xl border border-white/10 bg-[#111214] p-4 text-sm text-[#9CA3AF]">
              <h3 className="font-semibold text-[#EAEAF0]">{item.title}</h3>
              <p className="mt-2">{item.description}</p>
              <p className="mt-2 text-xs">Evidence required: {item.evidence}</p>
              <p className="mt-2 inline-flex rounded-full bg-white/5 px-2 py-1 text-xs text-[#EAEAF0]">
                Weight: +{item.weight} pts
              </p>
            </article>
          ))}
        </div>
      </div>

      <div className="archon-card p-6">
        <h2 className="text-lg font-semibold text-[#EAEAF0]">Your Applications</h2>
        {!account ? (
          <p className="mt-3 text-sm text-[#9CA3AF]">Connect wallet to view your application history.</p>
        ) : applicationsLoading ? (
          <p className="mt-3 text-sm text-[#9CA3AF]">Loading your applications...</p>
        ) : applications.length === 0 ? (
          <p className="mt-3 text-sm text-[#9CA3AF]">No applications submitted yet.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {applications.map((application) => {
              const badge = statusMeta(application.status);
              const matchedAward = awardByApplication[application.applicationId];
              const reviewerName =
                moderators.find((moderator) => moderator.wallet.toLowerCase() === application.reviewedBy.toLowerCase())?.name ??
                shortAddress(application.reviewedBy);
              return (
                <article key={application.applicationId} className="rounded-xl border border-white/10 bg-[#111214] p-4 text-sm text-[#9CA3AF]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-[#EAEAF0]">Application #{application.applicationId}</p>
                    <span className={`rounded-full px-2 py-1 text-xs ${badge.className}`}>{badge.label}</span>
                  </div>
                  <p className="mt-2 break-words">{application.activityDescription}</p>
                  <p className="mt-1 text-xs">Platform: {application.platform}</p>
                  <p className="mt-1 text-xs">Submitted: {formatTimestamp(application.submittedAt)}</p>
                  {application.evidenceLink ? (
                    <a
                      href={application.evidenceLink}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block break-all text-xs text-[#8FD9FF] underline underline-offset-4"
                    >
                      {application.evidenceLink}
                    </a>
                  ) : null}

                  {application.status === 0 ? (
                    <p className="mt-2 text-xs text-[#9CA3AF]">
                      Under review - moderators typically respond within 48 hours.
                    </p>
                  ) : null}
                  {application.status === 1 ? (
                    <div className="mt-2 space-y-2">
                      <p className="text-xs text-emerald-300">Approved by {reviewerName || "moderator"}.</p>
                      {matchedAward ? (
                        <button
                          type="button"
                          onClick={() => void handleClaim(matchedAward.activityId)}
                          disabled={busyAwardId === matchedAward.activityId}
                          className="archon-button-primary px-3 py-2 text-xs"
                        >
                          {busyAwardId === matchedAward.activityId ? "Claiming..." : "Claim Credential"}
                        </button>
                      ) : (
                        <p className="text-xs text-[#9CA3AF]">
                          Your credential award is being indexed. Refresh in a moment.
                        </p>
                      )}
                    </div>
                  ) : null}
                  {application.status === 2 ? (
                    <div className="mt-2 space-y-2">
                      <p className="text-xs text-rose-200">Rejection note: {application.reviewNote || "No note provided."}</p>
                      <p className="text-xs text-[#9CA3AF]">Submit a new application with stronger evidence.</p>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>

      <div className="archon-card p-6">
        <h2 className="text-lg font-semibold text-[#EAEAF0]">Submit New Technical Application</h2>
        {!hasModerators ? (
          <p className="mt-3 text-sm text-[#9CA3AF]">
            Applications are disabled until at least one active moderator is registered.
          </p>
        ) : !account ? (
          <p className="mt-3 text-sm text-[#9CA3AF]">Connect wallet to submit your application.</p>
        ) : (
          <form onSubmit={handleSubmitApplication} className="mt-4 space-y-3">
            <label className="block text-sm text-[#9CA3AF]">
              What did you contribute?
              <textarea
                className="archon-input mt-1 min-h-28"
                value={activityDescription}
                onChange={(event) => setActivityDescription(event.target.value)}
                placeholder="Describe specifically what you built or contributed. Include: what the project does, what your role was, what problem it solves, and relevant technical details."
                required
              />
            </label>
            <label className="block text-sm text-[#9CA3AF]">
              Select moderator
              {moderators.length === 0 ? (
                <p className="mt-1 text-xs text-[#9CA3AF]">
                  No moderators have been approved yet. Apply to become a moderator above, or contact a platform
                  operator to approve moderators for your contribution type.
                </p>
              ) : (
                <select
                  className="archon-input mt-1"
                  value={selectedModerator}
                  onChange={(event) => setSelectedModerator(event.target.value)}
                >
                  <option value="">Choose a moderator</option>
                  {moderators.map((moderator) => (
                    <option key={moderator.wallet} value={moderator.wallet}>
                      {(moderator.name || shortAddress(moderator.wallet))} — {(moderator.role || "All categories")}
                    </option>
                  ))}
                </select>
              )}
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-[#9CA3AF]">
                Platform
                <select className="archon-input mt-1" value={platform} onChange={(event) => setPlatform(event.target.value)}>
                  {PLATFORMS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-[#9CA3AF]">
                Activity type
                <select
                  className="archon-input mt-1"
                  value={selectedType}
                  onChange={(event) => setSelectedType(Number(event.target.value))}
                >
                  {COMMUNITY_TYPES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-sm text-[#9CA3AF]">
              Evidence Link (Required)
              <input
                className="archon-input mt-1"
                value={evidenceLink}
                onChange={(event) => setEvidenceLink(event.target.value)}
                placeholder="https://..."
                required
              />
              <span className="mt-1 block text-xs">
                This is the most important field. Without a verifiable link, your application cannot be approved.
              </span>
            </label>
            <button type="submit" className="archon-button-primary px-4 py-2.5 text-sm">
              Submit Application
            </button>
            <p className="text-xs text-[#9CA3AF]">
              Application submitted. A moderator will review within 48 hours. You can check the status in
              &nbsp;&quot;Your Applications&quot;&nbsp;above.
            </p>
          </form>
        )}
      </div>

      {activeModerator ? (
        <div className="archon-card p-6">
          <h2 className="text-lg font-semibold text-[#EAEAF0]">Moderator Panel</h2>
          {pendingApplications.length === 0 ? (
            <p className="mt-3 text-sm text-[#9CA3AF]">No pending applications.</p>
          ) : (
            <div className="mt-3 space-y-4">
              {pendingApplications.map((application) => (
                <article key={application.applicationId} className="rounded-xl border border-white/10 bg-[#111214] p-4 text-sm text-[#9CA3AF]">
                  <p className="font-semibold text-[#EAEAF0]">Application #{application.applicationId}</p>
                  <p className="mt-1">Applicant: {shortAddress(application.applicant)}</p>
                  <p className="mt-1">Platform: {application.platform}</p>
                  <p className="mt-1">Submitted: {formatTimestamp(application.submittedAt)}</p>
                  <p className="mt-2 whitespace-pre-wrap break-words">{application.activityDescription}</p>
                  {application.evidenceLink ? (
                    <a
                      href={application.evidenceLink}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-block break-all text-[#8FD9FF] underline underline-offset-4"
                    >
                      {application.evidenceLink}
                    </a>
                  ) : null}

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="block text-xs text-[#9CA3AF]">
                      Activity type
                      <select
                        className="archon-input mt-1"
                        value={reviewTypeById[application.applicationId] ?? 0}
                        onChange={(event) =>
                          setReviewTypeById((previous) => ({
                            ...previous,
                            [application.applicationId]: Number(event.target.value)
                          }))
                        }
                      >
                        {COMMUNITY_TYPES.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-xs text-[#9CA3AF]">
                      Approval note
                      <input
                        className="archon-input mt-1"
                        value={reviewNoteById[application.applicationId] ?? ""}
                        onChange={(event) =>
                          setReviewNoteById((previous) => ({
                            ...previous,
                            [application.applicationId]: event.target.value
                          }))
                        }
                        placeholder="Optional approval note"
                      />
                    </label>
                  </div>

                  <label className="mt-3 block text-xs text-[#9CA3AF]">
                    Rejection note (required for reject)
                    <textarea
                      className="archon-input mt-1 min-h-16"
                      value={rejectNoteById[application.applicationId] ?? ""}
                      onChange={(event) =>
                        setRejectNoteById((previous) => ({
                          ...previous,
                          [application.applicationId]: event.target.value
                        }))
                      }
                      placeholder="Explain why this application is rejected"
                    />
                  </label>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleApprove(application.applicationId)}
                      disabled={busyApplicationId === application.applicationId}
                      className="archon-button-primary px-3 py-2 text-xs"
                    >
                      {busyApplicationId === application.applicationId ? "Processing..." : "Approve"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleReject(application.applicationId)}
                      disabled={busyApplicationId === application.applicationId}
                      className="archon-button-secondary px-3 py-2 text-xs"
                    >
                      {busyApplicationId === application.applicationId ? "Processing..." : "Reject"}
                    </button>
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
