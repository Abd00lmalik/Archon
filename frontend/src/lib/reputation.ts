import { EnrichedCredential } from "@/lib/contracts";

export const SOURCE_WEIGHTS = {
  job: 100,
  github_pr_merged: 150,
  github_issue_resolved: 120,
  github_repo_contribution: 100,
  github_code_review: 80,
  github_documentation: 70,
  agent_task: 130,
  community_event: 120,
  community_content: 90,
  community_moderation: 80,
  community_help: 50,
  community_bug_report: 100,
  peer_attestation: 60,
  dao_governance: 90
} as const;

export function calculateWeightedScore(credentials: EnrichedCredential[]): number {
  const total = credentials.reduce((sum, credential) => sum + (credential.weight ?? 100), 0);
  return Math.min(total, 2000);
}

export function getScoreBreakdown(credentials: EnrichedCredential[]): Record<string, number> {
  const breakdown: Record<string, number> = {};
  for (const credential of credentials) {
    const source = normalizeSourceBucket(credential.sourceType);
    breakdown[source] = (breakdown[source] ?? 0) + (credential.weight ?? 100);
  }
  return breakdown;
}

export function getReputationTier(score: number): string {
  if (score >= 1500) return "Legend";
  if (score >= 1000) return "Elite";
  if (score >= 600) return "Expert";
  if (score >= 300) return "Verified";
  if (score >= 100) return "Contributor";
  return "Newcomer";
}

export function getSourceColor(sourceType: string): string {
  const colors: Record<string, string> = {
    job: "#00FFC8",
    github: "#8B5CF6",
    agent_task: "#3B82F6",
    community: "#F59E0B",
    peer_attestation: "#EC4899",
    dao_governance: "#6366F1"
  };
  return colors[normalizeSourceBucket(sourceType)] ?? "#4A7FA5";
}

export function getSourceLabel(sourceType: string): string {
  const labels: Record<string, string> = {
    job: "Job",
    github: "GitHub",
    agent_task: "Agent Task",
    community: "Community",
    peer_attestation: "Peer Attestation",
    dao_governance: "DAO Governance"
  };
  return labels[normalizeSourceBucket(sourceType)] ?? sourceType;
}

export function getTierProgress(score: number) {
  const tiers = [
    { name: "Newcomer", min: 0, max: 99 },
    { name: "Contributor", min: 100, max: 299 },
    { name: "Verified", min: 300, max: 599 },
    { name: "Expert", min: 600, max: 999 },
    { name: "Elite", min: 1000, max: 1499 },
    { name: "Legend", min: 1500, max: 2000 }
  ] as const;

  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    if (score <= tier.max || i === tiers.length - 1) {
      const nextTier = tiers[Math.min(i + 1, tiers.length - 1)];
      const range = Math.max(1, tier.max - tier.min + 1);
      const progress = Math.min(100, Math.max(0, ((score - tier.min) / range) * 100));
      const remaining = nextTier.name === tier.name ? 0 : Math.max(0, nextTier.min - score);
      return {
        tier: tier.name,
        progress,
        remaining,
        nextTier: nextTier.name
      };
    }
  }

  return {
    tier: "Legend",
    progress: 100,
    remaining: 0,
    nextTier: "Legend"
  };
}

function normalizeSourceBucket(sourceType: string) {
  const normalized = sourceType.toLowerCase().trim();
  if (normalized.startsWith("github")) return "github";
  if (normalized.startsWith("community")) return "community";
  return normalized;
}
