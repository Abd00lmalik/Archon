"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  expectedChainId,
  fetchSourceOperatorStatuses,
  SourceOperatorStatus,
  txApplyToOperate
} from "@/lib/contracts";
import { IconCommunity, IconTask } from "@/lib/icons";
import { useWallet } from "@/lib/wallet-context";

type RoleKey = "community";

const ROLE_TYPES: RoleKey[] = ["community"];

const EMPTY_STATUS: Record<RoleKey, SourceOperatorStatus> = {
  community: { sourceType: "community", approved: false, pending: false, appliedAt: 0, profileURI: "" }
};

function statusBadge(status: SourceOperatorStatus) {
  if (status.approved) {
    return <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-200">Approved</span>;
  }
  if (status.pending) {
    return <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-200">Under Review</span>;
  }
  return null;
}

export default function ApplyPage() {
  const { account, browserProvider, connect } = useWallet();
  const [statuses, setStatuses] = useState<Record<RoleKey, SourceOperatorStatus>>(EMPTY_STATUS);
  const [loadingStatuses, setLoadingStatuses] = useState(false);
  const [selectedRole, setSelectedRole] = useState<RoleKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const formRef = useRef<HTMLDivElement | null>(null);

  const [moderatorForm, setModeratorForm] = useState({
    name: "",
    github: "",
    technicalBackground: "",
    notableContribution: "",
    weeklyCapacity: "5-10",
    expertise: [] as string[]
  });

  const pendingCount = useMemo(
    () => ROLE_TYPES.reduce((count, role) => count + (statuses[role].pending ? 1 : 0), 0),
    [statuses]
  );

  const withProvider = async () => {
    const provider = browserProvider ?? (await connect());
    if (!provider) throw new Error("Wallet connection was not established.");
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== expectedChainId) {
      throw new Error(`Switch wallet network to chain ID ${expectedChainId}.`);
    }
    return provider;
  };

  const refreshStatuses = async () => {
    if (!account) {
      setStatuses(EMPTY_STATUS);
      return;
    }

    setLoadingStatuses(true);
    try {
      const result = await fetchSourceOperatorStatuses(account, ROLE_TYPES);
      setStatuses({
        community: result.community ?? EMPTY_STATUS.community
      });
    } catch {
      setStatuses(EMPTY_STATUS);
    } finally {
      setLoadingStatuses(false);
    }
  };

  useEffect(() => {
    void refreshStatuses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  const submitRole = async (payload: Record<string, unknown>) => {
    setSubmitting(true);
    setStatus("");
    setError("");

    try {
      const provider = await withProvider();
      const tx = await txApplyToOperate(provider, "community", JSON.stringify(payload));
      setStatus(`Application submitted: ${tx.hash}`);
      await tx.wait();
      setStatus("Application submitted successfully. The platform team will review within 48 hours.");
      setSelectedRole(null);
      await refreshStatuses();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to submit application.");
    } finally {
      setSubmitting(false);
    }
  };

  const openForm = () => {
    if (statuses.community.approved || statuses.community.pending) return;
    setSelectedRole("community");
    setError("");
    setStatus("");
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };

  return (
    <section className="space-y-6">
      <div className="archon-card p-6">
        <h1 className="text-2xl font-semibold text-[#EAEAF0]">Join Archon</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">
          Complete tasks immediately with no approval. Apply only if you want to become a Community Moderator.
        </p>
        {account ? (
          <p className="mt-2 text-xs text-[#9CA3AF]">
            {pendingCount > 0 ? `${pendingCount} role application(s) under review.` : "No pending role applications."}
          </p>
        ) : (
          <p className="mt-2 text-xs text-amber-200">Connect your wallet to apply for roles.</p>
        )}
      </div>

      {status ? (
        <div className="archon-card border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {status}
        </div>
      ) : null}
      {error ? (
        <div className="archon-card border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      ) : null}

      <div className="space-y-4">
        <article className="archon-card border-[#00FFC8]/25 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-[220px] flex-1">
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-[#00FFC8]/15 px-2 py-1 text-xs text-[#00FFC8]">
                <IconTask className="h-3.5 w-3.5" />
                Open to everyone
              </div>
              <h2 className="text-lg font-semibold text-[#EAEAF0]">Complete Tasks</h2>
              <p className="mt-2 text-sm text-[#9CA3AF]">
                Browse open tasks, submit your work, get paid in USDC, and earn on-chain credentials. No approval needed.
              </p>
              <p className="mt-2 text-xs text-[#9CA3AF]">No application required.</p>
            </div>
            <Link href="/" className="archon-button-primary shrink-0 px-3 py-2 text-sm">
              Browse Tasks
            </Link>
          </div>
        </article>

        <article className="archon-card p-5">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-[#22C55E]/15 px-2 py-1 text-xs text-[#22C55E]">
            <IconCommunity className="h-3.5 w-3.5" />
            Requires approval
          </div>
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-lg font-semibold text-[#EAEAF0]">Community Moderator</h3>
            {statusBadge(statuses.community)}
          </div>
          <p className="mt-2 text-sm text-[#9CA3AF]">
            Review and approve technical credential applications. You are the quality gate for community credentials.
          </p>
          {statuses.community.approved ? (
            <Link href="/community" className="archon-button-primary mt-4 inline-flex px-3 py-2 text-sm">
              Open Community Panel
            </Link>
          ) : statuses.community.pending ? (
            <p className="mt-4 text-xs text-amber-200">Your application is pending review. Response time is within 48 hours.</p>
          ) : (
            <button type="button" onClick={openForm} className="archon-button-primary mt-4 px-3 py-2 text-sm">
              Apply as Moderator
            </button>
          )}
        </article>
      </div>

      <div ref={formRef}>
        {selectedRole === "community" ? (
          <div className="archon-card space-y-4 p-6">
            <h2 className="text-xl font-semibold text-[#EAEAF0]">Apply as Community Moderator</h2>
            <p className="text-sm text-[#9CA3AF]">Moderators review technical credential applications and verify technical work quality.</p>
            <label className="block text-sm text-[#9CA3AF]">
              Your name
              <input className="archon-input mt-1" value={moderatorForm.name} onChange={(e) => setModeratorForm((p) => ({ ...p, name: e.target.value }))} />
            </label>
            <label className="block text-sm text-[#9CA3AF]">
              Your GitHub profile URL
              <input className="archon-input mt-1" type="url" value={moderatorForm.github} onChange={(e) => setModeratorForm((p) => ({ ...p, github: e.target.value }))} />
              <span className="mt-1 block text-xs">Required - this must start with https://github.com/</span>
            </label>
            <label className="block text-sm text-[#9CA3AF]">
              Your technical background
              <textarea className="archon-input mt-1 min-h-28" value={moderatorForm.technicalBackground} onChange={(e) => setModeratorForm((p) => ({ ...p, technicalBackground: e.target.value }))} />
              <span className="mt-1 block text-xs">Minimum 150 characters.</span>
            </label>
            <label className="block text-sm text-[#9CA3AF]">
              Link to a notable contribution
              <input className="archon-input mt-1" type="url" value={moderatorForm.notableContribution} onChange={(e) => setModeratorForm((p) => ({ ...p, notableContribution: e.target.value }))} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-[#9CA3AF]">
                How many applications can you review per week?
                <select className="archon-input mt-1" value={moderatorForm.weeklyCapacity} onChange={(e) => setModeratorForm((p) => ({ ...p, weeklyCapacity: e.target.value }))}>
                  <option>5-10</option>
                  <option>10-25</option>
                  <option>25-50</option>
                  <option>50+</option>
                </select>
              </label>
              <label className="block text-sm text-[#9CA3AF]">
                Which technical areas can you best evaluate?
                <select
                  className="archon-input mt-1 min-h-[130px]"
                  multiple
                  value={moderatorForm.expertise}
                  onChange={(e) => {
                    const values = Array.from(e.target.selectedOptions).map((option) => option.value);
                    setModeratorForm((p) => ({ ...p, expertise: values }));
                  }}
                >
                  <option>Smart contract development</option>
                  <option>Frontend/dApp development</option>
                  <option>Security and auditing</option>
                  <option>Protocol integrations</option>
                  <option>Open source contributions</option>
                  <option>Technical documentation</option>
                </select>
              </label>
            </div>
            <button
              type="button"
              disabled={submitting || loadingStatuses}
              onClick={() => {
                if (!account) return setError("Connect your wallet before submitting.");
                if (!moderatorForm.github.trim().startsWith("https://github.com/")) return setError("GitHub URL must start with https://github.com/");
                if (moderatorForm.technicalBackground.trim().length < 150) return setError("Technical background must be at least 150 characters.");
                if (moderatorForm.expertise.length === 0) return setError("Select at least one technical area.");
                void submitRole({ role: "community_moderator", ...moderatorForm });
              }}
              className="archon-button-primary px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Submit Moderator Application"}
            </button>
          </div>
        ) : null}
      </div>

      {loadingStatuses ? <p className="text-xs text-[#9CA3AF]">Checking application status...</p> : null}
    </section>
  );
}
