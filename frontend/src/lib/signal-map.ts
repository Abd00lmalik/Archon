import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";
import { contractAddresses, getReadProvider, ZERO_ADDRESS } from "@/lib/contracts";

export type ResponseType = "builds_on" | "critiques";

export interface SignalResponse {
  responseId: string;
  responder: string;
  responseType: ResponseType;
  contentURI: string;
  createdAt: number;
  stakeSlashed: boolean;
}

export interface SubmissionSignal {
  submissionId: string;
  agent: string;
  deliverableLink: string;
  isFinalist: boolean;
  isSelected: boolean;
  buildsOnCount: number;
  critiquesCount: number;
  totalInteractions: number;
  interactionWeight: number;
  colorRatio: number;
  responses: SignalResponse[];
}

export interface TaskSignalMap {
  submissions: SubmissionSignal[];
  totalInteractions: number;
  revealPhaseEnd: number;
  isRevealPhase: boolean;
}

export async function buildSignalMap(
  provider: BrowserProvider | JsonRpcProvider,
  taskId: number
): Promise<TaskSignalMap> {
  console.log("[signalMap] Building for task:", taskId);
  const graphProvider = provider ?? getReadProvider();
  const jobContract = new Contract(
    contractAddresses.job,
    [
      "function getSubmissions(uint256 jobId) view returns (tuple(uint256 submissionId,address agent,string deliverableLink,uint8 status,uint256 submittedAt,string reviewerNote,bool credentialClaimed,uint256 allocatedReward)[])",
      "function getSubmissionResponses(uint256 submissionId) view returns (uint256[])",
      "function getResponse(uint256 responseId) view returns (tuple(uint256 responseId, uint256 parentSubmissionId, uint256 taskId, address responder, uint8 responseType, string contentURI, uint256 stakedAmount, uint256 createdAt, bool stakeSlashed, bool stakeReturned))",
      "function getSelectedFinalists(uint256 jobId) view returns (address[])",
      "function getRevealPhaseEnd(uint256 jobId) view returns (uint256)",
      "function isInRevealPhase(uint256 jobId) view returns (bool)"
    ],
    graphProvider
  );

  let rawSubmissions: unknown[] = [];
  try {
    const result = await jobContract.getSubmissions(taskId);
    rawSubmissions = Array.from(result);
    console.log("[signalMap] getSubmissions:", rawSubmissions.length);
  } catch (error) {
    console.warn("[signalMap] getSubmissions failed:", error);
    return { submissions: [], totalInteractions: 0, revealPhaseEnd: 0, isRevealPhase: false };
  }

  let finalists: string[] = [];
  try {
    finalists = (await jobContract.getSelectedFinalists(taskId)) as string[];
  } catch {
    finalists = [];
  }
  const finalistSet = new Set(finalists.map((address) => address.toLowerCase()));

  let revealPhaseEnd = 0;
  let isRevealPhase = false;
  try {
    revealPhaseEnd = Number(await jobContract.getRevealPhaseEnd(taskId));
    isRevealPhase = Boolean(await jobContract.isInRevealPhase(taskId));
  } catch {
    revealPhaseEnd = 0;
    isRevealPhase = false;
  }

  const signals: SubmissionSignal[] = [];
  let totalInteractions = 0;

  for (let i = 0; i < rawSubmissions.length; i += 1) {
    const sub = rawSubmissions[i] as Record<string, unknown> & unknown[];
    const agent = String(sub.agent ?? sub[0] ?? "");
    const deliverableLink = String(sub.deliverableLink ?? sub[2] ?? sub[1] ?? "");
    const status = Number(sub.status ?? sub[3] ?? 0);
    const rawId = sub.submissionId ?? sub.id ?? sub[7] ?? BigInt(i + 1);
    const submissionId = String(rawId && rawId !== 0n ? rawId : BigInt(i + 1));

    if (!agent || agent.toLowerCase() === ZERO_ADDRESS.toLowerCase()) continue;

    const responses: SignalResponse[] = [];
    let buildsOnCount = 0;
    let critiquesCount = 0;

    try {
      const responseIds = (await jobContract.getSubmissionResponses(submissionId)) as Array<bigint | number>;
      for (const responseId of responseIds) {
        try {
          const response = await jobContract.getResponse(responseId);
          const responseTypeNumber = Number(response.responseType ?? response[4] ?? 0);
          const mappedType: ResponseType = responseTypeNumber === 0 ? "builds_on" : "critiques";
          if (mappedType === "builds_on") buildsOnCount += 1;
          else critiquesCount += 1;

          responses.push({
            responseId: String(response.responseId ?? response[0] ?? responseId),
            responder: String(response.responder ?? response[3] ?? ""),
            responseType: mappedType,
            contentURI: String(response.contentURI ?? response[5] ?? ""),
            createdAt: Number(response.createdAt ?? response[7] ?? 0),
            stakeSlashed: Boolean(response.stakeSlashed ?? response[8] ?? false)
          });
        } catch {
          // Ignore malformed response rows.
        }
      }
    } catch {
      // Submission may have no responses yet.
    }

    const submissionInteractions = buildsOnCount + critiquesCount;
    totalInteractions += submissionInteractions;

    if (submissionInteractions === 0) continue;

    signals.push({
      submissionId,
      agent,
      deliverableLink,
      isFinalist: finalistSet.has(agent.toLowerCase()),
      isSelected: status === 2,
      buildsOnCount,
      critiquesCount,
      totalInteractions: submissionInteractions,
      interactionWeight: 0,
      colorRatio: submissionInteractions > 0 ? buildsOnCount / submissionInteractions : 0.5,
      responses
    });
  }

  if (totalInteractions > 0) {
    for (const signal of signals) {
      signal.interactionWeight = Math.round((signal.totalInteractions / totalInteractions) * 100);
    }
  }

  signals.sort((left, right) => right.interactionWeight - left.interactionWeight);
  console.log("[signalMap] Result:", signals.length, "submissions with interactions");

  return {
    submissions: signals,
    totalInteractions,
    revealPhaseEnd,
    isRevealPhase
  };
}
