export const xionConfig = {
  rpcUrl: process.env.NEXT_PUBLIC_XION_RPC_URL ?? "https://rpc.xion-testnet-2.burnt.com:443",
  restUrl: process.env.NEXT_PUBLIC_XION_REST_URL ?? "https://api.xion-testnet-2.burnt.com",
  chainId: process.env.NEXT_PUBLIC_XION_CHAIN_ID ?? "xion-testnet-2",
  gasPrice: process.env.NEXT_PUBLIC_XION_GAS_PRICE ?? "0.001uxion",
  authAppUrl: process.env.NEXT_PUBLIC_XION_AUTH_APP_URL ?? "https://auth.testnet.burnt.com",
  treasuryAddress: process.env.NEXT_PUBLIC_XION_TREASURY_ADDRESS ?? "",
  useRealXion: process.env.NEXT_PUBLIC_USE_REAL_XION === "true",
  deployer: process.env.NEXT_PUBLIC_XION_DEPLOYER ?? "",
  contracts: {
    issuerRegistry: process.env.NEXT_PUBLIC_XION_ISSUER_REGISTRY ?? "",
    vaccinationRecord: process.env.NEXT_PUBLIC_XION_VACCINATION_RECORD ?? "",
    milestoneChecker: process.env.NEXT_PUBLIC_XION_MILESTONE_CHECKER ?? "",
    grantEscrow: process.env.NEXT_PUBLIC_XION_GRANT_ESCROW ?? "",
  },
} as const;

export type XionConfig = typeof xionConfig;
