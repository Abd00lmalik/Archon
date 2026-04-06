import fs from "node:fs";
import path from "node:path";
import { artifacts, ethers, network } from "hardhat";

type ContractConfig = {
  address: string;
  abi: unknown[];
};

type DeploymentConfig = {
  network: string;
  chainId: number;
  rpcUrl: string;
  usdcAddress: string;
  platformTreasury: string;
  platformFeeBps: number;
  platform: {
    treasury: string;
    feeBps: number;
  };
  contracts: {
    sourceRegistry: ContractConfig;
    validationRegistry: ContractConfig;
    credentialHook: ContractConfig;
    usdc: ContractConfig;
    job: ContractConfig;
    githubSource: ContractConfig;
    communitySource: ContractConfig;
    agentTaskSource: ContractConfig;
    milestoneEscrow: ContractConfig;
    peerAttestationSource: ContractConfig;
    daoGovernanceSource: ContractConfig;
  };
};

const SOURCE_TYPES = ["task", "job", "github", "community", "agent_task"] as const;

function writeJson(filePath: string, payload: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

async function getAbi(contractName: string): Promise<unknown[]> {
  const artifact = await artifacts.readArtifact(contractName);
  return artifact.abi;
}

function normalizeAddress(value: string | undefined) {
  if (!value) return "";
  return value.trim();
}

async function main() {
  const signers = await ethers.getSigners();
  const [deployer] = signers;
  if (!deployer) {
    throw new Error("No deployer signer available.");
  }
  const chainId = Number((await deployer.provider.getNetwork()).chainId);
  const rpcUrl =
    network.name === "arcTestnet"
      ? process.env.ARC_TESTNET_RPC_URL ?? "https://rpc.testnet.arc.network"
      : "http://127.0.0.1:8545";
  const seedOperator =
    (process.env.SEED_OPERATOR ?? "false").toLowerCase() === "true";

  const platformFeeBps = Number(process.env.PLATFORM_FEE_BPS ?? "1000");
  if (Number.isNaN(platformFeeBps) || platformFeeBps < 0 || platformFeeBps > 2000) {
    throw new Error("PLATFORM_FEE_BPS must be between 0 and 2000");
  }

  const configuredTreasury = normalizeAddress(process.env.PLATFORM_TREASURY);
  const platformTreasury = configuredTreasury || deployer.address;

  const configuredUsdcAddress = normalizeAddress(process.env.ARC_USDC_ADDRESS ?? process.env.USDC_ADDRESS);

  console.log(`Deploying contracts with ${deployer.address} on ${network.name} (chainId=${chainId})`);
  console.log(`Platform treasury: ${platformTreasury}`);
  console.log(`Platform fee (bps): ${platformFeeBps}`);

  let usdcAddress = configuredUsdcAddress;
  if (network.name === "arcTestnet" && !usdcAddress) {
    throw new Error("Missing ARC_USDC_ADDRESS (or USDC_ADDRESS) for arcTestnet deployment.");
  }

  let usdcContractName = "IERC20Minimal";
  if (!usdcAddress) {
    const mockUsdc = await ethers.deployContract("MockUSDC");
    await mockUsdc.waitForDeployment();
    usdcAddress = await mockUsdc.getAddress();
    usdcContractName = "MockUSDC";
    console.log(`MockUSDC: ${usdcAddress}`);

    const seedAmount = ethers.parseUnits("1000000", 6);
    await (await mockUsdc.mint(deployer.address, seedAmount)).wait();
    await (await mockUsdc.mint(signer1.address, seedAmount)).wait();
    await (await mockUsdc.mint(signer2.address, seedAmount)).wait();
    await (await mockUsdc.mint(signer3.address, seedAmount)).wait();
    console.log("Minted test USDC to first four accounts.");
  } else {
    console.log(`Using configured USDC token: ${usdcAddress}`);
  }

  const sourceRegistry = await ethers.deployContract("SourceRegistry");
  await sourceRegistry.waitForDeployment();
  const sourceRegistryAddress = await sourceRegistry.getAddress();
  console.log(`SourceRegistry: ${sourceRegistryAddress}`);

  if (seedOperator) {
    for (const sourceType of SOURCE_TYPES) {
      await (await sourceRegistry.approveOperator(sourceType, deployer.address)).wait();
    }
    console.log("Approved deployer as source operator for task/job/github/community/agent_task.");
  } else {
    console.log("SEED_OPERATOR=false: skipped deployer source-operator approvals.");
  }

  const registry = await ethers.deployContract("ERC8004ValidationRegistry");
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`ERC8004ValidationRegistry: ${registryAddress}`);

  const hook = await ethers.deployContract("CredentialHook", [registryAddress]);
  await hook.waitForDeployment();
  const hookAddress = await hook.getAddress();
  console.log(`CredentialHook: ${hookAddress}`);

  await (await registry.authorizeIssuer(hookAddress, true)).wait();
  console.log("Authorized hook as registry issuer.");

  const job = await ethers.deployContract("ERC8183Job", [
    hookAddress,
    usdcAddress,
    sourceRegistryAddress,
    platformTreasury,
    platformFeeBps
  ]);
  await job.waitForDeployment();
  const jobAddress = await job.getAddress();
  console.log(`ERC8183Job: ${jobAddress}`);

  const githubSource = await ethers.deployContract("GitHubSource", [hookAddress, sourceRegistryAddress]);
  await githubSource.waitForDeployment();
  const githubSourceAddress = await githubSource.getAddress();
  console.log(`GitHubSource: ${githubSourceAddress}`);

  const communitySource = await ethers.deployContract("CommunitySource", [hookAddress, sourceRegistryAddress]);
  await communitySource.waitForDeployment();
  const communitySourceAddress = await communitySource.getAddress();
  console.log(`CommunitySource: ${communitySourceAddress}`);

  const agentTaskSource = await ethers.deployContract("AgentTaskSource", [
    hookAddress,
    usdcAddress,
    sourceRegistryAddress,
    platformTreasury,
    platformFeeBps
  ]);
  await agentTaskSource.waitForDeployment();
  const agentTaskSourceAddress = await agentTaskSource.getAddress();
  console.log(`AgentTaskSource: ${agentTaskSourceAddress}`);

  const milestoneEscrow = await ethers.deployContract("MilestoneEscrow", [
    usdcAddress,
    hookAddress,
    platformFeeBps
  ]);
  await milestoneEscrow.waitForDeployment();
  const milestoneEscrowAddress = await milestoneEscrow.getAddress();
  console.log(`MilestoneEscrow: ${milestoneEscrowAddress}`);

  const arbitratorCandidates = [deployer.address, ...signers.slice(1, 4).map((signer) => signer.address)];
  const uniqueArbitrators = [...new Set(arbitratorCandidates.filter((address) => !!address))];
  for (let i = 0; i < uniqueArbitrators.length && i < 3; i++) {
    try {
      await (await milestoneEscrow.addArbitrator(uniqueArbitrators[i])).wait();
      console.log(`Added arbitrator: ${uniqueArbitrators[i]}`);
    } catch (error) {
      console.warn(`Skipping arbitrator ${uniqueArbitrators[i]}:`, error);
    }
  }

  const peerAttestationSource = await ethers.deployContract("PeerAttestationSource", [
    hookAddress,
    registryAddress
  ]);
  await peerAttestationSource.waitForDeployment();
  const peerAttestationSourceAddress = await peerAttestationSource.getAddress();
  console.log(`PeerAttestationSource: ${peerAttestationSourceAddress}`);

  const daoGovernanceSource = await ethers.deployContract("DAOGovernanceSource", [hookAddress]);
  await daoGovernanceSource.waitForDeployment();
  const daoGovernanceSourceAddress = await daoGovernanceSource.getAddress();
  console.log(`DAOGovernanceSource: ${daoGovernanceSourceAddress}`);

  const sourceContracts = [
    jobAddress,
    githubSourceAddress,
    communitySourceAddress,
    agentTaskSourceAddress,
    peerAttestationSourceAddress,
    daoGovernanceSourceAddress
  ];
  for (const sourceAddress of sourceContracts) {
    await (await hook.registerSourceContract(sourceAddress, true)).wait();
  }
  console.log("Registered all source contracts in CredentialHook.");

  if (seedOperator) {
    await (
      await communitySource.registerModerator(
        deployer.address,
        "Platform Admin",
        "CredentialHook Founder",
        ""
      )
    ).wait();
    console.log("Registered deployer as first community moderator.");
  }

  await (await registry.authorizeIssuer(deployer.address, false)).wait();
  console.log("Revoked owner direct issuance in ValidationRegistry.");

  const deploymentConfig: DeploymentConfig = {
    network: network.name === "arcTestnet" ? "arc-testnet" : network.name,
    chainId,
    rpcUrl,
    usdcAddress,
    platformTreasury,
    platformFeeBps,
    platform: {
      treasury: platformTreasury,
      feeBps: platformFeeBps
    },
    contracts: {
      sourceRegistry: {
        address: sourceRegistryAddress,
        abi: await getAbi("SourceRegistry")
      },
      validationRegistry: {
        address: registryAddress,
        abi: await getAbi("ERC8004ValidationRegistry")
      },
      credentialHook: {
        address: hookAddress,
        abi: await getAbi("CredentialHook")
      },
      usdc: {
        address: usdcAddress,
        abi: usdcContractName === "MockUSDC" ? await getAbi("MockUSDC") : await getAbi("MockUSDC")
      },
      job: {
        address: jobAddress,
        abi: await getAbi("ERC8183Job")
      },
      githubSource: {
        address: githubSourceAddress,
        abi: await getAbi("GitHubSource")
      },
      communitySource: {
        address: communitySourceAddress,
        abi: await getAbi("CommunitySource")
      },
      agentTaskSource: {
        address: agentTaskSourceAddress,
        abi: await getAbi("AgentTaskSource")
      },
      milestoneEscrow: {
        address: milestoneEscrowAddress,
        abi: await getAbi("MilestoneEscrow")
      },
      peerAttestationSource: {
        address: peerAttestationSourceAddress,
        abi: await getAbi("PeerAttestationSource")
      },
      daoGovernanceSource: {
        address: daoGovernanceSourceAddress,
        abi: await getAbi("DAOGovernanceSource")
      }
    }
  };

  const deploymentsFilePath = path.resolve(__dirname, `../deployments/${network.name}.json`);
  writeJson(deploymentsFilePath, deploymentConfig);

  const frontendConfigPath = path.resolve(__dirname, "../../frontend/src/lib/generated/contracts.json");
  writeJson(frontendConfigPath, deploymentConfig);

  console.log("Deployment files written to:");
  console.log(`- ${deploymentsFilePath}`);
  console.log(`- ${frontendConfigPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
