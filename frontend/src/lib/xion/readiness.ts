import { xionConfig } from "./config";

type RequiredKey = "rpcUrl" | "restUrl" | "chainId";
type OptionalKey =
  | "gasPrice"
  | "authAppUrl"
  | "treasuryAddress"
  | "deployer"
  | "issuerRegistry"
  | "vaccinationRecord"
  | "milestoneChecker"
  | "grantEscrow";

const REQUIRED_FIELDS: RequiredKey[] = ["rpcUrl", "restUrl", "chainId"];
const OPTIONAL_FIELDS: OptionalKey[] = [
  "gasPrice",
  "authAppUrl",
  "treasuryAddress",
  "deployer",
  "issuerRegistry",
  "vaccinationRecord",
  "milestoneChecker",
  "grantEscrow",
];

const requiredEnvMap: Record<RequiredKey, string> = {
  rpcUrl: "NEXT_PUBLIC_XION_RPC_URL",
  restUrl: "NEXT_PUBLIC_XION_REST_URL",
  chainId: "NEXT_PUBLIC_XION_CHAIN_ID",
};

const optionalEnvMap: Record<OptionalKey, string> = {
  gasPrice: "NEXT_PUBLIC_XION_GAS_PRICE",
  authAppUrl: "NEXT_PUBLIC_XION_AUTH_APP_URL",
  treasuryAddress: "NEXT_PUBLIC_XION_TREASURY_ADDRESS",
  deployer: "NEXT_PUBLIC_XION_DEPLOYER",
  issuerRegistry: "NEXT_PUBLIC_XION_ISSUER_REGISTRY",
  vaccinationRecord: "NEXT_PUBLIC_XION_VACCINATION_RECORD",
  milestoneChecker: "NEXT_PUBLIC_XION_MILESTONE_CHECKER",
  grantEscrow: "NEXT_PUBLIC_XION_GRANT_ESCROW",
};

function valueForKey(key: RequiredKey | OptionalKey): string {
  if (key in xionConfig.contracts) {
    return xionConfig.contracts[key as keyof typeof xionConfig.contracts] ?? "";
  }
  return (xionConfig[key as keyof typeof xionConfig] as string) ?? "";
}

export function getXionConfigStatus(): {
  configReady: boolean;
  missingVars: string[];
  optionalMissingVars: string[];
} {
  const missingVars = REQUIRED_FIELDS
    .filter((key) => !valueForKey(key))
    .map((key) => requiredEnvMap[key]);

  const optionalMissingVars = OPTIONAL_FIELDS
    .filter((key) => !valueForKey(key))
    .map((key) => optionalEnvMap[key]);

  return {
    configReady: missingVars.length === 0,
    missingVars,
    optionalMissingVars,
  };
}
