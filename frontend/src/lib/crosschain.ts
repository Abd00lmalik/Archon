import { CredentialRecord } from "@/lib/contracts";

export const SUPPORTED_CHAINS = [
  { chainId: 5042002, name: "Arc Testnet", role: "source" },
  { chainId: 80001, name: "Polygon Mumbai", role: "mirror" },
  { chainId: 11155111, name: "Ethereum Sepolia", role: "anchor" }
] as const;

export function buildPortabilityPayload(credential: CredentialRecord, targetChainId: number): string {
  return JSON.stringify({
    sourceChainId: 5042002,
    targetChainId,
    credential
  });
}

export async function isCredentialMirrored(_credential: CredentialRecord, _targetChainId: number): Promise<boolean> {
  void _credential;
  void _targetChainId;
  return false;
}
