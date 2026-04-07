import fs from "node:fs";
import path from "node:path";
import { ethers } from "hardhat";

type LoadedContracts = {
  contracts: Record<string, { address: string }>;
};

export function loadContracts(): LoadedContracts {
  const generatedPath = path.resolve(__dirname, "../../../frontend/src/lib/generated/contracts.json");
  const deploymentsPath = path.resolve(__dirname, "../../deployments/arc_testnet.json");
  const legacyDeploymentsPath = path.resolve(__dirname, "../../deployments/arcTestnet.json");

  const targetPath = fs.existsSync(generatedPath)
    ? generatedPath
    : fs.existsSync(deploymentsPath)
      ? deploymentsPath
      : legacyDeploymentsPath;
  if (!fs.existsSync(targetPath)) {
    throw new Error("contracts.json not found. Run deployment first.");
  }

  const raw = fs.readFileSync(targetPath, "utf8");
  return JSON.parse(raw) as LoadedContracts;
}

export async function getAdmin() {
  const [admin] = await ethers.getSigners();
  return admin;
}
