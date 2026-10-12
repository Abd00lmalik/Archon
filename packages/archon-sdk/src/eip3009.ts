import { ethers } from "ethers";

export const TRANSFER_WITH_AUTHORIZATION_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" }
  ]
};

export type Eip3009Domain = {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
};

/**
 * Arc USDC token `name()` is "USDC" (probed on-chain).
 * Domain must match what the Archon contracts verify against.
 */
export function usdcDomain(chainId: number, verifyingContract: string): Eip3009Domain {
  return { name: "USDC", version: "2", chainId, verifyingContract };
}

export type TransferWithAuthorizationMessage = {
  from: string;
  to: string;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: string;
};

export function buildAuthorizationWindow(nowSeconds = Math.floor(Date.now() / 1000)) {
  return { validAfter: BigInt(nowSeconds - 60), validBefore: BigInt(nowSeconds + 3600) };
}

export function newAuthorizationNonce(): string {
  return ethers.hexlify(ethers.randomBytes(32));
}

export async function signTransferWithAuthorization(
  signer: ethers.Wallet,
  domain: Eip3009Domain,
  message: TransferWithAuthorizationMessage
): Promise<{ v: number; r: string; s: string }> {
  const signature = await signer.signTypedData(domain, TRANSFER_WITH_AUTHORIZATION_TYPES, message);
  const { v, r, s } = ethers.Signature.from(signature);
  return { v, r, s };
}

export function recoverAuthorizationSigner(
  domain: Eip3009Domain,
  message: TransferWithAuthorizationMessage,
  signature: { v: number; r: string; s: string }
): string {
  return ethers.verifyTypedData(domain, TRANSFER_WITH_AUTHORIZATION_TYPES, message, signature);
}

/**
 * Live check: compares the on-chain DOMAIN_SEPARATOR() of the USDC token
 * with the hash computed from {name:"USDC", version:"2", chainId, verifyingContract}.
 */
export async function verifyUsdcDomainSeparator(
  provider: ethers.Provider,
  chainId: number,
  usdcAddress: string
): Promise<{ matches: boolean; onChain: string; computed: string }> {
  const usdc = new ethers.Contract(usdcAddress, ["function DOMAIN_SEPARATOR() view returns (bytes32)"], provider);
  const onChain = (await usdc.DOMAIN_SEPARATOR()) as string;
  const computed = ethers.TypedDataEncoder.hashDomain(usdcDomain(chainId, usdcAddress));
  return { matches: onChain.toLowerCase() === computed.toLowerCase(), onChain, computed };
}
