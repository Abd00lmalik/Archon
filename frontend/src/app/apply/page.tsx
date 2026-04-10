"use client";

import Link from "next/link";
import { ethers } from "ethers";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  expectedChainId,
  fetchSourceOperatorStatuses,
  SourceOperatorStatus,
  txApplyToOperate
} from "@/lib/contracts";
import {
  IconCommunity,
  IconGovernance,
  IconRobot,
  IconStar,
  IconTask
} from "@/lib/icons";
import { useWallet } from "@/lib/wallet-context";

type RoleKey = "task" | "community" | "agent_task" | "dao_governance";

const ROLE_TYPES: RoleKey[] = ["task", "community", "agent_task", "dao_governance"];

const EMPTY_STATUS: Record<RoleKey, SourceOperatorStatus> = {
  task: { sourceType: "task", approved: false, pending: false, appliedAt: 0, profileURI: "" },
  community: { sourceType: "community", approved: false, pending: false, appliedAt: 0, profileURI: "" },
  agent_task: { sourceType: "agent_task", approved: false, pending: false, appliedAt: 0, profileURI: "" },
  dao_governance: {
    sourceType: "dao_governance",
    approved: false,
    pending: false,
    appliedAt: 0,
    profileURI: ""
  }
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

  const [taskForm, setTaskForm] = useState({
    name: "",
    website: "",
    taskTypes: "",
    reason: "",
    monthlyVolume: "1-5 tasks",
    rewardRange: "5-50 USDC"
  });

  const [moderatorForm, setModeratorForm] = useState({
    name: "",
    github: "",
    technicalBackground: "",
    notableContribution: "",
    weeklyCapacity: "5-10",
    expertise: [] as string[]
  });

  const [agentForm, setAgentForm] = useState({
    name: "",
    portfolio: "",
    taskSpecs: "",
    automationSetup: "",
    validationApproach: "",
    monthlyVolume: "1-5 tasks"
  });

  const [daoForm, setDaoForm] = useState({
    name: "",
    daoName: "",
    governorAddress: "",
    network: "Arc Testnet",
    website: "",
    reason: "",
    proposalLink: ""
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
        task: result.task ?? EMPTY_STATUS.task,
        community: result.community ?? EMPTY_STATUS.community,
        agent_task: result.agent_task ?? EMPTY_STATUS.agent_task,
        dao_governance: result.dao_governance ?? EMPTY_STATUS.dao_governance
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

  const submitRole = async (sourceType: RoleKey, payload: Record<string, unknown>) => {
    setSubmitting(true);
    setStatus("");
    setError("");

    try {
      const provider = await withProvider();
      const tx = await txApplyToOperate(provider, sourceType, JSON.stringify(payload));
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

  const openForm = (role: RoleKey) => {
    if (statuses[role].approved || statuses[role].pending) return;
    setSelectedRole(role);
    setError("");
    setStatus("");
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };

  return (
    <section className="space-y-6">
      <div className="archon-card p-6">
        <h1 className="text-2xl font-semibold text-[#EAEAF0]">Apply for a Role</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">
          Apply to become a Task Creator, Community Moderator, Agent Task Operator, or DAO Governance Admin on Archon.
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
                Browse open tasks, submit your work, get paid in USDC, and earn on-chain credentials. No approval needed
                - start immediately.
              </p>
              <p className="mt-2 text-xs text-[#9CA3AF]">No application required.</p>
            </div>
            <Link href="/" className="archon-button-primary shrink-0 px-3 py-2 text-sm">
              Browse Tasks
            </Link>
          </div>
        </article>

        <div className="grid gap-4 md:grid-cols-2">
          <article className="archon-card p-5">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-[#2DE2FF]/15 px-2 py-1 text-xs text-[#2DE2FF]">
              <IconStar className="h-3.5 w-3.5" />
              Requires approval
            </div>
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-lg font-semibold text-[#EAEAF0]">Task Creator</h3>
              {statusBadge(statuses.task)}
            </div>
            <p className="mt-2 text-sm text-[#9CA3AF]">
              Post tasks with USDC reward pools. Contributors complete your tasks and earn credentials. Requires platform
              approval to prevent spam.
            </p>
            {statuses.task.approved ? (
              <Link href="/create-job" className="archon-button-primary mt-4 inline-flex px-3 py-2 text-sm">
                Go to Create Task
              </Link>
            ) : statuses.task.pending ? (
              <p className="mt-4 text-xs text-amber-200">Your application is pending review. Response time is within 48 hours.</p>
            ) : (
              <button type="button" onClick={() => openForm("task")} className="archon-button-primary mt-4 px-3 py-2 text-sm">
                Apply as Task Creator
              </button>
            )}
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
              <button type="button" onClick={() => openForm("community")} className="archon-button-primary mt-4 px-3 py-2 text-sm">
                Apply as Moderator
              </button>
            )}
          </article>

          <article className="archon-card p-5">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-[#8B5CF6]/15 px-2 py-1 text-xs text-[#8B5CF6]">
              <IconRobot className="h-3.5 w-3.5" />
              Requires approval
            </div>
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-lg font-semibold text-[#EAEAF0]">Agent Task Operator</h3>
              {statusBadge(statuses.agent_task)}
            </div>
            <p className="mt-2 text-sm text-[#9CA3AF]">
              Post structured tasks for autonomous AI agents and developers. You define specs and validate completions.
            </p>
            {statuses.agent_task.approved ? (
              <Link href="/tasks" className="archon-button-primary mt-4 inline-flex px-3 py-2 text-sm">
                Open Agentic Tasks
              </Link>
            ) : statuses.agent_task.pending ? (
              <p className="mt-4 text-xs text-amber-200">Your application is pending review. Response time is within 48 hours.</p>
            ) : (
              <button type="button" onClick={() => openForm("agent_task")} className="archon-button-primary mt-4 px-3 py-2 text-sm">
                Apply as Agent Operator
              </button>
            )}
          </article>

          <article className="archon-card p-5">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-[#6366F1]/15 px-2 py-1 text-xs text-[#6366F1]">
              <IconGovernance className="h-3.5 w-3.5" />
              Requires approval
            </div>
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-lg font-semibold text-[#EAEAF0]">DAO Governance Admin</h3>
              {statusBadge(statuses.dao_governance)}
            </div>
            <p className="mt-2 text-sm text-[#9CA3AF]">
              Propose governor contracts for approval so voters in that DAO can claim governance credentials.
            </p>
            {statuses.dao_governance.approved ? (
              <Link href="/governance" className="archon-button-primary mt-4 inline-flex px-3 py-2 text-sm">
                Open Governance
              </Link>
            ) : statuses.dao_governance.pending ? (
              <p className="mt-4 text-xs text-amber-200">Your application is pending review. Response time is within 48 hours.</p>
            ) : (
              <button type="button" onClick={() => openForm("dao_governance")} className="archon-button-primary mt-4 px-3 py-2 text-sm">
                Apply as DAO Admin
              </button>
            )}
          </article>
        </div>
      </div>

      <div ref={formRef}>
        {selectedRole === "task" ? (
          <div className="archon-card space-y-4 p-6">
            <h2 className="text-xl font-semibold text-[#EAEAF0]">Apply to Post Tasks</h2>
            <p className="text-sm text-[#9CA3AF]">Tell us about the tasks you plan to create.</p>

            <label className="block text-sm text-[#9CA3AF]">
              Your name or organization
              <input className="archon-input mt-1" value={taskForm.name} onChange={(e) => setTaskForm((p) => ({ ...p, name: e.target.value }))} />
            </label>
            <label className="block text-sm text-[#9CA3AF]">
              Your website, GitHub, or portfolio
              <input className="archon-input mt-1" type="url" value={taskForm.website} onChange={(e) => setTaskForm((p) => ({ ...p, website: e.target.value }))} />
              <span className="mt-1 block text-xs">We verify this to confirm your identity.</span>
            </label>
            <label className="block text-sm text-[#9CA3AF]">
              Task types and examples
              <textarea className="archon-input mt-1 min-h-28" value={taskForm.taskTypes} onChange={(e) => setTaskForm((p) => ({ ...p, taskTypes: e.target.value }))} />
              <span className="mt-1 block text-xs">Minimum 100 characters.</span>
            </label>
            <label className="block text-sm text-[#9CA3AF]">
              Why you should be approved
              <textarea className="archon-input mt-1 min-h-28" value={taskForm.reason} onChange={(e) => setTaskForm((p) => ({ ...p, reason: e.target.value }))} />
              <span className="mt-1 block text-xs">Minimum 150 characters.</span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-[#9CA3AF]">
                Expected monthly task volume
                <select className="archon-input mt-1" value={taskForm.monthlyVolume} onChange={(e) => setTaskForm((p) => ({ ...p, monthlyVolume: e.target.value }))}>
                  <option>1-5 tasks</option>
                  <option>6-20 tasks</option>
                  <option>21-50 tasks</option>
                  <option>50+ tasks</option>
                </select>
              </label>
              <label className="block text-sm text-[#9CA3AF]">
                Typical reward per task
                <select className="archon-input mt-1" value={taskForm.rewardRange} onChange={(e) => setTaskForm((p) => ({ ...p, rewardRange: e.target.value }))}>
                  <option>5-50 USDC</option>
                  <option>50-200 USDC</option>
                  <option>200-500 USDC</option>
                  <option>500+ USDC</option>
                </select>
              </label>
            </div>
            <button
              type="button"
              disabled={submitting || loadingStatuses}
              onClick={() => {
                if (!account) return setError("Connect your wallet before submitting.");
                if (taskForm.taskTypes.trim().length < 100) return setError("Task types and examples must be at least 100 characters.");
                if (taskForm.reason.trim().length < 150) return setError("Why you should be approved must be at least 150 characters.");
                void submitRole("task", { role: "task", ...taskForm });
              }}
              className="archon-button-primary px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Submit Task Creator Application"}
            </button>
          </div>
        ) : null}

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
                void submitRole("community", { role: "community_moderator", ...moderatorForm });
              }}
              className="archon-button-primary px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Submit Moderator Application"}
            </button>
          </div>
        ) : null}

        {selectedRole === "agent_task" ? (
          <div className="archon-card space-y-4 p-6">
            <h2 className="text-xl font-semibold text-[#EAEAF0]">Apply as Agent Task Operator</h2>
            <p className="text-sm text-[#9CA3AF]">Agent tasks are structured for autonomous AI completion. You define specs and validation criteria.</p>
            <label className="block text-sm text-[#9CA3AF]">
              Your name or organization
              <input className="archon-input mt-1" value={agentForm.name} onChange={(e) => setAgentForm((p) => ({ ...p, name: e.target.value }))} />
            </label>
            <label className="block text-sm text-[#9CA3AF]">
              GitHub or technical portfolio
              <input className="archon-input mt-1" type="url" value={agentForm.portfolio} onChange={(e) => setAgentForm((p) => ({ ...p, portfolio: e.target.value }))} />
            </label>
            <label className="block text-sm text-[#9CA3AF]">
              Task types and specifications
              <textarea className="archon-input mt-1 min-h-28" value={agentForm.taskSpecs} onChange={(e) => setAgentForm((p) => ({ ...p, taskSpecs: e.target.value }))} />
              <span className="mt-1 block text-xs">Minimum 100 characters.</span>
            </label>
            <label className="block text-sm text-[#9CA3AF]">
              Your agent or automation setup
              <textarea className="archon-input mt-1 min-h-24" value={agentForm.automationSetup} onChange={(e) => setAgentForm((p) => ({ ...p, automationSetup: e.target.value }))} />
              <span className="mt-1 block text-xs">Minimum 50 characters.</span>
            </label>
            <label className="block text-sm text-[#9CA3AF]">
              Validation approach
              <textarea className="archon-input mt-1 min-h-24" value={agentForm.validationApproach} onChange={(e) => setAgentForm((p) => ({ ...p, validationApproach: e.target.value }))} />
              <span className="mt-1 block text-xs">Minimum 100 characters.</span>
            </label>
            <label className="block text-sm text-[#9CA3AF]">
              Expected monthly task volume
              <select className="archon-input mt-1" value={agentForm.monthlyVolume} onChange={(e) => setAgentForm((p) => ({ ...p, monthlyVolume: e.target.value }))}>
                <option>1-5 tasks</option>
                <option>6-20 tasks</option>
                <option>21-50 tasks</option>
                <option>50+ tasks</option>
              </select>
            </label>
            <button
              type="button"
              disabled={submitting || loadingStatuses}
              onClick={() => {
                if (!account) return setError("Connect your wallet before submitting.");
                if (agentForm.taskSpecs.trim().length < 100) return setError("Task types and specifications must be at least 100 characters.");
                if (agentForm.automationSetup.trim().length < 50) return setError("Agent setup must be at least 50 characters.");
                if (agentForm.validationApproach.trim().length < 100) return setError("Validation approach must be at least 100 characters.");
                void submitRole("agent_task", { role: "agent_task", ...agentForm });
              }}
              className="archon-button-primary px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Submit Agent Operator Application"}
            </button>
          </div>
        ) : null}

        {selectedRole === "dao_governance" ? (
          <div className="archon-card space-y-4 p-6">
            <h2 className="text-xl font-semibold text-[#EAEAF0]">Apply as DAO Governance Admin</h2>
            <p className="text-sm text-[#9CA3AF]">DAO Governance Admins propose governor contracts for approval.</p>
            <label className="block text-sm text-[#9CA3AF]">
              Your name or organization
              <input className="archon-input mt-1" value={daoForm.name} onChange={(e) => setDaoForm((p) => ({ ...p, name: e.target.value }))} />
            </label>
            <label className="block text-sm text-[#9CA3AF]">
              DAO name
              <input className="archon-input mt-1" value={daoForm.daoName} onChange={(e) => setDaoForm((p) => ({ ...p, daoName: e.target.value }))} />
            </label>
            <label className="block text-sm text-[#9CA3AF]">
              Governor contract address
              <input className="archon-input mt-1" value={daoForm.governorAddress} onChange={(e) => setDaoForm((p) => ({ ...p, governorAddress: e.target.value }))} placeholder="0x..." />
              <span className="mt-1 block text-xs">Must be a valid 0x address.</span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-[#9CA3AF]">
                Network the governor is deployed on
                <select className="archon-input mt-1" value={daoForm.network} onChange={(e) => setDaoForm((p) => ({ ...p, network: e.target.value }))}>
                  <option>Arc Testnet</option>
                  <option>Ethereum Mainnet</option>
                  <option>Polygon</option>
                  <option>Arbitrum</option>
                  <option>Optimism</option>
                  <option>Other</option>
                </select>
              </label>
              <label className="block text-sm text-[#9CA3AF]">
                DAO website or governance forum
                <input className="archon-input mt-1" type="url" value={daoForm.website} onChange={(e) => setDaoForm((p) => ({ ...p, website: e.target.value }))} />
              </label>
            </div>
            <label className="block text-sm text-[#9CA3AF]">
              Why approve this DAO
              <textarea className="archon-input mt-1 min-h-28" value={daoForm.reason} onChange={(e) => setDaoForm((p) => ({ ...p, reason: e.target.value }))} />
              <span className="mt-1 block text-xs">Minimum 100 characters.</span>
            </label>
            <label className="block text-sm text-[#9CA3AF]">
              Link to a recent governance proposal
              <input className="archon-input mt-1" type="url" value={daoForm.proposalLink} onChange={(e) => setDaoForm((p) => ({ ...p, proposalLink: e.target.value }))} />
            </label>
            <button
              type="button"
              disabled={submitting || loadingStatuses}
              onClick={() => {
                if (!account) return setError("Connect your wallet before submitting.");
                if (!ethers.isAddress(daoForm.governorAddress.trim())) return setError("Governor contract address must be a valid 0x address.");
                if (daoForm.reason.trim().length < 100) return setError("Why approve this DAO must be at least 100 characters.");
                void submitRole("dao_governance", { role: "dao_governance", ...daoForm });
              }}
              className="archon-button-primary px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Submit DAO Governance Application"}
            </button>
          </div>
        ) : null}
      </div>

      {loadingStatuses ? <p className="text-xs text-[#9CA3AF]">Checking application status...</p> : null}
    </section>
  );
}
