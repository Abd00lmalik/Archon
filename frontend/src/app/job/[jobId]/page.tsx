"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import SignalMap from "@/components/signal-map";
import { UserDisplay } from "@/components/ui/user-display";
import { buildTaskHeatmap, TaskHeatmap } from "@/lib/signal-map";
import {
  deriveDisplayStatus,
  expectedChainId,
  fetchApprovedAgentCount,
  fetchIsInRevealPhase,
  fetchJob,
  fetchJobCredentialCooldownSeconds,
  fetchJobEscrow,
  fetchJobsCreatedCount,
  fetchLastJobCredentialClaim,
  fetchMaxApprovalsForJob,
  fetchRevealPhaseEnd,
  fetchSelectedFinalists,
  fetchSubmissionForAgent,
  fetchSubmissions,
  formatTaskDescription,
  formatTaskTitle,
  formatTimestamp,
  formatUsdc,
  getJobContractAddress,
  getJobReadContract,
  getReadProvider,
  getJobSignalsReadContract,
  getUSDCContract,
  isValidSubmission,
  parseSubmission,
  JobRecord,
  RESPONSE_TYPE,
  SubmissionRecord,
  txAcceptJob,
  txClaimJobCredential,
  txFinalizeWinners,
  txRespondToSubmission,
  txSelectFinalists,
  txSubmitDeliverable,
  ZERO_ADDRESS
} from "@/lib/contracts";
import { useWallet } from "@/lib/wallet-context";

type ViewMode = "signal" | "list" | "timeline";

function errorText(error: unknown, fallback: string) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message?: unknown }).message ?? fallback)
        : fallback;

  if (message.includes("missing revert data") || message.includes("CALL_EXCEPTION")) {
    return (
      "Transaction reverted. Possible causes: deadline has not passed yet, wrong task status, " +
      "or this function does not exist in the deployed contract version. Raw error: " +
      message
    );
  }

  return message;
}

function parseUsdcInput(value: string): bigint | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const [whole, frac = ""] = trimmed.split(".");
  if (!/^\d+$/.test(whole || "0") || !/^\d*$/.test(frac)) return null;
  return BigInt(whole || "0") * 1_000_000n + BigInt(frac.slice(0, 6).padEnd(6, "0"));
}

function contentToURI(content: string): string {
  const json = JSON.stringify({
    content,
    timestamp: Date.now(),
    type: "archon-response"
  });
  return `data:application/json;base64,${btoa(unescape(encodeURIComponent(json)))}`;
}

function DeadlineCountdown({ deadline }: { deadline: number }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    const update = () => {
      const diff = deadline - Date.now() / 1000;
      if (diff <= 0) {
        setRemaining("EXPIRED");
        return;
      }
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = Math.floor(diff % 60);
      setRemaining(h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`);
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);

  return <span className="text-data">{remaining}</span>;
}

function RevealCountdown({ end }: { end: number }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    const update = () => {
      const diff = end - Date.now() / 1000;
      if (diff <= 0) {
        setLabel("Ended");
        return;
      }
      const d = Math.floor(diff / 86400);
      const h = Math.floor((diff % 86400) / 3600);
      const m = Math.floor((diff % 3600) / 60);
      setLabel(d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`);
    };
    update();
    const timer = window.setInterval(update, 10000);
    return () => window.clearInterval(timer);
  }, [end]);
  return <span>{label}</span>;
}

function PhaseBanner({
  job,
  revealEnd,
  awaitingSelection
}: {
  job: JobRecord;
  revealEnd: number;
  awaitingSelection: boolean;
}) {
  const phases = [
    { status: 0, label: "OPEN", desc: "Accepting submissions", color: "var(--pulse)" },
    { status: 1, label: "IN PROGRESS", desc: "Work underway", color: "var(--arc)" },
    { status: 2, label: "SUBMITTED", desc: "Creator reviewing submissions", color: "var(--warn)" },
    { status: 3, label: "SELECTION", desc: "Creator selecting finalists", color: "var(--warn)" },
    { status: 4, label: "REVEAL PHASE", desc: "Critique and build-on window open", color: "var(--arc)" },
    { status: 5, label: "APPROVED", desc: "Winners selected", color: "var(--pulse)" },
    { status: 6, label: "REJECTED", desc: "Task closed", color: "var(--danger)" }
  ];

  const displayStatus = deriveDisplayStatus(job.status, job.deadline, revealEnd);
  const current = phases.find((phase) => phase.status === displayStatus.code) ?? phases[0];
  const revealEnded = displayStatus.label === "Reveal Ended";
  const label = displayStatus.label.toUpperCase();
  const description = awaitingSelection
    ? "Submission deadline passed - awaiting creator finalist selection"
    : revealEnded
      ? "Reveal window closed - awaiting winner finalization"
      : displayStatus.label === "Closed"
        ? "Submission deadline has passed. Awaiting creator to select finalists."
      : current.desc;
  const progress = Math.min(displayStatus.code, 5);

  return (
    <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-center gap-4">
        {phases.slice(0, 6).map((phase, index) => (
          <div key={phase.status} className="flex items-center gap-1">
            <div
              className="h-2 w-2 rounded-full"
              style={{ background: index <= progress ? displayStatus.color : "var(--border-bright)" }}
            />
            {index < 5 ? (
              <div
                className="h-px w-8"
                style={{ background: index < progress ? displayStatus.color : "var(--border)" }}
              />
            ) : null}
          </div>
        ))}
      </div>
      <div className="text-right">
        <div className="font-mono text-xs font-bold tracking-wider" style={{ color: displayStatus.color }}>
          {label}
        </div>
        <div className="text-xs text-[var(--text-secondary)]">{description}</div>
        {displayStatus.code === 4 && !revealEnded && revealEnd > 0 ? (
          <div className="mt-1 text-xs font-mono text-[var(--warn)]">
            Ends: <RevealCountdown end={revealEnd} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FinalistCard({
  agent,
  submission,
  onSelect,
  isWinner,
  rewardAmount,
  onRewardChange,
  buildOnInfo
}: {
  agent: string;
  submission: SubmissionRecord | null;
  onSelect: () => void;
  isWinner: boolean;
  rewardAmount: string;
  onRewardChange: (value: string) => void;
  buildOnInfo?: { parentAgent: string };
}) {
  const deliverable = submission?.deliverableLink ?? "";
  const submittedAt = submission?.submittedAt ?? 0;
  const isBuildOn = Boolean(buildOnInfo);
  const numericReward = Number(rewardAmount || "0");

  return (
    <div
      className={`p-4 border transition-all duration-200 ${
        isWinner
          ? "border-[var(--gold)] bg-[var(--gold)]/5"
          : "border-[var(--border)] hover:border-[var(--border-bright)]"
      }`}
    >
      <div className="flex items-center gap-3 mb-3">
        <UserDisplay address={agent} showAvatar={true} avatarSize={32} className="min-w-0 flex-1" />

        {isBuildOn ? (
          <span className="text-[10px] font-mono px-1.5 py-0.5 border border-[var(--arc)]/40 text-[var(--arc)]">
            BUILD-ON
          </span>
        ) : null}
        {isWinner ? (
          <span className="text-[10px] font-mono px-1.5 py-0.5 border border-[var(--gold)] text-[var(--gold)]">
            WINNER
          </span>
        ) : null}
      </div>

      {deliverable ? (
        <div className="mb-3">
          <div className="text-[10px] font-mono text-[var(--text-muted)] mb-1">DELIVERABLE</div>
          <a
            href={deliverable}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-[var(--arc)] hover:underline break-all flex items-center gap-1"
          >
            {deliverable.slice(0, 60)}
            {deliverable.length > 60 ? "..." : ""} ↗
          </a>
        </div>
      ) : (
        <div className="mb-3 text-xs text-[var(--text-muted)]">No deliverable link available</div>
      )}

      {submittedAt > 0 ? (
        <div className="text-[10px] font-mono text-[var(--text-muted)] mb-3">
          Submitted: {new Date(Number(submittedAt) * 1000).toLocaleString()}
        </div>
      ) : null}

      {isBuildOn && numericReward > 0 ? (
        <div className="mb-3 p-2 border border-[var(--arc)]/20 bg-[var(--arc)]/5">
          <div className="text-[10px] font-mono text-[var(--arc)] mb-1">REWARD SPLIT (BUILD-ON)</div>
          <div className="text-[10px] font-mono text-[var(--text-secondary)]">
            {buildOnInfo?.parentAgent.slice(0, 8)}... → {(numericReward * 0.7).toFixed(2)} USDC (70%)
          </div>
          <div className="text-[10px] font-mono text-[var(--text-secondary)]">
            {agent.slice(0, 8)}... → {(numericReward * 0.3).toFixed(2)} USDC (30%)
          </div>
        </div>
      ) : null}

      <div className="mb-3">
        <div className="text-[10px] font-mono text-[var(--text-muted)] mb-1">ALLOCATE REWARD (USDC)</div>
        <input
          type="number"
          className="input-field text-xs py-2"
          placeholder="0.00"
          value={rewardAmount}
          onChange={(event) => onRewardChange(event.target.value)}
          min="0"
          step="0.1"
        />
      </div>

      <button
        type="button"
        onClick={onSelect}
        className={`w-full text-xs py-2 font-mono font-600 tracking-wider transition-all border ${
          isWinner
            ? "border-[var(--gold)] text-[var(--gold)] bg-[var(--gold)]/10"
            : "border-[var(--border-bright)] text-[var(--text-secondary)] hover:border-[var(--arc)] hover:text-[var(--arc)]"
        }`}
      >
        {isWinner ? "✓ SELECTED AS WINNER" : "SELECT AS WINNER"}
      </button>
    </div>
  );
}

function FinalistSelectionPanel({
  submissions,
  maxApprovals,
  submitting,
  error,
  onSubmit
}: {
  submissions: SubmissionRecord[];
  maxApprovals: number;
  submitting: boolean;
  error: string | null;
  onSubmit: (agents: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const maxFinalists = maxApprovals + 5;

  const toggle = (agent: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(agent)) {
        next.delete(agent);
      } else if (next.size < maxFinalists) {
        next.add(agent);
      }
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="section-header">SELECT FINALISTS</div>
      <div className="border border-[#162334] px-3 py-2 text-xs text-[#7A9BB5]">
        Choose up to {maxFinalists} submissions to advance to the 5-day reveal phase. Only finalists will be visible
        for critique and build-ons.
        <br />
        <strong style={{ color: "#00E5FF" }}>
          Selected: {selected.size} / {maxFinalists}
        </strong>
      </div>

      <div className="space-y-2">
        {submissions.length === 0 ? (
          <div className="border border-[var(--border)] p-3 text-xs text-[var(--text-muted)]">
            No valid submissions available for finalist selection.
          </div>
        ) : null}
        {submissions.map((submission, index) => {
          const agent = submission.agent ?? "";
          const chosen = selected.has(agent);
          return (
            <div
              key={`${agent}-${index}`}
              onClick={() => toggle(agent)}
              className="cursor-pointer border p-3 transition-all"
              style={{
                borderColor: chosen ? "#00E5FF" : "#1E3347",
                background: chosen ? "rgba(0,229,255,0.06)" : "transparent"
              }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="flex h-4 w-4 shrink-0 items-center justify-center border"
                  style={{
                    borderColor: chosen ? "#00E5FF" : "#3D5A73",
                    background: chosen ? "#00E5FF" : "transparent"
                  }}
                >
                  {chosen ? <span style={{ color: "#020608", fontSize: 10, fontWeight: 700 }}>✓</span> : null}
                </div>

                <UserDisplay address={agent} showAvatar={true} avatarSize={30} className="min-w-0 flex-1" />

                {submission.deliverableLink ? (
                  <a
                    href={submission.deliverableLink}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="shrink-0 font-mono text-xs text-[var(--arc)] hover:underline"
                  >
                    View ↗
                  </a>
                ) : null}

                <div className="shrink-0 text-[10px] font-mono text-[#3D5A73]">
                  {submission.submittedAt > 0 ? new Date(submission.submittedAt * 1000).toLocaleDateString() : ""}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {error ? <div className="text-xs text-[var(--danger)]">{error}</div> : null}

      <button
        type="button"
        className="btn-primary w-full"
        onClick={() => onSubmit(Array.from(selected))}
        disabled={selected.size === 0 || submitting}
      >
        {submitting
          ? "Starting Reveal Phase..."
          : `Start Reveal Phase with ${selected.size} Finalist${selected.size === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}

export default function JobDetailsPage() {
  const params = useParams<{ jobId: string }>();
  const router = useRouter();
  const { account, browserProvider, connect, signer } = useWallet();
  const jobId = useMemo(() => Number(params.jobId), [params.jobId]);

  const [job, setJob] = useState<JobRecord | null>(null);
  const [jobLoading, setJobLoading] = useState(true);
  const [jobError, setJobError] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([]);
  const [mySubmission, setMySubmission] = useState<SubmissionRecord | null>(null);
  const [selectedSubmission, setSelectedSubmission] = useState<SubmissionRecord | null>(null);
  const [isAccepted, setIsAccepted] = useState(false);
  const [maxApprovals, setMaxApprovals] = useState(1);
  const [approvalsUsed, setApprovalsUsed] = useState(0);
  const [creatorPostedCount, setCreatorPostedCount] = useState(0);
  const [escrowLocked, setEscrowLocked] = useState(0n);

  const [selectedFinalists, setSelectedFinalists] = useState<string[]>([]);
  const [buildOnParents, setBuildOnParents] = useState<Record<string, string>>({});
  const [revealPhaseEnd, setRevealPhaseEnd] = useState(0);
  const [isRevealPhase, setIsRevealPhase] = useState(false);

  const [heatmap, setHeatmap] = useState<TaskHeatmap>({
    people: [],
    totalActivity: 0,
    revealPhaseEnd: 0,
    isRevealPhase: false
  });
  const [heatmapLoading, setHeatmapLoading] = useState(true);
  const [finalistSubmissions, setFinalistSubmissions] = useState<Record<string, SubmissionRecord | null>>({});
  const [viewMode, setViewMode] = useState<ViewMode>("signal");
  const [submissionFilterAddress, setSubmissionFilterAddress] = useState("");
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [mapDimensions, setMapDimensions] = useState({ w: 640, h: 380 });

  const [deliverableLink, setDeliverableLink] = useState("");
  const [responseType, setResponseType] = useState<number>(RESPONSE_TYPE.BuildsOn);
  const [responseContent, setResponseContent] = useState("");
  const [showResponsePanel, setShowResponsePanel] = useState(false);
  const [rewardInputs, setRewardInputs] = useState<Record<string, string>>({});

  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [busyAction, setBusyAction] = useState("");

  const [claimReadyAt, setClaimReadyAt] = useState<number | null>(null);
  const [claimCountdown, setClaimCountdown] = useState(0);

  const isConnected = Boolean(account);
  const isCreator = Boolean(account && job && account.toLowerCase() === job.client.toLowerCase());

  const safeSubmissions = useMemo(
    () =>
      (submissions ?? [])
        .filter((submission) => isValidSubmission(submission))
        .map((submission) => {
          try {
            return parseSubmission(submission as unknown);
          } catch {
            return null;
          }
        })
        .filter((submission): submission is SubmissionRecord => Boolean(submission && isValidSubmission(submission))),
    [submissions]
  );

  const pendingSubmissions = useMemo(
    () => safeSubmissions.filter((submission) => submission.status === 1),
    [safeSubmissions]
  );

  const filteredListSubmissions = useMemo(() => {
    if (!submissionFilterAddress) return safeSubmissions;
    return safeSubmissions.filter(
      (submission) => submission.agent.toLowerCase() === submissionFilterAddress.toLowerCase()
    );
  }, [safeSubmissions, submissionFilterAddress]);

  const finalistSet = useMemo(
    () => new Set(selectedFinalists.map((address) => address.toLowerCase())),
    [selectedFinalists]
  );

  const withProvider = async () => {
    const provider = browserProvider ?? (await connect());
    if (!provider) throw new Error("Wallet connection was not established.");
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== expectedChainId) {
      throw new Error(`Switch wallet network to chain ID ${expectedChainId}.`);
    }
    return provider;
  };

  const loadTask = useCallback(async () => {
    if (!Number.isInteger(jobId) || jobId < 0) {
      setJobLoading(false);
      setJobError(`Invalid task ID: ${params.jobId}`);
      setJob(null);
      return;
    }

    setJobLoading(true);
    setJobError(null);

    try {
      const [jobData, rawSubmissions, escrow, used, maxAllowed, finals, revealEnd, revealOpen] =
        await Promise.all([
          fetchJob(jobId),
          fetchSubmissions(jobId),
          fetchJobEscrow(jobId),
          fetchApprovedAgentCount(jobId),
          fetchMaxApprovalsForJob(jobId),
          fetchSelectedFinalists(jobId),
          fetchRevealPhaseEnd(jobId),
          fetchIsInRevealPhase(jobId)
        ]);

      if (!jobData) {
        setJobError(`Task #${jobId} not found`);
        setJob(null);
        return;
      }

      const contract = getJobSignalsReadContract();
      const parentEntries = await Promise.all(
        finals.map(async (finalist) => {
          try {
            const parent = String(await contract.buildOnParentByResponder(jobId, finalist));
            return [finalist.toLowerCase(), parent] as const;
          } catch {
            return [finalist.toLowerCase(), ZERO_ADDRESS] as const;
          }
        })
      );

      setJob({ ...jobData, revealPhaseEnd: BigInt(revealEnd || 0) });
      setSubmissions(rawSubmissions);
      setEscrowLocked(escrow);
      setApprovalsUsed(used);
      setMaxApprovals(Math.max(1, maxAllowed || 1));
      setSelectedFinalists(finals);
      setRevealPhaseEnd(revealEnd);
      setIsRevealPhase(revealOpen);
      setCreatorPostedCount(await fetchJobsCreatedCount(jobData.client));
      setBuildOnParents(
        parentEntries.reduce<Record<string, string>>((acc, [key, value]) => {
          acc[key] = value;
          return acc;
        }, {})
      );

      if (account) {
        const readContract = getJobReadContract();
        const [accepted, mine, lastClaim, cooldown] = await Promise.all([
          readContract.isAccepted(jobId, account).catch(() => false),
          fetchSubmissionForAgent(jobId, account),
          fetchLastJobCredentialClaim(account),
          fetchJobCredentialCooldownSeconds()
        ]);
        setIsAccepted(Boolean(accepted));
        setMySubmission(mine);
        setClaimReadyAt(Number(lastClaim) + cooldown);
      } else {
        setIsAccepted(false);
        setMySubmission(null);
        setClaimReadyAt(null);
      }
    } catch (error) {
      console.error("[task] load error:", error);
      setJob(null);
      setJobError(errorText(error, "Failed to load task"));
    } finally {
      setJobLoading(false);
    }
  }, [account, jobId, params.jobId]);

  const loadHeatmap = useCallback(async () => {
    if (!Number.isInteger(jobId) || jobId < 0) return;
    setHeatmapLoading(true);
    try {
      const provider = browserProvider ?? getReadProvider();
      const data = await buildTaskHeatmap(provider, Number(jobId));
      setHeatmap(data);
    } catch (error) {
      console.warn("[heatmap] load error:", error);
      setHeatmap({ people: [], totalActivity: 0, revealPhaseEnd: 0, isRevealPhase: false });
    } finally {
      setHeatmapLoading(false);
    }
  }, [browserProvider, jobId]);

  useEffect(() => {
    void loadTask();
    void loadHeatmap();
  }, [loadTask, loadHeatmap]);

  useEffect(() => {
    const element = mapContainerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setMapDimensions({
        w: Math.max(320, Math.floor(entry.contentRect.width)),
        h: Math.max(320, Math.floor(entry.contentRect.height))
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!claimReadyAt) return;
    const update = () => setClaimCountdown(Math.max(0, claimReadyAt - Math.floor(Date.now() / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [claimReadyAt]);

  useEffect(() => {
    if (!Number.isInteger(jobId) || jobId < 0) return () => undefined;
    const contract = getJobSignalsReadContract();
    const refresh = async (id: bigint | number) => {
      if (Number(id) === jobId) {
        await loadTask();
        await loadHeatmap();
      }
    };
    const onSubmission = async (id: bigint) => refresh(id);
    const onResponse = async (id: bigint) => refresh(id);
    const onFinalists = async (id: bigint) => refresh(id);
    const onWinners = async (id: bigint) => refresh(id);
    contract.on("DeliverableSubmitted", onSubmission);
    contract.on("SubmissionResponseAdded", onResponse);
    contract.on("FinalistsSelected", onFinalists);
    contract.on("WinnersFinalized", onWinners);
    return () => {
      contract.off("DeliverableSubmitted", onSubmission);
      contract.off("SubmissionResponseAdded", onResponse);
      contract.off("FinalistsSelected", onFinalists);
      contract.off("WinnersFinalized", onWinners);
    };
  }, [jobId, loadTask, loadHeatmap]);

  useEffect(() => {
    if (!selectedFinalists.length) {
      setFinalistSubmissions({});
      return;
    }

    let active = true;
    const loadFinalists = async () => {
      const contract = getJobReadContract();
      const byAgent: Record<string, SubmissionRecord | null> = {};
      let cachedAllSubmissions: SubmissionRecord[] | null = null;

      for (const agent of selectedFinalists) {
        const key = agent.toLowerCase();
        try {
          const raw = await contract.getSubmission(jobId, agent);
          byAgent[key] = parseSubmission(raw);
          continue;
        } catch {
          // Try fallback below.
        }

        try {
          if (!cachedAllSubmissions) {
            cachedAllSubmissions = await fetchSubmissions(jobId);
          }
          byAgent[key] =
            cachedAllSubmissions.find(
              (submission) => submission.agent.toLowerCase() === agent.toLowerCase()
            ) ?? null;
        } catch {
          byAgent[key] = null;
        }
      }

      if (active) setFinalistSubmissions(byAgent);
    };

    void loadFinalists();
    return () => {
      active = false;
    };
  }, [jobId, selectedFinalists]);

  const handleAccept = async () => {
    try {
      setBusyAction("accept");
      const provider = await withProvider();
      const tx = await txAcceptJob(provider, jobId);
      setStatusMessage(`Accept tx: ${tx.hash}`);
      await tx.wait();
      await loadTask();
    } catch (error) {
      setErrorMessage(errorText(error, "Failed to accept task"));
    } finally {
      setBusyAction("");
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      setBusyAction("submit");
      const provider = await withProvider();
      const tx = await txSubmitDeliverable(provider, jobId, deliverableLink.trim());
      setStatusMessage(`Submit tx: ${tx.hash}`);
      await tx.wait();
      setDeliverableLink("");
      await loadTask();
      await loadHeatmap();
    } catch (error) {
      setErrorMessage(errorText(error, "Failed to submit work"));
    } finally {
      setBusyAction("");
    }
  };

  const handleRespond = async () => {
    if (!selectedSubmission) return;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const revealEnd = Number(revealPhaseEnd || Number(job?.revealPhaseEnd ?? 0n));
    const isRevealActive = Boolean(job?.status === 4 && revealEnd > 0 && nowSeconds <= revealEnd);

    console.log("[respond] signer:", Boolean(signer));
    console.log("[respond] revealPhaseEnd:", revealEnd.toString());
    console.log("[respond] job.status:", job?.status);
    console.log("[respond] responseContent:", responseContent?.length ?? 0);
    console.log("[respond] responseType:", responseType);

    if (!signer) {
      alert("Wallet not connected");
      return;
    }
    if (!responseContent || responseContent.trim().length < 10) {
      alert("Response content too short");
      return;
    }

    try {
      setBusyAction("respond");
      await withProvider();
      if (!isRevealActive) {
        alert("Interactions are only available during reveal phase");
        return;
      }

      const usdcContract = getUSDCContract(signer);
      const responseStake = 2_000_000n;
      const signerAddress = await signer.getAddress();
      const jobContractAddress = getJobContractAddress();
      const allowance = (await usdcContract.allowance(signerAddress, jobContractAddress)) as bigint;
      if (allowance < responseStake) {
        console.log("[respond] Approving USDC...");
        const approveTx = await usdcContract.approve(jobContractAddress, responseStake);
        await approveTx.wait();
        console.log("[respond] USDC approved");
      }

      const contentUri = contentToURI(responseContent.trim());
      const txHash = await txRespondToSubmission(
        signer,
        BigInt(selectedSubmission.submissionId),
        responseType,
        contentUri
      );
      setStatusMessage(`Response tx: ${txHash}`);
      setResponseContent("");
      setShowResponsePanel(false);
      await loadHeatmap();
      await loadTask();
    } catch (error) {
      setErrorMessage(errorText(error, "Failed to submit response"));
    } finally {
      setBusyAction("");
    }
  };

  const handleSelectFinalists = async (agents: string[]) => {
    if (!agents.length) return;
    try {
      setBusyAction("select");
      const provider = await withProvider();
      const activeSigner = await provider.getSigner();
      const unique = [
        ...new Set(
          agents
            .map((address) => address.toLowerCase())
            .map((address) => safeSubmissions.find((submission) => submission.agent.toLowerCase() === address)?.agent)
            .filter((value): value is string => Boolean(value))
        )
      ];
      const txHash = await txSelectFinalists(activeSigner, BigInt(jobId), unique);
      setStatusMessage(`Finalists tx: ${txHash}`);
      await loadTask();
      await loadHeatmap();
    } catch (error) {
      setErrorMessage(errorText(error, "Failed selecting finalists"));
    } finally {
      setBusyAction("");
    }
  };

  const handleAutoStartReveal = async () => {
    if (!signer) {
      setErrorMessage("Connect wallet to start reveal phase.");
      return;
    }
    try {
      setBusyAction("autoReveal");
      const allAgents = [
        ...new Set(
          safeSubmissions
            .map((submission) => submission.agent)
            .filter((agent) => agent && agent.toLowerCase() !== ZERO_ADDRESS.toLowerCase())
        )
      ];
      console.log("[autoReveal] Calling selectFinalists with:", allAgents);
      if (!allAgents.length) {
        throw new Error("No valid submissions available to promote.");
      }
      const txHash = await txSelectFinalists(signer, BigInt(jobId), allAgents);
      setStatusMessage(`Reveal phase started via selectFinalists: ${txHash}`);
      await loadTask();
      await loadHeatmap();
    } catch (error) {
      setErrorMessage(errorText(error, "Failed to start auto-reveal"));
    } finally {
      setBusyAction("");
    }
  };

  const handleFinalizeWinners = async () => {
    try {
      setBusyAction("finalize");
      const winners: string[] = [];
      const amounts: bigint[] = [];
      for (const finalist of selectedFinalists) {
        const parsed = parseUsdcInput(rewardInputs[finalist.toLowerCase()] ?? "");
        if (parsed && parsed > 0n) {
          winners.push(finalist);
          amounts.push(parsed);
        }
      }
      const provider = await withProvider();
      const tx = await txFinalizeWinners(provider, jobId, winners, amounts);
      setStatusMessage(`Finalize tx: ${tx.hash}`);
      await tx.wait();
      await loadTask();
      await loadHeatmap();
    } catch (error) {
      setErrorMessage(errorText(error, "Failed to finalize winners"));
    } finally {
      setBusyAction("");
    }
  };

  const handleClaim = async () => {
    try {
      setBusyAction("claim");
      const provider = await withProvider();
      const tx = await txClaimJobCredential(provider, jobId);
      setStatusMessage(`Claim tx: ${tx.hash}`);
      await tx.wait();
      await loadTask();
    } catch (error) {
      setErrorMessage(errorText(error, "Failed to claim reward"));
    } finally {
      setBusyAction("");
    }
  };

  const hasSubmitted = Boolean(mySubmission && mySubmission.status !== 0);
  const isApproved = mySubmission?.status === 2;
  const isClaimed = Boolean(mySubmission?.credentialClaimed);
  const canClaim = isConnected && !isCreator && isApproved && !isClaimed && claimCountdown <= 0;

  const revealEndValue = revealPhaseEnd || Number(job?.revealPhaseEnd ?? 0n);
  const displayStatus = job ? deriveDisplayStatus(job.status, job.deadline, revealEndValue) : null;
  const revealEnded = Boolean(job?.status === 4 && revealEndValue > 0 && Math.floor(Date.now() / 1000) > revealEndValue);
  const submissionDeadlinePassed = Boolean(
    job && job.deadline > 0 && BigInt(Math.floor(Date.now() / 1000)) > BigInt(job.deadline)
  );
  const awaitingSelection = Boolean(job && submissionDeadlinePassed && (job.status === 2 || job.status === 0 || job.status === 1));
  const canAutoReveal = Boolean(
    job &&
      submissionDeadlinePassed &&
      (job.status === 0 || job.status === 1 || job.status === 2) &&
      safeSubmissions.length > 0 &&
      safeSubmissions.length <= maxApprovals + 5 &&
      selectedFinalists.length === 0
  );
  const nowSeconds = Math.floor(Date.now() / 1000);
  const isRevealActive = Boolean(job?.status === 4 && revealEndValue > 0 && nowSeconds <= revealEndValue);
  const shouldShowSignalMap = Boolean(job?.status === 4 || job?.status === 5);
  const isSelectedFinalist = Boolean(
    selectedSubmission && finalistSet.has(selectedSubmission.agent.toLowerCase())
  );
  const canInteract = Boolean(isRevealActive && signer && isConnected && selectedSubmission && isSelectedFinalist);

  useEffect(() => {
    console.log("[revealCheck]", {
      jobStatus: job?.status,
      revealPhaseEnd: revealEndValue,
      nowSeconds: Math.floor(Date.now() / 1000),
      isRevealActive,
      hasSigner: Boolean(signer),
      contentLength: responseContent?.length ?? 0
    });
  }, [job?.status, revealEndValue, isRevealActive, signer, responseContent]);

  if (jobLoading) {
    return (
      <div className="page-container flex min-h-[40vh] items-center justify-center">
        <div className="flex items-center gap-3 font-mono text-sm text-[var(--text-secondary)]">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--arc-dim)] border-t-[var(--arc)]" />
          Loading task #{jobId}...
        </div>
      </div>
    );
  }

  if (jobError || !job) {
    return (
      <div className="page-container flex min-h-[40vh] items-center justify-center">
        <div className="text-center">
          <div className="mb-2 font-mono text-sm text-[var(--danger)]">{jobError ?? "Task not found"}</div>
          <button type="button" onClick={() => router.back()} className="btn-ghost text-xs">
            {"<- Go back"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="page-container space-y-6">
      {statusMessage ? (
        <div className="panel border-[var(--pulse)] py-3 text-sm text-[var(--pulse)]">{statusMessage}</div>
      ) : null}
      {errorMessage ? (
        <div className="panel border-[var(--danger)] py-3 text-sm text-[var(--danger)]">{errorMessage}</div>
      ) : null}

      <PhaseBanner job={job} revealEnd={revealEndValue} awaitingSelection={awaitingSelection} />

      <div className="border-b border-[var(--border)] pb-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="text-sm font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              {"<- TASKS"}
            </button>
            <span className="text-sm font-mono text-[var(--border-bright)]">/</span>
            <span className="text-xs font-mono text-[var(--text-muted)]">#{job.jobId}</span>
          </div>
          <span className="badge mono border" style={{ color: displayStatus?.color, borderColor: displayStatus?.color, background: "transparent" }}>
            {displayStatus?.label}
          </span>
        </div>

        <div className="flex items-start justify-between gap-6">
            <h1 className="text-heading-1 flex-1">{formatTaskTitle(job.title)}</h1>
          <div className="text-right">
            <div className="font-heading text-[var(--gold)]" style={{ fontSize: "clamp(24px, 3vw, 36px)", fontWeight: 700 }}>
              {formatUsdc(job.rewardUSDC)} USDC
            </div>
            <div className="text-label mt-1 text-[var(--text-muted)]">Reward Pool</div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-6 border-t border-[var(--border)] pt-4">
          <div className="flex items-center gap-2"><span className="text-label">BY</span><UserDisplay address={job.client} showAvatar={true} avatarSize={24} /></div>
          <div className="flex items-center gap-2"><span className="text-label">DEADLINE</span><DeadlineCountdown deadline={job.deadline} /></div>
          <div className="flex items-center gap-2"><span className="text-label">SUBMISSIONS</span><span className="text-data">{job.submissionCount}</span></div>
          <div className="flex items-center gap-2"><span className="text-label">MAX WINNERS</span><span className="text-data">{maxApprovals}</span></div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_320px]">
        <aside className="panel h-fit space-y-6">
          <div><div className="section-header">DESCRIPTION</div><p className="text-sm text-[var(--text-secondary)]">{formatTaskDescription(job.description)}</p></div>
          <div><div className="section-header">METADATA</div><div className="space-y-2 text-xs"><div className="flex justify-between"><span className="text-[var(--text-muted)]">Creator</span><UserDisplay address={job.client} showAvatar={true} avatarSize={22} /></div><div className="flex justify-between"><span className="text-[var(--text-muted)]">Tasks posted</span><span className="font-mono">{creatorPostedCount}</span></div><div className="flex justify-between"><span className="text-[var(--text-muted)]">Created</span><span className="font-mono">{formatTimestamp(job.createdAt)}</span></div></div></div>
          <div><div className="section-header">REWARD BREAKDOWN</div><div className="space-y-2 text-xs"><div className="flex justify-between"><span className="text-[var(--text-muted)]">Total pool</span><span className="font-mono text-[var(--gold)]">{formatUsdc(job.rewardUSDC)} USDC</span></div><div className="flex justify-between"><span className="text-[var(--text-muted)]">Escrow locked</span><span className="font-mono">{formatUsdc(escrowLocked)} USDC</span></div><div className="flex justify-between"><span className="text-[var(--text-muted)]">Approval slots</span><span className="font-mono">{approvalsUsed}/{maxApprovals}</span></div></div></div>
        </aside>

        <div className="space-y-4">
          <div className="panel-elevated flex gap-2">
            <button
              type="button"
              className={viewMode === "signal" ? "btn-primary px-3 py-2 text-xs" : "btn-ghost px-3 py-2 text-xs"}
              onClick={() => setViewMode("signal")}
            >
              SIGNAL MAP
            </button>
            <button
              type="button"
              className={viewMode === "list" ? "btn-primary px-3 py-2 text-xs" : "btn-ghost px-3 py-2 text-xs"}
              onClick={() => setViewMode("list")}
            >
              LIST
            </button>
            <button
              type="button"
              className={viewMode === "timeline" ? "btn-primary px-3 py-2 text-xs" : "btn-ghost px-3 py-2 text-xs"}
              onClick={() => setViewMode("timeline")}
            >
              TIMELINE
            </button>
          </div>

          {isCreator && job.status === 4 ? (
            <div className="border border-[var(--border)] p-3 text-xs text-[var(--text-secondary)]">
              Finalist submissions are now visible to all participants. The 5-day interaction window is open for
              critiques and build-ons. After it closes, select final winners - you can choose any finalist regardless
              of interaction signals.
            </div>
          ) : null}

          {viewMode === "signal" ? (
            <div className="panel">
              {isRevealActive && isRevealPhase ? (
                <div className="mb-3 flex items-center gap-2">
                  <span className="live-dot" />
                  <span className="text-xs font-mono text-[var(--pulse)]">LIVE - updates as submissions arrive</span>
                </div>
              ) : null}

              {shouldShowSignalMap ? (
                <div ref={mapContainerRef} className="w-full" style={{ minHeight: 380 }}>
                  <SignalMap
                    heatmap={heatmap}
                    loading={heatmapLoading}
                    containerWidth={Math.max(300, mapDimensions.w - 4)}
                    containerHeight={Math.max(320, mapDimensions.h)}
                    onViewSubmissions={(address) => {
                      setSubmissionFilterAddress(address);
                      setViewMode("list");
                    }}
                  />
                </div>
              ) : (
                <div className="flex items-center justify-center h-48 text-[var(--text-muted)] font-mono text-xs text-center p-6">
                  <div>
                    <div className="text-2xl mb-3 opacity-20">⬡</div>
                    Signal map is only available during the reveal phase.
                    {job?.status === 2 ? " Creator is selecting finalists." : ""}
                    {job?.status === 0 ? " Task is still accepting submissions." : ""}
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {viewMode === "list" ? (
            !isCreator && !shouldShowSignalMap ? (
              <div className="flex h-48 flex-col items-center justify-center border border-[var(--border)] p-6 text-center">
                <div className="mb-3 font-mono text-2xl text-[var(--arc)]">⬡</div>
                <div className="font-heading mb-2 text-base font-semibold">Submissions are sealed</div>
                <div className="max-w-xs text-sm text-[var(--text-secondary)]">
                  Submissions are hidden until the creator selects finalists and opens the 5-day reveal phase. This
                  prevents copying and ensures independent solutions.
                </div>
                {submissionDeadlinePassed ? (
                  <div className="mt-3 text-xs font-mono text-[var(--warn)]">
                    Submission deadline passed - Awaiting creator to select finalists
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-3">
                {submissionFilterAddress ? (
                  <div className="flex items-center justify-between border border-[var(--border)] p-2 text-xs">
                    <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                      <span>Showing submissions from</span>
                      <UserDisplay address={submissionFilterAddress} showAvatar={true} avatarSize={18} />
                    </div>
                    <button
                      type="button"
                      className="btn-ghost px-2 py-1 text-[10px]"
                      onClick={() => setSubmissionFilterAddress("")}
                    >
                      Clear Filter
                    </button>
                  </div>
                ) : null}

                {filteredListSubmissions.length === 0 ? (
                  <div className="p-4 text-xs font-mono text-[var(--text-muted)]">No submissions to display</div>
                ) : (
                  filteredListSubmissions.map((submission) => (
                    <article key={`${submission.agent}-${submission.submissionId}`} className="card-sharp space-y-2 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <UserDisplay address={submission.agent} showAvatar={true} avatarSize={28} className="min-w-0" />
                        <span className="badge badge-arc">
                          {submission.status === 2
                            ? "APPROVED"
                            : submission.status === 1
                              ? "SUBMITTED"
                              : "PENDING"}
                        </span>
                      </div>

                      {submission.deliverableLink ? (
                        <a
                          href={submission.deliverableLink}
                          target="_blank"
                          rel="noreferrer"
                          className="break-all text-xs font-mono text-[var(--arc)] underline"
                        >
                          {submission.deliverableLink}
                        </a>
                      ) : (
                        <div className="text-xs text-[var(--text-muted)]">No deliverable link provided</div>
                      )}

                      {!isCreator && isRevealActive ? (
                        <button
                          type="button"
                          className="btn-ghost w-full text-xs"
                          onClick={() => setSelectedSubmission(submission)}
                        >
                          {selectedSubmission?.submissionId === submission.submissionId
                            ? "Selected for Response"
                            : "Select for Response"}
                        </button>
                      ) : null}
                    </article>
                  ))
                )}
              </div>
            )
          ) : null}

          {viewMode === "timeline" ? (
            <div className="panel space-y-2">
              {safeSubmissions.map((submission) => (
                <div
                  key={`timeline-${submission.submissionId}`}
                  className="card-sharp flex items-center justify-between px-3 py-2 text-xs gap-3"
                >
                  <UserDisplay address={submission.agent} showAvatar={true} avatarSize={24} />
                  <span className="font-mono text-[var(--text-muted)]">{formatTimestamp(submission.submittedAt)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <aside className="panel h-fit space-y-4">
          {!isConnected ? (
            <>
              <div className="section-header">CONNECT WALLET</div>
              <button type="button" className="btn-primary w-full" onClick={() => void connect()}>
                Connect Wallet
              </button>
            </>
          ) : null}

          {canAutoReveal ? (
            <div
              className="border p-4"
              style={{
                borderColor: "color-mix(in srgb, var(--arc) 35%, transparent)",
                background: "color-mix(in srgb, var(--arc) 8%, transparent)"
              }}
            >
              <div
                style={{
                  fontFamily: "Space Grotesk, sans-serif",
                  fontWeight: 600,
                  fontSize: 14,
                  color: "var(--text-primary)",
                  marginBottom: 8
                }}
              >
                Deadline Passed - Auto-Start Available
              </div>
              <div
                style={{
                  fontFamily: "Inter, sans-serif",
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  marginBottom: 12,
                  lineHeight: 1.5
                }}
              >
                This task has {safeSubmissions.length} submission{safeSubmissions.length !== 1 ? "s" : ""} - under
                the {maxApprovals + 5} finalist threshold. The deployed contract does not expose autoStartReveal, so
                Archon will call selectFinalists with every valid submission and begin the reveal phase that way.
              </div>
              <button
                type="button"
                className="btn-primary w-full"
                onClick={() => void handleAutoStartReveal()}
                disabled={busyAction === "autoReveal" || !signer}
              >
                {busyAction === "autoReveal" ? "Starting..." : "Start Reveal Phase Automatically"}
              </button>
              {!signer ? (
                <div className="mt-2 text-[11px] font-mono text-[var(--text-muted)]">
                  Connect wallet to submit the transaction.
                </div>
              ) : null}
            </div>
          ) : null}

          {isConnected && !isCreator ? (
            <>
              <div className="section-header">YOUR ACTIONS</div>

              {!isAccepted ? (
                <button
                  type="button"
                  className="btn-primary w-full"
                  onClick={() => void handleAccept()}
                  disabled={busyAction === "accept"}
                >
                  {busyAction === "accept" ? "Accepting..." : "Accept Task"}
                </button>
              ) : null}

              {isAccepted && !hasSubmitted ? (
                <form className="space-y-3" onSubmit={handleSubmit}>
                  <input
                    type="url"
                    className="input-field"
                    placeholder="https://github.com/... or ipfs://..."
                    value={deliverableLink}
                    onChange={(event) => setDeliverableLink(event.target.value)}
                  />
                  <button
                    type="submit"
                    className="btn-primary w-full"
                    disabled={busyAction === "submit" || !deliverableLink.trim()}
                  >
                    {busyAction === "submit" ? "Submitting..." : "Submit Work"}
                  </button>
                </form>
              ) : null}

              {canClaim ? (
                <button
                  type="button"
                  className="btn-primary w-full"
                  onClick={() => void handleClaim()}
                  disabled={busyAction === "claim"}
                >
                  {busyAction === "claim" ? "Claiming..." : `Claim ${formatUsdc(mySubmission?.allocatedReward ?? 0)} USDC`}
                </button>
              ) : null}
              {claimCountdown > 0 ? (
                <p className="text-xs text-[var(--warn)]">Claim in {Math.floor(claimCountdown / 60)}m</p>
              ) : null}

              {job.status !== 4 ? (
                <div className="text-xs text-[var(--text-muted)] font-mono p-3 border border-[var(--border)]">
                  {job.status === 0 && !submissionDeadlinePassed ? "Interactions open after reveal phase starts" : ""}
                  {job.status === 1 && !submissionDeadlinePassed ? "Interactions open after creator selects finalists" : ""}
                  {(job.status === 0 || job.status === 1) && submissionDeadlinePassed
                    ? "Submission deadline has passed. Awaiting creator to select finalists."
                    : ""}
                  {job.status === 2 ? "Creator is reviewing submissions" : ""}
                  {job.status === 3 ? "Creator is selecting finalists" : ""}
                  {job.status === 5 ? "Task is finalized" : ""}
                  {job.status === 6 ? "Task is rejected/closed" : ""}
                </div>
              ) : null}

              {job.status === 4 && selectedSubmission ? (
                <>
                  <button
                    type="button"
                    className="btn-ghost w-full"
                    onClick={() => setShowResponsePanel((value) => !value)}
                  >
                    {showResponsePanel ? "Close Response Panel" : "Respond to Selected Submission"}
                  </button>

                  {showResponsePanel ? (
                    <div className="card-sharp space-y-3 p-4">
                      <div className="text-xs text-[var(--text-secondary)]">
                        <span className="mr-2">Target:</span>
                        <UserDisplay address={selectedSubmission.agent} showAvatar={true} avatarSize={20} />
                      </div>

                      <div className="grid grid-cols-3 gap-1">
                        {[
                          { type: RESPONSE_TYPE.BuildsOn, label: "BUILDS ON", color: "var(--arc)" },
                          { type: RESPONSE_TYPE.Critiques, label: "CRITIQUES", color: "var(--warn)" },
                          { type: RESPONSE_TYPE.Alternative, label: "ALTERNATIVE", color: "var(--agent-primary)" }
                        ].map((option) => (
                          <button
                            key={option.type}
                            type="button"
                            onClick={() => setResponseType(option.type)}
                            className="border p-2 text-[10px] font-mono"
                            style={{
                              borderColor: responseType === option.type ? option.color : "var(--border)",
                              color: responseType === option.type ? option.color : "var(--text-muted)",
                              background: responseType === option.type ? `${option.color}12` : "transparent"
                            }}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>

                      <textarea
                        className="input-field resize-none"
                        rows={4}
                        value={responseContent}
                        onChange={(event) => setResponseContent(event.target.value)}
                        placeholder="Explain your response..."
                      />

                      <button
                        type="button"
                        className="btn-primary w-full"
                        onClick={() => void handleRespond()}
                        disabled={!canInteract || busyAction === "respond" || responseContent.trim().length < 10}
                      >
                        {busyAction === "respond" ? "Submitting..." : "Submit Response - Stake 2 USDC"}
                      </button>
                    </div>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}

          {isConnected && isCreator ? (
            <>
              {job.status === 2 || awaitingSelection ? (
                <FinalistSelectionPanel
                  submissions={pendingSubmissions}
                  maxApprovals={maxApprovals}
                  submitting={busyAction === "select"}
                  error={errorMessage || null}
                  onSubmit={(agents) => void handleSelectFinalists(agents)}
                />
              ) : null}

              {job.status === 4 && revealEnded ? (
                <div className="space-y-3">
                  <div className="section-header">FINALIZE WINNERS</div>
                  {selectedFinalists.map((agent) => {
                    const key = agent.toLowerCase();
                    const parentAuthor = buildOnParents[key] ?? ZERO_ADDRESS;
                    const isBuildOnWinner =
                      parentAuthor &&
                      parentAuthor.toLowerCase() !== ZERO_ADDRESS.toLowerCase() &&
                      parentAuthor.toLowerCase() !== key;
                    const isWinnerSelected = (rewardInputs[key] ?? "").trim().length > 0;
                    return (
                      <FinalistCard
                        key={agent}
                        agent={agent}
                        submission={finalistSubmissions[key] ?? null}
                        onSelect={() =>
                          setRewardInputs((previous) => ({
                            ...previous,
                            [key]: previous[key] ? "" : "1.0"
                          }))
                        }
                        isWinner={isWinnerSelected}
                        rewardAmount={rewardInputs[key] ?? ""}
                        onRewardChange={(value) =>
                          setRewardInputs((previous) => ({ ...previous, [key]: value }))
                        }
                        buildOnInfo={isBuildOnWinner ? { parentAgent: parentAuthor } : undefined}
                      />
                    );
                  })}
                  <button
                    type="button"
                    className="btn-primary w-full"
                    onClick={() => void handleFinalizeWinners()}
                    disabled={busyAction === "finalize"}
                  >
                    {busyAction === "finalize" ? "Finalizing..." : "Finalize Winners"}
                  </button>
                </div>
              ) : null}

              {job.status === 4 && !revealEnded ? (
                <div className="border border-[var(--border)] p-3 text-xs text-[var(--text-muted)]">
                  Reveal phase is active. Finalization opens after <RevealCountdown end={revealEndValue} />.
                </div>
              ) : null}
            </>
          ) : null}
        </aside>
      </div>

      <div className="pt-2"><Link href="/" className="btn-ghost inline-flex">Back to task feed</Link></div>
    </section>
  );
}
