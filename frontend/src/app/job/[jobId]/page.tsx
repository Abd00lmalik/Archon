"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import SignalMap from "@/components/signal-map";
import { SubmissionSignal, TaskSignalMap } from "@/lib/signal-map";
import {
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
  fetchSignalMap,
  fetchSubmissionForAgent,
  fetchSubmissions,
  formatTimestamp,
  formatUsdc,
  getJobReadContract,
  getJobSignalsReadContract,
  getReadProvider,
  JobRecord,
  RESPONSE_TYPE,
  statusLabel,
  SubmissionRecord,
  txAcceptJob,
  txClaimJobCredential,
  txFinalizeWinners,
  txRespondToSubmission,
  txSelectFinalists,
  txSubmitDeliverable
} from "@/lib/contracts";
import { useWallet } from "@/lib/wallet-context";

type ViewMode = "signal" | "list" | "timeline";

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function shortAddress(address: string) {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function parseUsdcInput(value: string): bigint | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const [whole, frac = ""] = trimmed.split(".");
  if (!/^\d+$/.test(whole || "0") || !/^\d*$/.test(frac)) return null;
  return BigInt(whole || "0") * 1_000_000n + BigInt(frac.slice(0, 6).padEnd(6, "0"));
}

function DeadlineCountdown({ deadline }: { deadline: number }) {
  const [remaining, setRemaining] = useState("");
  useEffect(() => {
    const update = () => {
      const diff = deadline - Date.now() / 1000;
      if (diff <= 0) return setRemaining("EXPIRED");
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = Math.floor(diff % 60);
      setRemaining(h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`);
    };
    update();
    const t = window.setInterval(update, 1000);
    return () => window.clearInterval(t);
  }, [deadline]);
  return <span className="text-data">{remaining}</span>;
}

function RevealCountdown({ end }: { end: number }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    const update = () => {
      const diff = end - Date.now() / 1000;
      if (diff <= 0) return setLabel("Ended");
      const d = Math.floor(diff / 86400);
      const h = Math.floor((diff % 86400) / 3600);
      const m = Math.floor((diff % 3600) / 60);
      setLabel(d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`);
    };
    update();
    const t = window.setInterval(update, 10000);
    return () => window.clearInterval(t);
  }, [end]);
  return <span>{label}</span>;
}

function PhaseBanner({ job, revealEnd }: { job: JobRecord; revealEnd: number }) {
  const phases = [
    { status: 0, label: "OPEN", desc: "Accepting submissions", color: "var(--pulse)" },
    { status: 1, label: "IN PROGRESS", desc: "Work underway", color: "var(--arc)" },
    { status: 2, label: "SUBMITTED", desc: "Creator reviewing submissions", color: "var(--warn)" },
    { status: 3, label: "SELECTION", desc: "Creator selecting finalists", color: "var(--warn)" },
    { status: 4, label: "REVEAL PHASE", desc: "Critique and build-on window open", color: "var(--arc)" },
    { status: 5, label: "APPROVED", desc: "Winners selected", color: "var(--pulse)" },
    { status: 6, label: "REJECTED", desc: "Task closed", color: "var(--danger)" }
  ];
  const current = phases.find((p) => p.status === job.status) ?? phases[0];
  const progress = Math.min(job.status, 5);
  return (
    <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-center gap-4">
        {phases.slice(0, 6).map((p, i) => (
          <div key={p.status} className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full" style={{ background: i <= progress ? current.color : "var(--border-bright)" }} />
            {i < 5 ? <div className="h-px w-8" style={{ background: i < progress ? current.color : "var(--border)" }} /> : null}
          </div>
        ))}
      </div>
      <div className="text-right">
        <div className="font-mono text-xs font-bold tracking-wider" style={{ color: current.color }}>{current.label}</div>
        <div className="text-xs text-[var(--text-secondary)]">{current.desc}</div>
        {job.status === 4 && revealEnd > 0 ? <div className="mt-1 text-xs font-mono text-[var(--warn)]">Ends: <RevealCountdown end={revealEnd} /></div> : null}
      </div>
    </div>
  );
}

export default function JobDetailsPage() {
  const params = useParams<{ jobId: string }>();
  const router = useRouter();
  const { account, browserProvider, connect } = useWallet();
  const jobId = useMemo(() => Number(params.jobId), [params.jobId]);

  const [job, setJob] = useState<JobRecord | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([]);
  const [mySubmission, setMySubmission] = useState<SubmissionRecord | null>(null);
  const [isAccepted, setIsAccepted] = useState(false);
  const [maxApprovals, setMaxApprovals] = useState(1);
  const [approvalsUsed, setApprovalsUsed] = useState(0);
  const [creatorPostedCount, setCreatorPostedCount] = useState(0);
  const [escrowLocked, setEscrowLocked] = useState(0n);

  const [selectedFinalists, setSelectedFinalists] = useState<string[]>([]);
  const [finalistDraft, setFinalistDraft] = useState<string[]>([]);
  const [revealPhaseEnd, setRevealPhaseEnd] = useState(0);
  const [isRevealPhase, setIsRevealPhase] = useState(false);

  const [signalMap, setSignalMap] = useState<TaskSignalMap>({ submissions: [], totalInteractions: 0, revealPhaseEnd: 0, isRevealPhase: false });
  const [signalMapLoading, setSignalMapLoading] = useState(true);
  const [selectedSignal, setSelectedSignal] = useState<SubmissionSignal | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("signal");

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
  const finalistSet = useMemo(() => new Set(selectedFinalists.map((a) => a.toLowerCase())), [selectedFinalists]);
  const pendingSubmissions = useMemo(() => submissions.filter((s) => s.status === 1), [submissions]);

  const withProvider = async () => {
    const p = browserProvider ?? (await connect());
    if (!p) throw new Error("Wallet connection was not established.");
    const net = await p.getNetwork();
    if (Number(net.chainId) !== expectedChainId) throw new Error(`Switch wallet network to chain ID ${expectedChainId}.`);
    return p;
  };

  const loadTask = useCallback(async () => {
    if (!Number.isInteger(jobId) || jobId < 0) return;
    const [jobData, subs, escrow, used, maxAllowed, finals, revealEnd, revealOpen] = await Promise.all([
      fetchJob(jobId),
      fetchSubmissions(jobId),
      fetchJobEscrow(jobId),
      fetchApprovedAgentCount(jobId),
      fetchMaxApprovalsForJob(jobId),
      fetchSelectedFinalists(jobId),
      fetchRevealPhaseEnd(jobId),
      fetchIsInRevealPhase(jobId)
    ]);
    if (!jobData) return;
    setJob(jobData);
    setSubmissions(subs);
    setEscrowLocked(escrow);
    setApprovalsUsed(used);
    setMaxApprovals(Math.max(1, maxAllowed || 1));
    setSelectedFinalists(finals);
    setRevealPhaseEnd(revealEnd);
    setIsRevealPhase(revealOpen);
    setCreatorPostedCount(await fetchJobsCreatedCount(jobData.client));
    if (account) {
      const contract = getJobReadContract();
      const [accepted, mine, lastClaim, cooldown] = await Promise.all([
        contract.isAccepted(jobId, account).catch(() => false),
        fetchSubmissionForAgent(jobId, account),
        fetchLastJobCredentialClaim(account),
        fetchJobCredentialCooldownSeconds()
      ]);
      setIsAccepted(Boolean(accepted));
      setMySubmission(mine);
      setClaimReadyAt(Number(lastClaim) + cooldown);
    }
  }, [account, jobId]);

  const loadSignalMap = useCallback(async () => {
    if (!Number.isInteger(jobId) || jobId < 0) return;
    setSignalMapLoading(true);
    try {
      const p = browserProvider ?? getReadProvider();
      const data = (await fetchSignalMap(p, jobId)) as unknown as TaskSignalMap;
      setSignalMap({ submissions: data.submissions ?? [], totalInteractions: data.totalInteractions ?? 0, revealPhaseEnd: data.revealPhaseEnd ?? 0, isRevealPhase: Boolean(data.isRevealPhase) });
    } finally {
      setSignalMapLoading(false);
    }
  }, [browserProvider, jobId]);

  useEffect(() => { void loadTask(); void loadSignalMap(); }, [loadTask, loadSignalMap]);

  useEffect(() => {
    if (!claimReadyAt) return;
    const update = () => setClaimCountdown(Math.max(0, claimReadyAt - Math.floor(Date.now() / 1000)));
    update();
    const t = window.setInterval(update, 1000);
    return () => window.clearInterval(t);
  }, [claimReadyAt]);

  useEffect(() => {
    if (!Number.isInteger(jobId) || jobId < 0) return () => undefined;
    const contract = getJobSignalsReadContract();
    const refresh = async (id: bigint | number) => { if (Number(id) === jobId) { await loadTask(); await loadSignalMap(); } };
    const onSub = async (id: bigint) => refresh(id);
    const onResp = async (id: bigint) => refresh(id);
    const onFinals = async (id: bigint) => refresh(id);
    const onWins = async (id: bigint) => refresh(id);
    contract.on("DeliverableSubmitted", onSub);
    contract.on("SubmissionResponseAdded", onResp);
    contract.on("FinalistsSelected", onFinals);
    contract.on("WinnersFinalized", onWins);
    return () => {
      contract.off("DeliverableSubmitted", onSub);
      contract.off("SubmissionResponseAdded", onResp);
      contract.off("FinalistsSelected", onFinals);
      contract.off("WinnersFinalized", onWins);
    };
  }, [jobId, loadTask, loadSignalMap]);

  const handleAccept = async () => {
    try { setBusyAction("accept"); const p = await withProvider(); const tx = await txAcceptJob(p, jobId); setStatusMessage(`Accept tx: ${tx.hash}`); await tx.wait(); await loadTask(); }
    catch (error: unknown) { setErrorMessage(errorText(error, "Failed to accept")); }
    finally { setBusyAction(""); }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try { setBusyAction("submit"); const p = await withProvider(); const tx = await txSubmitDeliverable(p, jobId, deliverableLink.trim()); setStatusMessage(`Submit tx: ${tx.hash}`); await tx.wait(); setDeliverableLink(""); await loadTask(); await loadSignalMap(); }
    catch (error: unknown) { setErrorMessage(errorText(error, "Failed to submit")); }
    finally { setBusyAction(""); }
  };

  const handleSelectFinalists = async () => {
    try { setBusyAction("select"); const p = await withProvider(); const unique = [...new Set(finalistDraft.map((a) => a.toLowerCase()))].map((a) => submissions.find((s) => s.agent.toLowerCase() === a)?.agent).filter((a): a is string => Boolean(a)); const tx = await txSelectFinalists(p, jobId, unique); setStatusMessage(`Finalists tx: ${tx.hash}`); await tx.wait(); await loadTask(); await loadSignalMap(); }
    catch (error: unknown) { setErrorMessage(errorText(error, "Failed selecting finalists")); }
    finally { setBusyAction(""); }
  };

  const handleFinalizeWinners = async () => {
    try {
      setBusyAction("finalize");
      const winners: string[] = [];
      const amounts: bigint[] = [];
      for (const finalist of selectedFinalists) {
        const parsed = parseUsdcInput(rewardInputs[finalist.toLowerCase()] ?? "");
        if (parsed && parsed > 0n) { winners.push(finalist); amounts.push(parsed); }
      }
      const p = await withProvider();
      const tx = await txFinalizeWinners(p, jobId, winners, amounts);
      setStatusMessage(`Finalize tx: ${tx.hash}`);
      await tx.wait();
      await loadTask();
      await loadSignalMap();
    } catch (error: unknown) { setErrorMessage(errorText(error, "Failed to finalize")); }
    finally { setBusyAction(""); }
  };

  const handleClaim = async () => {
    try { setBusyAction("claim"); const p = await withProvider(); const tx = await txClaimJobCredential(p, jobId); setStatusMessage(`Claim tx: ${tx.hash}`); await tx.wait(); await loadTask(); }
    catch (error: unknown) { setErrorMessage(errorText(error, "Failed to claim")); }
    finally { setBusyAction(""); }
  };

  const handleRespond = async () => {
    if (!selectedSignal) return;
    try {
      setBusyAction("respond");
      const p = await withProvider();
      const signer = await p.getSigner();
      const payload = { responseType: responseType === 0 ? "builds_on" : responseType === 1 ? "critiques" : "alternative", summary: responseContent.slice(0, 120), content: responseContent, referencedElements: [] };
      const contentUri = `data:application/json,${encodeURIComponent(JSON.stringify(payload))}`;
      const txHash = await txRespondToSubmission(signer, BigInt(selectedSignal.submissionId), responseType, contentUri);
      setStatusMessage(`Response tx: ${txHash}`);
      setResponseContent("");
      await loadSignalMap();
    } catch (error: unknown) { setErrorMessage(errorText(error, "Failed to respond")); }
    finally { setBusyAction(""); }
  };

  const hasSubmitted = Boolean(mySubmission && mySubmission.status !== 0);
  const isApproved = mySubmission?.status === 2;
  const isClaimed = Boolean(mySubmission?.credentialClaimed);
  const canClaim = isConnected && !isCreator && isApproved && !isClaimed && claimCountdown <= 0;
  const canInteract = Boolean(job && selectedSignal && job.status === 4 && Date.now() / 1000 <= revealPhaseEnd && finalistSet.has(selectedSignal.agent.toLowerCase()));
  const revealEnded = revealPhaseEnd > 0 && Date.now() / 1000 > revealPhaseEnd;

  return (
    <section className="page-container space-y-6">
      {statusMessage ? <div className="panel border-[var(--pulse)] py-3 text-sm text-[var(--pulse)]">{statusMessage}</div> : null}
      {errorMessage ? <div className="panel border-[var(--danger)] py-3 text-sm text-[var(--danger)]">{errorMessage}</div> : null}

      {job ? <PhaseBanner job={job} revealEnd={revealPhaseEnd} /> : null}

      {!job ? <div className="panel text-sm text-[var(--text-secondary)]">Loading task...</div> : (
        <>
          <div className="border-b border-[var(--border)] pb-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3"><button type="button" onClick={() => router.back()} className="text-sm font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)]">? TASKS</button><span className="text-sm font-mono text-[var(--border-bright)]">/</span><span className="text-xs font-mono text-[var(--text-muted)]">#{job.jobId}</span></div>
              <span className="text-xs font-mono tracking-wider text-[var(--text-secondary)]">{statusLabel(job.status)}</span>
            </div>
            <div className="flex items-start justify-between gap-6"><h1 className="text-heading-1 flex-1">{job.title}</h1><div className="text-right"><div className="font-heading text-[var(--gold)]" style={{ fontSize: "clamp(24px, 3vw, 36px)", fontWeight: 700 }}>{formatUsdc(job.rewardUSDC)} USDC</div><div className="text-label mt-1 text-[var(--text-muted)]">Reward Pool</div></div></div>
            <div className="mt-4 flex flex-wrap items-center gap-6 border-t border-[var(--border)] pt-4"><div className="flex items-center gap-2"><span className="text-label">BY</span><span className="text-data text-[var(--arc)]">{shortAddress(job.client)}</span></div><div className="flex items-center gap-2"><span className="text-label">DEADLINE</span><DeadlineCountdown deadline={job.deadline} /></div><div className="flex items-center gap-2"><span className="text-label">SUBMISSIONS</span><span className="text-data">{job.submissionCount}</span></div><div className="flex items-center gap-2"><span className="text-label">MAX WINNERS</span><span className="text-data">{maxApprovals}</span></div></div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_320px]">
            <aside className="panel h-fit space-y-6">
              <div><div className="section-header">DESCRIPTION</div><p className="text-sm text-[var(--text-secondary)]">{job.description}</p></div>
              <div><div className="section-header">METADATA</div><div className="space-y-2 text-xs"><div className="flex justify-between"><span className="text-[var(--text-muted)]">Creator</span><span className="text-data">{shortAddress(job.client)}</span></div><div className="flex justify-between"><span className="text-[var(--text-muted)]">Tasks posted</span><span className="font-mono">{creatorPostedCount}</span></div><div className="flex justify-between"><span className="text-[var(--text-muted)]">Created</span><span className="font-mono">{formatTimestamp(job.createdAt)}</span></div></div></div>
              <div><div className="section-header">REWARD BREAKDOWN</div><div className="space-y-2 text-xs"><div className="flex justify-between"><span className="text-[var(--text-muted)]">Total pool</span><span className="font-mono text-[var(--gold)]">{formatUsdc(job.rewardUSDC)} USDC</span></div><div className="flex justify-between"><span className="text-[var(--text-muted)]">Escrow locked</span><span className="font-mono">{formatUsdc(escrowLocked)} USDC</span></div><div className="flex justify-between"><span className="text-[var(--text-muted)]">Approval slots</span><span className="font-mono">{approvalsUsed}/{maxApprovals}</span></div></div></div>
            </aside>

            <div className="space-y-4">
              <div className="panel-elevated flex gap-2"><button type="button" className={viewMode === "signal" ? "btn-primary px-3 py-2 text-xs" : "btn-ghost px-3 py-2 text-xs"} onClick={() => setViewMode("signal")}>SIGNAL MAP</button><button type="button" className={viewMode === "list" ? "btn-primary px-3 py-2 text-xs" : "btn-ghost px-3 py-2 text-xs"} onClick={() => setViewMode("list")}>LIST</button><button type="button" className={viewMode === "timeline" ? "btn-primary px-3 py-2 text-xs" : "btn-ghost px-3 py-2 text-xs"} onClick={() => setViewMode("timeline")}>TIMELINE</button></div>
              {viewMode === "signal" ? <div className="panel">{job.status === 4 && isRevealPhase ? <div className="mb-3 flex items-center gap-2"><span className="live-dot" /><span className="text-xs font-mono text-[var(--pulse)]">LIVE — updates as submissions arrive</span></div> : null}<SignalMap signalMap={signalMap} loading={signalMapLoading} onSubmissionClick={setSelectedSignal} /></div> : null}
              {viewMode === "list" ? <div className="space-y-3">{submissions.map((s) => <article key={`${s.agent}-${s.submittedAt}`} className="card-sharp space-y-2 p-4"><div className="flex items-center justify-between"><span className="text-data text-xs">{shortAddress(s.agent)}</span><span className="badge badge-arc">{s.status === 2 ? "APPROVED" : s.status === 1 ? "SUBMITTED" : "PENDING"}</span></div><a href={s.deliverableLink} target="_blank" rel="noreferrer" className="break-all text-xs font-mono text-[var(--arc)] underline">{s.deliverableLink}</a></article>)}</div> : null}
              {viewMode === "timeline" ? <div className="panel space-y-2">{submissions.map((s) => <div key={`tl-${s.submissionId}`} className="card-sharp flex items-center justify-between px-3 py-2 text-xs"><span>{shortAddress(s.agent)} submitted work</span><span className="font-mono text-[var(--text-muted)]">{formatTimestamp(s.submittedAt)}</span></div>)}</div> : null}
            </div>

            <aside className="panel h-fit space-y-4">
              {!isConnected ? <><div className="section-header">CONNECT WALLET</div><button type="button" className="btn-primary w-full" onClick={() => void connect()}>Connect Wallet</button></> : null}

              {isConnected && !isCreator ? (
                <>
                  <div className="section-header">YOUR ACTIONS</div>
                  {!isAccepted ? <button type="button" className="btn-primary w-full" onClick={() => void handleAccept()} disabled={busyAction === "accept"}>{busyAction === "accept" ? "Accepting..." : "Accept Task"}</button> : null}
                  {isAccepted && !hasSubmitted ? <form className="space-y-3" onSubmit={handleSubmit}><input type="url" className="input-field" placeholder="https://..." value={deliverableLink} onChange={(e) => setDeliverableLink(e.target.value)} /><button type="submit" className="btn-primary w-full" disabled={busyAction === "submit" || !deliverableLink.trim()}>{busyAction === "submit" ? "Submitting..." : "Submit Work"}</button></form> : null}
                  {canClaim ? <button type="button" className="btn-primary w-full" onClick={() => void handleClaim()} disabled={busyAction === "claim"}>{busyAction === "claim" ? "Claiming..." : `Claim ${formatUsdc(mySubmission?.allocatedReward ?? 0)} USDC`}</button> : null}
                  {claimCountdown > 0 ? <p className="text-xs text-[var(--warn)]">Claim in {Math.floor(claimCountdown / 60)}m</p> : null}

                  {job.status < 4 ? <div className="border border-[var(--border)] p-3 text-xs text-[var(--text-muted)]">Critiques and build-ons open during the 5-day reveal phase after finalists are selected.</div> : null}
                  {selectedSignal ? <><button type="button" className="btn-ghost w-full" onClick={() => setShowResponsePanel((v) => !v)}>{showResponsePanel ? "Close Response Panel" : "Respond to Selected Submission"}</button>{showResponsePanel ? <div className="card-sharp space-y-3 p-4"><div className="grid grid-cols-3 gap-1">{[{ type: RESPONSE_TYPE.BuildsOn, label: "BUILDS ON", color: "var(--arc)" }, { type: RESPONSE_TYPE.Critiques, label: "CRITIQUES", color: "var(--warn)" }, { type: RESPONSE_TYPE.Alternative, label: "ALTERNATIVE", color: "var(--agent)" }].map((t) => <button key={t.type} type="button" onClick={() => setResponseType(t.type)} className="border p-2 text-[10px] font-mono" style={{ borderColor: responseType === t.type ? t.color : "var(--border)", color: responseType === t.type ? t.color : "var(--text-muted)", background: responseType === t.type ? `${t.color}12` : "transparent" }}>{t.label}</button>)}</div><textarea className="input-field resize-none" rows={4} value={responseContent} onChange={(e) => setResponseContent(e.target.value)} placeholder="Explain your response..." /><button type="button" className="btn-primary w-full" onClick={() => void handleRespond()} disabled={!canInteract || busyAction === "respond" || responseContent.trim().length < 20}>{busyAction === "respond" ? "Submitting..." : "Submit Response — Stake 2 USDC"}</button></div> : null}</> : null}
                </>
              ) : null}

              {isConnected && isCreator ? (
                <>
                  {job.status === 2 ? <div className="space-y-3"><div className="section-header">SELECT FINALISTS</div><p className="text-xs text-[var(--text-secondary)]">Choose up to {maxApprovals + 5} submissions for reveal phase.</p><div className="space-y-2">{pendingSubmissions.map((s) => { const checked = finalistDraft.some((a) => a.toLowerCase() === s.agent.toLowerCase()); return <label key={s.agent} className="flex items-center gap-2 border border-[var(--border)] p-2 text-xs"><input type="checkbox" checked={checked} onChange={() => setFinalistDraft((prev) => checked ? prev.filter((a) => a.toLowerCase() !== s.agent.toLowerCase()) : [...prev, s.agent])} /><span className="text-data">{shortAddress(s.agent)}</span></label>; })}</div><button type="button" className="btn-primary w-full" onClick={() => void handleSelectFinalists()} disabled={busyAction === "select"}>{busyAction === "select" ? "Selecting..." : "Start Reveal Phase"}</button></div> : null}
                  {job.status === 4 && revealEnded ? <div className="space-y-3"><div className="section-header">FINALIZE WINNERS</div>{selectedFinalists.map((agent) => <div key={agent} className="card-sharp p-3"><div className="mb-2 text-data text-xs">{shortAddress(agent)}</div><input type="number" min={0} step="0.000001" className="input-field text-sm" placeholder="Reward USDC" value={rewardInputs[agent.toLowerCase()] ?? ""} onChange={(e) => setRewardInputs((prev) => ({ ...prev, [agent.toLowerCase()]: e.target.value }))} /></div>)}<button type="button" className="btn-primary w-full" onClick={() => void handleFinalizeWinners()} disabled={busyAction === "finalize"}>{busyAction === "finalize" ? "Finalizing..." : "Finalize Winners"}</button></div> : null}
                  {job.status === 4 && !revealEnded ? <div className="border border-[var(--border)] p-3 text-xs text-[var(--text-muted)]">Reveal phase is active. Finalization opens after <RevealCountdown end={revealPhaseEnd} />.</div> : null}
                </>
              ) : null}
            </aside>
          </div>

          <div className="pt-2"><Link href="/" className="btn-ghost inline-flex">Back to task feed</Link></div>
        </>
      )}
    </section>
  );
}

