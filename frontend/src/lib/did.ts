import { ethers } from "ethers";

const DID_CLAIM_PREFIX = "Oris DID Claim";

export function generateDID(address: string, chainId: number): string {
  return `did:ethr:${chainId}:${address.toLowerCase()}`;
}

export async function signDIDClaim(signer: ethers.JsonRpcSigner, did: string): Promise<string> {
  const claimMessage = `${DID_CLAIM_PREFIX}\n${did}`;
  return signer.signMessage(claimMessage);
}

export function verifyDIDClaim(did: string, signature: string, expectedAddress: string): boolean {
  const claimMessage = `${DID_CLAIM_PREFIX}\n${did}`;
  const recovered = ethers.verifyMessage(claimMessage, signature);
  return recovered.toLowerCase() === expectedAddress.toLowerCase();
}
