import { BrowserProvider, JsonRpcProvider } from "ethers";
import {
  getReadProvider,
  isValidSubmission,
  parseSubmission,
  ZERO_ADDRESS
} from "@/lib/contracts";
import { decodeInteractionContent, DecodedInteraction } from "@/lib/content-decoder";
import { getContractForSource } from "@/lib/task-adapter";
import { fetchUserProfile } from "@/lib/user-profiles";

const COLOR_NEUTRAL = "var(--text-muted, #6b7280)";
const COLOR_GREEN = "var(--arc-green, #22c55e)";
const COLOR_RED = "var(--pulse, #ef4444)";
const COLOR_MIXED = "var(--amber, #f59e0b)";

export interface SignalResponse {
  responseId: string;
  responder: string;
  responseType: "critique" | "builds_on" | "other";
  contentURI: string;
  decoded: DecodedInteraction | null;
  stakedAmount: string;
  stakeSlashed: boolean;
  timestamp: number;
}

export interface SignalTile {
  submissionId: string;
  agent: string;
  deliverableLink: string;
  submittedAt: number;
  critiquesReceived: number;
  buildOnsReceived: number;
  totalReceived: number;
  responses: SignalResponse[];
}

export interface SignalTileWithWeight extends SignalTile {
  username: string | null;
  avatarUrl: string | null;
  blockieUrl: string;
  weight: number;
  percentage: number;
  color: string;
}

// Backwards-compat alias for existing imports in the UI layer.
export type PersonSignal = SignalTileWithWeight;

export interface TaskHeatmap {
  people: SignalTileWithWeight[];
  totalActivity: number;
  revealPhaseEnd: number;
  isRevealPhase: boolean;
}

function addressToColor(address: string): string {
  const normalized = address.replace(/^0x/i, "").padEnd(6, "0");
  const hash = normalized.slice(0, 6);
  const r = parseInt(hash.slice(0, 2), 16);
  const g = parseInt(hash.slice(2, 4), 16);
  const b = parseInt(hash.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

function generateBlockie(address: string): string {
  const mirror = `${address.slice(0, 20)}${address
    .slice(20)
    .split("")
    .reverse()
    .join("")}`;
  return addressToColor(address || mirror);
}

function isZeroAddress(address: string): boolean {
  const normalized = String(address ?? "").toLowerCase();
  return (
    !normalized ||
    normalized === ZERO_ADDRESS.toLowerCase() ||
    normalized.replace(/^0x/, "").replace(/0/g, "") === ""
  );
}

function mapResponseType(responseType: number): "critique" | "builds_on" | "other" {
  if (responseType === 1) return "critique";
  if (responseType === 0) return "builds_on";
  return "other";
}

async function loadResponseIds(
  contract: {
    getSubmissionResponses?: (submissionId: bigint | number) => Promise<Array<bigint | number>>;
    submissionResponseCount?: (submissionId: bigint | number) => Promise<bigint | number>;
    submissionResponses?: (submissionId: bigint | number, index: bigint | number) => Promise<bigint | number>;
  },
  submissionId: bigint | number
): Promise<Array<bigint | number>> {
  if (contract.getSubmissionResponses) {
    const explicit = await contract.getSubmissionResponses(submissionId).catch(() => null);
    if (explicit) return Array.from(explicit);
  }

  const count = Number(
    contract.submissionResponseCount
      ? await contract.submissionResponseCount(submissionId).catch(() => 0n)
      : 0n
  );

  const ids: Array<bigint | number> = [];
  for (let index = 0; index < count; index += 1) {
    const responseId = contract.submissionResponses
      ? await contract.submissionResponses(submissionId, index).catch(() => null)
      : null;
    if (responseId !== null && responseId !== undefined) ids.push(responseId);
  }
  return ids;
}

export async function buildSignalMapData(
  jobContract: {
    getSubmissions?: (taskId: number) => Promise<unknown[]>;
    submittedAgents?: (taskId: number, index: number) => Promise<string>;
    getSubmission?: (taskId: number, agent: string) => Promise<unknown>;
    submissions?: (taskId: number, agent: string) => Promise<unknown>;
    getSelectedFinalists?: (taskId: number) => Promise<string[]>;
    getSubmissionResponses?: (submissionId: bigint | number) => Promise<Array<bigint | number>>;
    submissionResponses?: (submissionId: bigint | number, index: bigint | number) => Promise<bigint | number>;
    submissionResponseCount?: (submissionId: bigint | number) => Promise<bigint | number>;
    getResponse?: (responseId: bigint | number) => Promise<unknown>;
  },
  jobId: number
): Promise<SignalTile[]> {
  let rawSubmissions: unknown[] = [];
  try {
    if (!jobContract.getSubmissions) throw new Error("getSubmissions unavailable");
    rawSubmissions = Array.from((await jobContract.getSubmissions(jobId).catch(() => [])) ?? []);
  } catch {
    for (let idx = 0; idx < 100; idx += 1) {
      try {
        const agent = await jobContract.submittedAgents?.(jobId, idx);
        if (!agent || isZeroAddress(agent)) break;
        const raw =
          (await jobContract.getSubmission?.(jobId, agent).catch(() => null)) ??
          (await jobContract.submissions?.(jobId, agent).catch(() => null));
        if (raw && isValidSubmission(raw)) rawSubmissions.push(raw);
      } catch {
        break;
      }
    }
  }

  const validSubmissions = rawSubmissions
    .filter((row) => isValidSubmission(row))
    .map((row) => parseSubmission(row))
    .filter((row) => row.agent && !isZeroAddress(row.agent));

  let finalists: string[] = [];
  try {
    finalists = Array.from((await jobContract.getSelectedFinalists?.(jobId)) ?? [])
      .map((address) => String(address))
      .filter((address) => !isZeroAddress(address));
  } catch {
    finalists = [];
  }

  const eligibleSet = new Set<string>(finalists.map((address) => address.toLowerCase()));

  if (eligibleSet.size === 0) {
    for (const submission of validSubmissions) {
      const sid = BigInt(submission.submissionId);
      let hasInteractions = false;
      try {
        const count = Number((await jobContract.submissionResponseCount?.(sid)) ?? 0n);
        hasInteractions = count > 0;
      } catch {
        hasInteractions = false;
      }

      if (!hasInteractions) {
        try {
          const ids = await loadResponseIds(jobContract, sid);
          hasInteractions = ids.length > 0;
        } catch {
          hasInteractions = false;
        }
      }

      if (hasInteractions) {
        eligibleSet.add(submission.agent.toLowerCase());
      }
    }

    if (eligibleSet.size === 0) {
      for (const submission of validSubmissions) {
        eligibleSet.add(submission.agent.toLowerCase());
      }
    }
  }

  const tiles: SignalTile[] = [];

  for (const sub of validSubmissions) {
    const submissionId = String(sub.submissionId ?? "");
    const agent = String(sub.agent ?? "");
    if (!submissionId || !agent || !eligibleSet.has(agent.toLowerCase())) continue;

    const responseIds = await loadResponseIds(jobContract, BigInt(submissionId)).catch(() => []);
    const responses: SignalResponse[] = [];
    let critiquesReceived = 0;
    let buildOnsReceived = 0;

    for (const rid of responseIds) {
      const raw = (await jobContract.getResponse?.(rid).catch(() => null)) as
        | (Record<string, unknown> & unknown[])
        | null;
      if (!raw) continue;

      const responseType = Number(raw.responseType ?? raw[4] ?? raw[3] ?? 0);
      const responder = String(raw.responder ?? raw[3] ?? raw[1] ?? "");
      const contentURI = String(raw.contentURI ?? raw[5] ?? raw[4] ?? "");
      const stakedAmount = String(raw.stakedAmount ?? raw[6] ?? "0");
      const stakeSlashed = Boolean(raw.stakeSlashed ?? raw[8] ?? false);
      const createdAt = Number(raw.createdAt ?? raw[7] ?? 0);

      const typeLabel = mapResponseType(responseType);
      if (!stakeSlashed) {
        if (typeLabel === "critique") critiquesReceived += 1;
        if (typeLabel === "builds_on") buildOnsReceived += 1;
      }

      let decoded: DecodedInteraction | null = null;
      try {
        decoded = decodeInteractionContent(contentURI, responseType);
      } catch {
        decoded = null;
      }

      responses.push({
        responseId: String(rid),
        responder,
        responseType: typeLabel,
        contentURI,
        decoded,
        stakedAmount,
        stakeSlashed,
        timestamp: createdAt
      });
    }

    tiles.push({
      submissionId,
      agent,
      deliverableLink: String(sub.deliverableLink ?? ""),
      submittedAt: Number(sub.submittedAt ?? 0),
      critiquesReceived,
      buildOnsReceived,
      totalReceived: critiquesReceived + buildOnsReceived,
      responses
    });
  }

  return tiles;
}

export function computeTileWeights(
  tiles: SignalTile[]
): Array<SignalTile & { weight: number; percentage: number }> {
  if (tiles.length === 0) return [];

  const BASE_WEIGHT = 1;
  const rawWeights = tiles.map((tile) => BASE_WEIGHT + tile.totalReceived);
  const totalRaw = rawWeights.reduce((sum, value) => sum + value, 0);

  return tiles.map((tile, index) => ({
    ...tile,
    weight: rawWeights[index],
    percentage: totalRaw > 0 ? Math.round((rawWeights[index] / totalRaw) * 1000) / 10 : 100 / tiles.length
  }));
}

export function deriveTileColor(tile: SignalTile): string {
  const { critiquesReceived, buildOnsReceived } = tile;
  if (critiquesReceived === 0 && buildOnsReceived === 0) return COLOR_NEUTRAL;
  if (critiquesReceived > buildOnsReceived) return COLOR_RED;
  if (buildOnsReceived > critiquesReceived) return COLOR_GREEN;
  return COLOR_MIXED;
}

export async function buildTaskHeatmap(
  provider: BrowserProvider | JsonRpcProvider,
  taskId: number,
  sourceId = "current"
): Promise<TaskHeatmap> {
  const readProvider = provider ?? getReadProvider();
  const contract = getContractForSource(sourceId, readProvider) as unknown as {
    getRevealPhaseEnd?: (taskId: number) => Promise<bigint | number>;
    isInRevealPhase?: (taskId: number) => Promise<boolean>;
    getSubmissions?: (taskId: number) => Promise<unknown[]>;
    submittedAgents?: (taskId: number, index: number) => Promise<string>;
    getSubmission?: (taskId: number, agent: string) => Promise<unknown>;
    submissions?: (taskId: number, agent: string) => Promise<unknown>;
    getSelectedFinalists?: (taskId: number) => Promise<string[]>;
    getSubmissionResponses?: (submissionId: bigint | number) => Promise<Array<bigint | number>>;
    submissionResponses?: (submissionId: bigint | number, index: bigint | number) => Promise<bigint | number>;
    submissionResponseCount?: (submissionId: bigint | number) => Promise<bigint | number>;
    getResponse?: (responseId: bigint | number) => Promise<unknown>;
  };

  let revealPhaseEnd = 0;
  let isRevealPhase = false;
  try {
    revealPhaseEnd = Number((await contract.getRevealPhaseEnd?.(taskId)) ?? 0);
    isRevealPhase = Boolean((await contract.isInRevealPhase?.(taskId)) ?? false);
  } catch {
    revealPhaseEnd = 0;
    isRevealPhase = false;
  }

  if (!isRevealPhase) {
    return {
      people: [],
      totalActivity: 0,
      revealPhaseEnd,
      isRevealPhase: false
    };
  }

  const tiles = await buildSignalMapData(contract, taskId);
  const weighted = computeTileWeights(tiles);

  const people: SignalTileWithWeight[] = weighted.map((tile) => ({
    ...tile,
    username: null,
    avatarUrl: null,
    blockieUrl: generateBlockie(tile.agent),
    color: deriveTileColor(tile)
  }));

  await Promise.all(
    people.map(async (tile) => {
      try {
        const profile = await fetchUserProfile(readProvider, tile.agent);
        if (profile) {
          tile.username = profile.username || null;
          tile.avatarUrl = profile.avatarUrl || null;
        }
      } catch {
        // Ignore profile fetch issues.
      }
    })
  );

  people.sort((a, b) => b.percentage - a.percentage);

  return {
    people,
    totalActivity: people.reduce((sum, tile) => sum + tile.totalReceived, 0),
    revealPhaseEnd,
    isRevealPhase
  };
}

