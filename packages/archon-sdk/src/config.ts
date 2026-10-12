import { readFileSync } from "node:fs";

export type ArchonAddresses = {
  usdc: string;
  job: string;
  sourceRegistry: string;
  validationRegistry: string;
  credentialHook: string;
  communitySource: string;
  agentTaskSource: string;
  peerAttestationSource: string;
  daoGovernanceSource: string;
  milestoneEscrow: string;
  prevJobContracts: string[];
  /** Legacy V1 job contract (separate hard-coded address in task-adapter). */
  v1Job: string;
};

export type ArchonNetworkConfig = {
  chainId: number;
  rpcUrl: string;
  platformTreasury: string;
  platformFeeBps: number;
  addresses: ArchonAddresses;
};

export type ArchonConfig = {
  /** Hex private key of the agent wallet. Omit for read-only usage. */
  privateKey?: string;
  rpcUrl?: string;
  chainId?: number;
  /** Full path to contracts.json manifest; overrides default addresses. */
  contractsPath?: string;
};

export const DEFAULT_NETWORK: ArchonNetworkConfig = {
  chainId: 5042,
  rpcUrl: "https://rpc.mainnet.arc.io",
  platformTreasury: "0x25265b9dBEb6c653b0CA281110Bb0697a9685107",
  platformFeeBps: 100,
  addresses: {
    usdc: "0x3600000000000000000000000000000000000000",
    job: "0x482deF6e38d4b22581A844c682174b917D55ecB7",
    sourceRegistry: "0xF5FCbcF220C13CB4A5e8604B3701c83DFd4e8576",
    validationRegistry: "0xb714C337470f96C3812E92987aEC1B6892A7AAcd",
    credentialHook: "0xc7Dcc4b616b192E046c722271CA7950601CAcd21",
    communitySource: "0xBAdeAE2bFE27c70C129237419abB4C6820e38ACc",
    agentTaskSource: "0xa1A6474D3342618422587f1F75343e6b7bBF709b",
    peerAttestationSource: "0x020558b936286Fc27d755541E63E9bab45394320",
    daoGovernanceSource: "0x893b8946e41B97FD3427c27cebFC63d819667835",
    milestoneEscrow: "0xa4ae469AA2A5316678c1e9f114f49D599545dc67",
    prevJobContracts: [],
    v1Job: "0xEEF4C172ea2A8AB184CA5d121D142789F78BFb16"
  }
};

type ManifestContract = { address?: string } | undefined;
type Manifest = {
  chainId?: number;
  rpcUrl?: string;
  platformTreasury?: string;
  platformFeeBps?: number;
  usdcAddress?: string;
  contracts?: Record<string, ManifestContract | ManifestContract[] | undefined>;
};

function manifestAddress(contracts: Manifest["contracts"], key: string): string | undefined {
  const entry = contracts?.[key];
  if (Array.isArray(entry)) return entry[0]?.address;
  return entry?.address;
}

export function resolveNetwork(config: ArchonConfig = {}): ArchonNetworkConfig {
  let network: ArchonNetworkConfig = {
    ...DEFAULT_NETWORK,
    addresses: { ...DEFAULT_NETWORK.addresses, prevJobContracts: [...DEFAULT_NETWORK.addresses.prevJobContracts] }
  };

  const contractsPath = config.contractsPath ?? process.env.ARCHON_CONTRACTS_PATH;
  if (contractsPath) {
    const manifest = JSON.parse(readFileSync(contractsPath, "utf8")) as Manifest;
    const contracts = manifest.contracts ?? {};
    const prev = Array.isArray(contracts.prevJobContracts) ? contracts.prevJobContracts : [];
    network = {
      chainId: manifest.chainId ?? network.chainId,
      rpcUrl: manifest.rpcUrl ?? network.rpcUrl,
      platformTreasury: manifest.platformTreasury ?? network.platformTreasury,
      platformFeeBps: manifest.platformFeeBps ?? network.platformFeeBps,
      addresses: {
        usdc: manifest.usdcAddress ?? network.addresses.usdc,
        job: manifestAddress(contracts, "job") ?? manifestAddress(contracts, "jobContract") ?? network.addresses.job,
        sourceRegistry: manifestAddress(contracts, "sourceRegistry") ?? network.addresses.sourceRegistry,
        validationRegistry: manifestAddress(contracts, "validationRegistry") ?? network.addresses.validationRegistry,
        credentialHook: manifestAddress(contracts, "credentialHook") ?? network.addresses.credentialHook,
        communitySource: manifestAddress(contracts, "communitySource") ?? network.addresses.communitySource,
        agentTaskSource: manifestAddress(contracts, "agentTaskSource") ?? network.addresses.agentTaskSource,
        peerAttestationSource: manifestAddress(contracts, "peerAttestationSource") ?? network.addresses.peerAttestationSource,
        daoGovernanceSource: manifestAddress(contracts, "daoGovernanceSource") ?? network.addresses.daoGovernanceSource,
        milestoneEscrow: manifestAddress(contracts, "milestoneEscrow") ?? network.addresses.milestoneEscrow,
        prevJobContracts: prev
          .map((entry: { address?: string } | undefined) => entry?.address)
          .filter((address: string | undefined): address is string => Boolean(address)),
        v1Job: network.addresses.v1Job
      }
    };
  }

  if (config.rpcUrl ?? process.env.ARCHON_RPC_URL) {
    network.rpcUrl = config.rpcUrl ?? process.env.ARCHON_RPC_URL ?? network.rpcUrl;
  }
  if (config.chainId ?? process.env.ARCHON_CHAIN_ID) {
    network.chainId = Number(config.chainId ?? process.env.ARCHON_CHAIN_ID);
  }

  return network;
}

export function resolvePrivateKey(config: ArchonConfig = {}): string | undefined {
  return config.privateKey ?? process.env.ARCHON_PRIVATE_KEY ?? process.env.AGENT_PRIVATE_KEY;
}
