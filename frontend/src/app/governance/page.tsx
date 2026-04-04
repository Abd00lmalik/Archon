"use client";

import { useState } from "react";
import {
  expectedChainId,
  txClaimGovernanceCredential
} from "@/lib/contracts";
import { useWallet } from "@/lib/wallet-context";

export default function GovernancePage() {
  const { browserProvider, connect } = useWallet();
  const [governorAddress, setGovernorAddress] = useState("");
  const [proposalId, setProposalId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const handleClaim = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setStatus("");
    setSubmitting(true);

    try {
      const provider = browserProvider ?? (await connect());
      if (!provider) throw new Error("Wallet connection was not established.");
      const network = await provider.getNetwork();
      if (Number(network.chainId) !== expectedChainId) {
        throw new Error(`Switch wallet network to chain ID ${expectedChainId}.`);
      }
      const id = Number(proposalId);
      if (!Number.isInteger(id) || id < 0) throw new Error("Invalid proposal ID.");

      const tx = await txClaimGovernanceCredential(provider, governorAddress.trim(), id);
      setStatus(`Verify and claim transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus("Governance credential claimed.");
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "Failed to verify and claim governance credential.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mx-auto max-w-xl space-y-6">
      <div className="archon-card p-6">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">DAO Governance Source</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">
          Trustless verification from on-chain vote history.
        </p>
      </div>

      {status ? <div className="archon-card border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{status}</div> : null}
      {error ? <div className="archon-card border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

      <div className="archon-card p-6">
        <form onSubmit={handleClaim} className="space-y-3">
          <label className="block text-sm text-[#9CA3AF]">
            Governor contract address
            <input
              className="archon-input mt-1"
              value={governorAddress}
              onChange={(event) => setGovernorAddress(event.target.value)}
              required
            />
          </label>
          <label className="block text-sm text-[#9CA3AF]">
            Proposal ID
            <input
              type="number"
              min={0}
              className="archon-input mt-1"
              value={proposalId}
              onChange={(event) => setProposalId(event.target.value)}
              required
            />
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="archon-button-primary w-full px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Verifying..." : "Verify and Claim"}
          </button>
        </form>
      </div>
    </section>
  );
}
