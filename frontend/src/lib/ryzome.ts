import { ethers } from "ethers";
import { contractAddresses, ZERO_ADDRESS } from "@/lib/contracts";

export const RYZOME_SERVICE_MANIFEST = {
  name: "Oris",
  description: "Deliverable-gated on-chain credential minter by Oris for the ARC ecosystem",
  version: "1.0.0",
  hookType: "job_completion",
  credentialStandard: "ERC-8004",
  supportedNetworks: [31337, 5042002],
  hookAddress: contractAddresses.credentialHook,
  registryAddress: contractAddresses.validationRegistry,
  arcTokenRequirement: "100"
} as const;

const RYZOME_ABI = [
  "function registerService(string manifestJson) returns (bytes32)"
];

export async function registerWithRyzome(
  signer: ethers.Signer,
  ryzomeRegistryAddress: string
): Promise<string> {
  if (!ryzomeRegistryAddress || ryzomeRegistryAddress === ZERO_ADDRESS) {
    throw new Error("Ryzome registry address not set");
  }

  const contract = new ethers.Contract(ryzomeRegistryAddress, RYZOME_ABI, signer);
  const tx = await contract.registerService(generateManifestJSON());
  const receipt = await tx.wait();
  if (!receipt) {
    throw new Error("Registration transaction did not return a receipt");
  }
  return tx.hash;
}

export function generateManifestJSON(): string {
  return JSON.stringify(RYZOME_SERVICE_MANIFEST, null, 2);
}
