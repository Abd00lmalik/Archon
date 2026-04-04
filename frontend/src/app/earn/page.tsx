"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fetchCredentialsForAgent } from "@/lib/contracts";
import { useWallet } from "@/lib/wallet-context";

const SOURCE_CARDS = [
  {
    key: "job",
    title: "Jobs",
    description: "Escrow + USDC",
    weight: 100,
    href: "/create-job"
  },
  {
    key: "github",
    title: "GitHub Activity",
    description: "Submit PR/issue for review",
    weight: 150,
    href: "/github"
  },
  {
    key: "agent_task",
    title: "Agent Tasks",
    description: "Paid AI tasks",
    weight: 130,
    href: "/tasks"
  },
  {
    key: "community",
    title: "Community",
    description: "Discord/forum contributions",
    weight: 120,
    href: "/community"
  },
  {
    key: "peer_attestation",
    title: "Peer Attestation",
    description: "Get vouched by verified users",
    weight: 60,
    href: "/attest"
  },
  {
    key: "dao_governance",
    title: "DAO Governance",
    description: "Prove your on-chain votes",
    weight: 90,
    href: "/governance"
  }
] as const;

function normalizeSource(sourceType: string) {
  const normalized = sourceType.toLowerCase().trim();
  if (normalized.startsWith("github")) return "github";
  if (normalized.startsWith("community")) return "community";
  return normalized;
}

export default function EarnPage() {
  const { account } = useWallet();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!account) {
        setCounts({});
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
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [account]);

  const subtitle = useMemo(() => {
    if (!account) return "Connect wallet to see your source progress.";
    if (loading) return "Loading your source progress...";
    return "Every source mints into one unified on-chain profile.";
  }, [account, loading]);

  return (
    <section className="space-y-6">
      <div className="archon-card p-6">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">Earn Credentials</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">{subtitle}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {SOURCE_CARDS.map((card) => (
          <article key={card.key} className="archon-card flex h-full flex-col p-5">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg font-semibold text-[#EAEAF0]">{card.title}</h2>
              <span className="rounded-full bg-white/5 px-2 py-1 text-xs text-[#9CA3AF]">
                Weight: {card.weight}
              </span>
            </div>
            <p className="mt-2 text-sm text-[#9CA3AF]">{card.description}</p>
            <p className="mt-4 text-sm text-[#EAEAF0]">
              Earned: <span className="font-semibold">{counts[card.key] ?? 0}</span>
            </p>
            <div className="mt-auto pt-5">
              <Link href={card.href} className="archon-button-primary inline-flex px-3 py-2 text-sm">
                Open
              </Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
