import { HardhatUserConfig, subtask } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
import * as path from "node:path";
import {
  TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD,
  TASK_COMPILE_SOLIDITY_RUN_SOLCJS
} from "hardhat/builtin-tasks/task-names";
import { CompilerDownloader, CompilerPlatform } from "hardhat/internal/solidity/compiler/downloader";
import { getCompilersDir } from "hardhat/internal/util/global-dir";

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
    compilers: [
      {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          }
        },
        // Use wasm compiler to avoid native solc spawn issues on locked-down Windows hosts.
        preferWasm: true
      }
    ]
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

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(
  async ({ quiet, solcVersion }: { quiet: boolean; solcVersion: string }, { run }) => {
    const compilersCache = await getCompilersDir();
    const wasmDownloader = CompilerDownloader.getConcurrencySafeDownloader(
      CompilerPlatform.WASM,
      compilersCache
    );

    await wasmDownloader.downloadCompiler(
      solcVersion,
      async (isCompilerDownloaded: boolean) => {
        await run("compile:solidity:log:download-compiler-start", {
          solcVersion,
          isCompilerDownloaded,
          quiet
        });
      },
      async (isCompilerDownloaded: boolean) => {
        await run("compile:solidity:log:download-compiler-end", {
          solcVersion,
          isCompilerDownloaded,
          quiet
        });
      }
    );

    const wasmCompiler = await wasmDownloader.getCompiler(solcVersion);
    if (!wasmCompiler) {
      throw new Error(`WASM build of solc ${solcVersion} is not available`);
    }
    return wasmCompiler;
  }
);

subtask(TASK_COMPILE_SOLIDITY_RUN_SOLCJS).setAction(
  async ({ input, solcJsPath }: { input: unknown; solcJsPath: string }) => {
    // Avoid spawning child processes in restricted Windows environments.
    const resolvedPath = path.isAbsolute(solcJsPath) ? solcJsPath : path.resolve(solcJsPath);
    const solcWrapper = require("solc/wrapper") as (solJson: unknown) => { compile: (jsonInput: string) => string };
    const solc = solcWrapper(require(resolvedPath));
    const output = solc.compile(JSON.stringify(input));
    return JSON.parse(output);
  }
);

export default config;
