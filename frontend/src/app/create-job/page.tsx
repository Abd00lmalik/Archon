"use client";

import { ethers } from "ethers";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  contractAddresses,
  expectedChainId,
  formatTimestamp,
  getJobWriteContract,
  txApproveUsdcIfNeeded
} from "@/lib/contracts";
import { useWallet } from "@/lib/wallet-context";
import { ARC_TOKEN_CONFIG } from "../../../config";
import { getArcBalance, hasEnoughArcToPost } from "@/lib/arcToken";

type EstimateState = "idle" | "loading" | "ready" | "error";

function parseDeadline(deadlineInput: string) {
  if (!deadlineInput) return 0;
  return Math.floor(new Date(deadlineInput).getTime() / 1000);
}

function parseRewardToUnits(reward: string) {
  const trimmed = reward.trim();
  if (!trimmed) return 0n;
  return ethers.parseUnits(trimmed, 6);
}

export default function CreateJobPage() {
  const { account, browserProvider, connect } = useWallet();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deadlineInput, setDeadlineInput] = useState("");
  const [rewardInput, setRewardInput] = useState("0");
  const [createdJobId, setCreatedJobId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [estimateState, setEstimateState] = useState<EstimateState>("idle");
  const [estimateMessage, setEstimateMessage] = useState("Enter all fields to estimate gas.");
  const [estimatedUnits, setEstimatedUnits] = useState("");
  const [estimatedCost, setEstimatedCost] = useState("");
  const [arcBalance, setArcBalance] = useState("0");
  const [arcGateAllowed, setArcGateAllowed] = useState(true);
  const [checkingArc, setCheckingArc] = useState(false);

  const gateEnabled = ARC_TOKEN_CONFIG.tokenAddress !== "0x0000000000000000000000000000000000000000";
  const submitDisabled = submitting || (gateEnabled && !arcGateAllowed);
  const costSymbol = expectedChainId === 5042002 ? "USDC" : "ETH";
  const trimmedTitle = title.trim();
  const trimmedDescription = description.trim();
  const deadline = parseDeadline(deadlineInput);
  const deadlineDisplay = deadline ? formatTimestamp(deadline) : "";

  useEffect(() => {
    let active = true;

    const checkBalance = async () => {
      if (!gateEnabled || !account || !browserProvider) {
        setArcGateAllowed(true);
        return;
      }
      setCheckingArc(true);
      try {
        const [allowed, balance] = await Promise.all([
          hasEnoughArcToPost(browserProvider, account),
          getArcBalance(browserProvider, account)
        ]);
        if (!active) return;
        setArcGateAllowed(allowed);
        setArcBalance(balance);
      } catch {
        if (!active) return;
        setArcGateAllowed(false);
        setArcBalance("0");
      } finally {
        if (active) setCheckingArc(false);
      }
    };

    void checkBalance();
    return () => {
      active = false;
    };
  }, [account, browserProvider, gateEnabled]);

  useEffect(() => {
    let active = true;

    if (!trimmedTitle || !trimmedDescription || !deadlineInput) {
      setEstimateState("idle");
      setEstimateMessage("Enter all fields to estimate gas.");
      setEstimatedUnits("");
      setEstimatedCost("");
      return () => {
        active = false;
      };
    }

    setEstimateState("loading");
    setEstimateMessage("Estimating...");

    const timer = setTimeout(() => {
      void (async () => {
        if (!browserProvider) {
          if (!active) return;
          setEstimateState("error");
          setEstimateMessage("Unable to estimate (wallet not connected).");
          return;
        }

        try {
          const rewardUnits = parseRewardToUnits(rewardInput);
          const jobContract = await getJobWriteContract(browserProvider);
          const gas = (await jobContract.createJob.estimateGas(trimmedTitle, trimmedDescription, deadline, rewardUnits)) as bigint;
          const feeData = await browserProvider.getFeeData();
          const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas;
          const totalCost = gasPrice ? ethers.formatEther(gas * gasPrice) : "";
          if (!active) return;
          setEstimateState("ready");
          setEstimatedUnits(gas.toString());
          setEstimatedCost(totalCost);
          setEstimateMessage("Estimate ready");
        } catch {
          if (!active) return;
          setEstimateState("error");
          setEstimateMessage("Unable to estimate");
          setEstimatedUnits("");
          setEstimatedCost("");
        }
      })();
    }, 500);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [browserProvider, deadline, deadlineInput, rewardInput, trimmedDescription, trimmedTitle]);

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setStatus("");
    setCreatedJobId(null);

    if (!trimmedTitle || !trimmedDescription) {
      setError("Title and description are required.");
      return;
    }
    if (trimmedTitle.length > 100) {
      setError("Title must be 100 characters or fewer.");
      return;
    }
    if (trimmedDescription.length > 500) {
      setError("Description must be 500 characters or fewer.");
      return;
    }
    if (!deadlineInput || deadline <= Math.floor(Date.now() / 1000)) {
      setError("Set a future deadline for this job.");
      return;
    }
    if (gateEnabled && !arcGateAllowed) {
      setError(`You need at least ${ARC_TOKEN_CONFIG.minBalanceToPost} ${ARC_TOKEN_CONFIG.symbol} to post a job.`);
      return;
    }

    let rewardUnits: bigint;
    try {
      rewardUnits = parseRewardToUnits(rewardInput);
    } catch {
      setError("Enter a valid USDC reward amount.");
      return;
    }

    setSubmitting(true);
    try {
      const provider = browserProvider ?? (await connect());
      if (!provider) throw new Error("Wallet connection was not established.");

      const network = await provider.getNetwork();
      if (Number(network.chainId) !== expectedChainId) {
        throw new Error(`Switch wallet network to chain ID ${expectedChainId}.`);
      }

      const jobContract = await getJobWriteContract(provider);
      const predictedJobId = Number(await jobContract.nextJobId());

      const approvalTx = await txApproveUsdcIfNeeded(provider, contractAddresses.job, rewardUnits);
      if (approvalTx) {
        setStatus(`USDC approve transaction submitted: ${approvalTx.hash}`);
        await approvalTx.wait();
      }

      const tx = await jobContract.createJob(trimmedTitle, trimmedDescription, deadline, rewardUnits);
      setStatus(`Create transaction submitted: ${tx.hash}`);
      const receipt = await tx.wait();

      let jobIdFromEvent: number | null = null;
      for (const log of receipt.logs) {
        try {
          const parsed = jobContract.interface.parseLog({
            topics: Array.from(log.topics),
            data: log.data
          });
          if (parsed?.name === "JobCreated") {
            jobIdFromEvent = Number(parsed.args[0]);
            break;
          }
        } catch {
          // Ignore unrelated log entries.
        }
      }

      const createdId = jobIdFromEvent ?? (Number.isFinite(predictedJobId) ? predictedJobId : null);
      setCreatedJobId(createdId);
      setStatus(createdId !== null ? `Job #${createdId} created successfully.` : "Job created successfully.");
      setTitle("");
      setDescription("");
      setDeadlineInput("");
      setRewardInput("0");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create job.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mx-auto max-w-[560px]">
      <div className="archon-card p-6 md:p-7">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">Create Job</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">Set reward and deadline so accepted users can submit before time runs out.</p>

        {status ? <div className="mt-4 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{status}</div> : null}
        {createdJobId !== null ? (
          <div className="mt-4 rounded-xl border border-[#00D1B2]/30 bg-[#00D1B2]/10 px-4 py-3 text-sm text-[#9EF6E8]">
            Job ID: <strong>#{createdJobId}</strong>.{" "}
            <Link href="/" className="underline underline-offset-4 hover:text-white">
              View on Home
            </Link>
          </div>
        ) : null}
        {error ? <div className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

        <form onSubmit={handleCreate} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[#EAEAF0]">Job Title</span>
            <input
              aria-label="Job title"
              className="archon-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Build landing page"
              required
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[#EAEAF0]">Description</span>
            <textarea
              aria-label="Job description"
              className="archon-input min-h-32"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Create and deploy a responsive marketing page."
              required
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[#EAEAF0]">Deadline (date & time)</span>
            <input
              aria-label="Job deadline"
              type="datetime-local"
              className="archon-input"
              value={deadlineInput}
              onChange={(event) => setDeadlineInput(event.target.value)}
              required
            />
            {deadlineDisplay ? <p className="mt-1 text-xs text-[#9CA3AF]">Ends: {deadlineDisplay}</p> : null}
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[#EAEAF0]">Reward (USDC)</span>
            <input
              aria-label="Reward amount in USDC"
              type="number"
              min="0"
              step="0.000001"
              className="archon-input"
              value={rewardInput}
              onChange={(event) => setRewardInput(event.target.value)}
              placeholder="100"
              required
            />
          </label>

          {gateEnabled && !arcGateAllowed ? (
            <div className="rounded-xl border border-amber-300/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              You need at least {ARC_TOKEN_CONFIG.minBalanceToPost} {ARC_TOKEN_CONFIG.symbol} to post a job. Your balance: {arcBalance} {ARC_TOKEN_CONFIG.symbol}
              {checkingArc ? " (checking...)" : ""}
            </div>
          ) : null}

          <div className="arc-glass arc-mono px-3 py-2 text-xs text-[#C9D0DB]">
            <div className="font-semibold text-[#EAEAF0]">Gas Estimate</div>
            {estimateState === "loading" ? (
              <div>Estimating...</div>
            ) : estimateState === "ready" ? (
              <div>
                {estimatedUnits} units{estimatedCost ? ` (~${estimatedCost} ${costSymbol})` : ""}
              </div>
            ) : (
              <div>{estimateMessage}</div>
            )}
          </div>

          <button
            type="submit"
            disabled={submitDisabled}
            className="archon-button-primary w-full px-4 py-2.5 text-sm transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create Job"}
          </button>
        </form>
      </div>
    </section>
  );
}
