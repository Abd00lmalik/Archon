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
  fetchJobCredentialCooldownSeconds,
  fetchLastJobCredentialClaim,
  fetchPendingReleases,
  formatTaskDescription,
  formatTaskTitle,
  formatTimestamp,
  formatUsdc,
  getReadProvider,
  isValidSubmission,
  parseSubmission,
  JobRecord,
  PendingReleaseRecord,
  RESPONSE_TYPE,
  SubmissionRecord,
  TaskEconomyRecord,
  txClaimInteractionReward,
  txInteract,
  txReturnStake,
  ZERO_ADDRESS
} from "@/lib/contracts";
import {
  fetchAllTasks,
  fetchTaskById,
  getContractForSource,
  invalidateTaskCache,
  loadTaskSubmissions,
  unifiedTaskToJobRecord,
  UnifiedTask
} from "@/lib/task-adapter";
import { getDisplayId, parseTaskUrl } from "@/lib/task-id";
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

function coerceBigInt(value: unknown, fallback = 0n): bigint {
  try {
    if (typeof value === "bigint") return value;
    if (typeof value === "number") return BigInt(Math.trunc(value));
    if (typeof value === "string" && value.trim()) return BigInt(value);
  } catch {
    // Fall through to fallback.
  }
  return fallback;
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
    { status: 5, label: "COMPLETED", desc: "Winners selected", color: "var(--pulse)" },
    { status: 6, label: "CLOSED", desc: "Task closed", color: "var(--text-muted)" }
  ];

  const displayStatus = deriveDisplayStatus(job.status, job.deadline, revealEnd);
  const current = phases.find((phase) => phase.status === displayStatus.code) ?? phases[0];
  const revealEnded = displayStatus.label === "Ready to Finalize";
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
      className={`flex flex-col gap-3 p-4 border transition-all duration-200 ${
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
            {deliverable.length > 60 ? "..." : ""} [open]
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
            {buildOnInfo?.parentAgent.slice(0, 8)}... -&gt; {(numericReward * 0.7).toFixed(2)} USDC (70%)
          </div>
          <div className="text-[10px] font-mono text-[var(--text-secondary)]">
            {agent.slice(0, 8)}... -&gt; {(numericReward * 0.3).toFixed(2)} USDC (30%)
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
        {isWinner ? "SELECTED AS WINNER" : "SELECT AS WINNER"}
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
                  {chosen ? <span style={{ color: "#020608", fontSize: 10, fontWeight: 700 }}>x</span> : null}
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
                    View [open]
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
  const rawJobParam = params.jobId ?? "";
  const prefixedRoute = useMemo(() => parseTaskUrl(rawJobParam), [rawJobParam]);
  const displayId = useMemo(() => {
    const numeric = Number(rawJobParam);
    if (Number.isInteger(numeric) && numeric > 0) return numeric;
    return prefixedRoute ? getDisplayId(prefixedRoute.source, prefixedRoute.contractJobId) : NaN;
  }, [prefixedRoute, rawJobParam]);
  const validDisplayId = Number.isInteger(displayId) && displayId > 0;

  const [task, setTask] = useState<UnifiedTask | null>(null);
  const [job, setJob] = useState<JobRecord | null>(null);
  const jobId = task?.jobId ?? -1;
  const [displayTaskId, setDisplayTaskId] = useState(validDisplayId ? `#${displayId}` : `#${rawJobParam}`);
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
  const [taskEconomy, setTaskEconomy] = useState<TaskEconomyRecord>({
    interactionStake: 2_000_000n,
    interactionReward: 0n,
    interactionPool: 0n,
    interactionPoolFunded: false,
    poolRemaining: 0n
  });

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
  const taskRef = useRef<UnifiedTask | null>(null);
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
  const [pendingReleases, setPendingReleases] = useState<PendingReleaseRecord[]>([]);

  const isConnected = Boolean(account);
  const isCreator = Boolean(account && job && account.toLowerCase() === job.client.toLowerCase());
  const taskJobId = task?.jobId ?? -1;
  const taskSourceId = task?.sourceId ?? "";
  const taskHasSignalMap = Boolean(task?.caps.hasSignalMap);
  const taskLoaded = Boolean(task);

  useEffect(() => {
    taskRef.current = task;
  }, [task]);

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

  const getTaskWriteContract = async () => {
    if (!task) throw new Error("Task is still loading.");
    const provider = await withProvider();
    return getContractForSource(task.sourceId, await provider.getSigner());
  };

  const loadTask = useCallback(async () => {
    if (!validDisplayId) {
      setJobLoading(false);
      setJobError(`Invalid task ID: ${rawJobParam}`);
      setJob(null);
      setTask(null);
      return;
    }

    setJobLoading(true);
    setJobError(null);

    try {
      const readProvider = browserProvider ?? getReadProvider();
      const unifiedTask = await fetchTaskById(displayId, readProvider);

      if (!unifiedTask) {
        setJobError(`Task #${rawJobParam} not found`);
        setJob(null);
        setTask(null);
        return;
      }

      setTask(unifiedTask);
      setDisplayTaskId(`#${unifiedTask.displayId}`);

      const readContract = getContractForSource(unifiedTask.sourceId, readProvider);
      const jobData = unifiedTaskToJobRecord(unifiedTask);
      const rawSubmissions = await loadTaskSubmissions(unifiedTask, readProvider);
      const allTasks = await fetchAllTasks(readProvider);

      let finals: string[] = [];
      let revealEnd = Number(unifiedTask.revealPhaseEnd);
      let revealOpen = unifiedTask.isInRevealPhase;
      let economy: TaskEconomyRecord = {
        interactionStake: 2_000_000n,
        interactionReward: 0n,
        interactionPool: 0n,
        interactionPoolFunded: false,
        poolRemaining: 0n
      };

      if (unifiedTask.caps.hasSignalMap || unifiedTask.caps.canSelectFinalists || unifiedTask.caps.canInteract) {
        const [finalRows, revealEndRaw, revealOpenRaw, economyRaw, poolRemainingRaw] = await Promise.all([
          readContract.getSelectedFinalists(unifiedTask.jobId).catch(() => []),
          readContract.getRevealPhaseEnd(unifiedTask.jobId).catch(() => unifiedTask.revealPhaseEnd),
          readContract.isInRevealPhase(unifiedTask.jobId).catch(() => unifiedTask.isInRevealPhase),
          readContract.getTaskEconomy(unifiedTask.jobId).catch(() => null),
          readContract.getInteractionPoolRemaining(unifiedTask.jobId).catch(() => 0n)
        ]);
        finals = Array.from(finalRows as string[]);
        revealEnd = Number(revealEndRaw);
        revealOpen = Boolean(revealOpenRaw);
        if (economyRaw) {
          const raw = economyRaw as Record<string, unknown> & unknown[];
          economy = {
            interactionStake: coerceBigInt(raw.interactionStake ?? raw[0] ?? 2_000_000n, 2_000_000n),
            interactionReward: coerceBigInt(raw.interactionReward ?? raw[1] ?? 0n),
            interactionPool: coerceBigInt(raw.interactionPool ?? raw[2] ?? 0n),
            interactionPoolFunded: Boolean(raw.interactionPoolFunded ?? raw[3] ?? false),
            poolRemaining: coerceBigInt(poolRemainingRaw)
          };
        }
      }

      const parentEntries = await Promise.all(
        finals.map(async (finalist) => {
          try {
            const parent = String(await readContract.buildOnParentByResponder(unifiedTask.jobId, finalist));
            return [finalist.toLowerCase(), parent] as const;
          } catch {
            return [finalist.toLowerCase(), ZERO_ADDRESS] as const;
          }
        })
      );

      setJob({ ...jobData, revealPhaseEnd: BigInt(revealEnd || 0) });
      setSubmissions(rawSubmissions);
      setEscrowLocked(coerceBigInt(jobData.rewardUSDC) - coerceBigInt(jobData.paidOutUSDC));
      setApprovalsUsed(jobData.approvedCount);
      setMaxApprovals(Math.max(1, jobData.maxApprovals || 1));
      setSelectedFinalists(finals);
      setRevealPhaseEnd(revealEnd);
      setIsRevealPhase(revealOpen);
      setTaskEconomy(economy);
      setCreatorPostedCount(allTasks.filter((candidate) => candidate.client.toLowerCase() === jobData.client.toLowerCase()).length);
      setBuildOnParents(
        parentEntries.reduce<Record<string, string>>((acc, [key, value]) => {
          acc[key] = value;
          return acc;
        }, {})
      );

      if (account) {
        const mine = rawSubmissions.find((submission) => submission.agent.toLowerCase() === account.toLowerCase()) ?? null;
        const [accepted, lastClaim, cooldown] = await Promise.all([
          readContract.isAccepted(unifiedTask.jobId, account).catch(() => Boolean(mine)),
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
  }, [account, browserProvider, displayId, rawJobParam, validDisplayId]);

  const loadHeatmap = useCallback(async () => {
    if (!taskHasSignalMap || !Number.isInteger(taskJobId) || taskJobId < 0 || !taskSourceId) {
      setHeatmap({ people: [], totalActivity: 0, revealPhaseEnd: 0, isRevealPhase: false });
      setHeatmapLoading(false);
      return;
    }
    setHeatmapLoading(true);
    try {
      const provider = browserProvider ?? getReadProvider();
      const data = await buildTaskHeatmap(provider, Number(taskJobId), taskSourceId);
      setHeatmap(data);
    } catch (error) {
      console.warn("[heatmap] load error:", error);
      setHeatmap({ people: [], totalActivity: 0, revealPhaseEnd: 0, isRevealPhase: false });
    } finally {
      setHeatmapLoading(false);
    }
  }, [browserProvider, taskHasSignalMap, taskJobId, taskSourceId]);

  useEffect(() => {
    void loadTask();
  }, [loadTask]);

  useEffect(() => {
    void loadHeatmap();
  }, [loadHeatmap]);

  useEffect(() => {
    if (taskLoaded && !taskHasSignalMap && viewMode === "signal") {
      setViewMode("list");
    }
  }, [taskHasSignalMap, taskLoaded, viewMode]);

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

  const refreshPendingReleases = useCallback(async () => {
    if (!account || taskSourceId !== "current" || !Number.isInteger(jobId) || jobId < 0) {
      setPendingReleases([]);
      return;
    }

    try {
      const provider = browserProvider ?? getReadProvider();
      const releases = await fetchPendingReleases(provider, jobId, account);
      setPendingReleases(releases);
    } catch (error) {
      console.warn("[releases] load failed:", error);
      setPendingReleases([]);
    }
  }, [account, browserProvider, jobId, taskSourceId]);

  useEffect(() => {
    void refreshPendingReleases();
  }, [refreshPendingReleases, job?.status, revealPhaseEnd, selectedFinalists.length]);

  useEffect(() => {
    if (!taskHasSignalMap || !taskSourceId || !Number.isInteger(jobId) || jobId < 0) return () => undefined;
    const contract = getContractForSource(taskSourceId, getReadProvider());
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
  }, [jobId, loadTask, loadHeatmap, taskHasSignalMap, taskSourceId]);

  useEffect(() => {
    if (!selectedFinalists.length) {
      setFinalistSubmissions({});
      return;
    }

    let active = true;
    const loadFinalists = async () => {
      const currentTask = taskRef.current;
      if (!currentTask || !taskSourceId) return;
      const contract = getContractForSource(taskSourceId, getReadProvider());
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
            cachedAllSubmissions = await loadTaskSubmissions(currentTask, getReadProvider());
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
  }, [jobId, selectedFinalists, taskSourceId]);

  const handleAccept = async () => {
    try {
      setBusyAction("accept");
      const contract = await getTaskWriteContract();
      const tx = await contract.acceptJob(jobId);
      setStatusMessage(`Accept tx: ${tx.hash}`);
      await tx.wait();
      invalidateTaskCache();
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
      const contract = await getTaskWriteContract();
      const tx = typeof contract.interface.hasFunction === "function" && contract.interface.hasFunction("submitDirect")
        ? await contract.submitDirect(BigInt(jobId), deliverableLink.trim())
        : await contract.submitDeliverable(jobId, deliverableLink.trim());
      setStatusMessage(`Submit tx: ${tx.hash}`);
      await tx.wait();
      setDeliverableLink("");
      invalidateTaskCache();
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
    const caller = await signer.getAddress();
    console.log("[respond] parentSubmissionId:", selectedSubmission.submissionId.toString());
    console.log("[respond] caller:", caller);
    console.log("[respond] known submitter:", selectedSubmission.agent);
    if (caller.toLowerCase() === selectedSubmission.agent.toLowerCase()) {
      setErrorMessage("You cannot respond to your own submission.");
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

      const contentUri = contentToURI(responseContent.trim());
      const { txHash, path } = await txInteract(
        signer,
        task?.sourceId ?? "current",
        BigInt(selectedSubmission.submissionId),
        responseType,
        contentUri
      );
      console.log("[interact] path:", path);
      setStatusMessage(`Response tx: ${txHash}`);
      setResponseContent("");
      setShowResponsePanel(false);
      invalidateTaskCache();
      await loadHeatmap();
      await loadTask();
    } catch (error) {
      setErrorMessage(errorText(error, "Failed to submit response"));
    } finally {
      setBusyAction("");
    }
  };

  const handleSlashResponse = async (responseId: bigint) => {
    if (!signer) {
      setErrorMessage("Connect wallet to slash a response stake.");
      return;
    }

    try {
      setBusyAction("slash");
      const contract = getContractForSource(task?.sourceId ?? "current", signer);
      const tx = await contract.slashResponseStake(responseId);
      await tx.wait();
      const txHash = tx.hash as string;
      setStatusMessage(`Stake slashed: ${txHash}`);
      invalidateTaskCache();
      await loadHeatmap();
      await loadTask();
    } catch (error) {
      setErrorMessage(errorText(error, "Failed to slash response stake"));
    } finally {
      setBusyAction("");
    }
  };

  const handleSelectFinalists = async (agents: string[]) => {
    if (!agents.length) return;
    try {
      setBusyAction("select");
      const unique = [
        ...new Set(
          agents
            .map((address) => address.toLowerCase())
            .map((address) => safeSubmissions.find((submission) => submission.agent.toLowerCase() === address)?.agent)
            .filter((value): value is string => Boolean(value))
        )
      ];
      const contract = await getTaskWriteContract();
      const tx = await contract.selectFinalists(BigInt(jobId), unique);
      await tx.wait();
      const txHash = tx.hash as string;
      setStatusMessage(`Finalists tx: ${txHash}`);
      invalidateTaskCache();
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
      try {
        const contract = getContractForSource(task?.sourceId ?? "current", signer);
        const tx = await contract.autoStartReveal(BigInt(jobId));
        await tx.wait();
        const txHash = tx.hash as string;
        setStatusMessage(`Reveal phase started automatically: ${txHash}`);
      } catch (error) {
        const allAgents = [
          ...new Set(
            safeSubmissions
              .map((submission) => submission.agent)
              .filter((agent) => agent && agent.toLowerCase() !== ZERO_ADDRESS.toLowerCase())
          )
        ];
        console.log("[autoReveal] autoStartReveal failed, falling back to selectFinalists:", allAgents, error);
        if (!allAgents.length) {
          throw new Error("No valid submissions available to promote.");
        }
        const contract = getContractForSource(task?.sourceId ?? "current", signer);
        const tx = await contract.selectFinalists(BigInt(jobId), allAgents);
        await tx.wait();
        const txHash = tx.hash as string;
        setStatusMessage(`Reveal phase started via selectFinalists fallback: ${txHash}`);
      }
      invalidateTaskCache();
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
      const contract = await getTaskWriteContract();
      const tx = await contract.finalizeWinners(BigInt(jobId), winners, amounts);
      await tx.wait();
      const txHash = tx.hash as string;
      setStatusMessage(`Finalize tx: ${txHash}`);
      invalidateTaskCache();
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
      const contract = await getTaskWriteContract();
      const tx = await contract.claimCredential(jobId);
      setStatusMessage(`Claim tx: ${tx.hash}`);
      await tx.wait();
      invalidateTaskCache();
      await loadTask();
    } catch (error) {
      setErrorMessage(errorText(error, "Failed to claim reward"));
    } finally {
      setBusyAction("");
    }
  };

  const handleClaimPendingReleases = async () => {
    if (!signer || pendingReleases.length === 0) return;

    try {
      setBusyAction("release");
      const hashes: string[] = [];
      for (const release of pendingReleases) {
        if (release.canClaimReward) {
          hashes.push(await txClaimInteractionReward(signer, release.responseId));
        } else if (release.canReturnStake) {
          hashes.push(await txReturnStake(signer, release.responseId));
        }
      }
      setStatusMessage(`Claimed pending reveal releases: ${hashes.join(", ")}`);
      await refreshPendingReleases();
      invalidateTaskCache();
      await loadTask();
      await loadHeatmap();
    } catch (error) {
      setErrorMessage(errorText(error, "Failed to claim pending stake/reward"));
    } finally {
      setBusyAction("");
    }
  };

  const handleSettleRevealPhase = async () => {
    if (!signer) {
      setErrorMessage("Connect wallet to settle reveal rewards.");
      return;
    }

    try {
      setBusyAction("settle");
      const contract = getContractForSource(task?.sourceId ?? "current", signer);
      const tx = await contract.settleRevealPhase(BigInt(jobId));
      await tx.wait();
      const txHash = tx.hash as string;
      setStatusMessage(`Reveal phase settled: ${txHash}`);
      await refreshPendingReleases();
      invalidateTaskCache();
      await loadTask();
      await loadHeatmap();
    } catch (error) {
      setErrorMessage(errorText(error, "Settlement failed"));
    } finally {
      setBusyAction("");
    }
  };

  const hasSubmitted = Boolean(mySubmission && mySubmission.status !== 0);
  const isClaimed = Boolean(mySubmission?.credentialClaimed);
  const viewerIsCreator = isCreator;
  const viewerHasSubmitted = hasSubmitted;
  const viewerSubmission = mySubmission;
  const viewerSubmissionApproved = viewerSubmission?.status === 2;

  const revealEndValue = revealPhaseEnd || Number(job?.revealPhaseEnd ?? 0n);
  const displayStatus = job
    ? deriveDisplayStatus(job.status, job.deadline, revealEndValue, account ?? undefined, hasSubmitted, isCreator)
    : null;
  const canClaim = Boolean(
    displayStatus?.canClaim && isConnected && !viewerIsCreator && viewerSubmissionApproved && !isClaimed && claimCountdown <= 0
  );
  const revealEnded = Boolean(job?.status === 4 && revealEndValue > 0 && Math.floor(Date.now() / 1000) > revealEndValue);
  const submissionDeadlinePassed = Boolean(
    job && job.deadline > 0 && BigInt(Math.floor(Date.now() / 1000)) > BigInt(job.deadline)
  );
  const awaitingSelection = Boolean(job && submissionDeadlinePassed && (job.status === 2 || job.status === 0 || job.status === 1));
  const canAutoReveal = Boolean(
    task?.caps.canAutoReveal &&
      job &&
      displayStatus?.canAutoReveal &&
      submissionDeadlinePassed &&
      (job.status === 0 || job.status === 1 || job.status === 2) &&
      safeSubmissions.length > 0 &&
      safeSubmissions.length <= Number(maxApprovals) + 5
  );
  const canManualReveal = Boolean(
    task?.caps.canSelectFinalists &&
      job &&
      submissionDeadlinePassed &&
      (job.status === 0 || job.status === 1 || job.status === 2) &&
      safeSubmissions.length > Number(maxApprovals) + 5
  );
  const nowSeconds = Math.floor(Date.now() / 1000);
  const isRevealActive = Boolean(job?.status === 4 && revealEndValue > 0 && nowSeconds <= revealEndValue);
  const shouldShowSignalMap = Boolean(task?.caps.hasSignalMap);
  const isSelectedFinalist = Boolean(
    selectedSubmission && finalistSet.has(selectedSubmission.agent.toLowerCase())
  );
  const isOwnSelectedSubmission = Boolean(
    account && selectedSubmission && account.toLowerCase() === selectedSubmission.agent.toLowerCase()
  );
  const canSubmitToTask = Boolean(
    task?.caps.canSubmit &&
      displayStatus?.label === "Open" &&
      isConnected &&
      !viewerIsCreator &&
      !viewerHasSubmitted
  );
  const showAcceptAction = Boolean(canSubmitToTask && !isAccepted);
  const showSubmitAction = Boolean(canSubmitToTask && isAccepted);
  const showInteractionAction = Boolean(
    task?.caps.canInteract &&
      isRevealActive &&
      isConnected &&
      !viewerIsCreator &&
      job?.status === 4
  );
  const canInteract = Boolean(
    task?.caps.canInteract &&
      showInteractionAction &&
      isRevealActive &&
      signer &&
      isConnected &&
      selectedSubmission &&
      isSelectedFinalist &&
      !isOwnSelectedSubmission
  );
  const canSettle = Boolean(
    task?.caps.canSettleRevealPhase &&
      job &&
      isConnected &&
      signer &&
      (job.status === 5 ||
        (job.status === 4 && revealEndValue > 0 && nowSeconds > revealEndValue + 2 * 24 * 60 * 60))
  );
  const postRevealComplete = Boolean(task?.sourceId === "current" && job && (job.status === 5 || revealEnded));
  const isParticipant = Boolean(hasSubmitted || pendingReleases.length > 0);
  const totalPendingRelease = pendingReleases.reduce(
    (sum, release) => sum + release.stakeAmount + release.rewardAmount,
    0n
  );
  useEffect(() => {
    setDisplayTaskId(task?.displayId ? `#${task.displayId}` : validDisplayId ? `#${displayId}` : `#${rawJobParam}`);
  }, [displayId, rawJobParam, task?.displayId, validDisplayId]);

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
          Loading task {displayTaskId}...
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
            <span className="text-xs font-mono text-[var(--text-muted)]">
              {displayTaskId}
            </span>
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

      <div className="task-detail-grid grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_320px]">
        <aside className="panel h-fit space-y-6">
          <div><div className="section-header">DESCRIPTION</div><p className="text-sm text-[var(--text-secondary)]">{formatTaskDescription(job.description)}</p></div>
          <div><div className="section-header">METADATA</div><div className="space-y-2 text-xs"><div className="flex justify-between"><span className="text-[var(--text-muted)]">Creator</span><UserDisplay address={job.client} showAvatar={true} avatarSize={22} /></div><div className="flex justify-between"><span className="text-[var(--text-muted)]">Tasks posted</span><span className="font-mono">{creatorPostedCount}</span></div><div className="flex justify-between"><span className="text-[var(--text-muted)]">Created</span><span className="font-mono">{formatTimestamp(job.createdAt)}</span></div></div></div>
          <div><div className="section-header">REWARD BREAKDOWN</div><div className="space-y-2 text-xs"><div className="flex justify-between"><span className="text-[var(--text-muted)]">Total pool</span><span className="font-mono text-[var(--gold)]">{formatUsdc(job.rewardUSDC)} USDC</span></div><div className="flex justify-between"><span className="text-[var(--text-muted)]">Escrow locked</span><span className="font-mono">{formatUsdc(escrowLocked)} USDC</span></div><div className="flex justify-between"><span className="text-[var(--text-muted)]">Approval slots</span><span className="font-mono">{approvalsUsed}/{maxApprovals}</span></div></div></div>
        </aside>

        <div className="space-y-4">
          <div className="panel-elevated flex gap-2">
            {task?.caps.hasSignalMap ? (
              <button
                type="button"
                className={viewMode === "signal" ? "btn-primary px-3 py-2 text-xs" : "btn-ghost px-3 py-2 text-xs"}
                onClick={() => setViewMode("signal")}
              >
                SIGNAL MAP
              </button>
            ) : null}
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

          {job.status === 4 ? (
            <div
              style={{
                padding: "12px 16px",
                border: "1px solid color-mix(in srgb, var(--arc) 35%, transparent)",
                background: "color-mix(in srgb, var(--arc) 8%, transparent)"
              }}
            >
              <div
                style={{
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: 10,
                  color: "var(--arc)",
                  letterSpacing: "0.1em",
                  marginBottom: 8
                }}
              >
                INTERACTION ECONOMY
              </div>
              <div className="mb-3 text-xs text-[var(--text-secondary)]">
                Arc settles task state and USDC movement. Circle authorizes paid access and EIP-3009 interaction
                transfers where the deployed task contract supports it.
              </div>
              <div className="flex flex-wrap gap-6 text-xs">
                <div>
                  <div style={{ color: "var(--text-muted)", fontSize: 10 }}>STAKE PER RESPONSE</div>
                  <div style={{ color: "var(--text-primary)", fontFamily: "JetBrains Mono, monospace", fontWeight: 700 }}>
                    {(Number(taskEconomy.interactionStake) / 1e6).toFixed(3)} USDC
                  </div>
                </div>
                <div>
                  <div style={{ color: "var(--text-muted)", fontSize: 10 }}>REWARD PER APPROVAL</div>
                  <div style={{ color: "var(--pulse)", fontFamily: "JetBrains Mono, monospace", fontWeight: 700 }}>
                    {taskEconomy.interactionPool > 0n
                      ? `~${(Number(taskEconomy.interactionReward) / 1e6).toFixed(3)} USDC`
                      : "No pool"}
                  </div>
                </div>
                <div>
                  <div style={{ color: "var(--text-muted)", fontSize: 10 }}>POOL REMAINING</div>
                  <div style={{ color: "var(--gold)", fontFamily: "JetBrains Mono, monospace", fontWeight: 700 }}>
                    {(Number(taskEconomy.poolRemaining) / 1e6).toFixed(3)} USDC
                  </div>
                </div>
              </div>
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
                <div ref={mapContainerRef} className="signal-map-wrapper w-full overflow-hidden" style={{ height: 400, minHeight: 400 }}>
                  <SignalMap
                    heatmap={heatmap}
                    loading={heatmapLoading}
                    containerWidth={Math.max(300, mapDimensions.w - 4)}
                    containerHeight={Math.max(320, mapDimensions.h)}
                    taskId={jobId}
                    sourceId={task?.sourceId}
                    provider={browserProvider ?? getReadProvider()}
                    isCreator={isCreator}
                    onViewSubmissions={(address) => {
                      setSubmissionFilterAddress(address);
                      setViewMode("list");
                    }}
                    onSlashResponse={(responseId) => void handleSlashResponse(responseId)}
                  />
                </div>
              ) : (
                <div className="flex items-center justify-center h-48 text-[var(--text-muted)] font-mono text-xs text-center p-6">
                  <div>
                    <div className="text-2xl mb-3 opacity-20">?</div>
                    Signal map is only available during the reveal phase.
                    {job?.status === 2 ? " Creator is selecting finalists." : ""}
                    {job?.status === 0 ? " Task is still accepting submissions." : ""}
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {viewMode === "list" ? (
            !task?.caps.showsSubmissionsToAll && !isCreator && !shouldShowSignalMap ? (
              <div className="flex h-48 flex-col items-center justify-center border border-[var(--border)] p-6 text-center">
                <div className="mb-3 font-mono text-2xl text-[var(--arc)]">?</div>
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
                        account?.toLowerCase() === submission.agent.toLowerCase() ? (
                          <div className="border border-[var(--border)] p-2 text-center text-xs text-[var(--text-muted)]">
                            You cannot respond to your own submission.
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="btn-ghost w-full text-xs"
                            onClick={() => setSelectedSubmission(submission)}
                          >
                            {selectedSubmission?.submissionId === submission.submissionId
                              ? "Selected for Response"
                              : "Select for Response"}
                          </button>
                        )
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

        <aside className="task-right-panel panel h-fit space-y-4">
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
                the {maxApprovals + 5} finalist threshold. Anyone can trigger reveal phase automatically and promote
                every valid submission to finalist status.
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

          {canSettle ? (
            <div
              className="border p-4"
              style={{
                borderColor: "color-mix(in srgb, var(--pulse) 35%, transparent)",
                background: "color-mix(in srgb, var(--pulse) 8%, transparent)"
              }}
            >
              <div className="mb-2 font-heading text-sm font-semibold text-[var(--text-primary)]">
                Reveal Settlement Ready
              </div>
              <div className="mb-3 text-xs leading-5 text-[var(--text-secondary)]">
                Release all eligible response stakes and interaction rewards in one permissionless transaction.
              </div>
              <button
                type="button"
                className="btn-primary w-full"
                onClick={() => void handleSettleRevealPhase()}
                disabled={busyAction === "settle" || !signer}
              >
                {busyAction === "settle" ? "Settling..." : "Settle Reveal Phase"}
              </button>
            </div>
          ) : null}

          {isConnected && !isCreator ? (
            <>
              <div className="section-header">YOUR ACTIONS</div>

              {showAcceptAction ? (
                <button
                  type="button"
                  className="btn-primary w-full"
                  onClick={() => void handleAccept()}
                  disabled={busyAction === "accept"}
                >
                  {busyAction === "accept" ? "Accepting..." : "Accept Task"}
                </button>
              ) : null}

              {showSubmitAction ? (
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

              {postRevealComplete && isParticipant ? (
                <div
                  style={{
                    padding: "12px 16px",
                    border: "1px solid var(--pulse)",
                    background: "color-mix(in srgb, var(--pulse) 8%, transparent)"
                  }}
                >
                  <div
                    style={{
                      fontFamily: "JetBrains Mono, monospace",
                      fontSize: 10,
                      color: "var(--pulse)",
                      marginBottom: 8,
                      letterSpacing: "0.1em"
                    }}
                  >
                    REVEAL PHASE COMPLETE
                  </div>
                  {pendingReleases.length > 0 ? (
                    <>
                      <div className="mb-3 text-xs text-[var(--text-secondary)]">
                        You have unclaimed stake and/or interaction rewards from this task.
                      </div>
                      <button
                        type="button"
                        className="btn-primary w-full"
                        onClick={() => void handleClaimPendingReleases()}
                        disabled={busyAction === "release" || !signer}
                      >
                        {busyAction === "release"
                          ? "Claiming..."
                          : `Claim ${formatUsdc(totalPendingRelease)} USDC`}
                      </button>
                    </>
                  ) : (
                    <div className="text-xs text-[var(--text-muted)]">No pending claims for your wallet.</div>
                  )}
                </div>
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
                  {job.status === 6 ? "Task is closed" : ""}
                </div>
              ) : null}

              {showInteractionAction && selectedSubmission ? (
                isOwnSelectedSubmission ? (
                  <div className="border border-[var(--border)] p-3 text-xs text-[var(--text-muted)]">
                    You cannot respond to your own submission. Select another finalist submission to critique or build on.
                  </div>
                ) : (
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
                        style={{ minHeight: 80, maxHeight: 160 }}
                        value={responseContent}
                        onChange={(event) => setResponseContent(event.target.value)}
                        placeholder="Explain your response..."
                      />

                      <div className="font-mono text-[11px] text-[var(--text-muted)]">
                        {task?.caps.canRespondWithAuthorization
                          ? "Authorization path: EIP-3009 is attempted first; classic USDC approval is used if the token rejects it."
                          : "Authorization path: USDC approval, then onchain response transaction."}
                      </div>

                      <button
                        type="button"
                        className="btn-primary w-full"
                        onClick={() => void handleRespond()}
                        disabled={!canInteract || busyAction === "respond" || responseContent.trim().length < 10}
                      >
                        {busyAction === "respond"
                          ? "Submitting..."
                          : `Submit Response - Stake ${(Number(taskEconomy.interactionStake > 0n ? taskEconomy.interactionStake : 2_000_000n) / 1e6).toFixed(2)} USDC`}
                      </button>
                    </div>
                  ) : null}
                </>
                )
              ) : null}
            </>
          ) : null}

          {isConnected && isCreator ? (
            <>
              {canManualReveal ? (
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
