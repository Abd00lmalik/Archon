import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import contractsJson from "@/lib/generated/contracts.json";
import { LEGACY_ADDRESSES } from "@/lib/legacy-contracts";

const PAYMENT_ADDRESS = process.env.PLATFORM_TREASURY_ADDRESS ?? "0x25265b9dBEb6c653b0CA281110Bb0697a9685107";
const PAYMENT_AMOUNT = "10"; // 0.00001 USDC in 6-decimal units.
const USDC_CONTRACT = "0x3600000000000000000000000000000000000000";
const NETWORK = "eip155:5042002";
const RPC_URL = "https://rpc.testnet.arc.network";
const CIRCLE_GATEWAY_TESTNET_SETTLE_URL = "https://gateway-api-testnet.circle.com/gateway/v1/x402/settle";
const CIRCLE_GATEWAY_MAINNET_SETTLE_URL = "https://gateway-api.circle.com/gateway/v1/x402/settle";

const LEGACY_JOB_ABI = [
  "function getJob(uint256 jobId) view returns (tuple(uint256 jobId,address client,string title,string description,uint256 deadline,uint256 rewardUSDC,uint256 createdAt,uint256 acceptedCount,uint256 submissionCount,uint256 approvedCount,uint256 claimedCount,uint256 paidOutUSDC,bool refunded))"
] as const;

type PaymentRequirement = ReturnType<typeof paymentRequirements>;

type VerificationResult = {
  ok: boolean;
  method: "circle-gateway-settle" | "local-eip3009" | "none";
  reason?: string;
  response?: unknown;
};

function paymentRequirements(resource: string, jobId: string) {
  return {
    scheme: "exact",
    network: NETWORK,
    amount: PAYMENT_AMOUNT,
    maxAmountRequired: PAYMENT_AMOUNT,
    resource,
    description: `Access Archon task #${jobId} context data`,
    mimeType: "application/json",
    payTo: PAYMENT_ADDRESS,
    maxTimeoutSeconds: 300,
    asset: USDC_CONTRACT,
    extra: {
      name: "Archon Task Context",
      version: "1"
    }
  };
}

function parsePaymentHeader(value: string | null): unknown | null {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeGatewayPayload(parsed: unknown, requirement: PaymentRequirement) {
  const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  return {
    paymentPayload: record.paymentPayload ?? record.payload ?? parsed,
    paymentRequirements: record.paymentRequirements ?? record.accepted ?? requirement
  };
}

async function settleWithCircleGateway(parsed: unknown, requirement: PaymentRequirement): Promise<VerificationResult> {
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) {
    return { ok: false, method: "none", reason: "CIRCLE_API_KEY not configured" };
  }

  const url =
    process.env.CIRCLE_GATEWAY_ENV === "mainnet"
      ? CIRCLE_GATEWAY_MAINNET_SETTLE_URL
      : CIRCLE_GATEWAY_TESTNET_SETTLE_URL;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(normalizeGatewayPayload(parsed, requirement))
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      method: "circle-gateway-settle",
      reason: typeof body === "object" && body && "message" in body ? String(body.message) : response.statusText,
      response: body
    };
  }

  return { ok: true, method: "circle-gateway-settle", response: body };
}

function unpackAuthorization(parsed: unknown) {
  const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const payload = record.payload && typeof record.payload === "object" ? (record.payload as Record<string, unknown>) : {};
  const authorization =
    payload.authorization && typeof payload.authorization === "object"
      ? (payload.authorization as Record<string, unknown>)
      : payload;
  return Object.keys(authorization).length > 0 ? authorization : record;
}

function verifyEip3009Authorization(parsed: unknown, requirement: PaymentRequirement): VerificationResult {
  try {
    const auth = unpackAuthorization(parsed);
    const from = String(auth.from ?? "");
    const to = String(auth.to ?? "");
    const value = BigInt(String(auth.value ?? auth.amount ?? 0));
    const validAfter = Number(auth.validAfter ?? 0);
    const validBefore = Number(auth.validBefore ?? 0);
    const nonce = String(auth.nonce ?? "");
    const v = Number(auth.v ?? 0);
    const r = String(auth.r ?? "");
    const s = String(auth.s ?? "");

    if (!ethers.isAddress(from)) return { ok: false, method: "local-eip3009", reason: "invalid payer" };
    if (to.toLowerCase() !== requirement.payTo.toLowerCase()) {
      return { ok: false, method: "local-eip3009", reason: "wrong payment recipient" };
    }
    if (value < BigInt(requirement.amount)) {
      return { ok: false, method: "local-eip3009", reason: "insufficient payment amount" };
    }

    const now = Math.floor(Date.now() / 1000);
    if (now <= validAfter || now >= validBefore) {
      return { ok: false, method: "local-eip3009", reason: "authorization outside valid time window" };
    }
    if (!nonce || !r || !s || v === 0) {
      return { ok: false, method: "local-eip3009", reason: "missing EIP-3009 signature fields" };
    }

    const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    const domainCandidate =
      record.domain && typeof record.domain === "object" ? (record.domain as Record<string, unknown>) : {};
    const domain = {
      name: String(domainCandidate.name ?? "USDC"),
      version: String(domainCandidate.version ?? "2"),
      chainId: Number(domainCandidate.chainId ?? 5042002),
      verifyingContract: String(domainCandidate.verifyingContract ?? requirement.asset)
    };
    const types = {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" }
      ]
    };
    const message = { from, to, value, validAfter, validBefore, nonce };
    const recovered = ethers.verifyTypedData(domain, types, message, { v, r, s });

    if (recovered.toLowerCase() !== from.toLowerCase()) {
      return { ok: false, method: "local-eip3009", reason: "signature recovered wrong signer" };
    }

    return { ok: true, method: "local-eip3009" };
  } catch (error) {
    return {
      ok: false,
      method: "local-eip3009",
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

async function verifyPayment(parsed: unknown, requirement: PaymentRequirement): Promise<VerificationResult> {
  if (process.env.CIRCLE_API_KEY) {
    return settleWithCircleGateway(parsed, requirement);
  }

  // Testnet fallback: verify the signed authorization locally. This proves intent
  // and recipient/amount correctness, but does not settle funds through Circle.
  return verifyEip3009Authorization(parsed, requirement);
}

async function readTask(jobId: number) {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contracts = (contractsJson as { contracts?: Record<string, { address?: string; abi?: ethers.InterfaceAbi }> }).contracts ?? {};
  const jobConfig = contracts.jobContract ?? contracts.job;

  if (jobConfig?.address && jobConfig.abi) {
    try {
      const jobContract = new ethers.Contract(jobConfig.address, jobConfig.abi, provider);
      const job = await jobContract.getJob(jobId);
      const client = String(job.client ?? job[1] ?? "");
      if (client && client !== ethers.ZeroAddress) {
        return {
          jobId,
          title: String(job.title ?? job[2] ?? ""),
          description: String(job.description ?? job[3] ?? ""),
          acceptanceCriteria: String(job.description ?? job[3] ?? ""),
          rewardUSDC: Number(job.rewardUSDC ?? job[5] ?? 0n) / 1e6,
          deadline: Number(job.deadline ?? job[4] ?? 0),
          maxApprovals: Number(job.maxApprovals ?? job[6] ?? 0),
          submissionCount: Number(job.submissionCount ?? job[9] ?? 0)
        };
      }
    } catch {
      // Older tasks are still readable from the previous contract for continuity.
    }
  }

  const previousContract = new ethers.Contract(LEGACY_ADDRESSES.job, LEGACY_JOB_ABI, provider);
  const job = await previousContract.getJob(jobId);
  const client = String(job.client ?? job[1] ?? "");
  if (!client || client === ethers.ZeroAddress) {
    throw new Error("Task not found");
  }

  return {
    jobId,
    title: String(job.title ?? job[2] ?? ""),
    description: String(job.description ?? job[3] ?? ""),
    acceptanceCriteria: String(job.description ?? job[3] ?? ""),
    rewardUSDC: Number(job.rewardUSDC ?? job[5] ?? 0n) / 1e6,
    deadline: Number(job.deadline ?? job[4] ?? 0),
    maxApprovals: Number(job.approvedCount ?? job[9] ?? 0),
    submissionCount: Number(job.submissionCount ?? job[8] ?? 0)
  };
}

export async function GET(request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  const params = await context.params;
  const jobId = params.jobId;
  const requirement = paymentRequirements(request.url, jobId);
  const paymentSignature = request.headers.get("PAYMENT-SIGNATURE");
  const compatibilityPaymentHeader = request.headers.get("X-Payment");
  const parsedPayment = parsePaymentHeader(paymentSignature ?? compatibilityPaymentHeader);

  if (!parsedPayment) {
    return NextResponse.json(
      {
        error: "Payment Required",
        accepts: [requirement]
      },
      {
        status: 402,
        headers: {
          "PAYMENT-REQUIRED": JSON.stringify(requirement),
          "X-Payment-Required": "true"
        }
      }
    );
  }

  const verification = await verifyPayment(parsedPayment, requirement);
  if (!verification.ok) {
    return NextResponse.json(
      {
        error: "Payment verification failed",
        reason: verification.reason,
        accepts: [requirement]
      },
      {
        status: 402,
        headers: {
          "PAYMENT-REQUIRED": JSON.stringify(requirement),
          "X-Payment-Required": "true"
        }
      }
    );
  }

  try {
    const task = await readTask(Number(jobId));
    return NextResponse.json(
      {
        ...task,
        paymentReceived: true,
        paymentVerification: verification.method,
        accessedAt: Date.now()
      },
      {
        headers: {
          "PAYMENT-RESPONSE": JSON.stringify({ success: true, network: NETWORK, method: verification.method })
        }
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to fetch task context",
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
