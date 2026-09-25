"use client";

import Link from "next/link";
import { ethers } from "ethers";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  contractAddresses,
  expectedChainId,
  fetchDispute,
  fetchDisputeWindowSeconds,
  fetchMilestoneFunded,
  fetchMilestonesByClient,
  fetchMilestonesByFreelancer,
  fetchMilestonesByProject,
  fetchNextProjectId,
  formatTimestamp,
  formatUsdc,
  MILESTONE_ESCROW_ABI,
  MilestoneRecord,
  txApproveUsdcIfNeeded,
  txFundMilestone,
  txProposeMilestoneProject,
  txVoteOnMilestoneDispute
} from "@/lib/contracts";
import { useWallet } from "@/lib/wallet-context";

type TabKey = "projects" | "propose" | "disputes";
type DraftMilestone = { id: number; title: string; description: string; amount: string; deadline: string };

const newDraft = (): DraftMilestone => ({
  id: Date.now() + Math.floor(Math.random() * 1000),
  title: "",
  description: "",
  amount: "",
  deadline: ""
});

const toUnix = (value: string) => (value ? Math.floor(new Date(value).getTime() / 1000) : 0);

function statusLabel(status: number, funded: boolean) {
  if (status === 0) return funded ? "Funded" : "Pending";
  if (status === 1) return "Submitted";
  if (status === 2) return "Approved";
  if (status === 3) return "Disputed";
  if (status === 4) return "Arbitrator Resolved";
  if (status === 5) return "Refunded";
  return "Unknown";
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

export default function MilestonesPage() {
  const { account, browserProvider, connect } = useWallet();
  const [tab, setTab] = useState<TabKey>("projects");
  const [clientMilestones, setClientMilestones] = useState<MilestoneRecord[]>([]);
  const [freelancerMilestones, setFreelancerMilestones] = useState<MilestoneRecord[]>([]);
  const [funded, setFunded] = useState<Record<number, boolean>>({});
  const [disputes, setDisputes] = useState<Record<number, Awaited<ReturnType<typeof fetchDispute>>>>({});
  const [disputeWindow, setDisputeWindow] = useState(48 * 3600);
  const [deliverables, setDeliverables] = useState<Record<number, string>>({});
  const [disputeNotes, setDisputeNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [submittingMilestoneId, setSubmittingMilestoneId] = useState<number | null>(null);
  const [approvingMilestoneId, setApprovingMilestoneId] = useState<number | null>(null);
  const [disputingMilestoneId, setDisputingMilestoneId] = useState<number | null>(null);
  const [autoReleasingMilestoneId, setAutoReleasingMilestoneId] = useState<number | null>(null);
  const [milestoneTxHashes, setMilestoneTxHashes] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const [freelancerWallet, setFreelancerWallet] = useState("");
  const [drafts, setDrafts] = useState<DraftMilestone[]>([newDraft()]);
  const [createdProjectId, setCreatedProjectId] = useState<number | null>(null);
  const [createdProjectMilestones, setCreatedProjectMilestones] = useState<MilestoneRecord[]>([]);

  const myMilestones = useMemo(() => {
    const map = new Map<number, MilestoneRecord>();
    for (const row of clientMilestones) map.set(row.milestoneId, row);
    for (const row of freelancerMilestones) map.set(row.milestoneId, row);
    return Array.from(map.values()).sort((a, b) => b.milestoneId - a.milestoneId);
  }, [clientMilestones, freelancerMilestones]);

  const projects = useMemo(() => {
    const groups = new Map<number, MilestoneRecord[]>();
    for (const row of myMilestones) {
      const list = groups.get(row.projectId) ?? [];
      list.push(row);
      groups.set(row.projectId, list);
    }
    return Array.from(groups.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([projectId, milestones]) => ({ projectId, milestones: milestones.sort((a, b) => a.milestoneId - b.milestoneId) }));
  }, [myMilestones]);

  const withProvider = async () => {
    const provider = browserProvider ?? (await connect());
    if (!provider) throw new Error("Wallet connection was not established.");
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== expectedChainId) {
      throw new Error(`Switch wallet network to chain ID ${expectedChainId}.`);
    }
    return provider;
  };

  const withMilestoneContract = async () => {
    if (!contractAddresses.milestoneEscrow || contractAddresses.milestoneEscrow === ethers.ZeroAddress) {
      throw new Error("MilestoneEscrow contract is not configured.");
    }
    const provider = await withProvider();
    const signer = await provider.getSigner();
    const contract = new ethers.Contract(contractAddresses.milestoneEscrow, MILESTONE_ESCROW_ABI, signer);
    return { provider, signer, contract };
  };

  const load = useCallback(async () => {
    if (!account || !contractAddresses.milestoneEscrow || contractAddresses.milestoneEscrow === ethers.ZeroAddress) {
      setClientMilestones([]);
      setFreelancerMilestones([]);
      setFunded({});
      setDisputes({});
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [clientRows, freelancerRows, windowSeconds] = await Promise.all([
        fetchMilestonesByClient(account),
        fetchMilestonesByFreelancer(account),
        fetchDisputeWindowSeconds()
      ]);
      setClientMilestones(clientRows);
      setFreelancerMilestones(freelancerRows);
      setDisputeWindow(windowSeconds);
      const combined = [...clientRows, ...freelancerRows];
      const ids = Array.from(new Set(combined.map((row) => row.milestoneId)));
      const fundedRows = await Promise.all(ids.map(async (id) => [id, await fetchMilestoneFunded(id)] as const));
      setFunded(Object.fromEntries(fundedRows));
      const disputeRows = await Promise.all(ids.map(async (id) => [id, await fetchDispute(id)] as const));
      const nextDisputes: Record<number, Awaited<ReturnType<typeof fetchDispute>>> = {};
      for (const [id, row] of disputeRows) {
        if (row) nextDisputes[id] = row;
      }
      setDisputes(nextDisputes);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load milestone data.");
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    void load();
  }, [load]);

  const onFund = async (milestone: MilestoneRecord) => {
    setBusy(milestone.milestoneId);
    setStatus("");
    setError("");
    try {
      const provider = await withProvider();
      const amount = BigInt(milestone.amount || "0");
      const approvalTx = await txApproveUsdcIfNeeded(provider, contractAddresses.milestoneEscrow, amount);
      if (approvalTx) await approvalTx.wait();
      const tx = await txFundMilestone(provider, milestone.milestoneId);
      await tx.wait();
      setStatus(`Milestone #${milestone.milestoneId} funded.`);
      await load();
    } catch (fundError) {
      setError(fundError instanceof Error ? fundError.message : "Failed to fund milestone.");
    } finally {
      setBusy(null);
    }
  };

  const handleSubmitDeliverable = async (
    projectId: number,
    milestoneId: number,
    deliverableLink: string
  ) => {
    const deliverable = deliverableLink.trim();
    if (!deliverable) {
      setError("Deliverable link is required");
      return;
    }

    setSubmittingMilestoneId(milestoneId);
    setStatus("");
    setError("");

    try {
      const { signer, contract } = await withMilestoneContract();
      const wallet = await signer.getAddress();
      console.log("[milestone-submit] projectId:", projectId, "milestoneId:", milestoneId);
      console.log("[milestone-submit] deliverableLink:", deliverable);
      console.log("[milestone-submit] wallet:", wallet);
      console.log("[milestone-submit] contract:", contractAddresses.milestoneEscrow);

      const gasEst = (await contract.submitDeliverable.estimateGas(
        BigInt(milestoneId),
        deliverable
      ).catch((estimateError: unknown) => {
        const message =
          estimateError instanceof Error
            ? estimateError.message
            : String(estimateError ?? "Gas estimation failed");
        throw new Error(message || "Gas estimation failed - tx would revert");
      })) as bigint;

      const tx = (await contract.submitDeliverable(BigInt(milestoneId), deliverable, {
        gasLimit: (gasEst * 12n) / 10n
      })) as ethers.TransactionResponse;
      setMilestoneTxHashes((previous) => ({ ...previous, [milestoneId]: tx.hash }));
      console.log("[milestone-submit] tx sent:", tx.hash);

      const receipt = await tx.wait();
      console.log("[milestone-submit] receipt status:", receipt?.status, "block:", receipt?.blockNumber);
      console.log("[milestone-submit] logs:", receipt?.logs?.length ?? 0);

      if (!receipt || receipt.status === 0) {
        throw new Error("Transaction reverted on-chain");
      }

      setStatus(`Milestone #${milestoneId} submitted.`);
      await load();
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : String(submitError ?? "Failed to submit deliverable.");
      setError(message);
      console.log("[milestone-submit] FAILED:", message.slice(0, 120));
    } finally {
      setSubmittingMilestoneId(null);
    }
  };

  const handleApproveMilestone = async (projectId: number, milestoneId: number) => {
    setApprovingMilestoneId(milestoneId);
    setStatus("");
    setError("");
    try {
      const { contract } = await withMilestoneContract();
      const gasEst = (await contract.approveMilestone.estimateGas(
        BigInt(milestoneId)
      ).catch((estimateError: unknown) => {
        const message =
          estimateError instanceof Error ? estimateError.message : String(estimateError ?? "Approval would revert");
        throw new Error(message || "Approval would revert");
      })) as bigint;

      const tx = (await contract.approveMilestone(BigInt(milestoneId), {
        gasLimit: (gasEst * 12n) / 10n
      })) as ethers.TransactionResponse;
      setMilestoneTxHashes((previous) => ({ ...previous, [milestoneId]: tx.hash }));
      await tx.wait();
      setStatus(`Milestone #${milestoneId} approved for project #${projectId}.`);
      await load();
    } catch (approveError) {
      const message =
        approveError instanceof Error ? approveError.message : String(approveError ?? "Approval failed");
      setError(message);
    } finally {
      setApprovingMilestoneId(null);
    }
  };

  const handleDisputeMilestone = async (projectId: number, milestoneId: number) => {
    const reason = (disputeNotes[milestoneId] ?? "").trim();
    if (reason.length < 20) {
      setError("Dispute reason must be at least 20 characters.");
      return;
    }
    setDisputingMilestoneId(milestoneId);
    setStatus("");
    setError("");
    try {
      const { contract } = await withMilestoneContract();
      const gasEst = (await contract.raiseDispute.estimateGas(
        BigInt(milestoneId),
        reason
      ).catch((estimateError: unknown) => {
        const message =
          estimateError instanceof Error ? estimateError.message : String(estimateError ?? "Dispute would revert");
        throw new Error(message || "Dispute would revert");
      })) as bigint;

      const tx = (await contract.raiseDispute(BigInt(milestoneId), reason, {
        gasLimit: (gasEst * 12n) / 10n
      })) as ethers.TransactionResponse;
      setMilestoneTxHashes((previous) => ({ ...previous, [milestoneId]: tx.hash }));
      await tx.wait();
      setStatus(`Dispute raised for milestone #${milestoneId} in project #${projectId}.`);
      await load();
    } catch (disputeError) {
      const message =
        disputeError instanceof Error ? disputeError.message : String(disputeError ?? "Dispute failed");
      setError(message);
    } finally {
      setDisputingMilestoneId(null);
    }
  };

  const handleAutoRelease = async (projectId: number, milestoneId: number) => {
    setAutoReleasingMilestoneId(milestoneId);
    setStatus("");
    setError("");
    try {
      const { contract } = await withMilestoneContract();
      const gasEst = (await contract.autoRelease.estimateGas(
        BigInt(milestoneId)
      ).catch((estimateError: unknown) => {
        const message =
          estimateError instanceof Error ? estimateError.message : String(estimateError ?? "Auto-release would revert");
        throw new Error(message || "Auto-release would revert");
      })) as bigint;
      const tx = (await contract.autoRelease(BigInt(milestoneId), {
        gasLimit: (gasEst * 12n) / 10n
      })) as ethers.TransactionResponse;
      setMilestoneTxHashes((previous) => ({ ...previous, [milestoneId]: tx.hash }));
      await tx.wait();
      setStatus(`Milestone #${milestoneId} auto-released for project #${projectId}.`);
      await load();
    } catch (autoError) {
      const message =
        autoError instanceof Error ? autoError.message : String(autoError ?? "Failed to auto-release milestone.");
      setError(message);
    } finally {
      setAutoReleasingMilestoneId(null);
    }
  };

  const onVote = async (milestoneId: number, vote: 1 | 2) => {
    setBusy(milestoneId);
    setStatus("");
    setError("");
    try {
      const provider = await withProvider();
      const tx = await txVoteOnMilestoneDispute(provider, milestoneId, vote);
      await tx.wait();
      setStatus(`Vote recorded for dispute on milestone #${milestoneId}.`);
      await load();
    } catch (voteError) {
      setError(voteError instanceof Error ? voteError.message : "Failed to submit dispute vote.");
    } finally {
      setBusy(null);
    }
  };

  const onPropose = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creating) return;
    setStatus("");
    setError("");
    if (!ethers.isAddress(freelancerWallet.trim())) return setError("Enter a valid freelancer wallet address.");
    if (drafts.length < 1 || drafts.length > 20) return setError("Milestones must be between 1 and 20.");
    // MilestoneEscrow enforces deadline >= block.timestamp + 1h per milestone
    // (MIN_MILESTONE_DURATION) with stripped revert strings; validate here
    // against chain time so users get a readable error instead.
    let chainNow = Math.floor(Date.now() / 1000);
    try {
      const timeProvider = await withProvider();
      const timeBlock = await timeProvider.getBlock("latest");
      if (timeBlock?.timestamp) chainNow = timeBlock.timestamp;
    } catch {
      // Fall back to local clock.
    }
    const MIN_MILESTONE_DURATION = 3600;
    for (const draft of drafts) {
      const milestoneDeadline = toUnix(draft.deadline);
      if (milestoneDeadline < chainNow + MIN_MILESTONE_DURATION) {
        return setError(
          `Milestone "${draft.title || "untitled"}" needs a deadline at least 1 hour in the future (chain time).`
        );
      }
    }
    setCreating(true);
    try {
      const provider = await withProvider();
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      const [pendingNonce, confirmedNonce] = await Promise.all([
        provider.getTransactionCount(address, "pending"),
        provider.getTransactionCount(address, "latest")
      ]);
      if (pendingNonce > confirmedNonce) {
        setError(
          "You have a pending transaction on the network. Wait for it to confirm before submitting a new one."
        );
        return;
      }

      const titles = drafts.map((row) => row.title.trim());
      const descriptions = drafts.map((row) => row.description.trim());
      const amounts = drafts.map((row) => ethers.parseUnits(row.amount || "0", 6));
      const deadlines = drafts.map((row) => toUnix(row.deadline));
      const nextProjectId = await fetchNextProjectId();
      const tx = await txProposeMilestoneProject(provider, freelancerWallet.trim(), titles, descriptions, amounts, deadlines);
      await tx.wait();
      setCreatedProjectId(nextProjectId);
      setCreatedProjectMilestones(await fetchMilestonesByProject(nextProjectId));
      setDrafts([newDraft()]);
      setStatus(`Project #${nextProjectId} created.`);
      await load();
    } catch (proposeError) {
      const message =
        proposeError instanceof Error ? proposeError.message : String(proposeError ?? "Failed to create project.");
      const lower = message.toLowerCase();
      if (
        lower.includes("txpool is full") ||
        lower.includes("pool is full") ||
        lower.includes("-32603")
      ) {
        setError(
          "The Arc testnet transaction pool is temporarily full. Wait 30-60 seconds and try again. Do not click multiple times."
        );
      } else if (lower.includes("user rejected") || lower.includes("4001")) {
        setError("Transaction rejected in wallet.");
      } else {
        setError(`Transaction failed: ${message.slice(0, 120)}`);
      }
    } finally {
      setCreating(false);
    }
  };

  const disputesList = Object.entries(disputes).map(([id, dispute]) => ({ milestoneId: Number(id), dispute }));

  return (
    <section className="space-y-6">
      <div className="archon-card p-6">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">Smart Contracts</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">
          Agree on milestones with a client or freelancer before work begins. USDC is locked in escrow for each
          milestone. Funds release automatically on approval - no trust required.
        </p>
      </div>

      <div className="archon-card p-6">
        <h2 className="text-lg font-semibold text-[#EAEAF0]">How It Works</h2>
        <div className="mt-4 grid gap-3 lg:grid-cols-5">
          <article className="rounded-xl border border-white/10 bg-[#111214] p-3">
            <p className="text-xs uppercase tracking-wide text-[#8FD9FF]">Step 1</p>
            <p className="mt-1 text-sm font-semibold text-[#EAEAF0]">Agree on Milestones</p>
            <p className="mt-1 text-xs text-[#9CA3AF]">
              Client proposes project with defined milestones, deadlines, and USDC amounts.
            </p>
          </article>
          <article className="rounded-xl border border-white/10 bg-[#111214] p-3">
            <p className="text-xs uppercase tracking-wide text-[#8FD9FF]">Step 2</p>
            <p className="mt-1 text-sm font-semibold text-[#EAEAF0]">Client Funds Escrow</p>
            <p className="mt-1 text-xs text-[#9CA3AF]">
              Client deposits USDC for each milestone into the smart contract. Funds are locked - not transferable.
            </p>
          </article>
          <article className="rounded-xl border border-white/10 bg-[#111214] p-3">
            <p className="text-xs uppercase tracking-wide text-[#8FD9FF]">Step 3</p>
            <p className="mt-1 text-sm font-semibold text-[#EAEAF0]">Freelancer Delivers</p>
            <p className="mt-1 text-xs text-[#9CA3AF]">
              Freelancer submits a link or hash proving the milestone was completed.
            </p>
          </article>
          <article className="rounded-xl border border-white/10 bg-[#111214] p-3">
            <p className="text-xs uppercase tracking-wide text-[#8FD9FF]">Step 4</p>
            <p className="mt-1 text-sm font-semibold text-[#EAEAF0]">Client Approves or Disputes</p>
            <p className="mt-1 text-xs text-[#9CA3AF]">
              Client approves and funds release instantly. Or raises a dispute within 48 hours.
            </p>
          </article>
          <article className="rounded-xl border border-white/10 bg-[#111214] p-3">
            <p className="text-xs uppercase tracking-wide text-[#8FD9FF]">Step 5</p>
            <p className="mt-1 text-sm font-semibold text-[#EAEAF0]">Arbitration (if disputed)</p>
            <p className="mt-1 text-xs text-[#9CA3AF]">
              3 approved arbitrators vote. Majority wins. Funds go to freelancer or back to client.
            </p>
          </article>
        </div>
        <div className="mt-4 rounded-xl border border-[#00D1B2]/30 bg-[#00D1B2]/10 p-3 text-xs text-[#A7F8E8]">
          Auto-Release: If the client neither approves nor disputes within 48 hours of delivery, the freelancer can
          claim funds automatically. This prevents clients from ghosting.
        </div>
      </div>
      <div className="archon-card p-4">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`rounded-full px-4 py-2 text-sm ${tab === "projects" ? "bg-[#6C5CE7]/35 text-[#EAEAF0]" : "bg-white/5 text-[#9CA3AF]"}`} onClick={() => setTab("projects")}>My Contracts</button>
          <button type="button" className={`rounded-full px-4 py-2 text-sm ${tab === "propose" ? "bg-[#6C5CE7]/35 text-[#EAEAF0]" : "bg-white/5 text-[#9CA3AF]"}`} onClick={() => setTab("propose")}>New Contract</button>
          <button type="button" className={`rounded-full px-4 py-2 text-sm ${tab === "disputes" ? "bg-[#6C5CE7]/35 text-[#EAEAF0]" : "bg-white/5 text-[#9CA3AF]"}`} onClick={() => setTab("disputes")}>Disputes</button>
        </div>
      </div>
      {status ? <div className="archon-card border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{status}</div> : null}
      {error ? <div className="archon-card border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

      {tab === "projects" ? (
        <div className="archon-card p-6">
          {!account ? <p className="text-sm text-[#9CA3AF]">Connect wallet to view projects.</p> : loading ? <p className="text-sm text-[#9CA3AF]">Loading milestones...</p> : projects.length === 0 ? <p className="text-sm text-[#9CA3AF]">No milestones yet.</p> : (
            <div className="space-y-4">
              {projects.map((project) => (
                <article key={project.projectId} className="rounded-xl border border-white/10 bg-[#111214] p-4">
                  <p className="text-sm font-semibold text-[#EAEAF0]">Project #{project.projectId}</p>
                  <div className="mt-3 space-y-3">
                    {project.milestones.map((milestone) => {
                      const isClient = account?.toLowerCase() === milestone.client.toLowerCase();
                      const isFreelancer = account?.toLowerCase() === milestone.freelancer.toLowerCase();
                      const isFunded = funded[milestone.milestoneId] ?? false;
                      const reviewDeadline =
                        milestone.status === 1 && milestone.submittedAt > 0
                          ? (milestone.submittedAt + disputeWindow) * 1000
                          : null;
                      const reviewExpired = reviewDeadline ? Date.now() > reviewDeadline : false;
                      const canAutoRelease = milestone.status === 1 && Boolean(reviewDeadline) && reviewExpired;
                      return (
                        <div key={milestone.milestoneId} className="rounded-xl border border-white/10 bg-[#0F1012] p-3 text-sm text-[#9CA3AF]">
                          <p className="font-medium text-[#EAEAF0]">#{milestone.milestoneId} {milestone.title}</p>
                          <p className="mt-1">{milestone.description}</p>
                          <p className="mt-1 text-xs">Amount: {formatUsdc(milestone.amount)} USDC · Status: {statusLabel(milestone.status, isFunded)}</p>
                          <p className="text-xs">Deadline: {formatTimestamp(milestone.deadline)}</p>

                          {milestoneTxHashes[milestone.milestoneId] ? (
                            <div className="mt-2 text-[11px] text-[#00FFA3]">
                              Tx:{" "}
                              <a
                                href={`https://explorer.testnet.arc.network/tx/${milestoneTxHashes[milestone.milestoneId]}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: "#00FFA3" }}
                              >
                                {milestoneTxHashes[milestone.milestoneId].slice(0, 18)}…
                              </a>
                            </div>
                          ) : null}

                          {isClient && milestone.status === 0 && !isFunded ? (
                            <button
                              type="button"
                              onClick={() => void onFund(milestone)}
                              disabled={busy === milestone.milestoneId}
                              className="archon-button-primary mt-2 px-3 py-2 text-xs"
                            >
                              {busy === milestone.milestoneId ? "Funding..." : "Fund Milestone"}
                            </button>
                          ) : null}

                          {isFreelancer && milestone.status === 0 && isFunded ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              <input
                                className="archon-input grow"
                                placeholder="Deliverable link/hash"
                                value={deliverables[milestone.milestoneId] ?? ""}
                                onChange={(event) =>
                                  setDeliverables((prev) => ({ ...prev, [milestone.milestoneId]: event.target.value }))
                                }
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  void handleSubmitDeliverable(
                                    milestone.projectId,
                                    milestone.milestoneId,
                                    deliverables[milestone.milestoneId] ?? ""
                                  )
                                }
                                disabled={
                                  submittingMilestoneId === milestone.milestoneId ||
                                  !(deliverables[milestone.milestoneId] ?? "").trim()
                                }
                                className="archon-button-primary px-3 py-2 text-xs"
                                style={{ opacity: submittingMilestoneId === milestone.milestoneId ? 0.6 : 1 }}
                              >
                                {submittingMilestoneId === milestone.milestoneId ? "Submitting…" : "Submit Deliverable"}
                              </button>
                            </div>
                          ) : null}

                          {milestone.status === 1 && milestone.deliverableHash ? (
                            <div
                              style={{
                                background: "rgba(0,255,163,0.08)",
                                border: "1px solid rgba(0,255,163,0.3)",
                                borderRadius: 8,
                                padding: "12px 16px",
                                marginTop: 12
                              }}
                            >
                              <div style={{ fontSize: 12, color: "#7A9BB5", marginBottom: 4 }}>
                                Submitted deliverable:
                              </div>
                              <a
                                href={milestone.deliverableHash}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: "#00FFA3", fontSize: 14, wordBreak: "break-all" }}
                              >
                                {milestone.deliverableHash}
                              </a>
                            </div>
                          ) : null}

                          {milestone.status === 1 && reviewDeadline && !reviewExpired ? (
                            <div style={{ fontSize: 12, color: "#F5A623", marginTop: 8 }}>
                              ⏱ Creator review window: {formatCountdown(reviewDeadline - Date.now())} remaining
                            </div>
                          ) : null}

                          {isClient && milestone.status === 1 ? (
                            <div className="mt-2 space-y-2">
                              <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
                                <button
                                  type="button"
                                  onClick={() => void handleApproveMilestone(milestone.projectId, milestone.milestoneId)}
                                  disabled={approvingMilestoneId === milestone.milestoneId}
                                  style={{
                                    background: "#00FFA3",
                                    color: "#0D1117",
                                    fontWeight: 700,
                                    padding: "10px 20px",
                                    borderRadius: 8
                                  }}
                                >
                                  {approvingMilestoneId === milestone.milestoneId ? "Approving…" : "✅ Approve & Release"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDisputeMilestone(milestone.projectId, milestone.milestoneId)}
                                  disabled={disputingMilestoneId === milestone.milestoneId}
                                  style={{
                                    background: "#FF4A4A",
                                    color: "#fff",
                                    fontWeight: 700,
                                    padding: "10px 20px",
                                    borderRadius: 8
                                  }}
                                >
                                  {disputingMilestoneId === milestone.milestoneId ? "Disputing…" : "⚠️ Dispute"}
                                </button>
                              </div>
                              <textarea
                                className="archon-input min-h-20"
                                value={disputeNotes[milestone.milestoneId] ?? ""}
                                onChange={(event) =>
                                  setDisputeNotes((prev) => ({ ...prev, [milestone.milestoneId]: event.target.value }))
                                }
                                placeholder="Dispute reason (min 20 chars)"
                              />
                            </div>
                          ) : null}

                          {isFreelancer && canAutoRelease ? (
                            <button
                              type="button"
                              onClick={() => void handleAutoRelease(milestone.projectId, milestone.milestoneId)}
                              disabled={autoReleasingMilestoneId === milestone.milestoneId}
                              style={{
                                background: "#00B4FF",
                                color: "#fff",
                                fontWeight: 700,
                                padding: "10px 20px",
                                borderRadius: 8,
                                marginTop: 12
                              }}
                            >
                              {autoReleasingMilestoneId === milestone.milestoneId ? "Releasing…" : "🔓 Auto-Release Funds"}
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {tab === "propose" ? (
        <div className="archon-card p-6">
          <form onSubmit={onPropose} className="space-y-3">
            <input className="archon-input" placeholder="Freelancer wallet address" value={freelancerWallet} onChange={(event) => setFreelancerWallet(event.target.value)} required />
            {drafts.map((row) => (
              <div key={row.id} className="rounded-xl border border-white/10 bg-[#111214] p-3 space-y-2">
                <input className="archon-input" placeholder="Milestone title" value={row.title} onChange={(event) => setDrafts((prev) => prev.map((item) => item.id === row.id ? { ...item, title: event.target.value } : item))} required />
                <textarea className="archon-input min-h-20" placeholder="Description" value={row.description} onChange={(event) => setDrafts((prev) => prev.map((item) => item.id === row.id ? { ...item, description: event.target.value } : item))} required />
                <div className="grid gap-2 sm:grid-cols-2">
                  <input className="archon-input" type="number" min="5" step="0.000001" placeholder="Amount (USDC)" value={row.amount} onChange={(event) => setDrafts((prev) => prev.map((item) => item.id === row.id ? { ...item, amount: event.target.value } : item))} required />
                  <input className="archon-input" type="datetime-local" value={row.deadline} onChange={(event) => setDrafts((prev) => prev.map((item) => item.id === row.id ? { ...item, deadline: event.target.value } : item))} required />
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="archon-button-secondary px-3 py-2 text-xs" onClick={() => drafts.length < 20 && setDrafts((prev) => [...prev, newDraft()])}>Add Milestone</button>
              {drafts.length > 1 ? <button type="button" className="archon-button-secondary px-3 py-2 text-xs" onClick={() => setDrafts((prev) => prev.slice(0, -1))}>Remove Last</button> : null}
              <button
                type="submit"
                disabled={creating}
                className={creating ? "archon-button-primary px-4 py-2 text-sm opacity-50 cursor-not-allowed" : "archon-button-primary px-4 py-2 text-sm"}
              >
                {creating ? "Creating..." : "Create Project"}
              </button>
            </div>
          </form>
          {createdProjectId !== null ? <div className="mt-3 rounded-xl border border-[#00D1B2]/25 bg-[#00D1B2]/10 p-3 text-sm text-[#9EF6E8]">Project #{createdProjectId} created. {createdProjectMilestones[0] ? <button type="button" className="archon-button-primary ml-2 px-3 py-2 text-xs" onClick={() => void onFund(createdProjectMilestones[0])}>Fund Milestone 1</button> : null}</div> : null}
        </div>
      ) : null}

      {tab === "disputes" ? (
        <div className="archon-card p-6">
          {disputesList.length === 0 ? <p className="text-sm text-[#9CA3AF]">No active disputes.</p> : (
            <div className="space-y-3">
              {disputesList.map(({ milestoneId, dispute }) => {
                const assignedIndex = account ? dispute?.arbitrators.findIndex((address) => address.toLowerCase() === account.toLowerCase()) ?? -1 : -1;
                const canVote = assignedIndex >= 0 && dispute && dispute.votes[assignedIndex] === 0 && !dispute.resolved;
                return (
                  <article key={milestoneId} className="rounded-xl border border-white/10 bg-[#111214] p-3 text-sm text-[#9CA3AF]">
                    <p className="font-medium text-[#EAEAF0]">Milestone #{milestoneId}</p>
                    <p className="mt-1">{dispute?.reason}</p>
                    <p className="mt-1 text-xs">Votes: {dispute?.votesReceived}/3</p>
                    <p className="text-xs">Outcome: {dispute?.outcome === 1 ? "Favor Freelancer" : dispute?.outcome === 2 ? "Favor Client" : "Pending"}</p>
                    {canVote ? <div className="mt-2 flex gap-2"><button type="button" className="archon-button-primary px-3 py-2 text-xs" disabled={busy === milestoneId} onClick={() => void onVote(milestoneId, 1)}>Favor Freelancer</button><button type="button" className="archon-button-secondary px-3 py-2 text-xs" disabled={busy === milestoneId} onClick={() => void onVote(milestoneId, 2)}>Favor Client</button></div> : null}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      <div className="archon-card p-4 text-xs text-[#9CA3AF]">
        Need regular tasks instead? Go to <Link href="/" className="text-[#8FD9FF] underline underline-offset-4">Open Tasks</Link>.
      </div>
    </section>
  );
}
