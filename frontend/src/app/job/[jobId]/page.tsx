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
  extractBanner,
  fetchHasRespondedMap,
  fetchIsJudge,
  fetchJobCredentialCooldownSeconds,
  fetchLastJobCredentialClaim,
  fetchPendingReleases,
  fetchTaskJudges,
  fetchTriageState,
  formatTaskDescription,
  formatTaskTitle,
  formatTimestamp,
  formatUsdc,
  getReadProvider,
  isValidSubmission,
  parseSubmission,
  shortAddress,
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
  fetchTaskBySourceAndId,
  getContractForSource,
  invalidateTaskCache,
  loadTaskSubmissions,
  unifiedTaskToJobRecord,
  UnifiedTask
} from "@/lib/task-adapter";
import { getDisplayId, parseTaskUrl } from "@/lib/task-id";
import { useWallet } from "@/lib/wallet-context";

type ViewMode = "signal" | "list" | "timeline";

const LIST_PAGE_SIZE = 5;

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

function humanizeError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message?: unknown }).message ?? "Unknown error")
        : String(error ?? "Unknown error");
  const normalized = raw.toLowerCase();
  if (normalized.includes("user rejected")) return "Transaction cancelled.";
  if (normalized.includes("insufficient funds")) return "Insufficient USDC balance.";
  if (normalized.includes("already submitted")) return "You have already submitted to this task.";
  if (normalized.includes("already responded"))
    return "You already responded to this submission - each wallet can respond to a submission only once.";
  if (normalized.includes("deadline")) return "This task's deadline has passed.";
  if (normalized.includes("network")) return "Network error - check your connection and retry.";
  return raw.slice(0, 120);
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

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  const timeout = new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms));
  return Promise.race([promise, timeout]);
}

const perf = {
  start: (label: string) => {
    if (process.env.NODE_ENV === "development") console.time(`[archon] ${label}`);
  },
  end: (label: string) => {
    if (process.env.NODE_ENV === "development") console.timeEnd(`[archon] ${label}`);
  }
};

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
    { status: 2, label: "SUBMITTED", desc: "Judges reviewing submissions", color: "var(--warn)" },
    { status: 3, label: "SELECTION", desc: "Promoting submissions for reveal", color: "var(--warn)" },
    { status: 4, label: "REVEAL PHASE", desc: "Critique and build-on window open", color: "var(--arc)" },
    { status: 5, label: "CLOSED", desc: "Task closed", color: "var(--text-muted)" },
    { status: 6, label: "CLOSED", desc: "Task closed", color: "var(--text-muted)" }
  ];

  const displayStatus = deriveDisplayStatus(job.status, job.deadline, revealEnd, job.submissionCount);
  const current = phases.find((phase) => phase.status === displayStatus.code) ?? phases[0];
  const revealEnded = job.status === 4 && revealEnd > 0 && Math.floor(Date.now() / 1000) > revealEnd;
  const label = displayStatus.label.toUpperCase();
  const description = awaitingSelection
    ? "Submission deadline passed - awaiting creator to begin the reveal"
    : revealEnded
      ? "Reveal window closed - awaiting winner finalization"
      : displayStatus.label === "Closed"
        ? "Task closed"
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
  selected,
  onToggle,
  submitting,
  error,
  disabled,
  disabledHint,
  submitLabel,
  onSubmit
}: {
  submissions: SubmissionRecord[];
  maxApprovals: number;
  selected: string[];
  onToggle: (agent: string) => void;
  submitting: boolean;
  error: string | null;
  disabled?: boolean;
  disabledHint?: string;
  submitLabel?: string;
  onSubmit: (agents: string[]) => void;
}) {
  const maxFinalists = maxApprovals + 5;
  const selectedKeys = useMemo(() => new Set(selected.map((agent) => agent.toLowerCase())), [selected]);

  return (
    <div className="space-y-4">
      <div className="section-header">PROMOTED FOR REVEAL</div>
      <div className="border border-[#162334] px-3 py-2 text-xs text-[#7A9BB5]">
        These accepted submissions are shortlisted for the 5-day reveal phase. Click one to remove
        it from the shortlist. Only promoted submissions will be visible for critique and
        build-ons.
        <br />
        <strong style={{ color: "#00E5FF" }}>
          Promoted: {selected.length} / {maxFinalists}
        </strong>
      </div>

      <div className="space-y-2">
        {submissions.length === 0 ? (
          <div className="border border-[var(--border)] p-3 text-xs text-[var(--text-muted)]">
            No promoted submissions yet. Accept a submission, then promote it to shortlist it for
            the reveal.
          </div>
        ) : null}
        {submissions.map((submission, index) => {
          const agent = submission.agent ?? "";
          const chosen = selectedKeys.has(agent.toLowerCase());
          return (
            <div
              key={`${agent}-${index}`}
              onClick={() => onToggle(agent)}
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
        onClick={() => onSubmit(selected)}
        disabled={selected.length === 0 || submitting || disabled}
      >
        {submitting
          ? "Starting Reveal Phase..."
          : submitLabel ??
            `Start Reveal Phase with ${selected.length} Finalist${selected.length === 1 ? "" : "s"}`}
      </button>
      {disabled && disabledHint ? (
        <div className="text-center text-[11px] text-[var(--text-muted)]">{disabledHint}</div>
      ) : null}
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
    return prefixedRoute ? getDisplayId(prefixedRoute.source, prefixedRoute.contractJobId) : NaN;
  }, [prefixedRoute]);
  const validRouteTask = Boolean(
    prefixedRoute &&
    Number.isInteger(prefixedRoute.contractJobId) &&
    prefixedRoute.contractJobId >= 0
  );

  const [task, setTask] = useState<UnifiedTask | null>(null);
  const [job, setJob] = useState<JobRecord | null>(null);
  const jobId = task?.jobId ?? -1;
  const [displayTaskId, setDisplayTaskId] = useState(validRouteTask ? `#${displayId}` : `#${rawJobParam}`);
  const [coreLoading, setCoreLoading] = useState(true);
  const [subsLoading, setSubsLoading] = useState(true);
  const [jobError, setJobError] = useState<string | null>(null);
  const [subsError, setSubsError] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([]);
  const [mySubmission, setMySubmission] = useState<SubmissionRecord | null>(null);
  const [selectedSubmission, setSelectedSubmission] = useState<SubmissionRecord | null>(null);
  const [isAccepted, setIsAccepted] = useState(false);
  const [maxApprovals, setMaxApprovals] = useState(1);
  const [approvalsUsed, setApprovalsUsed] = useState(0);
  const [creatorPostedCount] = useState(0);
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

  const [isJudge, setIsJudge] = useState(false);
  const [taskJudges, setTaskJudges] = useState<string[]>([]);
  const [judgeInput, setJudgeInput] = useState("");
  const [judgeSaving, setJudgeSaving] = useState(false);
  const [judgeError, setJudgeError] = useState("");
  const [visibleCount, setVisibleCount] = useState(LIST_PAGE_SIZE);
  const [expandedSubmissionId, setExpandedSubmissionId] = useState<number | null>(null);
  const [verdictsBySid, setVerdictsBySid] = useState<Map<number, Record<string, number>>>(
    new Map()
  );
  const [promotedAgents, setPromotedAgents] = useState<Set<string>>(new Set());
  const [rejectConfirmId, setRejectConfirmId] = useState<number | null>(null);
  const [respondedIds, setRespondedIds] = useState<Set<number>>(new Set());
  const [reviewBusyId, setReviewBusyId] = useState<number | null>(null);
  const [reviewError, setReviewError] = useState("");

  const taskRef = useRef<UnifiedTask | null>(null);

  const [deliverableLink, setDeliverableLink] = useState("");
  const [responseType, setResponseType] = useState<number>(RESPONSE_TYPE.BuildsOn);
  const [responseContent, setResponseContent] = useState("");
  const [showResponsePanel, setShowResponsePanel] = useState(false);
  const [rewardInputs, setRewardInputs] = useState<Record<string, string>>({});

  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [txInFlight, setTxInFlight] = useState(false);
  const [acceptState, setAcceptState] = useState<"idle" | "confirming" | "pending" | "success" | "error">("idle");
  const [acceptTxHash, setAcceptTxHash] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<"idle" | "confirming" | "pending" | "success" | "error">("idle");
  const [submitTxHash, setSubmitTxHash] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showEditForm, setShowEditForm] = useState(false);
  const [editLink, setEditLink] = useState("");
  const [editState, setEditState] = useState<"idle" | "confirming" | "pending" | "success" | "error">("idle");
  const [editTxHash, setEditTxHash] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [revealStarting, setRevealStarting] = useState(false);
  const [revealTxHash, setRevealTxHash] = useState<string | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [finalistSelecting, setFinalistSelecting] = useState(false);
  const [finalistError, setFinalistError] = useState<string | null>(null);

  const [claimReadyAt, setClaimReadyAt] = useState<number | null>(null);
  const [claimCountdown, setClaimCountdown] = useState(0);
  const [pendingReleases, setPendingReleases] = useState<PendingReleaseRecord[]>([]);

  const isConnected = Boolean(account);
  const isCreator = Boolean(account && job && account.toLowerCase() === job.client.toLowerCase());
  const canReview = Boolean(isCreator || isJudge);
  const clientAddress = job?.client ?? "";
  const bannerUrl = useMemo(() => extractBanner(job?.description ?? ""), [job?.description]);
  const jobLoading = coreLoading;
  const taskJobId = task?.jobId ?? -1;
  const taskSourceId = task?.sourceId ?? "";
  const taskHasSignalMap = Boolean(task?.caps.hasSignalMap);
  const taskLoaded = Boolean(task);

  const clearTaskCaches = useCallback(() => {
    invalidateTaskCache();
  }, []);

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

  const verdictRow = (submissionId: number): Record<string, number> =>
    verdictsBySid.get(submissionId) ?? {};
  const acceptCountFor = (submissionId: number): number =>
    Object.values(verdictRow(submissionId)).filter((verdict) => verdict === 1).length;
  const isRejectedSubmission = (submissionId: number): boolean =>
    Object.values(verdictRow(submissionId)).some((verdict) => verdict === 2);
  const isPromotedAgent = (agent: string): boolean => promotedAgents.has(agent.toLowerCase());

  const reviewQueueSubmissions = useMemo(
    () =>
      filteredListSubmissions.filter((submission) => {
        if (promotedAgents.has(submission.agent.toLowerCase())) return false;
        if (isRejectedSubmission(submission.submissionId)) return false;
        return true;
      }),
    [filteredListSubmissions, verdictsBySid, promotedAgents] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const visibleReviewSubmissions = useMemo(
    () => reviewQueueSubmissions.slice(0, Math.max(LIST_PAGE_SIZE, visibleCount)),
    [reviewQueueSubmissions, visibleCount]
  );

  const acceptedCount = useMemo(
    () =>
      filteredListSubmissions.filter((submission) => {
        const row = verdictsBySid.get(submission.submissionId);
        return Boolean(
          row &&
            !promotedAgents.has(submission.agent.toLowerCase()) &&
            Object.values(row).some((verdict) => verdict === 1)
        );
      }).length,
    [filteredListSubmissions, verdictsBySid, promotedAgents]
  );

  const promotedCount = useMemo(
    () =>
      filteredListSubmissions.filter((submission) =>
        promotedAgents.has(submission.agent.toLowerCase())
      ).length,
    [filteredListSubmissions, promotedAgents]
  );

  const rejectedCount = useMemo(
    () =>
      filteredListSubmissions.filter((submission) => {
        const row = verdictsBySid.get(submission.submissionId);
        return Boolean(row && Object.values(row).some((verdict) => verdict === 2));
      }).length,
    [filteredListSubmissions, verdictsBySid]
  );

  const promotedSubmissions = useMemo(
    () =>
      safeSubmissions.filter((submission) => promotedAgents.has(submission.agent.toLowerCase())),
    [safeSubmissions, promotedAgents]
  );

  const timelineSubmissions = useMemo(
    () =>
      safeSubmissions.filter((submission) => {
        const row = verdictsBySid.get(submission.submissionId);
        return !(row && Object.values(row).some((verdict) => verdict === 2));
      }),
    [safeSubmissions, verdictsBySid]
  );

  useEffect(() => {
    setVisibleCount(LIST_PAGE_SIZE);
    setExpandedSubmissionId(null);
  }, [submissionFilterAddress]);

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

  const loadTaskCore = useCallback(async () => {
    if (!validRouteTask || !prefixedRoute) {
      setCoreLoading(false);
      setJobError("Task not found");
      setJob(null);
      setTask(null);
      return;
    }

    setCoreLoading(true);
    setJobError(null);
    try {
      perf.start("task-core-load");
      const readProvider = getReadProvider();
      const unifiedTask = await fetchTaskBySourceAndId(prefixedRoute.source, prefixedRoute.contractJobId, readProvider);
      if (!unifiedTask) {
        setJobError("Task not found");
        setJob(null);
        setTask(null);
        return;
      }
      const jobData = unifiedTaskToJobRecord(unifiedTask);
      setTask(unifiedTask);
      setDisplayTaskId(`#${unifiedTask.displayId}`);
      setJob(jobData);
      setMaxApprovals(Math.max(1, jobData.maxApprovals || 1));
      setApprovalsUsed(jobData.approvedCount);
      setEscrowLocked(coerceBigInt(jobData.rewardUSDC) - coerceBigInt(jobData.paidOutUSDC));
    } catch (error) {
      console.error("[task] core load error:", error);
      setJob(null);
      setTask(null);
      setJobError(errorText(error, "Failed to load task"));
    } finally {
      perf.end("task-core-load");
      setCoreLoading(false);
    }
  }, [prefixedRoute, validRouteTask]);

  const loadTaskSecondary = useCallback(async () => {
    if (!task || !job) return;
    const readProvider = getReadProvider();
    const readContract = getContractForSource(task.sourceId, readProvider);

    setSubsLoading(true);
    setSubsError(null);
    try {
      perf.start("task-submissions-load");
      const rawSubmissions = await withTimeout(loadTaskSubmissions(task, readProvider), 5_000, []);
      setSubmissions(rawSubmissions);
    } catch {
      setSubmissions([]);
      setSubsError("Failed to load submissions.");
    } finally {
      perf.end("task-submissions-load");
      setSubsLoading(false);
    }

    const shouldLoadInteractions = task.caps.hasSignalMap || task.caps.canSelectFinalists || task.caps.canInteract;
    if (shouldLoadInteractions) {
      try {
        const [finalRows, revealEndRaw, revealOpenRaw, economyRaw, poolRemainingRaw] = await Promise.all([
          readContract.getSelectedFinalists(task.jobId).catch(() => []),
          readContract.getRevealPhaseEnd(task.jobId).catch(() => task.revealPhaseEnd),
          readContract.isInRevealPhase(task.jobId).catch(() => task.isInRevealPhase),
          readContract.getTaskEconomy(task.jobId).catch(() => null),
          readContract.getInteractionPoolRemaining(task.jobId).catch(() => 0n)
        ]);
        const finals = Array.from(finalRows as string[]);
        const revealEnd = Number(revealEndRaw);
        setSelectedFinalists(finals);
        setRevealPhaseEnd(revealEnd);
        setIsRevealPhase(Boolean(revealOpenRaw));

        if (economyRaw) {
          const raw = economyRaw as Record<string, unknown> & unknown[];
          setTaskEconomy({
            interactionStake: coerceBigInt(raw.interactionStake ?? raw[0] ?? 2_000_000n, 2_000_000n),
            interactionReward: coerceBigInt(raw.interactionReward ?? raw[1] ?? 0n),
            interactionPool: coerceBigInt(raw.interactionPool ?? raw[2] ?? 0n),
            interactionPoolFunded: Boolean(raw.interactionPoolFunded ?? raw[3] ?? false),
            poolRemaining: coerceBigInt(poolRemainingRaw)
          });
        }

        const parentEntries = await Promise.all(
          finals.map(async (finalist) => {
            try {
              const parent = String(await readContract.buildOnParentByResponder(task.jobId, finalist));
              return [finalist.toLowerCase(), parent] as const;
            } catch {
              return [finalist.toLowerCase(), ZERO_ADDRESS] as const;
            }
          })
        );
        setBuildOnParents(
          parentEntries.reduce<Record<string, string>>((acc, [key, value]) => {
            acc[key] = value;
            return acc;
          }, {})
        );

      } catch {
        // keep page usable if interaction data fails
      }
    }
  }, [job, task]);

  const loadTask = useCallback(async () => {
    await loadTaskCore();
  }, [loadTaskCore]);

  const loadWalletState = useCallback(async () => {
    if (!task || !account) {
      setIsAccepted(false);
      setMySubmission(null);
      setClaimReadyAt(null);
      return;
    }
    try {
      const readProvider = getReadProvider();
      const readContract = getContractForSource(task.sourceId, readProvider);
      const mine = submissions.find((submission) => submission.agent.toLowerCase() === account.toLowerCase()) ?? null;
      const [accepted, lastClaim, cooldown] = await Promise.all([
        readContract.isAccepted(task.jobId, account).catch(() => Boolean(mine)),
        fetchLastJobCredentialClaim(account),
        fetchJobCredentialCooldownSeconds()
      ]);
      setIsAccepted(Boolean(accepted));
      setMySubmission(mine);
      setClaimReadyAt(Number(lastClaim) + cooldown);
    } catch {
      setIsAccepted(false);
      setMySubmission(null);
      setClaimReadyAt(null);
    }
  }, [account, submissions, task]);

  const loadHeatmap = useCallback(async () => {
    if (!taskHasSignalMap || !Number.isInteger(taskJobId) || taskJobId < 0 || !taskSourceId) {
      setHeatmap({ people: [], totalActivity: 0, revealPhaseEnd: 0, isRevealPhase: false });
      setHeatmapLoading(false);
      return;
    }
    setHeatmapLoading(true);
    try {
      const data = await buildTaskHeatmap(getReadProvider(), Number(taskJobId), taskSourceId);
      setHeatmap(data);
    } catch (error) {
      console.warn("[heatmap] load error:", error);
      setHeatmap({ people: [], totalActivity: 0, revealPhaseEnd: 0, isRevealPhase: false });
    } finally {
      setHeatmapLoading(false);
    }
  }, [taskHasSignalMap, taskJobId, taskSourceId]);

  useEffect(() => {
    void loadTask();
  }, [loadTask]);

  useEffect(() => {
    if (coreLoading || !task || !job) return;
    void loadTaskSecondary();
  }, [coreLoading, job, loadTaskSecondary, task]);

  useEffect(() => {
    if (coreLoading) return;
    void loadWalletState();
  }, [coreLoading, loadWalletState]);

  useEffect(() => {
    void loadHeatmap();
  }, [loadHeatmap]);

  useEffect(() => {
    if (taskLoaded && !taskHasSignalMap && viewMode === "signal") {
      setViewMode("list");
    }
  }, [taskHasSignalMap, taskLoaded, viewMode]);

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
      const releases = await fetchPendingReleases(getReadProvider(), jobId, account);
      setPendingReleases(releases);
    } catch (error) {
      console.warn("[releases] load failed:", error);
      setPendingReleases([]);
    }
  }, [account, jobId, taskSourceId]);

  useEffect(() => {
    void refreshPendingReleases();
  }, [refreshPendingReleases, job?.status, revealPhaseEnd, selectedFinalists.length]);

  useEffect(() => {
    if (!taskHasSignalMap || !taskSourceId || !Number.isInteger(jobId) || jobId < 0) return () => undefined;
    const contract = getContractForSource(taskSourceId, getReadProvider());
    const refresh = async (id: bigint | number) => {
      if (Number(id) === jobId) {
        clearTaskCaches();
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
  }, [clearTaskCaches, jobId, loadTask, loadHeatmap, taskHasSignalMap, taskSourceId]);

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
    if (txInFlight) return;
    setTxInFlight(true);
    setAcceptError(null);
    setAcceptTxHash(null);
    setAcceptState("confirming");
    try {
      setBusyAction("accept");
      const contract = await getTaskWriteContract();
      const tx = await contract.acceptJob(jobId);
      setAcceptState("pending");
      setAcceptTxHash(tx.hash);
      setStatusMessage(`Accept tx: ${tx.hash}`);
      await tx.wait();
      setAcceptState("success");
      setIsAccepted(true);
      setJob((previous) =>
        previous ? { ...previous, acceptedCount: previous.acceptedCount + 1 } : previous
      );
      void loadWalletState();
    } catch (error) {
      const message = humanizeError(error);
      setAcceptState("error");
      setAcceptError(message);
      setErrorMessage(message);
    } finally {
      setBusyAction("");
      setTxInFlight(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (txInFlight) return;
    setTxInFlight(true);
    setSubmitError(null);
    setSubmitTxHash(null);
    setSubmitState("confirming");
    try {
      setBusyAction("submit");
      const contract = await getTaskWriteContract();
      const tx = typeof contract.interface.hasFunction === "function" && contract.interface.hasFunction("submitDirect")
        ? await contract.submitDirect(BigInt(jobId), deliverableLink.trim())
        : await contract.submitDeliverable(jobId, deliverableLink.trim());
      setSubmitState("pending");
      setSubmitTxHash(tx.hash);
      setStatusMessage(`Submit tx: ${tx.hash}`);
      await tx.wait();
      setDeliverableLink("");
      setSubmitState("success");
      setIsAccepted(true);
      void loadTaskSecondary();
      void loadWalletState();
      void loadHeatmap();
    } catch (error) {
      const message = humanizeError(error);
      setSubmitState("error");
      setSubmitError(message);
      setErrorMessage(message);
    } finally {
      setBusyAction("");
      setTxInFlight(false);
    }
  };

  const handleEditSubmission = async (event: FormEvent) => {
    event.preventDefault();
    if (txInFlight) return;
    setTxInFlight(true);
    setEditError(null);
    setEditTxHash(null);
    setEditState("confirming");
    try {
      setBusyAction("edit");
      const contract = await getTaskWriteContract();
      if (
        typeof contract.interface.hasFunction !== "function" ||
        !contract.interface.hasFunction("updateDeliverable")
      ) {
        throw new Error("Editing submissions is not supported on this deployment yet.");
      }
      const tx = await contract.updateDeliverable(BigInt(jobId), editLink.trim());
      setEditState("pending");
      setEditTxHash(tx.hash);
      setStatusMessage(`Edit tx: ${tx.hash}`);
      await tx.wait();
      setEditState("success");
      void loadTaskSecondary();
      void loadWalletState();
    } catch (error) {
      const message = humanizeError(error);
      setEditState("error");
      setEditError(message);
      setErrorMessage(message);
    } finally {
      setBusyAction("");
      setTxInFlight(false);
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
    if (respondedIds.has(selectedSubmission.submissionId)) {
      setErrorMessage("You already responded to this submission - each wallet can respond only once.");
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
      setRespondedIds((previous) => new Set(previous).add(selectedSubmission.submissionId));
      clearTaskCaches();
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
      clearTaskCaches();
      await loadHeatmap();
      await loadTask();
    } catch (error) {
      setErrorMessage(errorText(error, "Failed to slash response stake"));
    } finally {
      setBusyAction("");
    }
  };

  const canCallAutoStartReveal = async (
    contract: Awaited<ReturnType<typeof getTaskWriteContract>>,
    currentJobId: number
  ): Promise<{ can: boolean; reason: string }> => {
    try {
      const rawJob = await contract.getJob(BigInt(currentJobId));
      const status = Number(rawJob.status ?? rawJob[14] ?? 0);
      const deadline = Number(rawJob.deadline ?? rawJob[4] ?? 0);
      const maxApprovalsRaw = Number(rawJob.maxApprovals ?? rawJob[6] ?? 1);
      const maxApprovalsSafe = Number.isFinite(maxApprovalsRaw) && maxApprovalsRaw > 0 ? maxApprovalsRaw : 1;
      const now = Math.floor(Date.now() / 1000);

      if (deadline <= 0 || now <= deadline) {
        return { can: false, reason: "Deadline has not passed" };
      }
      if (!(status === 0 || status === 1 || status === 2)) {
        return { can: false, reason: `Wrong status: ${status}` };
      }

      const selected = Array.from((await contract.getSelectedFinalists(BigInt(currentJobId)).catch(() => [])) as string[]);
      if (selected.length > 0) {
        return { can: false, reason: "Finalists already selected" };
      }

      let submittedCount = 0;
      for (let idx = 0; idx < 50; idx += 1) {
        try {
          const agent = String(await contract.submittedAgents(BigInt(currentJobId), idx));
          if (!agent || agent.toLowerCase() === ZERO_ADDRESS.toLowerCase()) break;
          const submission = await contract.getSubmission(BigInt(currentJobId), agent).catch(() => null);
          if (!submission) continue;
          const parsed = parseSubmission(submission);
          if (
            parsed.agent &&
            parsed.agent.toLowerCase() !== ZERO_ADDRESS.toLowerCase() &&
            parsed.status === 1
          ) {
            submittedCount += 1;
          }
        } catch {
          break;
        }
      }

      if (submittedCount === 0) {
        const rows = Array.from((await contract.getSubmissions(BigInt(currentJobId)).catch(() => [])) as unknown[]);
        submittedCount = rows.filter((row) => {
          const parsed = parseSubmission(row);
          return (
            parsed.agent &&
            parsed.agent.toLowerCase() !== ZERO_ADDRESS.toLowerCase() &&
            parsed.status === 1
          );
        }).length;
      }

      if (submittedCount === 0) {
        return { can: false, reason: "No submitted submissions" };
      }
      if (submittedCount > maxApprovalsSafe + 5) {
        return {
          can: false,
          reason: `Too many submissions (${submittedCount}) - select finalists first`
        };
      }

      await contract.autoStartReveal.estimateGas(BigInt(currentJobId));
      return { can: true, reason: "OK" };
    } catch (error) {
      return {
        can: false,
        reason: errorText(error, "autoStartReveal precheck failed").slice(0, 180)
      };
    }
  };

  const handleSetVerdict = async (submission: SubmissionRecord, verdict: 1 | 2) => {
    if (!signer || !account) {
      setReviewError("Connect a wallet to review submissions.");
      return;
    }
    try {
      setReviewBusyId(submission.submissionId);
      setReviewError("");
      setRejectConfirmId(null);
      await withProvider();
      const contract = await getTaskWriteContract();
      const hasFlag =
        typeof contract.interface.hasFunction === "function" &&
        contract.interface.hasFunction("setReviewVerdict(uint256,uint256,uint8)");
      if (!hasFlag) {
        throw new Error("This contract deployment does not support review verdicts yet.");
      }
      const tx = await contract.setReviewVerdict(
        BigInt(jobId),
        BigInt(submission.submissionId),
        verdict
      );
      await tx.wait();
      setVerdictsBySid((previous) => {
        const next = new Map(previous);
        const row = { ...next.get(submission.submissionId) };
        row[account.toLowerCase()] = verdict;
        next.set(submission.submissionId, row);
        return next;
      });
      setStatusMessage(
        verdict === 1
          ? "Submission accepted - promote it to move it toward the reveal."
          : "Submission rejected - removed from the queue and timeline."
      );
    } catch (error) {
      setReviewError(humanizeError(error));
    } finally {
      setReviewBusyId(null);
    }
  };

  const handleRejectClick = (submission: SubmissionRecord) => {
    if (rejectConfirmId !== submission.submissionId) {
      setRejectConfirmId(submission.submissionId);
      return;
    }
    void handleSetVerdict(submission, 2);
  };

  const handleTogglePromote = async (submission: SubmissionRecord) => {
    if (!signer || !account) {
      setReviewError("Connect a wallet to manage the reveal shortlist.");
      return;
    }
    const agentKey = submission.agent.toLowerCase();
    const promoting = !promotedAgents.has(agentKey);
    try {
      setReviewBusyId(submission.submissionId);
      setReviewError("");
      setRejectConfirmId(null);
      await withProvider();
      const contract = await getTaskWriteContract();
      const hasFlag =
        typeof contract.interface.hasFunction === "function" &&
        contract.interface.hasFunction("setPromoted(uint256,address,bool)");
      if (!hasFlag) {
        throw new Error("This contract deployment does not support promotion yet.");
      }
      const tx = await contract.setPromoted(BigInt(jobId), submission.agent, promoting);
      await tx.wait();
      setPromotedAgents((previous) => {
        const next = new Set(previous);
        if (promoting) next.add(agentKey);
        else next.delete(agentKey);
        return next;
      });
      setStatusMessage(
        promoting
          ? "Promoted - it will be revealed when the reveal phase begins."
          : "Removed from the reveal shortlist."
      );
    } catch (error) {
      setReviewError(humanizeError(error));
    } finally {
      setReviewBusyId(null);
    }
  };

  const handleSaveJudges = async (overrideList?: string[]) => {
    if (!signer || !account) {
      setJudgeError("Connect your wallet to manage judges.");
      return;
    }
    if (!task || !isCreator) return;

    const parsed = judgeInput
      .split(/[\s,;]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);

    const invalid = parsed.filter((entry) => !/^0x[0-9a-fA-F]{40}$/.test(entry));
    if (invalid.length > 0) {
      setJudgeError(`Invalid address: ${invalid[0]}`);
      return;
    }

    if (overrideList === undefined && parsed.length === 0) {
      setJudgeError("Paste at least one address to add.");
      return;
    }

    // Saving without an explicit list appends to the current judges; the Remove
    // button passes the exact remaining list instead.
    const merged = overrideList ?? [...taskJudges, ...parsed];
    const unique = Array.from(new Set(merged.map((entry) => entry.toLowerCase()))).filter(
      (entry) => entry !== job?.client.toLowerCase()
    );
    if (unique.length > 10) {
      setJudgeError(`A task can have at most 10 judges (this would be ${unique.length}).`);
      return;
    }

    try {
      setJudgeSaving(true);
      setJudgeError("");
      await withProvider();
      const contract = await getTaskWriteContract();
      const hasFlag =
        typeof contract.interface.hasFunction === "function" &&
        contract.interface.hasFunction("setJudges(uint256,address[])");
      if (!hasFlag) {
        throw new Error("This contract deployment does not support judges yet.");
      }
      const tx = await contract.setJudges(BigInt(jobId), unique);
      await tx.wait();
      setJudgeInput("");
      const list = await fetchTaskJudges(jobId);
      setTaskJudges(list);
      setIsJudge(unique.includes(account.toLowerCase()));
      setStatusMessage(
        overrideList
          ? `Judge removed: ${unique.length} remaining.`
          : `Judges updated: ${unique.length} address${unique.length === 1 ? "" : "es"}.`
      );
    } catch (error) {
      setJudgeError(errorText(error, "Failed to update judges"));
    } finally {
      setJudgeSaving(false);
    }
  };

  const handleSelectFinalists = async (agents: string[]) => {
    if (!agents.length) return;
    if (finalistSelecting) return;
    try {
      setFinalistSelecting(true);
      setFinalistError(null);
      const unique = [
        ...new Set(
          agents
            .map((address) => address.toLowerCase())
            .map((address) => safeSubmissions.find((submission) => submission.agent.toLowerCase() === address)?.agent)
            .filter((value): value is string => Boolean(value))
        )
      ];
      const threshold = Number(maxApprovals || 1) + 5;
      if (unique.length > threshold) {
        throw new Error(`Too many finalists selected (${unique.length}/${threshold}).`);
      }
      const contract = await getTaskWriteContract();
      const tx = await contract.selectFinalists(BigInt(jobId), unique);
      await tx.wait();
      const txHash = tx.hash as string;
      setStatusMessage(`Reveal phase tx: ${txHash}`);
      clearTaskCaches();
      await loadTask();
      await loadHeatmap();
      const freshJob = await contract.getJob(BigInt(jobId));
      const freshStatus = Number(freshJob.status ?? freshJob[14] ?? 0);
      if (freshStatus !== 4) {
        setFinalistError(`Finalists selected but reveal not active yet (status ${freshStatus}).`);
      }
    } catch (error) {
      const message = errorText(error, "Failed selecting finalists");
      setFinalistError(message);
      setErrorMessage(message);
    } finally {
      setFinalistSelecting(false);
    }
  };

  const handleAutoStartReveal = async () => {
    if (!signer) {
      const message = "Connect wallet to start reveal phase.";
      setRevealError(message);
      setErrorMessage(message);
      return;
    }
    if (!task) return;
    if (revealStarting) return;

    try {
      setRevealStarting(true);
      setRevealError(null);
      setRevealTxHash(null);
      const contract = getContractForSource(task.sourceId, signer);
      const precheck = await canCallAutoStartReveal(contract, jobId);
      if (!precheck.can) {
        const message = `Cannot start reveal: ${precheck.reason}`;
        setRevealError(message);
        setErrorMessage(message);
        return;
      }

      console.log("[reveal] Calling autoStartReveal for job", jobId);
      const tx = await contract.autoStartReveal(BigInt(jobId));
      setRevealTxHash(tx.hash as string);
      const receipt = await tx.wait();
      if (receipt?.status === 0) {
        throw new Error("Transaction reverted on-chain");
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
      const freshJob = await contract.getJob(BigInt(jobId));
      const freshStatus = Number(freshJob.status ?? freshJob[14] ?? 0);
      if (freshStatus !== 4) {
        throw new Error(`Reveal did not start — status is ${freshStatus}, expected 4`);
      }

      setStatusMessage(`Reveal phase started automatically: ${tx.hash}`);
      clearTaskCaches();
      await loadTask();
      await loadHeatmap();
      window.location.reload();
    } catch (error) {
      const message = errorText(error, "Failed to start auto-reveal").slice(0, 200);
      setRevealError(message);
      setErrorMessage(message);
    } finally {
      setRevealStarting(false);
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
      clearTaskCaches();
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
      clearTaskCaches();
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
      clearTaskCaches();
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
      clearTaskCaches();
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
    ? deriveDisplayStatus(job.status, job.deadline, revealEndValue, job.submissionCount, hasSubmitted, isCreator)
    : null;
  const canClaim = Boolean(
    displayStatus?.canClaim && isConnected && !viewerIsCreator && viewerSubmissionApproved && !isClaimed && claimCountdown <= 0
  );
  const revealEnded = Boolean(job?.status === 4 && revealEndValue > 0 && Math.floor(Date.now() / 1000) > revealEndValue);
  const submissionDeadlinePassed = Boolean(
    job && job.deadline > 0 && BigInt(Math.floor(Date.now() / 1000)) > BigInt(job.deadline)
  );
  const awaitingSelection = Boolean(
    job && submissionDeadlinePassed && safeSubmissions.length > 0 && (job.status === 2 || job.status === 0 || job.status === 1)
  );
  const submittedCountForReveal = pendingSubmissions.length;
  const finalistThreshold = Number(maxApprovals || 1) + 5;
  const canAutoReveal = Boolean(
    task?.caps.canAutoReveal &&
      job &&
      displayStatus?.canAutoReveal &&
      submissionDeadlinePassed &&
      (job.status === 0 || job.status === 1 || job.status === 2) &&
      submittedCountForReveal > 0 &&
      submittedCountForReveal <= finalistThreshold
  );
  const canStageFinalists = Boolean(
    canReview &&
      task?.caps.canSelectFinalists &&
      job &&
      (job.status === 1 || job.status === 2) &&
      submittedCountForReveal > 0
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
      !isJudge &&
      !viewerHasSubmitted
  );
  const showAcceptAction = Boolean(canSubmitToTask && !isAccepted);
  const showSubmitAction = Boolean(canSubmitToTask && isAccepted);
  const showInteractionAction = Boolean(
    task?.caps.canInteract &&
      isRevealActive &&
      isConnected &&
      !viewerIsCreator &&
      !isJudge &&
      job?.status === 4
  );
  const canEditSubmission = Boolean(
    isConnected &&
      viewerHasSubmitted &&
      mySubmission &&
      mySubmission.status !== 2 &&
      !isClaimed &&
      !viewerIsCreator &&
      !isJudge &&
      !submissionDeadlinePassed
  );
  const finalistInteractionPool = safeSubmissions.filter((submission) =>
    finalistSet.has(submission.agent.toLowerCase())
  );
  const respondedFinalistCount = finalistInteractionPool.filter((submission) =>
    respondedIds.has(submission.submissionId)
  ).length;
  const remainingInteractions = Math.max(0, finalistInteractionPool.length - respondedFinalistCount);
  const selectedAlreadyResponded = Boolean(
    selectedSubmission && respondedIds.has(selectedSubmission.submissionId)
  );
  const canInteract = Boolean(
    task?.caps.canInteract &&
      showInteractionAction &&
      isRevealActive &&
      signer &&
      isConnected &&
      selectedSubmission &&
      isSelectedFinalist &&
      !isOwnSelectedSubmission &&
      !selectedAlreadyResponded
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
    let active = true;
    if (!Number.isInteger(jobId) || jobId < 0) return () => undefined;
    void (async () => {
      const [judgeFlag, list] = await Promise.all([
        account ? fetchIsJudge(jobId, account) : Promise.resolve(false),
        fetchTaskJudges(jobId)
      ]);
      if (!active) return;
      setIsJudge(judgeFlag);
      setTaskJudges(list);
    })();
    return () => {
      active = false;
    };
  }, [account, jobId, job?.status]);

  useEffect(() => {
    let active = true;
    if (safeSubmissions.length === 0 || !Number.isInteger(jobId) || jobId < 0) {
      setVerdictsBySid(new Map());
      setPromotedAgents(new Set());
      return () => {
        active = false;
      };
    }
    const reviewers = clientAddress ? [clientAddress, ...taskJudges] : [];
    void fetchTriageState(
      jobId,
      safeSubmissions.map((submission) => ({
        submissionId: submission.submissionId,
        agent: submission.agent
      })),
      reviewers
    ).then((state) => {
      if (active) {
        setVerdictsBySid(state.verdicts);
        setPromotedAgents(state.promoted);
      }
    });
    return () => {
      active = false;
    };
  }, [jobId, safeSubmissions, taskJudges, clientAddress]);

  useEffect(() => {
    let active = true;
    if (!account || !isRevealActive || safeSubmissions.length === 0) {
      setRespondedIds(new Set());
      return () => {
        active = false;
      };
    }
    const finalists = safeSubmissions.filter((submission) =>
      finalistSet.has(submission.agent.toLowerCase())
    );
    const ids = (finalists.length > 0 ? finalists : safeSubmissions).map(
      (submission) => submission.submissionId
    );
    void fetchHasRespondedMap(ids, account).then((marks) => {
      if (active) setRespondedIds(marks);
    });
    return () => {
      active = false;
    };
  }, [account, isRevealActive, safeSubmissions, finalistSet]);

  useEffect(() => {
    setDisplayTaskId(task?.displayId ? `#${task.displayId}` : validRouteTask ? `#${displayId}` : `#${rawJobParam}`);
  }, [displayId, rawJobParam, task?.displayId, validRouteTask]);

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

      {bannerUrl ? (
        <div className="panel overflow-hidden p-0">
          <img
            src={bannerUrl}
            alt={`${job.title} banner`}
            className="aspect-[3/1] w-full object-cover"
          />
        </div>
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
          <div className="flex items-center gap-2"><span className="text-label">SUBMISSIONS</span><span className="text-data">{Math.max(job.submissionCount, safeSubmissions.length)}</span></div>
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

          {subsLoading ? (
            <div className="text-xs font-mono text-[var(--text-muted)]">Loading submissions...</div>
          ) : null}
          {subsError ? (
            <button
              type="button"
              className="text-xs text-[var(--text-muted)] underline"
              onClick={() => {
                setSubsError(null);
                void loadTaskSecondary();
              }}
            >
              Failed to load submissions - retry
            </button>
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
                <div className="signal-map-wrapper w-full overflow-hidden">
                  <SignalMap
                    heatmap={heatmap}
                    loading={heatmapLoading}
                    taskId={jobId}
                    sourceId={task?.sourceId}
                    provider={getReadProvider()}
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
            !task?.caps.showsSubmissionsToAll && !canReview && !shouldShowSignalMap ? (
              <div className="flex h-48 flex-col items-center justify-center border border-[var(--border)] p-6 text-center">
                <div className="mb-3 font-mono text-2xl text-[var(--arc)]">?</div>
                <div className="font-heading mb-2 text-base font-semibold">Submissions are sealed</div>
                <div className="max-w-xs text-sm text-[var(--text-secondary)]">
                  Submissions are hidden until accepted submissions are promoted and the creator
                  begins the 5-day reveal phase. This prevents copying and ensures independent
                  solutions.
                </div>
                {submissionDeadlinePassed ? (
                  <div className="mt-3 text-xs font-mono text-[var(--warn)]">
                    Submission deadline passed - Awaiting creator to begin the reveal phase
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

                {canReview ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 border border-[var(--border)] px-3 py-2 text-[11px]">
                    <span className="font-mono text-[var(--text-secondary)]">
                      {reviewQueueSubmissions.length} in review queue
                      {acceptedCount > 0 ? ` · ${acceptedCount} accepted` : ""}
                      {promotedCount > 0 ? ` · ${promotedCount} promoted` : ""}
                      {rejectedCount > 0 ? ` · ${rejectedCount} rejected (hidden)` : ""}
                    </span>
                  </div>
                ) : null}

                {reviewError ? (
                  <div className="border border-[var(--danger)] px-3 py-2 text-xs text-[var(--danger)]">
                    {reviewError}
                  </div>
                ) : null}

                {visibleReviewSubmissions.length === 0 ? (
                  <div className="p-4 text-xs font-mono text-[var(--text-muted)]">
                    {filteredListSubmissions.length === 0 ? "No submissions to display" : "Review queue is empty"}
                  </div>
                ) : (
                  visibleReviewSubmissions.map((submission) => {
                    const isExpanded = expandedSubmissionId === submission.submissionId;
                    const isPromoted = isPromotedAgent(submission.agent);
                    const verdictRowForSubmission = verdictRow(submission.submissionId);
                    const acceptedBy = Object.keys(verdictRowForSubmission).filter(
                      (reviewer) => verdictRowForSubmission[reviewer] === 1
                    );
                    const isAcceptedBySomeone = acceptedBy.length > 0;
                    const alreadyResponded = respondedIds.has(submission.submissionId);
                    const triageVisible = Boolean(job && canReview && job.status <= 3);
                    const finalistLimit = Number(maxApprovals || 1) + 5;
                    const promoteFull =
                      !isPromoted && promotedAgents.size >= finalistLimit;
                    const busy = reviewBusyId === submission.submissionId;
                    return (
                      <article
                        key={`${submission.agent}-${submission.submissionId}`}
                        className="card-sharp space-y-2 p-4"
                      >
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-2 text-left"
                          onClick={() =>
                            setExpandedSubmissionId(isExpanded ? null : submission.submissionId)
                          }
                        >
                          <UserDisplay
                            address={submission.agent}
                            showAvatar={true}
                            avatarSize={28}
                            className="min-w-0"
                          />
                          <span className="flex shrink-0 items-center gap-1.5">
                            {isAcceptedBySomeone && !isPromoted ? (
                              <span className="badge" style={{ color: "#7A9BB5" }}>
                                ACCEPTED ({acceptedBy.length})
                              </span>
                            ) : null}
                            {isPromoted ? <span className="badge badge-arc">PROMOTED</span> : null}
                            <span className="badge badge-arc">
                              {submission.status === 2
                                ? "APPROVED"
                                : submission.status === 1
                                  ? "SUBMITTED"
                                  : "PENDING"}
                            </span>
                          </span>
                        </button>

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

                        {alreadyResponded ? (
                          <div className="border border-[var(--border)] px-2 py-1.5 text-center text-[11px] text-[var(--text-secondary)]">
                            You already responded to this submission - 1 response per wallet per submission.
                          </div>
                        ) : null}

                        {!isCreator && isRevealActive ? (
                          account?.toLowerCase() === submission.agent.toLowerCase() ? (
                            <div className="border border-[var(--border)] p-2 text-center text-xs text-[var(--text-muted)]">
                              You cannot respond to your own submission.
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="btn-ghost w-full text-xs"
                              disabled={alreadyResponded}
                              onClick={() => setSelectedSubmission(submission)}
                            >
                              {alreadyResponded
                                ? "Already responded"
                                : selectedSubmission?.submissionId === submission.submissionId
                                  ? "Selected for Response"
                                  : "Select for Response"}
                            </button>
                          )
                        ) : null}

                        {isExpanded && acceptedBy.length > 0 ? (
                          <div className="border border-[var(--border)] px-2 py-1.5 text-[11px] text-[var(--text-secondary)]">
                            Accepted by:{" "}
                            {acceptedBy.map((reviewer, index) => (
                              <span key={reviewer}>
                                {index > 0 ? " · " : ""}
                                <span className="font-mono">
                                  {shortAddress(reviewer)}
                                </span>
                              </span>
                            ))}
                          </div>
                        ) : null}

                        {triageVisible ? (
                          <div className="flex gap-2 border-t border-[var(--border)] pt-3">
                            {isPromoted ? (
                              <button
                                type="button"
                                className="btn-ghost flex-1 text-xs"
                                disabled={busy}
                                onClick={() => void handleTogglePromote(submission)}
                              >
                                {busy ? "Working..." : "Promoted ✓ (un-promote)"}
                              </button>
                            ) : isAcceptedBySomeone ? (
                              <button
                                type="button"
                                className="btn-primary flex-1 text-xs"
                                disabled={busy || promoteFull}
                                onClick={() => void handleTogglePromote(submission)}
                              >
                                {busy
                                  ? "Working..."
                                  : promoteFull
                                    ? `Slots full (${finalistLimit})`
                                    : "Promote"}
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="btn-ghost flex-1 text-xs"
                                  disabled={busy}
                                  onClick={() => void handleSetVerdict(submission, 1)}
                                >
                                  {busy ? "Working..." : "Accept"}
                                </button>
                                <button
                                  type="button"
                                  className="btn-ghost flex-1 text-xs"
                                  style={
                                    rejectConfirmId === submission.submissionId
                                      ? { borderColor: "var(--danger)", color: "var(--danger)" }
                                      : undefined
                                  }
                                  disabled={busy}
                                  onClick={() => handleRejectClick(submission)}
                                >
                                  {busy
                                    ? "Working..."
                                    : rejectConfirmId === submission.submissionId
                                      ? "Confirm reject?"
                                      : "Reject"}
                                </button>
                              </>
                            )}
                          </div>
                        ) : null}
                      </article>
                    );
                  })
                )}

                {reviewQueueSubmissions.length > visibleReviewSubmissions.length ? (
                  <button
                    type="button"
                    className="btn-ghost w-full text-xs"
                    onClick={() => setVisibleCount((previous) => previous + LIST_PAGE_SIZE)}
                  >
                    Open more ({reviewQueueSubmissions.length - visibleReviewSubmissions.length} remaining)
                  </button>
                ) : null}
              </div>
            )
          ) : null}

          {viewMode === "timeline" ? (
            <div className="panel space-y-2">
              {timelineSubmissions.length === 0 ? (
                <div className="p-4 text-xs font-mono text-[var(--text-muted)]">
                  No submissions to display
                </div>
              ) : (
                timelineSubmissions.map((submission) => {
                  const isPromoted = isPromotedAgent(submission.agent);
                  const acceptedCountForRow = acceptCountFor(submission.submissionId);
                  const finalistLimit = Number(maxApprovals || 1) + 5;
                  const promoteFull =
                    !isPromoted && promotedAgents.size >= finalistLimit;
                  const busy = reviewBusyId === submission.submissionId;
                  const triageVisible = Boolean(job && canReview && job.status <= 3);
                  return (
                    <div
                      key={`timeline-${submission.submissionId}`}
                      className="card-sharp flex items-center justify-between px-3 py-2 text-xs gap-3"
                    >
                      <UserDisplay address={submission.agent} showAvatar={true} avatarSize={24} />
                      <span className="flex min-w-0 items-center gap-2">
                        {acceptedCountForRow > 0 && !isPromoted ? (
                          <span className="badge" style={{ color: "#7A9BB5" }}>
                            ACCEPTED ({acceptedCountForRow})
                          </span>
                        ) : null}
                        {isPromoted ? <span className="badge badge-arc">PROMOTED</span> : null}
                        {triageVisible ? (
                          isPromoted ? (
                            <button
                              type="button"
                              className="btn-ghost px-2 py-1 text-[10px]"
                              disabled={busy}
                              onClick={() => void handleTogglePromote(submission)}
                            >
                              {busy ? "..." : "Un-promote"}
                            </button>
                          ) : acceptedCountForRow > 0 ? (
                            <button
                              type="button"
                              className="btn-primary px-2 py-1 text-[10px]"
                              disabled={busy || promoteFull}
                              onClick={() => void handleTogglePromote(submission)}
                            >
                              {busy ? "..." : promoteFull ? "Slots full" : "Promote"}
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="btn-ghost px-2 py-1 text-[10px]"
                                disabled={busy}
                                onClick={() => void handleSetVerdict(submission, 1)}
                              >
                                {busy ? "..." : "Accept"}
                              </button>
                              <button
                                type="button"
                                className="btn-ghost px-2 py-1 text-[10px]"
                                style={
                                  rejectConfirmId === submission.submissionId
                                    ? { borderColor: "var(--danger)", color: "var(--danger)" }
                                    : undefined
                                }
                                disabled={busy}
                                onClick={() => handleRejectClick(submission)}
                              >
                                {busy
                                  ? "..."
                                  : rejectConfirmId === submission.submissionId
                                    ? "Confirm?"
                                    : "Reject"}
                              </button>
                            </>
                          )
                        ) : null}
                        <span className="shrink-0 font-mono text-[var(--text-muted)]">
                          {formatTimestamp(submission.submittedAt)}
                        </span>
                      </span>
                    </div>
                  );
                })
              )}
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

          {canAutoReveal && job.status !== 4 && job.status !== 5 && job.status !== 6 ? (
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
                This task has {submittedCountForReveal} submitted submission{submittedCountForReveal !== 1 ? "s" : ""} - under
                the {finalistThreshold} finalist threshold. Anyone can trigger the reveal phase automatically, selecting
                every non-rejected submission for the reveal.
                </div>
              <button
                type="button"
                className="btn-primary w-full"
                onClick={() => void handleAutoStartReveal()}
                disabled={revealStarting || !signer}
                style={{ opacity: revealStarting ? 0.6 : 1 }}
              >
                {revealStarting ? "Starting Reveal Phase..." : "Start Reveal Phase Automatically"}
              </button>
              {revealTxHash && !revealError ? (
                <div className="mt-2 text-[11px] font-mono text-[var(--arc)]">
                  Tx: {revealTxHash.slice(0, 20)}... (confirming)
                </div>
              ) : null}
              {!signer ? (
                <div className="mt-2 text-[11px] font-mono text-[var(--text-muted)]">
                  Connect wallet to submit the transaction.
                </div>
              ) : null}
              {revealError ? (
                <div className="mt-2 text-xs text-[var(--danger)]">
                  {revealError}
                  <button
                    type="button"
                    className="ml-2 text-[11px] text-[var(--text-muted)] underline"
                    onClick={() => {
                      setRevealError(null);
                      setRevealStarting(false);
                    }}
                  >
                    Retry
                  </button>
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
                <div className="space-y-2">
                  <button
                    type="button"
                    className="btn-primary w-full"
                    onClick={() => void handleAccept()}
                    disabled={txInFlight || busyAction === "accept"}
                  >
                    {acceptState === "confirming"
                      ? "Confirm in wallet..."
                      : acceptState === "pending"
                        ? "Transaction pending..."
                        : acceptState === "success"
                          ? "Accepted"
                          : "Accept Task"}
                  </button>
                  {acceptTxHash ? (
                    <div className="text-[11px] font-mono text-[var(--arc)] break-all">
                      Tx: {acceptTxHash}
                    </div>
                  ) : null}
                  {acceptError ? (
                    <div className="text-xs text-[var(--danger)]">
                      {acceptError}{" "}
                      <button
                        type="button"
                        className="underline text-[11px] text-[var(--text-muted)]"
                        onClick={() => {
                          setAcceptError(null);
                          setAcceptState("idle");
                        }}
                      >
                        Retry
                      </button>
                    </div>
                  ) : null}
                </div>
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
                    disabled={txInFlight || busyAction === "submit" || !deliverableLink.trim()}
                  >
                    {submitState === "confirming"
                      ? "Confirm in wallet..."
                      : submitState === "pending"
                        ? "Transaction pending..."
                        : submitState === "success"
                          ? "Submitted"
                          : "Submit Work"}
                  </button>
                  {submitTxHash ? (
                    <div className="text-[11px] font-mono text-[var(--arc)] break-all">
                      Tx: {submitTxHash}
                    </div>
                  ) : null}
                  {submitError ? (
                    <div className="text-xs text-[var(--danger)]">
                      {submitError}{" "}
                      <button
                        type="button"
                        className="underline text-[11px] text-[var(--text-muted)]"
                        onClick={() => {
                          setSubmitError(null);
                          setSubmitState("idle");
                        }}
                      >
                        Retry
                      </button>
                    </div>
                  ) : null}
                </form>
              ) : null}

              {canEditSubmission && !showEditForm ? (
                <button
                  type="button"
                  className="btn-ghost w-full"
                  onClick={() => {
                    setEditLink(mySubmission?.deliverableLink ?? "");
                    setEditError(null);
                    setEditState("idle");
                    setShowEditForm(true);
                  }}
                >
                  Edit your submission
                </button>
              ) : null}

              {canEditSubmission && showEditForm ? (
                <form className="space-y-3" onSubmit={handleEditSubmission}>
                  <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    Edit deliverable link - deadline applies
                  </div>
                  <input
                    type="url"
                    className="input-field"
                    placeholder="https://github.com/... or ipfs://..."
                    value={editLink}
                    onChange={(event) => setEditLink(event.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      className="btn-primary flex-1"
                      disabled={
                        txInFlight ||
                        busyAction === "edit" ||
                        !editLink.trim() ||
                        editState === "success"
                      }
                    >
                      {editState === "confirming"
                        ? "Confirm in wallet..."
                        : editState === "pending"
                          ? "Transaction pending..."
                          : editState === "success"
                            ? "Saved"
                            : "Save Changes"}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={txInFlight}
                      onClick={() => {
                        setShowEditForm(false);
                        setEditError(null);
                        setEditState("idle");
                      }}
                    >
                      {editState === "success" ? "Close" : "Cancel"}
                    </button>
                  </div>
                  {editState === "success" ? (
                    <div className="text-xs text-[var(--pulse)]">
                      Deliverable updated. Previous review marks were reset so reviewers
                      re-review the new link.
                    </div>
                  ) : null}
                  {editTxHash ? (
                    <div className="text-[11px] font-mono text-[var(--arc)] break-all">
                      Tx: {editTxHash}
                    </div>
                  ) : null}
                  {editError ? (
                    <div className="text-xs text-[var(--danger)]">
                      {editError}{" "}
                      <button
                        type="button"
                        className="underline text-[11px] text-[var(--text-muted)]"
                        onClick={() => {
                          setEditError(null);
                          setEditState("idle");
                        }}
                      >
                        Retry
                      </button>
                    </div>
                  ) : null}
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
                    REVEAL PHASE CLOSED
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
                  {job.status === 5 ? "Task is closed" : ""}
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
                  {finalistInteractionPool.length > 0 ? (
                    <div className="border px-3 py-2 text-[11px] text-[var(--text-secondary)]" style={{ borderColor: "var(--border)" }}>
                      <span className="font-mono text-[var(--text-primary)]">
                        {respondedFinalistCount}/{finalistInteractionPool.length}
                      </span>{" "}
                      submissions responded to -{" "}
                      <span className="font-mono text-[var(--arc)]">{remainingInteractions} left</span> to critique or
                      build on. Each wallet can respond to each submission only once.
                    </div>
                  ) : null}

                  <button
                    type="button"
                    className="btn-ghost w-full"
                    onClick={() => setShowResponsePanel((value) => !value)}
                    disabled={selectedAlreadyResponded}
                  >
                    {selectedAlreadyResponded
                      ? "Already responded to this submission"
                      : showResponsePanel
                        ? "Close Response Panel"
                        : "Respond to Selected Submission"}
                  </button>

                  {selectedAlreadyResponded ? (
                    <div className="border border-[var(--border)] p-2 text-center text-[11px] text-[var(--text-muted)]">
                      You already responded to this submission. Pick another finalist -{" "}
                      {remainingInteractions} left.
                    </div>
                  ) : null}

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

          {isConnected && isCreator && job && (job.status === 0 || job.status === 1 || job.status === 2) ? (
            <div className="space-y-3 border-b border-[var(--border)] pb-4">
              <div className="section-header">JUDGES</div>
              <div className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                Paste wallet addresses (comma or newline separated) to let them accept or reject
                submissions, promote accepted submissions, and begin the 5-day reveal phase. New
                addresses are added to the current list; judges cannot submit work to this task.
              </div>
              <textarea
                aria-label="Judge wallet addresses"
                className="archon-input min-h-20 w-full text-xs"
                placeholder="0xabc..., 0xdef..."
                value={judgeInput}
                onChange={(event) => setJudgeInput(event.target.value)}
                disabled={judgeSaving}
              />
              {judgeError ? <div className="text-xs text-[var(--danger)]">{judgeError}</div> : null}
              <button
                type="button"
                className="btn-primary w-full text-xs"
                onClick={() => void handleSaveJudges()}
                disabled={judgeSaving || !judgeInput.trim()}
              >
                {judgeSaving ? "Saving judges..." : "Save judges"}
              </button>
              {taskJudges.length > 0 ? (
                <div className="space-y-1">
                  <div className="text-[10px] font-mono text-[var(--text-muted)]">
                    CURRENT JUDGES ({taskJudges.length})
                  </div>
                  {taskJudges.map((address) => (
                    <div
                      key={address}
                      className="flex items-center justify-between gap-2 border border-[var(--border)] px-2 py-1"
                    >
                      <span className="truncate font-mono text-[11px]">{shortAddress(address)}</span>
                      <button
                        type="button"
                        className="shrink-0 text-[10px] text-rose-400 hover:underline"
                        disabled={judgeSaving}
                        onClick={() =>
                          void handleSaveJudges(
                            taskJudges.filter((entry) => entry.toLowerCase() !== address.toLowerCase())
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {canStageFinalists && promotedSubmissions.length > 0 ? (
            <FinalistSelectionPanel
              submissions={promotedSubmissions}
              maxApprovals={maxApprovals}
              selected={promotedSubmissions.map((submission) => submission.agent)}
              onToggle={(agent) => {
                const submission = safeSubmissions.find(
                  (entry) => entry.agent.toLowerCase() === agent.toLowerCase()
                );
                if (submission) void handleTogglePromote(submission);
              }}
              submitting={finalistSelecting}
              error={finalistError}
              disabled={!submissionDeadlinePassed}
              disabledHint="The reveal can begin once the submission deadline passes."
              submitLabel="Begin reveal phase"
              onSubmit={(agents) => void handleSelectFinalists(agents)}
            />
          ) : null}

          {isConnected && isCreator ? (
            <>
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
