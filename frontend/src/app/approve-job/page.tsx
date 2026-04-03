"use client";

import { ethers } from "ethers";
import { useEffect, useState } from "react";
import { expectedChainId, getJobWriteContract } from "@/lib/contracts";
import { useWallet } from "@/lib/wallet-context";

type EstimateState = "idle" | "loading" | "ready" | "error";

export default function ApproveJobPage() {
  const { browserProvider, connect } = useWallet();
  const [jobId, setJobId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [estimateState, setEstimateState] = useState<EstimateState>("idle");
  const [estimateMessage, setEstimateMessage] = useState("Enter a job ID to estimate gas.");
  const [estimatedUnits, setEstimatedUnits] = useState("");
  const [estimatedCost, setEstimatedCost] = useState("");

  const parsedJobId = Number(jobId);
  const costSymbol = expectedChainId === 5042002 ? "USDC" : "ETH";

  useEffect(() => {
    let active = true;

    if (!Number.isInteger(parsedJobId) || parsedJobId < 0) {
      setEstimateState("idle");
      setEstimateMessage("Enter a job ID to estimate gas.");
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
          const gas = (await jobContract.approveJob.estimateGas(parsedJobId)) as bigint;
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
  }, [browserProvider, parsedJobId]);

  const handleApprove = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setStatus("");

    if (!Number.isInteger(parsedJobId) || parsedJobId < 0) {
      setError("Enter a valid numeric job ID.");
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
      const tx = await jobContract.approveJob(parsedJobId);
      setStatus(`Approval transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Job ${parsedJobId} approved and credential issued.`);
      setJobId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve job.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mx-auto max-w-[500px]">
      <div className="oris-card p-6 md:p-7">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">Approve Job</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">Confirm completion and mint a permanent credential.</p>

        {status ? <div className="mt-4 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{status}</div> : null}
        {error ? <div className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

        <form onSubmit={handleApprove} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[#EAEAF0]">Job ID</span>
            <input
              aria-label="Job ID"
              type="number"
              min={0}
              className="oris-input"
              value={jobId}
              onChange={(event) => setJobId(event.target.value)}
              placeholder="0"
              required
            />
          </label>

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
            className="oris-button-primary w-full px-4 py-2.5 text-sm transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Approving..." : "Approve Job"}
          </button>
        </form>
      </div>
    </section>
  );
}