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
  MilestoneRecord,
  txApproveMilestone,
  txApproveUsdcIfNeeded,
  txAutoReleaseMilestone,
  txFundMilestone,
  txProposeMilestoneProject,
  txRaiseMilestoneDispute,
  txSubmitMilestoneDeliverable,
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

  const onSubmitDeliverable = async (milestoneId: number) => {
    const deliverable = (deliverables[milestoneId] ?? "").trim();
    if (!deliverable) return setError("Deliverable link/hash is required.");
    setBusy(milestoneId);
    setStatus("");
    setError("");
    try {
      const provider = await withProvider();
      const tx = await txSubmitMilestoneDeliverable(provider, milestoneId, deliverable);
      await tx.wait();
      setStatus(`Milestone #${milestoneId} submitted.`);
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to submit deliverable.");
    } finally {
      setBusy(null);
    }
  };

  const onApprove = async (milestoneId: number) => {
    setBusy(milestoneId);
    setStatus("");
    setError("");
    try {
      const provider = await withProvider();
      const tx = await txApproveMilestone(provider, milestoneId);
      await tx.wait();
      setStatus(`Milestone #${milestoneId} approved.`);
      await load();
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : "Failed to approve milestone.");
    } finally {
      setBusy(null);
    }
  };

  const onDispute = async (milestoneId: number) => {
    const reason = (disputeNotes[milestoneId] ?? "").trim();
    if (reason.length < 20) return setError("Dispute reason must be at least 20 characters.");
    setBusy(milestoneId);
    setStatus("");
    setError("");
    try {
      const provider = await withProvider();
      const tx = await txRaiseMilestoneDispute(provider, milestoneId, reason);
      await tx.wait();
      setStatus(`Dispute raised for #${milestoneId}.`);
      await load();
    } catch (disputeError) {
      setError(disputeError instanceof Error ? disputeError.message : "Failed to raise dispute.");
    } finally {
      setBusy(null);
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
                      const canAutoRelease = milestone.status === 1 && milestone.submittedAt > 0 && Math.floor(Date.now() / 1000) > milestone.submittedAt + disputeWindow;
                      return (
                        <div key={milestone.milestoneId} className="rounded-xl border border-white/10 bg-[#0F1012] p-3 text-sm text-[#9CA3AF]">
                          <p className="font-medium text-[#EAEAF0]">#{milestone.milestoneId} {milestone.title}</p>
                          <p className="mt-1">{milestone.description}</p>
                          <p className="mt-1 text-xs">Amount: {formatUsdc(milestone.amount)} USDC · Status: {statusLabel(milestone.status, isFunded)}</p>
                          <p className="text-xs">Deadline: {formatTimestamp(milestone.deadline)}</p>
                          {isClient && milestone.status === 0 && !isFunded ? <button type="button" onClick={() => void onFund(milestone)} disabled={busy === milestone.milestoneId} className="archon-button-primary mt-2 px-3 py-2 text-xs">{busy === milestone.milestoneId ? "Funding..." : "Fund Milestone"}</button> : null}
                          {isFreelancer && milestone.status === 0 && isFunded ? <div className="mt-2 flex flex-wrap gap-2"><input className="archon-input grow" placeholder="Deliverable link/hash" value={deliverables[milestone.milestoneId] ?? ""} onChange={(event) => setDeliverables((prev) => ({ ...prev, [milestone.milestoneId]: event.target.value }))} /><button type="button" onClick={() => void onSubmitDeliverable(milestone.milestoneId)} disabled={busy === milestone.milestoneId} className="archon-button-primary px-3 py-2 text-xs">Submit</button></div> : null}
                          {isClient && milestone.status === 1 ? <div className="mt-2 space-y-2"><div className="flex gap-2"><button type="button" onClick={() => void onApprove(milestone.milestoneId)} disabled={busy === milestone.milestoneId} className="archon-button-primary px-3 py-2 text-xs">Approve</button><button type="button" onClick={() => void onDispute(milestone.milestoneId)} disabled={busy === milestone.milestoneId} className="archon-button-secondary px-3 py-2 text-xs">Dispute</button></div><textarea className="archon-input min-h-20" value={disputeNotes[milestone.milestoneId] ?? ""} onChange={(event) => setDisputeNotes((prev) => ({ ...prev, [milestone.milestoneId]: event.target.value }))} placeholder="Dispute reason (min 20 chars)" /></div> : null}
                          {isFreelancer && canAutoRelease ? <button type="button" onClick={async () => { try { setBusy(milestone.milestoneId); const provider = await withProvider(); const tx = await txAutoReleaseMilestone(provider, milestone.milestoneId); await tx.wait(); setStatus(`Milestone #${milestone.milestoneId} auto-released.`); await load(); } catch (autoError) { setError(autoError instanceof Error ? autoError.message : "Failed to auto-release milestone."); } finally { setBusy(null); } }} disabled={busy === milestone.milestoneId} className="archon-button-primary mt-2 px-3 py-2 text-xs">Auto-Release</button> : null}
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
