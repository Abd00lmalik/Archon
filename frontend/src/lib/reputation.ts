import { CredentialRecord } from "@/lib/contracts";

export function calculateReputationScore(credentials: CredentialRecord[]): number {
  const baseScore = credentials.length * 10;
  return Math.min(baseScore, 1000);
}

export function getReputationTier(score: number): string {
  if (score >= 500) return "Elite";
  if (score >= 300) return "Expert";
  if (score >= 150) return "Verified";
  if (score >= 50) return "Contributor";
  return "Newcomer";
}

export function getTierColor(tier: string): string {
  if (tier === "Contributor") return "text-[#9CA3AF]";
  if (tier === "Verified") return "text-[#00D1B2]";
  if (tier === "Expert") return "text-[#6C5CE7]";
  if (tier === "Elite") return "text-yellow-400";
  return "text-[#9CA3AF]";
}
