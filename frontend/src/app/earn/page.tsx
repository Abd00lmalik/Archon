"use client";

import Link from "next/link";
import { ReactNode, useEffect, useMemo, useState } from "react";
import {
  fetchCredentialsForAgent
} from "@/lib/contracts";
import {
  IconAttest,
  IconCommunity,
  IconGovernance,
  IconStar,
  IconTask,
  IconWallet
} from "@/lib/icons";
import { calculateWeightedScore, getReputationTier } from "@/lib/reputation";
import { useWallet } from "@/lib/wallet-context";

type SourceCard = {
  key: string;
  name: string;
  what: string;
  weight: string;
  paid: boolean;
  href: string;
  cta: string;
  icon: ReactNode;
  example?: string;
};

type TabKey = "sources" | "how" | "faq";

type Guide = {
  title: string;
  intro?: string;
  steps: string[];
};

const SOURCE_CARDS: SourceCard[] = [
  {
    key: "job",
    icon: <IconTask className="h-5 w-5" />,
    name: "Complete Tasks",
    what: "Browse open tasks, accept one, submit a deliverable link, and get approved by the task creator.",
    weight: "Credential weight: +100 pts + USDC",
    paid: true,
    href: "/",
    cta: "Browse Open Tasks"
  },
  {
    key: "community",
    icon: <IconCommunity className="h-5 w-5" />,
    name: "Community Work",
    what: "Apply for community credentials by showing real contribution evidence reviewed by moderators.",
    weight: "Credential weight: +50 to +120 pts",
    paid: false,
    href: "/community",
    cta: "Apply for Community Credit"
  },
  {
    key: "peer_attestation",
    icon: <IconAttest className="h-5 w-5" />,
    name: "Peer Vouching",
    what: "Keystone tier members can attest for contributors they worked with. Public, permanent, rate-limited.",
    weight: "Credential weight: +60 pts",
    paid: false,
    href: "/attest",
    cta: "Open Peer Vouching"
  },
  {
    key: "dao_governance",
    icon: <IconGovernance className="h-5 w-5" />,
    name: "DAO Governance",
    what: "Trustlessly prove you voted on an approved DAO proposal directly from the governor contract.",
    weight: "Credential weight: +90 pts",
    paid: false,
    href: "/governance",
    cta: "Claim Governance Credit"
  }
];

const COMMUNITY_ACTIVITY_POINTS = [
  { activity: "Helped a community member", points: "50" },
  { activity: "Moderated community spaces", points: "80" },
  { activity: "Created educational content", points: "90" },
  { activity: "Reported a verified bug", points: "100" },
  { activity: "Organized a community event", points: "120" }
];

const TIERS = [
  { tier: "Surveyor", points: "0", unlock: "-" },
  { tier: "Draftsman", points: "100", unlock: "-" },
  { tier: "Architect", points: "300", unlock: "-" },
  { tier: "Master Builder", points: "600", unlock: "-" },
  { tier: "Keystone", points: "1000", unlock: "Peer attestation" },
  { tier: "Arc Founder", points: "1500", unlock: "-" }
];

const METAMASK_CONFIG = [
  { field: "Network Name", value: "Arc Testnet" },
  { field: "RPC URL", value: "https://rpc.testnet.arc.network" },
  { field: "Chain ID", value: "5042002" },
  { field: "Currency Symbol", value: "USDC" },
  { field: "Block Explorer", value: "https://testnet.arcscan.app" }
];

const USER_GUIDES: Guide[] = [
  {
    title: "User who wants to complete tasks and earn credentials",
    steps: [
      "Connect wallet on home (/), review task cards (#jobId, USDC pool, deadline, winner cap), then click View and Apply.",
      "Open /job/[jobId]. If you are not creator, you see Agent View.",
      "Click Accept Task and confirm MetaMask transaction (acceptJob).",
      "Submit Deliverable Link (http/https URL). Good links: GitHub PR, deployed app, Notion/public docs, IPFS gateway.",
      "Status becomes Awaiting review until creator approves.",
      "After approval, page shows allocated reward, net payout, and platform fee deduction.",
      "Click Claim USDC + Credential and confirm claimCredential transaction.",
      "Open /profile to confirm credential card, score update (+100 task weight), and tier progress."
    ]
  },
  {
    title: "Task creator who wants to post a task",
    steps: [
      "Go to /create-job and fill title, description, deadline, reward USDC, and max approvals.",
      "Step 1 of 2: approve USDC allowance for the escrow contract.",
      "Step 2 of 2: post the task transaction after approval confirms.",
      "Task appears on home feed and can be shared via /job/[jobId].",
      "Review submissions as creator: wallet, URL, timestamp, status, suspicion signal.",
      "Set custom reward per submission and approve using approveSubmission(jobId, agent, rewardAmount).",
      "When max approvals are used, task closes for new approvals; remaining refundable balance can be reclaimed after expiry if eligible."
    ]
  },
  {
    title: "AI agent operator who wants to post agentic tasks",
    intro:
      "Agentic tasks are structured for machine-usable input/output and autonomous workflows, not just manual browsing.",
    steps: [
      "Open /tasks and move to Post a Task tab.",
      "Enter title, description, optional input data (for example IPFS CID), reward, and deadline.",
      "Approve USDC first if allowance is insufficient, then post task.",
      "Task appears in Available Tasks tab.",
      "Agents claim task on-chain (claimTask), setting assignedAgent and in-progress status.",
      "Agent submits output hash/link from My Tasks -> In Progress (submitOutput).",
      "Task waits for validator review after validation delay.",
      "After validation, agent claims USDC + credential (+130) from validated state."
    ]
  },
  {
    title: "User who wants a community credential",
    steps: [
      "Open /community and review Moderation Team panel.",
      "Choose category that matches your contribution.",
      "Submit application with 50+ character description, platform, evidence link, and activity type.",
      "Application appears as Pending in Your Applications.",
      "Moderator reviews in moderator panel and approves/rejects with note.",
      "When Approved, claim action becomes available.",
      "Click Claim Credential and confirm transaction.",
      "Credential appears on /profile.",
      "If Rejected, check note and submit a new application with clearer evidence."
    ]
  },
  {
    title: "Client and freelancer using milestone contracts",
    intro: "/milestones is for formal two-party agreements with staged escrow.",
    steps: [
      "Client opens New Contract tab, enters freelancer address, and builds milestones (title, description, amount, deadline, up to 20).",
      "Client creates project and funds milestones separately to control staged risk.",
      "Freelancer opens My Contracts and submits deliverable per funded milestone.",
      "Client has 48-hour dispute window after submission to Approve or Raise Dispute.",
      "Approve releases payout minus platform fee.",
      "If client is inactive for 48 hours, freelancer can auto-release.",
      "If disputed, 3 approved arbitrators are assigned and vote Favor Freelancer or Favor Client.",
      "Majority vote resolves escrow: payout to freelancer or refund to client."
    ]
  },
  {
    title: "User who wants to give or receive peer attestations",
    steps: [
      "Giving attestations requires Keystone tier (1000+ points).",
      "Eligible users open /attest and submit recipient, category, and 50+ char note.",
      "Attestations are permanent and public on-chain.",
      "Contract enforces anti-gaming limits: max 2 given per week, max 1 received per week, mutual-attestation block.",
      "Recipient sees attestation in Received tab and gets +60 credential weight."
    ]
  },
  {
    title: "User who wants DAO governance credential",
    steps: [
      "Open /governance, enter approved governor contract and proposal ID.",
      "Click Verify and Claim.",
      "Contract checks hasVoted(proposalId, wallet) directly on governor contract.",
      "If verified, credential mints instantly. If not, transaction explains reason (not voted, governor not approved, duplicate claim, etc)."
    ]
  }
];

const FAQ_ITEMS = [
  {
    q: "What problem does Archon solve?",
    a: "Archon replaces fake, self-reported work history with verifiable on-chain credentials linked to completed workflows."
  },
  {
    q: "What is a reputation credential in plain English?",
    a: "A permanent record that your wallet completed a specific verified activity from a source at a known time with a known score weight."
  },
  {
    q: "Why can credentials not be faked, transferred, or deleted?",
    a: "Only authorized source contracts can mint through the hook, credentials are wallet-bound records (no transfer function), and issuance is append-only."
  },
  {
    q: "How is score calculated?",
    a: "Score is the sum of credential weights across sources, capped at 2000."
  },
  {
    q: "What are the earning sources?",
    a: "Complete Tasks (+100 + USDC), Community Work (+50 to +120), Peer Vouching (+60), and DAO Governance (+90)."
  },
  {
    q: "How do milestone contracts work?",
    a: "Client proposes milestones, funds escrow per milestone, freelancer submits deliverable, client approves or disputes, and arbitrators resolve disputes by majority."
  },
  {
    q: "What is Arc in this app?",
    a: "Arc is the configured target network (Arc Testnet, chain ID 5042002) where Archon contracts and wallet flows run."
  },
  {
    q: "What USDC decimal model should I know?",
    a: "Network currency UX is 18-decimal style, but ERC-20 transfer math for USDC in this app uses 6 decimals."
  }
];

function normalizeSource(sourceType: string) {
  const normalized = sourceType.toLowerCase().trim();
  if (normalized.startsWith("community")) return "community";
  return normalized;
}

function SourceCardView({ card, earned }: { card: SourceCard; earned: number }) {
  return (
    <article className="archon-card flex h-full flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[#EAEAF0]">{card.icon}</span>
          <h2 className="text-lg font-semibold text-[#EAEAF0]">{card.name}</h2>
        </div>
        <span className="rounded-full bg-white/5 px-2 py-1 text-xs text-[#9CA3AF]">{card.weight}</span>
      </div>

      <p className="mt-3 text-sm text-[#9CA3AF]">{card.what}</p>
      {card.example ? <p className="mt-2 text-xs text-[#9CA3AF]">{card.example}</p> : null}
      <p className="mt-3 inline-flex items-center gap-2 text-xs text-[#9CA3AF]">
        {card.paid ? <IconWallet className="h-4 w-4" /> : <IconStar className="h-4 w-4" />}
        {card.paid ? "Paid in USDC" : "Reputation only"}
      </p>
      <p className="mt-2 text-sm text-[#EAEAF0]">
        You have earned: <strong>{earned}</strong> credentials from this source
      </p>

      <div className="mt-auto pt-5">
        <Link href={card.href} className="archon-button-primary inline-flex px-3 py-2 text-sm">
          {card.cta}
        </Link>
      </div>
    </article>
  );
}

function DataTable({
  headers,
  rows
}: {
  headers: [string, string];
  rows: Array<{ left: string; right: string }>;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-white/5 text-[#EAEAF0]">
          <tr>
            <th className="px-3 py-2">{headers[0]}</th>
            <th className="px-3 py-2">{headers[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.left}-${row.right}`} className="border-t border-white/10 text-[#9CA3AF]">
              <td className="px-3 py-2">{row.left}</td>
              <td className="px-3 py-2">{row.right}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function EarnPage() {
  const { account } = useWallet();
  const [tab, setTab] = useState<TabKey>("sources");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [score, setScore] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!account) {
        setCounts({});
        setScore(0);
        return;
      }

      setLoading(true);
      try {
        const credentials = await fetchCredentialsForAgent(account);
        if (!active) return;
        const nextCounts: Record<string, number> = {};
        for (const credential of credentials) {
          const key = normalizeSource(credential.sourceType);
          nextCounts[key] = (nextCounts[key] ?? 0) + 1;
        }
        setCounts(nextCounts);
        setScore(calculateWeightedScore(credentials));
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [account]);

  const tier = useMemo(() => getReputationTier(score), [score]);
  return (
    <section className="space-y-6">
      <div className="archon-card p-6">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">Ways to Earn Credentials</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">
          Every credential source in Archon follows the same pattern: real work to contract verification to
          credential minting to wallet to reputation score update.
        </p>
        <div className="mt-4 rounded-xl border border-white/10 bg-[#111214] px-4 py-3 text-sm text-[#9CA3AF]">
          {account ? (
            loading ? (
              "Loading your score..."
            ) : (
              <span>
                Your current score: <strong className="text-[#EAEAF0]">{score}</strong> | Tier{" "}
                <span className="text-[#00D1B2]">{tier}</span>
              </span>
            )
          ) : (
            "Connect wallet to see your score"
          )}
        </div>
      </div>

      <div className="archon-card p-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`rounded-full px-4 py-2 text-sm ${
              tab === "sources" ? "bg-[#6C5CE7]/35 text-[#EAEAF0]" : "bg-white/5 text-[#9CA3AF]"
            }`}
            onClick={() => setTab("sources")}
          >
            Four Ways to Earn
          </button>
          <button
            type="button"
            className={`rounded-full px-4 py-2 text-sm ${
              tab === "how" ? "bg-[#6C5CE7]/35 text-[#EAEAF0]" : "bg-white/5 text-[#9CA3AF]"
            }`}
            onClick={() => setTab("how")}
          >
            How It Works
          </button>
          <button
            type="button"
            className={`rounded-full px-4 py-2 text-sm ${
              tab === "faq" ? "bg-[#6C5CE7]/35 text-[#EAEAF0]" : "bg-white/5 text-[#9CA3AF]"
            }`}
            onClick={() => setTab("faq")}
          >
            FAQ
          </button>
        </div>
      </div>

      {tab === "sources" ? (
        <div className="grid gap-4 md:grid-cols-2">
          {SOURCE_CARDS.map((card) => (
            <SourceCardView key={card.key} card={card} earned={counts[card.key] ?? 0} />
          ))}
        </div>
      ) : null}

      {tab === "how" ? (
        <div className="space-y-6">
          <div className="archon-card p-6">
            <h2 className="text-xl font-semibold text-[#EAEAF0]">How It Works</h2>
            <p className="mt-2 text-sm text-[#9CA3AF]">
              Credentials are stored as on-chain records keyed to your wallet address. There is no transfer function.
              There is no delete function. Your reputation trail is append-only and permanent.
            </p>
          </div>

          <div className="archon-card p-6">
            <h3 className="text-lg font-semibold text-[#EAEAF0]">Community Work Activity Points</h3>
            <div className="mt-3">
              <DataTable
                headers={["Activity", "Points"]}
                rows={COMMUNITY_ACTIVITY_POINTS.map((item) => ({ left: item.activity, right: item.points }))}
              />
            </div>
          </div>

          <div className="archon-card p-6">
            <h3 className="text-lg font-semibold text-[#EAEAF0]">Reputation Tiers</h3>
            <div className="mt-3">
              <div className="overflow-hidden rounded-xl border border-white/10">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="bg-white/5 text-[#EAEAF0]">
                    <tr>
                      <th className="px-3 py-2">Tier</th>
                      <th className="px-3 py-2">Points Required</th>
                      <th className="px-3 py-2">Unlocks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {TIERS.map((tierItem) => (
                      <tr key={tierItem.tier} className="border-t border-white/10 text-[#9CA3AF]">
                        <td className="px-3 py-2">{tierItem.tier}</td>
                        <td className="px-3 py-2">{tierItem.points}</td>
                        <td className="px-3 py-2">{tierItem.unlock}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="mt-3 text-sm text-[#9CA3AF]">Score = sum of all credential weights, capped at 2000.</p>
          </div>

          <div className="archon-card p-6">
            <h3 className="text-lg font-semibold text-[#EAEAF0]">Milestone Contracts</h3>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[#9CA3AF]">
              <li>Client proposes a project with up to 20 milestones.</li>
              <li>Each milestone is funded separately to reduce upfront risk.</li>
              <li>Freelancer submits deliverable per milestone.</li>
              <li>Client approves and funds are released (minus platform fee).</li>
              <li>If client is inactive for 48 hours, freelancer can auto-release.</li>
              <li>Disputes go to 3 approved arbitrators and majority vote decides.</li>
            </ul>
          </div>

          <div className="archon-card p-6">
            <h3 className="text-lg font-semibold text-[#EAEAF0]">Getting Started (MetaMask)</h3>
            <div className="mt-3">
              <DataTable
                headers={["Field", "Value"]}
                rows={METAMASK_CONFIG.map((row) => ({ left: row.field, right: row.value }))}
              />
            </div>
            <p className="mt-3 text-sm text-[#9CA3AF]">
              Get testnet USDC from{" "}
              <a className="text-[#8FD9FF] underline underline-offset-4" href="https://faucet.arc.network" target="_blank" rel="noreferrer">
                faucet.arc.network
              </a>
              .
            </p>
          </div>
        </div>
      ) : null}

      {tab === "faq" ? (
        <div className="space-y-6">
          <div className="archon-card p-6">
            <h2 className="text-xl font-semibold text-[#EAEAF0]">FAQ</h2>
            <div className="mt-4 space-y-3">
              {FAQ_ITEMS.map((item) => (
                <details key={item.q} className="rounded-xl border border-white/10 bg-[#111214] p-3">
                  <summary className="cursor-pointer text-sm font-medium text-[#EAEAF0]">{item.q}</summary>
                  <p className="mt-2 text-sm text-[#9CA3AF]">{item.a}</p>
                </details>
              ))}
            </div>
          </div>

          <div className="archon-card p-6">
            <h3 className="text-lg font-semibold text-[#EAEAF0]">Step-by-Step Guides</h3>
            <div className="mt-4 space-y-3">
              {USER_GUIDES.map((guide) => (
                <details key={guide.title} className="rounded-xl border border-white/10 bg-[#111214] p-3">
                  <summary className="cursor-pointer text-sm font-medium text-[#EAEAF0]">{guide.title}</summary>
                  {guide.intro ? <p className="mt-2 text-sm text-[#9CA3AF]">{guide.intro}</p> : null}
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-[#9CA3AF]">
                    {guide.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </details>
              ))}
            </div>
          </div>

          <div className="archon-card p-6">
            <h3 className="text-lg font-semibold text-[#EAEAF0]">Arc Technology Explained</h3>
            <div className="mt-3 space-y-2 text-sm text-[#9CA3AF]">
              <p>
                Arc is the target blockchain network for Archon deployments and frontend network checks.
              </p>
              <p>
                Arc USDC ERC-20 in this app is configured at <span className="arc-mono">0x3600000000000000000000000000000000000000</span>.
              </p>
              <p>
                Wallet/native network currency UX uses 18-decimal style, while ERC-20 USDC transfer math in contracts/frontend uses 6 decimals.
              </p>
              <p>
                ERC-8004 validation registry stores wallet-bound credential records with source type and weight.
              </p>
              <p>
                ERC-8183 job contracts enforce task lifecycle proof from create to accept to submit to approve to claim.
              </p>
              <p>
                Arc testnet values: chain ID 5042002, RPC <span className="arc-mono">https://rpc.testnet.arc.network</span>, explorer{" "}
                <span className="arc-mono">https://testnet.arcscan.app</span>.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}





