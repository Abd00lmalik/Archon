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
  chainId: 5042002,
  rpcUrl: "https://rpc.testnet.arc.network",
  platformTreasury: "0x25265b9dBEb6c653b0CA281110Bb0697a9685107",
  platformFeeBps: 100,
  addresses: {
    usdc: "0x3600000000000000000000000000000000000000",
    job: "0xAAf90B31AD72f15FAf9028D496C0bB2127127706",
    sourceRegistry: "0x4A33a848de45d79f6A8082D1d2aE93b3c85a1F91",
    validationRegistry: "0x9197D26c71a438b93BE0C074548b052e4a58b559",
    credentialHook: "0x4cF9319F15494C7dE8851d0f9F324B3ACF2Daa8b",
    communitySource: "0x7b38fBC03FB2865ae5a7E174502b135D590BB742",
    agentTaskSource: "0xE00CC410f9fF38aF726506c54eA451F43Ea6Da1d",
    peerAttestationSource: "0x7212bA676e31060740be23ADCAb0E807A9b9A4c0",
    daoGovernanceSource: "0xBd84a902C2b44717dDA047427F3aD0448b594033",
    milestoneEscrow: "0xf99bca7cB9e8162C49CB8170B64744c7bd7B5110",
    prevJobContracts: ["0x8D8bB12C0e052fC839b4146Eb88aAA8e36Ed075A", "0x6423B07886980CBb49010A0912b6e0e08a7C1C37"]
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
          .filter((address: string | undefined): address is string => Boolean(address))
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
