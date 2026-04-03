"use client";

import { ethers } from "ethers";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { expectedChainId, getJobWriteContract } from "@/lib/contracts";
import { useWallet } from "@/lib/wallet-context";
import { ARC_TOKEN_CONFIG } from "../../../config";
import { getArcBalance, hasEnoughArcToPost } from "@/lib/arcToken";

type EstimateState = "idle" | "loading" | "ready" | "error";

export default function CreateJobPage() {
  const router = useRouter();
  const { account, browserProvider, connect } = useWallet();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [estimateState, setEstimateState] = useState<EstimateState>("idle");
  const [estimateMessage, setEstimateMessage] = useState("Enter title and description to estimate gas.");
  const [estimatedUnits, setEstimatedUnits] = useState<string>("");
  const [estimatedCost, setEstimatedCost] = useState<string>("");
  const [arcBalance, setArcBalance] = useState("0");
  const [arcGateAllowed, setArcGateAllowed] = useState(true);
  const [checkingArc, setCheckingArc] = useState(false);

  const gateEnabled = ARC_TOKEN_CONFIG.tokenAddress !== "0x0000000000000000000000000000000000000000";
  const submitDisabled = submitting || (gateEnabled && !arcGateAllowed);
  const costSymbol = expectedChainId === 5042002 ? "USDC" : "ETH";
  const trimmedTitle = title.trim();
  const trimmedDescription = description.trim();

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
        if (active) {
          setCheckingArc(false);
        }
      }
    };

    void checkBalance();
    return () => {
      active = false;
    };
  }, [account, browserProvider, gateEnabled]);

  useEffect(() => {
    let active = true;

    if (!trimmedTitle || !trimmedDescription) {
      setEstimateState("idle");
      setEstimateMessage("Enter title and description to estimate gas.");
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
          const jobContract = await getJobWriteContract(browserProvider);
          const gas = (await jobContract.createJob.estimateGas(trimmedTitle, trimmedDescription)) as bigint;
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
  }, [browserProvider, trimmedDescription, trimmedTitle]);

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setStatus("");

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
    if (gateEnabled && !arcGateAllowed) {
      setError(`You need at least ${ARC_TOKEN_CONFIG.minBalanceToPost} ${ARC_TOKEN_CONFIG.symbol} to post a job.`);
      return;
    }

    setSubmitting(true);
    try {
      const provider = browserProvider ?? (await connect());
      if (!provider) {
        throw new Error("Wallet connection was not established.");
      }

      const network = await provider.getNetwork();
      if (Number(network.chainId) !== expectedChainId) {
        throw new Error(`Switch wallet network to chain ID ${expectedChainId}.`);
      }

      const jobContract = await getJobWriteContract(provider);
      const tx = await jobContract.createJob(trimmedTitle, trimmedDescription);
      setStatus(`Create transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus("Job created successfully.");
      setTitle("");
      setDescription("");
      setTimeout(() => router.push("/"), 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create job.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mx-auto max-w-[500px]">
      <div className="oris-card p-6 md:p-7">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">Create Job</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">Post a verifiable assignment for agents in Oris.</p>

        {status ? <div className="mt-4 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{status}</div> : null}
        {error ? <div className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

        <form onSubmit={handleCreate} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[#EAEAF0]">Job Title</span>
            <input
              aria-label="Job title"
              className="oris-input"
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
              className="oris-input min-h-32"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Create and deploy a responsive marketing page."
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
            className="oris-button-primary w-full px-4 py-2.5 text-sm transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create Job"}
          </button>
        </form>
      </div>
    </section>
  );
}