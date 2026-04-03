"use client";

import { useMemo, useState } from "react";
import { ethers } from "ethers";
import { SUPPORTED_CHAINS } from "@/lib/crosschain";
import { CredentialRecord, getReadProvider, shortAddress, verifyCredentialOnChain } from "@/lib/contracts";

type VerificationState = "idle" | "loading" | "verified" | "missing" | "error";

export function CredentialCard({
  credential,
  provider
}: {
  credential: CredentialRecord;
  provider?: ethers.Provider | null;
}) {
  const [verification, setVerification] = useState<VerificationState>("idle");

  const verificationLabel = useMemo(() => {
    if (verification === "verified") return "Verified";
    if (verification === "missing") return "Not Found";
    if (verification === "error") return "Verification Failed";
    return "";
  }, [verification]);

  const verificationClass = useMemo(() => {
    if (verification === "verified") return "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    if (verification === "missing" || verification === "error") {
      return "border border-rose-500/30 bg-rose-500/10 text-rose-300";
    }
    return "hidden";
  }, [verification]);

  const handleVerify = async () => {
    setVerification("loading");
    try {
      const exists = await verifyCredentialOnChain(credential.agent, credential.jobId, provider ?? getReadProvider());
      setVerification(exists ? "verified" : "missing");
    } catch {
      setVerification("error");
    }
  };

  return (
    <article className="archon-card animate-slide-up p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold tracking-wide text-[#EAEAF0]">Credential #{credential.credentialId}</h3>
          <p className="text-xs text-[#9CA3AF]">Agent: {shortAddress(credential.agent)}</p>
          <p className="text-xs text-[#9CA3AF]">Job ID: {credential.jobId}</p>
        </div>

        <button
          type="button"
          onClick={() => void handleVerify()}
          disabled={verification === "loading"}
          className="archon-button-secondary px-3 py-1.5 text-xs font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {verification === "loading" ? "Verifying..." : "Verify On-Chain"}
        </button>
      </div>

      {verificationLabel ? <div className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${verificationClass}`}>{verificationLabel}</div> : null}

      <div className="mt-4 border-t border-white/5 pt-3">
        <p className="text-xs font-medium tracking-wide text-[#EAEAF0]">Portability</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {SUPPORTED_CHAINS.map((chain) => {
            const isSource = chain.role === "source";
            return (
              <span
                key={chain.chainId}
                title={isSource ? "Credential minted on source chain." : "Cross-chain mirroring via LayerZero coming soon."}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs ${
                  isSource ? "bg-[#00D1B2]/15 text-[#6EF2DE]" : "bg-white/5 text-[#9CA3AF]"
                }`}
              >
                {chain.name} ({chain.role})
              </span>
            );
          })}
        </div>
      </div>
    </article>
  );
}
