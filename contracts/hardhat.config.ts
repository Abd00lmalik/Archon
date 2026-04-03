import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const ARC_TESTNET_RPC_URL = process.env.ARC_TESTNET_RPC_URL ?? "https://rpc.testnet.arc.network";
const rawPrivateKey = process.env.DEPLOYER_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
const PRIVATE_KEY = rawPrivateKey
  ? rawPrivateKey.startsWith("0x")
    ? rawPrivateKey
    : `0x${rawPrivateKey}`
  : undefined;
const ARC_CHAIN_ID = process.env.ARC_CHAIN_ID ? Number(process.env.ARC_CHAIN_ID) : 5042002;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545"
    },
    arcTestnet: {
      url: ARC_TESTNET_RPC_URL,
      chainId: ARC_CHAIN_ID,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : []
    }
  }
};

export default config;
