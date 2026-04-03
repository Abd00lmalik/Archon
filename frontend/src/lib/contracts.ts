import { ethers } from "ethers";
import deploymentRaw from "@/lib/generated/contracts.json";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const JOB_STATUS_LABELS = ["Open", "Accepted", "Submitted", "Approved"] as const;

type DeploymentContract = {
  address: string;
  abi: unknown[];
};

type DeploymentConfig = {
  network: string;
  chainId: number;
  rpcUrl: string;
  contracts: {
    validationRegistry: DeploymentContract;
    credentialHook: DeploymentContract;
    job: DeploymentContract;
  };
};

export type JobRecord = {
  jobId: number;
  client: string;
  agent: string;
  title: string;
  description: string;
  deliverableHash: string;
  status: number;
};

export type CredentialRecord = {
  credentialId: number;
  agent: string;
  jobId: number;
  issuedAt: number;
  issuedBy: string;
};

type RawJobRecord = {
  jobId: unknown;
  client: unknown;
  agent: unknown;
  title: unknown;
  description: unknown;
  deliverableHash: unknown;
  status: unknown;
};

const deployment = deploymentRaw as DeploymentConfig;
const overrideRpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
const overrideChainId = process.env.NEXT_PUBLIC_CHAIN_ID;

export const expectedChainId = overrideChainId ? Number(overrideChainId) : deployment.chainId;
export const rpcUrl = overrideRpcUrl ?? deployment.rpcUrl;
export const deploymentNetworkName = deployment.network;
export const contractAddresses = {
  validationRegistry: deployment.contracts.validationRegistry.address,
  credentialHook: deployment.contracts.credentialHook.address,
  job: deployment.contracts.job.address
} as const;

let readProvider: ethers.JsonRpcProvider | null = null;

export function getDeploymentConfig() {
  return deployment;
}

export function isContractsConfigured(): boolean {
  return (
    deployment.contracts.job.address !== ZERO_ADDRESS &&
    deployment.contracts.validationRegistry.address !== ZERO_ADDRESS &&
    deployment.contracts.credentialHook.address !== ZERO_ADDRESS
  );
}

function ensureContractsConfigured() {
  if (!isContractsConfigured()) {
    throw new Error("Contracts are not deployed yet. Start with `npm run dev` in the project root.");
  }
}

export function shortAddress(address: string) {
  if (!address || address.length < 10) {
    return address;
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function statusLabel(status: number) {
  return JOB_STATUS_LABELS[status] ?? "Unknown";
}

export function hashDeliverable(input: string) {
  return ethers.keccak256(ethers.toUtf8Bytes(input.trim()));
}

function toNumber(input: unknown) {
  if (typeof input === "bigint") {
    return Number(input);
  }
  if (typeof input === "number") {
    return input;
  }
  const parsed = Number(input);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toString(input: unknown) {
  if (typeof input === "string") {
    return input;
  }
  return input == null ? "" : String(input);
}

export function parseJob(rawJob: unknown): JobRecord {
  const candidate = rawJob as Partial<RawJobRecord>;
  return {
    jobId: toNumber(candidate.jobId),
    client: toString(candidate.client),
    agent: toString(candidate.agent),
    title: toString(candidate.title),
    description: toString(candidate.description),
    deliverableHash: toString(candidate.deliverableHash),
    status: toNumber(candidate.status)
  };
}

export function parseCredential(agent: string, rawJobId: unknown): CredentialRecord {
  const jobId = toNumber(rawJobId);
  return {
    credentialId: jobId,
    agent,
    jobId,
    issuedAt: 0,
    issuedBy: contractAddresses.credentialHook
  };
}

export function getReadProvider() {
  if (!readProvider) {
    readProvider = new ethers.JsonRpcProvider(rpcUrl);
  }
  return readProvider;
}

export function getJobReadContract() {
  ensureContractsConfigured();
  return new ethers.Contract(
    deployment.contracts.job.address,
    deployment.contracts.job.abi as ethers.InterfaceAbi,
    getReadProvider()
  );
}

export function getValidationRegistryReadContract() {
  ensureContractsConfigured();
  return new ethers.Contract(
    deployment.contracts.validationRegistry.address,
    deployment.contracts.validationRegistry.abi as ethers.InterfaceAbi,
    getReadProvider()
  );
}

export function getValidationRegistryVerificationContract(provider?: ethers.Provider) {
  ensureContractsConfigured();
  return new ethers.Contract(
    deployment.contracts.validationRegistry.address,
    [
      "function hasCredential(address agent, uint256 jobId) view returns (bool)",
      "function getCredentials(address agent) view returns (uint256[])"
    ],
    provider ?? getReadProvider()
  );
}

export async function getJobWriteContract(browserProvider: ethers.BrowserProvider) {
  ensureContractsConfigured();
  const signer = await browserProvider.getSigner();
  return new ethers.Contract(
    deployment.contracts.job.address,
    deployment.contracts.job.abi as ethers.InterfaceAbi,
    signer
  );
}

export async function verifyCredentialOnChain(agent: string, jobId: number, provider?: ethers.Provider) {
  const registry = getValidationRegistryVerificationContract(provider);
  try {
    return (await registry.hasCredential(agent, jobId)) as boolean;
  } catch {
    const jobIds = (await registry.getCredentials(agent)) as bigint[];
    return jobIds.some((value) => Number(value) === jobId);
  }
}
