import { ethers } from "ethers";
import { contractAddresses, CredentialRecord } from "@/lib/contracts";

const CREDENTIAL_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  Credential: [
    { name: "credentialId", type: "uint256" },
    { name: "agent", type: "address" },
    { name: "jobId", type: "uint256" },
    { name: "issuedAt", type: "uint256" },
    { name: "issuedBy", type: "address" }
  ]
};

type TypedDataPayload = {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: "Credential";
  message: {
    credentialId: bigint;
    agent: string;
    jobId: bigint;
    issuedAt: bigint;
    issuedBy: string;
  };
};

export function buildCredentialTypedData(credential: CredentialRecord, chainId: number): TypedDataPayload {
  return {
    domain: {
      name: "Oris",
      version: "1",
      chainId,
      verifyingContract: contractAddresses.validationRegistry
    },
    types: CREDENTIAL_TYPES,
    primaryType: "Credential",
    message: {
      credentialId: BigInt(credential.credentialId),
      agent: credential.agent,
      jobId: BigInt(credential.jobId),
      issuedAt: BigInt(credential.issuedAt),
      issuedBy: credential.issuedBy
    }
  };
}

export function verifyCredentialSignature(
  typedData: TypedDataPayload,
  signature: string,
  expectedSigner: string
): boolean {
  const recovered = ethers.verifyTypedData(typedData.domain, typedData.types, typedData.message, signature);
  return recovered.toLowerCase() === expectedSigner.toLowerCase();
}

export async function signCredential(
  signer: ethers.JsonRpcSigner,
  credential: CredentialRecord,
  chainId: number
): Promise<string> {
  const typedData = buildCredentialTypedData(credential, chainId);
  return signer.signTypedData(typedData.domain, typedData.types, typedData.message);
}
