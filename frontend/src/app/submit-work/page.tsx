"use client";

import { ethers } from "ethers";
import { useEffect, useMemo, useState } from "react";
import { expectedChainId, getJobWriteContract, hashDeliverable } from "@/lib/contracts";
import { useWallet } from "@/lib/wallet-context";

type EstimateState = "idle" | "loading" | "ready" | "error";

export default function SubmitWorkPage() {
  const { browserProvider, connect } = useWallet();
  const [jobId, setJobId] = useState("");
  const [deliverableLink, setDeliverableLink] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [estimateState, setEstimateState] = useState<EstimateState>("idle");
  const [estimateMessage, setEstimateMessage] = useState("Enter a job ID and deliverable to estimate gas.");
  const [estimatedUnits, setEstimatedUnits] = useState("");
  const [estimatedCost, setEstimatedCost] = useState("");

  const computedHash = useMemo(() => {
    if (!deliverableLink.trim()) {
      return "";
    }
    return hashDeliverable(deliverableLink);
  }, [deliverableLink]);

  const trimmedDeliverable = deliverableLink.trim();
  const parsedJobId = Number(jobId);
  const costSymbol = expectedChainId === 5042002 ? "USDC" : "ETH";

  useEffect(() => {
    let active = true;

    if (!Number.isInteger(parsedJobId) || parsedJobId < 0 || !trimmedDeliverable) {
      setEstimateState("idle");
      setEstimateMessage("Enter a job ID and deliverable to estimate gas.");
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
          const gas = (await jobContract.submitDeliverable.estimateGas(parsedJobId, computedHash)) as bigint;
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
  }, [browserProvider, computedHash, parsedJobId, trimmedDeliverable]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("");
    setError("");

    if (!Number.isInteger(parsedJobId) || parsedJobId < 0) {
      setError("Enter a valid numeric job ID.");
      return;
    }
    if (!trimmedDeliverable) {
      setError("Deliverable link or CID is required.");
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

      const deliverableHash = hashDeliverable(trimmedDeliverable);
      const jobContract = await getJobWriteContract(provider);
      const tx = await jobContract.submitDeliverable(parsedJobId, deliverableHash);
      setStatus(`Submit transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Deliverable submitted for job ${parsedJobId}.`);
      setJobId("");
      setDeliverableLink("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit deliverable.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mx-auto max-w-[500px]">
      <div className="archon-card p-6 md:p-7">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">Submit Work</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">Attach your completion link. Archon stores a proof hash on-chain.</p>

        {status ? <div className="mt-4 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{status}</div> : null}
        {error ? <div className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[#EAEAF0]">Job ID</span>
            <input
              aria-label="Job ID"
              type="number"
              min={0}
              className="archon-input"
              value={jobId}
              onChange={(event) => setJobId(event.target.value)}
              placeholder="0"
              required
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[#EAEAF0]">Deliverable Link</span>
            <input
              aria-label="Deliverable link"
              className="archon-input"
              value={deliverableLink}
              onChange={(event) => setDeliverableLink(event.target.value)}
              placeholder="ipfs://bafy... or https://..."
              required
            />
          </label>

          <div className="arc-glass px-3 py-2 text-xs text-[#C9D0DB]">
            <div className="mb-1 font-medium text-[#EAEAF0]">Computed proof hash</div>
            <code className="break-all arc-mono">{computedHash || "Enter a link to compute hash"}</code>
          </div>

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
            disabled={submitting}
            className="archon-button-primary w-full px-4 py-2.5 text-sm transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Submitting..." : "Submit Deliverable"}
          </button>
        </form>
      </div>
    </section>
  );
}
