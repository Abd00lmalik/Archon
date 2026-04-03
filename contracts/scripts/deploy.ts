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
  contracts: {
    validationRegistry: ContractConfig;
    credentialHook: ContractConfig;
    job: ContractConfig;
  };
};

function writeJson(filePath: string, payload: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

async function getAbi(contractName: string): Promise<unknown[]> {
  const artifact = await artifacts.readArtifact(contractName);
  return artifact.abi;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await deployer.provider.getNetwork()).chainId);
  const rpcUrl = network.name === "arcTestnet"
    ? process.env.ARC_TESTNET_RPC_URL ?? ""
    : "http://127.0.0.1:8545";

  console.log(`Deploying contracts with ${deployer.address} on ${network.name} (chainId=${chainId})`);

  const registry = await ethers.deployContract("MockERC8004ValidationRegistry");
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`MockERC8004ValidationRegistry: ${registryAddress}`);

  const hook = await ethers.deployContract("CredentialHook", [registryAddress]);
  await hook.waitForDeployment();
  const hookAddress = await hook.getAddress();
  console.log(`CredentialHook: ${hookAddress}`);

  const authorizeTx = await registry.authorizeIssuer(hookAddress, true);
  await authorizeTx.wait();
  console.log(`Authorized hook as registry issuer.`);

  const job = await ethers.deployContract("MockERC8183Job", [hookAddress]);
  await job.waitForDeployment();
  const jobAddress = await job.getAddress();
  console.log(`MockERC8183Job: ${jobAddress}`);

  const registerTx = await hook.registerJobContract(jobAddress, true);
  await registerTx.wait();
  console.log(`Registered job contract in hook.`);

  const deploymentConfig: DeploymentConfig = {
    network: network.name,
    chainId,
    rpcUrl,
    contracts: {
      validationRegistry: {
        address: registryAddress,
        abi: await getAbi("MockERC8004ValidationRegistry")
      },
      credentialHook: {
        address: hookAddress,
        abi: await getAbi("CredentialHook")
      },
      job: {
        address: jobAddress,
        abi: await getAbi("MockERC8183Job")
      }
    }
  };

  const deploymentsFilePath = path.resolve(__dirname, `../deployments/${network.name}.json`);
  writeJson(deploymentsFilePath, deploymentConfig);

  const frontendConfigPath = path.resolve(__dirname, "../../frontend/src/lib/generated/contracts.json");
  writeJson(frontendConfigPath, deploymentConfig);

  console.log(`Deployment files written to:`);
  console.log(`- ${deploymentsFilePath}`);
  console.log(`- ${frontendConfigPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
