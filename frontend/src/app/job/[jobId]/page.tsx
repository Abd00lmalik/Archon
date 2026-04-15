"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import SubmissionGraph from "@/components/submission-graph";
import type { GraphEdge, GraphNode } from "@/lib/graph";
import {
  expectedChainId,
  fetchApprovedAgentCount,
  fetchSubmissionGraph,
  fetchJobCredentialCooldownSeconds,
  fetchJob,
  fetchJobEscrow,
  fetchLastJobCredentialClaim,
  fetchJobsCompletedCount,
  fetchJobsCreatedCount,
  fetchMaxApprovalsForJob,
  fetchSubmissionForAgent,
  fetchSubmissions,
  fetchSuspicionScore,
  formatTimestamp,
  formatUsdc,
  getDeploymentConfig,
  getJobReadContract,
  getJobSignalsReadContract,
  isJobOpen,
  JobRecord,
  RESPONSE_TYPE,
  statusLabel,
  SubmissionRecord,
  submissionStatusLabel,
  SuspicionResult,
  toDisplayName,
  txAcceptJob,
  txApproveSubmission,
  txClaimJobCredential,
  txRejectSubmission,
  txRespondToSubmission,
  txSlashResponseStake,
  txSubmitDeliverable
} from "@/lib/contracts";
import { useWallet } from "@/lib/wallet-context";

type AgentInsight = {
  suspicion: SuspicionResult;
  completedCount: number;
};

type ViewMode = "graph" | "list" | "timeline";

type ResponseFormState = {
  type: number;
  content: string;
};

function shortAddress(address: string) {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function submissionClass(status: number) {
  if (status === 2) return "border border-emerald-400/30 bg-emerald-500/10 text-emerald-200";
  if (status === 3) return "border border-rose-400/30 bg-rose-500/10 text-rose-200";
  if (status === 1) return "border border-cyan-400/30 bg-cyan-500/10 text-cyan-200";
  return "border border-white/10 bg-white/5 text-[#9CA3AF]";
}

function suspicionClass(score: number) {
  if (score > 70) return "text-rose-300";
  if (score > 40) return "text-amber-300";
  return "text-[#9CA3AF]";
}

function isHttpUrl(value: string) {
  return (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("ipfs://") ||
    value.startsWith("data:")
  );
}

function parseUsdcInput(value: string): bigint | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const [whole, frac = ""] = trimmed.split(".");
    const safeWhole = whole === "" ? "0" : whole;
    const safeFrac = frac.slice(0, 6).padEnd(6, "0");
    if (!/^\d+$/.test(safeWhole) || !/^\d+$/.test(safeFrac)) return null;
    return BigInt(safeWhole) * 1_000_000n + BigInt(safeFrac);
  } catch {
    return null;
  }
}

function formatDraftValue(units: bigint | null) {
  if (units === null) return "0";
  return formatUsdc(units);
}

function formatRemainingDuration(seconds: number) {
  if (seconds <= 0) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function mapToGateway(uri: string) {
  if (uri.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${uri.replace("ipfs://", "")}`;
  }
  return uri;
}

function responseTypeLabel(value: number) {
  if (value === RESPONSE_TYPE.BuildsOn) return "builds_on";
  if (value === RESPONSE_TYPE.Critiques) return "critiques";
  return "alternative";
}

function makeResponseDataUri(content: string, responseType: number, address: string) {
  const payload = {
    responseType: responseTypeLabel(responseType),
    summary: content.slice(0, 120),
    content,
    referencedElements: [],
    agentId: address
  };
  const serialized = JSON.stringify(payload);
  if (typeof window === "undefined") {
    return `data:application/json,${encodeURIComponent(serialized)}`;
  }
  const encoded = window.btoa(unescape(encodeURIComponent(serialized)));
  return `data:application/json;base64,${encoded}`;
}

export default function JobDetailsPage() {
  const params = useParams<{ jobId: string }>();
  const { account, browserProvider, connect } = useWallet();

  const [job, setJob] = useState<JobRecord | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([]);
  const [mySubmission, setMySubmission] = useState<SubmissionRecord | null>(null);
  const [isAccepted, setIsAccepted] = useState(false);
  const [escrowLocked, setEscrowLocked] = useState<bigint>(0n);
  const [approvalsUsed, setApprovalsUsed] = useState(0);
  const [maxApprovals, setMaxApprovals] = useState(3);
  const [platformFeeBps, setPlatformFeeBps] = useState(
    getDeploymentConfig().platformFeeBps ?? getDeploymentConfig().platform?.feeBps ?? 1000
  );
  const [creatorPostedCount, setCreatorPostedCount] = useState(0);
  const [insightsByAgent, setInsightsByAgent] = useState<Record<string, AgentInsight>>({});
  const [deliverableLink, setDeliverableLink] = useState("");
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({});
  const [rewardDraftByAgent, setRewardDraftByAgent] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [claimReadyAt, setClaimReadyAt] = useState<number | null>(null);
  const [claimCountdown, setClaimCountdown] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("graph");
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({
    nodes: [],
    edges: []
  });
  const [graphLoading, setGraphLoading] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedPreview, setSelectedPreview] = useState("");
  const [showResponseForm, setShowResponseForm] = useState(false);
  const [responseForm, setResponseForm] = useState<ResponseFormState>({
    type: RESPONSE_TYPE.BuildsOn,
    content: ""
  });

  const jobId = useMemo(() => Number(params.jobId), [params.jobId]);
  const isConnected = Boolean(account);
  const isCreator = Boolean(account && job && account.toLowerCase() === job.client.toLowerCase());

  const allocatedReserved = useMemo(() => {
    return submissions.reduce((sum, submission) => {
      if (submission.status === 2 || submission.credentialClaimed) {
        return sum + BigInt(submission.allocatedReward || "0");
      }
      return sum;
    }, 0n);
  }, [submissions]);

  const remainingBeforeDraft = useMemo(() => {
    if (!job) return 0n;
    const pool = BigInt(job.rewardUSDC);
    if (allocatedReserved >= pool) return 0n;
    return pool - allocatedReserved;
  }, [allocatedReserved, job]);

  const draftTotal = useMemo(() => {
    return Object.values(rewardDraftByAgent).reduce((sum, value) => {
      const parsed = parseUsdcInput(value);
      if (!parsed) return sum;
      return sum + parsed;
    }, 0n);
  }, [rewardDraftByAgent]);

  const remainingWithDraft = useMemo(() => {
    return remainingBeforeDraft > draftTotal ? remainingBeforeDraft - draftTotal : 0n;
  }, [draftTotal, remainingBeforeDraft]);

  const myStatus = mySubmission?.status ?? 0;
  const canSubmit = isConnected && !isCreator && isAccepted && (mySubmission === null || myStatus === 3);
  const canClaim = isConnected && !isCreator && mySubmission?.status === 2 && !mySubmission.credentialClaimed;
  const claimBlockedByCooldown = canClaim && claimCountdown > 0;

  const netForMyClaim = useMemo(() => {
    if (!mySubmission?.allocatedReward) return 0n;
    const gross = BigInt(mySubmission.allocatedReward);
    const fee = (gross * BigInt(platformFeeBps)) / 10_000n;
    return gross - fee;
  }, [mySubmission?.allocatedReward, platformFeeBps]);

  const responseSignals = useMemo(() => {
    const counts = { builds_on: 0, critiques: 0, alternative: 0 };
    for (const edge of graphData.edges) {
      if (edge.type === "builds_on") counts.builds_on += 1;
      if (edge.type === "critiques") counts.critiques += 1;
      if (edge.type === "alternative") counts.alternative += 1;
    }
    return counts;
  }, [graphData.edges]);

  const timelineItems = useMemo(() => {
    const submissionItems = submissions.map((submission) => ({
      id: `submission-${submission.submissionId}`,
      at: submission.submittedAt,
      type: "Submission",
      label: `${shortAddress(submission.agent)} submitted work`
    }));
    const responseItems = graphData.nodes
      .filter((node) => node.type === "response")
      .map((node) => ({
        id: node.id,
        at: node.createdAt,
        type: "Response",
        label: `${shortAddress(node.submitterAddress)} posted ${node.responseType}`
      }));

    return [...submissionItems, ...responseItems].sort((a, b) => b.at - a.at);
  }, [graphData.nodes, submissions]);

  const loadJobData = useCallback(async () => {
    if (!Number.isInteger(jobId) || jobId < 0) {
      setError("Invalid job ID.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const [jobData, submissionRows, escrow, approvedCount, maxAllowed] = await Promise.all([
        fetchJob(jobId),
        fetchSubmissions(jobId),
        fetchJobEscrow(jobId),
        fetchApprovedAgentCount(jobId),
        fetchMaxApprovalsForJob(jobId)
      ]);

      if (!jobData) {
        setJob(null);
        setSubmissions([]);
        return;
      }

      setJob(jobData);
      setSubmissions(submissionRows);
      setEscrowLocked(escrow);
      setApprovalsUsed(approvedCount);
      setMaxApprovals(Math.max(1, maxAllowed || 3));
      setCreatorPostedCount(await fetchJobsCreatedCount(jobData.client));

      try {
        const readContract = getJobReadContract();
        setPlatformFeeBps(Number(await readContract.platformFeeBps()));
      } catch {
        setPlatformFeeBps(getDeploymentConfig().platformFeeBps ?? getDeploymentConfig().platform?.feeBps ?? 1000);
      }

      if (account) {
        const [accepted, submission, lastClaim, cooldownSeconds] = await Promise.all([
          (async () => {
            try {
              const readContract = getJobReadContract();
              return (await readContract.isAccepted(jobId, account)) as boolean;
            } catch {
              return false;
            }
          })(),
          fetchSubmissionForAgent(jobId, account),
          fetchLastJobCredentialClaim(account),
          fetchJobCredentialCooldownSeconds()
        ]);
        setIsAccepted(accepted);
        setMySubmission(submission);
        const readyAt = Number(lastClaim) + cooldownSeconds;
        setClaimReadyAt(readyAt > 0 ? readyAt : null);
      } else {
        setIsAccepted(false);
        setMySubmission(null);
        setClaimReadyAt(null);
      }

      if (submissionRows.length > 0) {
        const insightEntries = await Promise.all(
          submissionRows.map(async (submission) => {
            const [suspicion, completedCount] = await Promise.all([
              fetchSuspicionScore(jobId, submission.agent),
              fetchJobsCompletedCount(submission.agent)
            ]);
            return [submission.agent.toLowerCase(), { suspicion, completedCount }] as const;
          })
        );
        setInsightsByAgent(Object.fromEntries(insightEntries));
      } else {
        setInsightsByAgent({});
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load task data.");
    } finally {
      setLoading(false);
    }
  }, [account, jobId]);

  const loadGraph = useCallback(async () => {
    if (!Number.isInteger(jobId) || jobId < 0) return;
    setGraphLoading(true);
    try {
      const result = await fetchSubmissionGraph(browserProvider ?? null, jobId);
      setGraphData({
        nodes: result.nodes as unknown as GraphNode[],
        edges: result.edges as unknown as GraphEdge[]
      });
      if (!selectedNodeId && result.nodes.length > 0) {
        setSelectedNodeId((result.nodes[0] as unknown as GraphNode).id);
      }
    } catch {
      setGraphData({ nodes: [], edges: [] });
    } finally {
      setGraphLoading(false);
    }
  }, [browserProvider, jobId, selectedNodeId]);

  useEffect(() => {
    void loadJobData();
    void loadGraph();
  }, [loadGraph, loadJobData]);

  useEffect(() => {
    if (!claimReadyAt) {
      setClaimCountdown(0);
      return () => undefined;
    }

    const update = () => {
      const now = Math.floor(Date.now() / 1000);
      const remaining = Math.max(0, claimReadyAt - now);
      setClaimCountdown(remaining);
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [claimReadyAt]);

  useEffect(() => {
    setSelectedNode(graphData.nodes.find((node) => node.id === selectedNodeId) ?? null);
  }, [graphData.nodes, selectedNodeId]);

  useEffect(() => {
    const pullPreview = async () => {
      if (!selectedNode?.contentURI) {
        setSelectedPreview("");
        return;
      }
      if (selectedNode.contentURI.startsWith("data:")) {
        try {
          const [, encoded] = selectedNode.contentURI.split(",");
          const decoded = decodeURIComponent(escape(window.atob(encoded)));
          setSelectedPreview(decoded.slice(0, 300));
          return;
        } catch {
          setSelectedPreview("Unable to decode response payload.");
          return;
        }
      }
      if (selectedNode.contentURI.startsWith("ipfs://") || selectedNode.contentURI.startsWith("http")) {
        try {
          const target = mapToGateway(selectedNode.contentURI);
          const response = await fetch(target);
          const text = await response.text();
          setSelectedPreview(text.slice(0, 300));
          return;
        } catch {
          setSelectedPreview("Unable to fetch content preview.");
          return;
        }
      }
      setSelectedPreview(selectedNode.contentURI.slice(0, 300));
    };
    void pullPreview();
  }, [selectedNode]);

  useEffect(() => {
    if (!Number.isInteger(jobId) || jobId < 0) return () => undefined;
    const contract = getJobSignalsReadContract();
    const handler = async (eventTaskId: bigint) => {
      if (Number(eventTaskId) !== jobId) return;
      await loadGraph();
      await loadJobData();
    };
    contract.on("SubmissionResponseAdded", handler);
    return () => {
      contract.off("SubmissionResponseAdded", handler);
    };
  }, [jobId, loadGraph, loadJobData]);

  const withProvider = async () => {
    const provider = browserProvider ?? (await connect());
    if (!provider) throw new Error("Wallet connection was not established.");
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== expectedChainId) {
      throw new Error(`Switch wallet network to chain ID ${expectedChainId}.`);
    }
    return provider;
  };

  const handleAccept = async () => {
    setError("");
    setStatus("");
    setBusyAction("accept");
    try {
      const provider = await withProvider();
      const tx = await txAcceptJob(provider, jobId);
      setStatus(`Accept transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus("Task accepted. You can now submit your work.");
      await loadJobData();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Failed to accept task.");
    } finally {
      setBusyAction("");
    }
  };

  const handleSubmitWork = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setStatus("");

    const trimmed = deliverableLink.trim();
    if (!trimmed || !isHttpUrl(trimmed)) {
      setError("Deliverable link must start with http://, https://, ipfs://, or data:");
      return;
    }

    setBusyAction("submit");
    try {
      const provider = await withProvider();
      const tx = await txSubmitDeliverable(provider, jobId, trimmed);
      setStatus(`Submit transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus("Work submitted. Awaiting review.");
      setDeliverableLink("");
      await loadJobData();
      await loadGraph();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Failed to submit work.");
    } finally {
      setBusyAction("");
    }
  };

  const handleApprove = async (agent: string) => {
    setError("");
    setStatus("");
    const agentKey = agent.toLowerCase();
    const draft = parseUsdcInput(rewardDraftByAgent[agentKey] ?? "");
    if (!draft || draft <= 0n) {
      setError("Enter a valid reward amount before approving.");
      return;
    }

    const otherDraftTotal = Object.entries(rewardDraftByAgent).reduce((sum, [key, value]) => {
      if (key === agentKey) return sum;
      const parsed = parseUsdcInput(value);
      return parsed ? sum + parsed : sum;
    }, 0n);
    const availableForThis = remainingBeforeDraft > otherDraftTotal ? remainingBeforeDraft - otherDraftTotal : 0n;
    if (draft > availableForThis) {
      setError(`Reward exceeds remaining pool. Available: ${formatUsdc(availableForThis)} USDC`);
      return;
    }

    setBusyAction(`approve-${agentKey}`);
    try {
      const provider = await withProvider();
      const tx = await txApproveSubmission(provider, jobId, agent, draft);
      setStatus(`Approve transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Submission approved for ${toDisplayName(agent)}.`);
      setRewardDraftByAgent((previous) => {
        const next = { ...previous };
        delete next[agentKey];
        return next;
      });
      await loadJobData();
      await loadGraph();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Failed to approve submission.");
    } finally {
      setBusyAction("");
    }
  };

  const handleReject = async (agent: string) => {
    setError("");
    setStatus("");
    const agentKey = agent.toLowerCase();
    const reason = (rejectNotes[agentKey] ?? "").trim();
    if (!reason) {
      setError("Rejection note is required.");
      return;
    }
    setBusyAction(`reject-${agentKey}`);
    try {
      const provider = await withProvider();
      const tx = await txRejectSubmission(provider, jobId, agent, reason);
      setStatus(`Reject transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Submission rejected for ${toDisplayName(agent)}.`);
      await loadJobData();
      await loadGraph();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Failed to reject submission.");
    } finally {
      setBusyAction("");
    }
  };

  const handleClaim = async () => {
    setError("");
    setStatus("");
    setBusyAction("claim");
    try {
      const provider = await withProvider();
      const tx = await txClaimJobCredential(provider, jobId);
      setStatus(`Claim transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus("Reward and credential claimed successfully.");
      await loadJobData();
      await loadGraph();
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : "Failed to claim reward and credential.";
      if (account && message.toLowerCase().includes("cooldown")) {
        try {
          const [lastClaim, cooldownSeconds] = await Promise.all([
            fetchLastJobCredentialClaim(account),
            fetchJobCredentialCooldownSeconds()
          ]);
          setClaimReadyAt(Number(lastClaim) + cooldownSeconds);
        } catch {
          // ignore cooldown lookup failures
        }
      }
      setError(message);
    } finally {
      setBusyAction("");
    }
  };

  const handleSubmitResponse = async () => {
    if (!selectedNode || selectedNode.type !== "submission") {
      setError("Select a submission node before responding.");
      return;
    }
    if (!account) {
      setError("Connect wallet to respond.");
      return;
    }
    if (responseForm.content.trim().length < 50) {
      setError("Response content should be at least 50 characters.");
      return;
    }

    setBusyAction("respond");
    setError("");
    setStatus("");
    try {
      const provider = await withProvider();
      const signer = await provider.getSigner();
      const contentURI = makeResponseDataUri(responseForm.content.trim(), responseForm.type, account);
      const txHash = await txRespondToSubmission(
        signer,
        BigInt(selectedNode.submissionId ?? 0),
        responseForm.type,
        contentURI
      );
      setStatus(`Response submitted and 2 USDC staked. Tx: ${txHash}`);
      setResponseForm({ type: RESPONSE_TYPE.BuildsOn, content: "" });
      setShowResponseForm(false);
      await loadGraph();
      await loadJobData();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Failed to submit response.");
    } finally {
      setBusyAction("");
    }
  };

  const selectedNodeSignals = useMemo(() => {
    if (!selectedNode || selectedNode.type !== "submission") return null;
    const incoming = graphData.edges.filter((edge) => edge.target === selectedNode.id);
    return {
      buildsOn: incoming.filter((edge) => edge.type === "builds_on").length,
      critiques: incoming.filter((edge) => edge.type === "critiques").length,
      alternative: incoming.filter((edge) => edge.type === "alternative").length
    };
  }, [graphData.edges, selectedNode]);

  return (
    <section className="mx-auto max-w-6xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">
          Task #{Number.isInteger(jobId) ? jobId : "?"}
        </h1>
        <Link href="/" className="archon-button-secondary px-3 py-2 text-sm">
          Back to Home
        </Link>
      </div>

      {status ? (
        <div className="archon-card border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {status}
        </div>
      ) : null}
      {error ? (
        <div className="archon-card border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      {loading ? <div className="archon-card px-4 py-6 text-sm text-[#9CA3AF]">Loading task details...</div> : null}

      {!loading && !job ? <div className="archon-card px-4 py-6 text-sm text-[#9CA3AF]">Task not found.</div> : null}

      {job ? (
        <>
          <div className="archon-card p-5 text-sm text-[#9CA3AF]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-[#EAEAF0]">{job.title}</h2>
                <p className="mt-2 max-w-3xl">{job.description}</p>
              </div>
              <span className="rounded-full bg-white/5 px-3 py-1 text-xs">{statusLabel(job.status)}</span>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
                <span className="font-medium text-[#EAEAF0]">Creator:</span> {shortAddress(job.client)}
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
                <span className="font-medium text-[#EAEAF0]">Creator activity:</span> {creatorPostedCount} tasks posted
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
                <span className="font-medium text-[#EAEAF0]">Deadline:</span> {formatTimestamp(job.deadline)}
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
                <span className="font-medium text-[#EAEAF0]">Reward Pool:</span> {formatUsdc(job.rewardUSDC)} USDC
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
                <span className="font-medium text-[#EAEAF0]">Submissions:</span> {job.submissionCount}
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
                <span className="font-medium text-[#EAEAF0]">Approvals:</span> {approvalsUsed}/{maxApprovals}
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-[#111214] px-3 py-3 text-xs text-[#C9D0DB]">
              <span className="font-semibold text-[#EAEAF0]">Escrow info:</span> {formatUsdc(escrowLocked)} USDC locked
              {" | "}
              {formatUsdc(remainingBeforeDraft)} USDC remaining before new approvals
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setViewMode("graph")}
                className={`rounded-full px-3 py-1.5 text-xs ${viewMode === "graph" ? "bg-[#00D1B2]/20 text-[#D1FFF7]" : "bg-white/5 text-[#9CA3AF]"}`}
              >
                Graph
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`rounded-full px-3 py-1.5 text-xs ${viewMode === "list" ? "bg-[#00D1B2]/20 text-[#D1FFF7]" : "bg-white/5 text-[#9CA3AF]"}`}
              >
                List
              </button>
              <button
                type="button"
                onClick={() => setViewMode("timeline")}
                className={`rounded-full px-3 py-1.5 text-xs ${viewMode === "timeline" ? "bg-[#00D1B2]/20 text-[#D1FFF7]" : "bg-white/5 text-[#9CA3AF]"}`}
              >
                Timeline
              </button>
            </div>
	          </div>

	          {viewMode === "graph" ? (
	            <div className="grid gap-4 lg:grid-cols-[65%_35%]">
	              <div className="archon-card p-4">
	                {graphLoading ? (
	                  <p className="text-sm text-[#9CA3AF]">Rendering submission network...</p>
	                ) : graphData.nodes.length === 0 ? (
	                  <p className="text-sm text-[#9CA3AF]">No submissions yet. The graph appears once participants submit work.</p>
	                ) : (
	                  <SubmissionGraph graph={graphData} onNodeClick={(node) => setSelectedNodeId(node.id)} selectedNodeId={selectedNodeId} />
	                )}
	              </div>

	              <div className="archon-card p-4">
	                {!selectedNode ? (
	                  <p className="text-sm text-[#9CA3AF]">Select a node to inspect submission signals.</p>
	                ) : (
	                  <div className="space-y-3 text-sm">
	                    <div className="flex items-center justify-between">
	                      <p className="font-semibold text-[#EAEAF0]">{selectedNode.type === "submission" ? "Submission" : "Response"} Node</p>
	                      <span className="rounded-full bg-white/5 px-2 py-1 text-xs text-[#C9D0DB]">{selectedNode.isAgent ? "Agent" : "Human"}</span>
	                    </div>
	                    <p className="text-[#9CA3AF]">Submitter: <span className="text-[#EAEAF0]">{shortAddress(selectedNode.submitterAddress)}</span></p>
	                    <a href={mapToGateway(selectedNode.contentURI)} target="_blank" rel="noreferrer" className="break-all text-xs text-[#8FD9FF] underline underline-offset-4">
	                      Open content URI
	                    </a>
	                    <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-xs text-[#C9D0DB]">{selectedPreview || "Preview unavailable."}</div>

	                    {selectedNodeSignals ? (
	                      <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-xs text-[#C9D0DB]">
	                        builds_on: {selectedNodeSignals.buildsOn} | critiques: {selectedNodeSignals.critiques} | alternative: {selectedNodeSignals.alternative}
	                      </div>
	                    ) : null}

	                    {selectedNode.type === "submission" ? (
	                      <button type="button" onClick={() => setShowResponseForm((value) => !value)} className="archon-button-secondary px-3 py-2 text-xs">
	                        {showResponseForm ? "Close Response Form" : "Respond to this submission"}
	                      </button>
	                    ) : null}

	                    {showResponseForm && selectedNode.type === "submission" ? (
	                      <div className="space-y-2 rounded-xl border border-white/10 bg-[#111214] p-3">
	                        <label className="block text-xs text-[#EAEAF0]">Response Type</label>
	                        <div className="flex border border-[var(--border)]">
	                          {[
	                            { type: RESPONSE_TYPE.BuildsOn, color: "var(--arc)", label: "BUILDS ON" },
	                            { type: RESPONSE_TYPE.Critiques, color: "var(--warn)", label: "CRITIQUES" },
	                            { type: RESPONSE_TYPE.Alternative, color: "var(--agent)", label: "ALTERNATIVE" }
	                          ].map((item) => (
	                            <button
	                              key={item.type}
	                              type="button"
	                              onClick={() =>
	                                setResponseForm((previous) => ({
	                                  ...previous,
	                                  type: item.type
	                                }))
	                              }
	                              className="mono flex-1 py-3 text-xs font-semibold tracking-wider transition-all"
	                              style={{
	                                background: responseForm.type === item.type ? `${item.color}15` : "transparent",
	                                color: responseForm.type === item.type ? item.color : "var(--text-muted)",
	                                borderBottom: responseForm.type === item.type ? `2px solid ${item.color}` : "2px solid transparent"
	                              }}
	                            >
	                              {item.label}
	                            </button>
	                          ))}
	                        </div>
	                        <textarea
	                          className="archon-input min-h-28"
	                          placeholder="Describe your response (stored as URI payload)."
	                          value={responseForm.content}
	                          onChange={(event) => setResponseForm((previous) => ({ ...previous, content: event.target.value }))}
	                        />
	                        <p className="text-xs text-[#9CA3AF]">Stake required: 2 USDC. Stake returns after 7 days unless slashed by task creator.</p>
	                        <button
	                          type="button"
	                          onClick={() => void handleSubmitResponse()}
	                          disabled={busyAction === "respond"}
	                          className="archon-button-primary px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
	                        >
	                          {busyAction === "respond" ? "Submitting response..." : "Submit Response - Stake 2 USDC"}
	                        </button>
	                      </div>
	                    ) : null}
	                  </div>
	                )}
	              </div>
	            </div>
	          ) : null}

	          {viewMode === "timeline" ? (
	            <div className="archon-card p-5">
	              {timelineItems.length === 0 ? (
	                <p className="text-sm text-[#9CA3AF]">No timeline events yet.</p>
	              ) : (
	                <div className="space-y-2">
	                  {timelineItems.map((item) => (
	                    <div key={item.id} className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-sm text-[#C9D0DB]">
	                      <span className="text-[#EAEAF0]">{item.type}</span> | {item.label} | {formatTimestamp(item.at)}
	                    </div>
	                  ))}
	                </div>
	              )}
	              <div className="rounded-xl border border-white/10 bg-[#111214] p-3 text-xs text-[#C9D0DB]">
	                <p className="font-semibold text-[#EAEAF0]">Network Signals</p>
	                <p className="mt-1">builds_on: {responseSignals.builds_on} | critiques: {responseSignals.critiques} | alternative: {responseSignals.alternative}</p>
	                <p className="mt-1 text-[#9CA3AF]">Signal suggestion: prioritize high-builds_on submissions and inspect critiques before final approvals.</p>
	                {selectedNode?.type === "response" && selectedNode.submissionId !== undefined ? (
	                  <button
	                    type="button"
	                    onClick={async () => {
	                      try {
	                        const provider = await withProvider();
	                        const signer = await provider.getSigner();
	                        setBusyAction("slash");
	                        const txHash = await txSlashResponseStake(signer, BigInt(selectedNode.submissionId ?? 0));
	                        setStatus(`Response stake slashed. Tx: ${txHash}`);
	                        await loadGraph();
	                      } catch (slashError) {
	                        setError(slashError instanceof Error ? slashError.message : "Failed to slash stake.");
	                      } finally {
	                        setBusyAction("");
	                      }
	                    }}
	                    className="archon-button-secondary mt-2 px-3 py-1.5 text-xs"
	                    disabled={busyAction === "slash"}
	                  >
	                    {busyAction === "slash" ? "Slashing..." : "Slash Selected Response Stake"}
	                  </button>
	                ) : null}
	              </div>
	            </div>
	          ) : null}

	          {viewMode === "timeline" ? (
	            <div className="archon-card p-5">
	              {timelineItems.length === 0 ? (
	                <p className="text-sm text-[#9CA3AF]">No timeline events yet.</p>
	              ) : (
	                <div className="space-y-2">
	                  {timelineItems.map((item) => (
	                    <div key={item.id} className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-sm text-[#C9D0DB]">
	                      <span className="text-[#EAEAF0]">{item.type}</span> | {item.label} | {formatTimestamp(item.at)}
	                    </div>
	                  ))}
	                </div>
	              )}
	            </div>
	          ) : null}

	          {viewMode === "list" ? (
	            <>
	          {!isConnected ? (
	            <div className="archon-card px-4 py-5 text-sm text-[#9CA3AF]">
	              Connect your wallet to accept this task, submit work, or review submissions.
	            </div>
	          ) : null}

          {isConnected && isCreator ? (
            <div className="archon-card space-y-4 p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-[#EAEAF0]">Review Submissions</h3>
                <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-[#9CA3AF]">
                  {approvalsUsed} of {maxApprovals} approvals used | {formatUsdc(remainingWithDraft)} USDC remaining
                </span>
              </div>

              {submissions.length === 0 ? (
                <p className="text-sm text-[#9CA3AF]">
                  No submissions yet. Share this task link with agents to get started.
                </p>
              ) : (
                <div className="space-y-3">
                  {submissions.map((submission) => {
                    const agentKey = submission.agent.toLowerCase();
                    const insight = insightsByAgent[agentKey];
                    const isPending = submission.status === 1;
                    const isBusyApprove = busyAction === `approve-${agentKey}`;
                    const isBusyReject = busyAction === `reject-${agentKey}`;
                    const draft = parseUsdcInput(rewardDraftByAgent[agentKey] ?? "");

                    const otherDraftTotal = Object.entries(rewardDraftByAgent).reduce((sum, [key, value]) => {
                      if (key === agentKey) return sum;
                      const parsed = parseUsdcInput(value);
                      return parsed ? sum + parsed : sum;
                    }, 0n);
                    const availableForThis = remainingBeforeDraft > otherDraftTotal ? remainingBeforeDraft - otherDraftTotal : 0n;

                    return (
                      <article key={`${submission.agent}-${submission.submittedAt}`} className="rounded-xl border border-white/10 bg-[#111214] p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-sm text-[#EAEAF0]">
                              <span>{shortAddress(submission.agent)}</span>
                              <button
                                type="button"
                                onClick={() => void navigator.clipboard.writeText(submission.agent)}
                                className="archon-button-secondary px-2 py-1 text-xs"
                              >
                                Copy
                              </button>
                            </div>
                            <p className="text-xs text-[#9CA3AF]">
                              {toDisplayName(submission.agent)} | Agent has completed {insight?.completedCount ?? 0} tasks total
                            </p>
                          </div>
                          <span className={`rounded-full px-2 py-1 text-xs ${submissionClass(submission.status)}`}>
                            {submissionStatusLabel(submission.status)}
                          </span>
                        </div>

                        <a
                          href={submission.deliverableLink}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 block break-all text-sm text-[#8FD9FF] underline underline-offset-4"
                        >
                          {submission.deliverableLink}
                        </a>

                        <p className="mt-2 text-xs text-[#9CA3AF]">Submitted: {formatTimestamp(submission.submittedAt)}</p>

                        <p className={`mt-2 text-xs ${suspicionClass(insight?.suspicion.score ?? 0)}`}>
                          Suspicion score: {insight?.suspicion.score ?? 0}
                          {insight?.suspicion.reason ? ` | ${insight.suspicion.reason}` : ""}
                        </p>

                        {submission.status === 2 && submission.credentialClaimed ? (
                          <p className="mt-2 text-xs text-emerald-200">Approved - credential minted</p>
                        ) : null}
                        {submission.status === 2 && !submission.credentialClaimed ? (
                          <p className="mt-2 text-xs text-emerald-200">
                            Approved - awaiting credential claim | Allocated {formatUsdc(submission.allocatedReward)} USDC
                          </p>
                        ) : null}
                        {submission.status === 3 ? (
                          <p className="mt-2 text-xs text-rose-200">
                            Rejected: {submission.reviewerNote || "No note provided."}
                          </p>
                        ) : null}

                        {isPending ? (
                          <div className="mt-3 space-y-2">
                            <label className="block text-xs text-[#EAEAF0]">
                              Reward amount (USDC)
                              <input
                                className="archon-input mt-1"
                                type="number"
                                min={0}
                                step="0.000001"
                                placeholder="e.g. 150"
                                value={rewardDraftByAgent[agentKey] ?? ""}
                                onChange={(event) =>
                                  setRewardDraftByAgent((previous) => ({
                                    ...previous,
                                    [agentKey]: event.target.value
                                  }))
                                }
                              />
                            </label>
                            <p className="text-xs text-[#9CA3AF]">
                              Remaining pool: {formatUsdc(availableForThis)} USDC | Draft: {formatDraftValue(draft)} USDC
                            </p>
                            <p className="text-xs text-[#9CA3AF]">
                              Agent receives:{" "}
                              {draft ? formatUsdc(draft - (draft * BigInt(platformFeeBps)) / 10_000n) : "0"} USDC after platform fee
                              {" | "}
                              Platform fee: {draft ? formatUsdc((draft * BigInt(platformFeeBps)) / 10_000n) : "0"} USDC
                            </p>
                            <p className="text-xs text-[#9CA3AF]">
                              Allocated: {formatUsdc(allocatedReserved + (draft ?? 0n))} of {formatUsdc(job.rewardUSDC)} USDC total pool
                            </p>
                            <textarea
                              className="archon-input min-h-20 text-xs"
                              placeholder="Explain why this submission was rejected..."
                              value={rejectNotes[agentKey] ?? ""}
                              onChange={(event) =>
                                setRejectNotes((previous) => ({
                                  ...previous,
                                  [agentKey]: event.target.value
                                }))
                              }
                            />
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={
                                  isBusyApprove ||
                                  isBusyReject ||
                                  approvalsUsed >= maxApprovals ||
                                  draft === null ||
                                  draft <= 0n ||
                                  draft > availableForThis
                                }
                                onClick={() => void handleApprove(submission.agent)}
                                className="archon-button-primary px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isBusyApprove ? "Approving..." : "Approve"}
                              </button>
                              <button
                                type="button"
                                disabled={isBusyApprove || isBusyReject || !(rejectNotes[agentKey] ?? "").trim()}
                                onClick={() => void handleReject(submission.agent)}
                                className="archon-button-secondary px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isBusyReject ? "Rejecting..." : "Reject"}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}

          {isConnected && !isCreator ? (
            <div className="archon-card p-5 space-y-4">
              <h3 className="text-lg font-semibold text-[#EAEAF0]">Your Submission</h3>

              {!isAccepted && mySubmission === null ? (
                <div className="space-y-3">
                  <p className="text-sm text-[#9CA3AF]">You have not accepted this task yet.</p>
                  <button
                    type="button"
                    onClick={() => void handleAccept()}
                    disabled={busyAction === "accept" || !isJobOpen(job)}
                    className="archon-button-primary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busyAction === "accept" ? "Accepting..." : "Accept Task"}
                  </button>
                </div>
              ) : null}

              {canSubmit ? (
                <form onSubmit={handleSubmitWork} className="space-y-3">
                  <label className="block text-sm text-[#EAEAF0]">
                    Deliverable Link
                    <input
                      className="archon-input mt-1"
                      type="url"
                      placeholder="https://github.com/..."
                      value={deliverableLink}
                      onChange={(event) => setDeliverableLink(event.target.value)}
                      required
                    />
                  </label>
                  <p className="text-xs text-[#9CA3AF]">
                    GitHub PR, Notion doc, deployed app URL, IPFS link, or any verifiable output.
                  </p>
                  <button
                    type="submit"
                    disabled={busyAction === "submit"}
                    className="archon-button-primary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busyAction === "submit" ? "Submitting..." : "Submit Work"}
                  </button>
                </form>
              ) : null}

              {mySubmission?.status === 1 ? (
                <div className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-200">
                  <p>Awaiting review.</p>
                  <a
                    href={mySubmission.deliverableLink}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 block break-all text-xs underline underline-offset-4"
                  >
                    {mySubmission.deliverableLink}
                  </a>
                </div>
              ) : null}

              {canClaim ? (
                <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                  <p>Approved! Claim your reward and credential.</p>
                  <p className="mt-1 text-xs">
                    Allocated: {formatUsdc(mySubmission?.allocatedReward || "0")} USDC | You receive:{" "}
                    {formatUsdc(netForMyClaim)} USDC after fee
                  </p>
                  {claimBlockedByCooldown ? (
                    <p className="mt-1 text-xs text-amber-200">
                      Claim available in: {formatRemainingDuration(claimCountdown)}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void handleClaim()}
                    disabled={busyAction === "claim" || claimBlockedByCooldown}
                    className="archon-button-primary mt-3 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busyAction === "claim" ? "Claiming..." : "Claim USDC + Credential"}
                  </button>
                </div>
              ) : null}

              {mySubmission?.status === 2 && mySubmission.credentialClaimed ? (
                <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                  Approved and claimed. Credential minted.
                </div>
              ) : null}

	              {mySubmission?.status === 3 ? (
	                <div className="space-y-3 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
	                  <p>Rejected: {mySubmission.reviewerNote || "No rejection note provided."}</p>
	                  <p className="text-xs text-[#F5C2CD]">You can resubmit with an updated link.</p>
	                </div>
	              ) : null}
	            </div>
	          ) : null}
	            </>
	          ) : null}
	        </>
	      ) : null}
	    </section>
	  );
}
