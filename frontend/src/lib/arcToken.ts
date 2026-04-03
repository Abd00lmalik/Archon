import { ethers } from "ethers";
import { ARC_TOKEN_CONFIG } from "../../config";
import { ZERO_ADDRESS } from "@/lib/contracts";

const ARC_ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

export async function getArcBalance(provider: ethers.Provider, address: string): Promise<string> {
  if (!provider || !address || ARC_TOKEN_CONFIG.tokenAddress === ZERO_ADDRESS) {
    return "0";
  }

  const token = new ethers.Contract(ARC_TOKEN_CONFIG.tokenAddress, ARC_ERC20_ABI, provider);
  const [balance, decimals] = (await Promise.all([
    token.balanceOf(address),
    token.decimals()
  ])) as [bigint, number];

  return ethers.formatUnits(balance, decimals);
}

export async function hasEnoughArcToPost(provider: ethers.Provider, address: string): Promise<boolean> {
  if (!provider || !address || ARC_TOKEN_CONFIG.tokenAddress === ZERO_ADDRESS) {
    return true;
  }

  const balance = await getArcBalance(provider, address);
  const normalized = Number.parseFloat(balance);
  const required = Number.parseFloat(ARC_TOKEN_CONFIG.minBalanceToPost);
  if (Number.isNaN(normalized) || Number.isNaN(required)) {
    return false;
  }
  return normalized >= required;
}
