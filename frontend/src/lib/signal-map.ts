import { BrowserProvider, InterfaceAbi, JsonRpcProvider, Provider } from "ethers";
import {
  getReadProvider,
  isValidSubmission,
  parseSubmission,
  ZERO_ADDRESS
} from "@/lib/contracts";
import { decodeInteractionContent, DecodedInteraction } from "@/lib/content-decoder";
import { mapLimit, MulticallRequest, multicall, withRetry } from "@/lib/multicall";
import { getContractForSource } from "@/lib/task-adapter";
import { fetchUserProfile } from "@/lib/user-profiles";

/** Per-call read overrides accepted by ethers contract methods. */
export type ReadOverrides = { blockTag?: number | string };

/** Overrides object for a pinned-block read (empty when unpinned). */
function atBlock(blockTag?: number | string): ReadOverrides {
  return blockTag !== undefined && blockTag !== null ? { blockTag } : {};
}

const COLOR_NEUTRAL = "#3A4A5A";
const COLOR_MIXED = "#F5A623";

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

type ResponseRow = Record<string, unknown> & unknown[];

type JobContractShape = {
  getSubmissions?: (taskId: number, overrides?: ReadOverrides) => Promise<unknown[]>;
  submittedAgents?: (taskId: number, index: number, overrides?: ReadOverrides) => Promise<string>;
  getSubmission?: (taskId: number, agent: string, overrides?: ReadOverrides) => Promise<unknown>;
  submissions?: (taskId: number, agent: string, overrides?: ReadOverrides) => Promise<unknown>;
  getSelectedFinalists?: (taskId: number, overrides?: ReadOverrides) => Promise<string[]>;
  getJob?: (taskId: number, overrides?: ReadOverrides) => Promise<unknown>;
  getSubmissionResponses?: (
    submissionId: bigint | number,
    overrides?: ReadOverrides
  ) => Promise<Array<bigint | number>>;
  submissionResponseCount?: (
    submissionId: bigint | number,
    overrides?: ReadOverrides
  ) => Promise<bigint | number>;
  getResponse?: (responseId: bigint | number, overrides?: ReadOverrides) => Promise<unknown>;
};

type BatchContext = { provider: Provider; target: string; abi: InterfaceAbi; blockTag?: number };

type SubmissionResponseData = { rows: ResponseRow[]; count: number | null };

function toBigints(values: unknown): bigint[] {
  return Array.from((values ?? []) as ArrayLike<unknown>).map((value) => BigInt(value as string));
}

async function loadIdsAndCount(
  jobContract: JobContractShape,
  sid: bigint,
  overrides?: ReadOverrides
): Promise<{ ids: bigint[] | null; count: number | null }> {
  const ids = jobContract.getSubmissionResponses
    ? toBigints(await withRetry(() => jobContract.getSubmissionResponses!(sid, overrides)))
    : null;
  const count = jobContract.submissionResponseCount
    ? Number(await withRetry(() => jobContract.submissionResponseCount!(sid, overrides)))
    : null;
  return { ids, count };
}

async function loadResponseRow(
  jobContract: JobContractShape,
  rid: bigint,
  overrides?: ReadOverrides
): Promise<ResponseRow> {
  const raw = await withRetry(() => jobContract.getResponse!(rid, overrides));
  if (!raw) throw new Error(`Signal map: response ${rid} returned no data`);
  const row = raw as ResponseRow;
  const rowId = row.responseId ?? row[0];
  if (rowId === null || rowId === undefined) {
    throw new Error(`Signal map: response ${rid} is missing its id`);
  }
  return row;
}

/**
 * Load every submission's response rows. Fail-loud: any read that still fails
 * after retries throws instead of silently returning fewer rows - a partially
 * loaded map changes percentages between refreshes, and the caller keeps its
 * last-good map on error.
 */
async function collectResponses(
  jobContract: JobContractShape,
  submissionIds: bigint[],
  batch?: BatchContext
): Promise<Map<string, SubmissionResponseData>> {
  const map = new Map<string, SubmissionResponseData>();
  for (const sid of submissionIds) map.set(sid.toString(), { rows: [], count: null });
  if (submissionIds.length === 0) return map;

  const canIds = typeof jobContract.getSubmissionResponses === "function";
  const canCount = typeof jobContract.submissionResponseCount === "function";
  // Legacy sources without the response-read surface expose no interactions.
  if (!canIds && !canCount) return map;

  // All reads in this batch derive their pinning from the same blockTag so a
  // fallback after a failed multicall chunk still reads the same block.
  const overrides = atBlock(batch?.blockTag);

  // Phase 1: response-id lists plus cross-check counts, batched in one
  // multicall; per-entry failures fall back to direct retrying reads.
  const idsBySid = new Map<string, bigint[]>();
  const countBySid = new Map<string, number>();
  const phase1Failed: bigint[] = [];

  if (batch) {
    const requests: MulticallRequest[] = submissionIds.flatMap((sid) => {
      const row: MulticallRequest[] = [];
      if (canIds) {
        row.push({
          target: batch.target,
          abi: batch.abi,
          functionName: "getSubmissionResponses",
          args: [sid]
        });
      }
      if (canCount) {
        row.push({
          target: batch.target,
          abi: batch.abi,
          functionName: "submissionResponseCount",
          args: [sid]
        });
      }
      return row;
    });
    const results = await multicall(batch.provider, requests, 50, batch.blockTag);
    let cursor = 0;
    for (const sid of submissionIds) {
      let ids: bigint[] | null = null;
      let count: number | null = null;
      if (canIds) {
        const result = results[cursor];
        cursor += 1;
        if (result?.ok) ids = toBigints(result.value);
      }
      if (canCount) {
        const result = results[cursor];
        cursor += 1;
        if (result?.ok && result.value !== null && result.value !== undefined) {
          count = Number(result.value);
        }
      }
      if ((canIds && ids === null) || (canCount && count === null)) {
        phase1Failed.push(sid);
      } else {
        if (ids !== null) idsBySid.set(sid.toString(), ids);
        if (count !== null) countBySid.set(sid.toString(), count);
      }
    }
  } else {
    phase1Failed.push(...submissionIds);
  }

  if (phase1Failed.length > 0) {
    await mapLimit(phase1Failed, 6, async (sid) => {
      const loaded = await loadIdsAndCount(jobContract, sid, overrides);
      if (loaded.ids !== null) idsBySid.set(sid.toString(), loaded.ids);
      if (loaded.count !== null) countBySid.set(sid.toString(), loaded.count);
    });
  }

  // Completeness: the id list must be readable (primary source) and must agree
  // with the count cross-check. A mismatch after retries means mixed reads.
  for (const sid of submissionIds) {
    const key = sid.toString();
    if (canIds && !idsBySid.has(key)) {
      throw new Error(`Signal map: response ids unreadable for submission ${key} after retries.`);
    }
    if (canIds && canCount) {
      const ids = idsBySid.get(key) ?? [];
      const count = countBySid.get(key);
      if (count !== undefined && count !== ids.length) {
        throw new Error(
          `Signal map: inconsistent response counts for submission ${key} (${ids.length} ids vs ${count} count).`
        );
      }
    }
  }

  // Phase 2: fetch every response row by id.
  const allIds: bigint[] = [];
  for (const ids of idsBySid.values()) allIds.push(...ids);

  if (allIds.length === 0) {
    for (const sid of submissionIds) {
      const key = sid.toString();
      map.set(key, { rows: [], count: countBySid.get(key) ?? (canCount ? 0 : null) });
    }
    return map;
  }

  if (typeof jobContract.getResponse !== "function") {
    if (canIds) {
      throw new Error("Signal map: contract exposes response ids but no getResponse reader.");
    }
    for (const sid of submissionIds) {
      const key = sid.toString();
      map.set(key, { rows: [], count: countBySid.get(key) ?? null });
    }
    return map;
  }

  const rowById = new Map<string, ResponseRow>();
  const loadRows = async (rids: bigint[]): Promise<void> => {
    await mapLimit(rids, 6, async (rid) => {
      rowById.set(rid.toString(), await loadResponseRow(jobContract, rid, overrides));
    });
  };

  if (batch) {
    const requests: MulticallRequest[] = allIds.map((rid) => ({
      target: batch.target,
      abi: batch.abi,
      functionName: "getResponse",
      args: [rid]
    }));
    const results = await multicall(batch.provider, requests, 50, batch.blockTag);
    const failed: bigint[] = [];
    results.forEach((result, index) => {
      const rid = allIds[index];
      const row = result?.ok && result.value ? (result.value as ResponseRow) : null;
      const rowId = row ? row.responseId ?? row[0] : null;
      if (row && rowId !== null && rowId !== undefined) {
        rowById.set(rid.toString(), row);
      } else {
        failed.push(rid);
      }
    });
    if (failed.length > 0) await loadRows(failed);
  } else {
    await loadRows(allIds);
  }

  // Distribute rows back to their submissions; a missing row is a failed read.
  for (const sid of submissionIds) {
    const key = sid.toString();
    if (!canIds) {
      map.set(key, { rows: [], count: countBySid.get(key) ?? null });
      continue;
    }
    const rows: ResponseRow[] = [];
    for (const rid of idsBySid.get(key) ?? []) {
      const row = rowById.get(rid.toString());
      if (!row) {
        throw new Error(`Signal map: response ${rid} missing for submission ${key} after retries.`);
      }
      rows.push(row);
    }
    map.set(key, { rows, count: countBySid.get(key) ?? rows.length });
  }
  return map;
}

export async function buildSignalMapData(
  jobContract: JobContractShape,
  jobId: number,
  batch?: BatchContext,
  blockTag?: number
): Promise<SignalTile[]> {
  const overrides = atBlock(blockTag);
  // Load submissions: retry the batched getter, then fall back to enumerating
  // submittedAgents. If both paths yield nothing the read itself is broken —
  // during a reveal there is always at least one submission — so throw instead
  // of silently producing an empty (or fallback-expanded) tile set.
  let rawSubmissions: unknown[] = [];
  if (jobContract.getSubmissions) {
    try {
      const rows = await withRetry(() => jobContract.getSubmissions!(jobId, overrides));
      rawSubmissions = Array.from(rows ?? []);
    } catch {
      rawSubmissions = [];
    }
  }
  if (rawSubmissions.length === 0) {
    // Batched getter empty or failed: enumerate submittedAgents instead.
    // Reads here are fail-loud too - skipping a submission silently changes
    // the tile set between refreshes. The mapping's array getter reverts past
    // its end, so bound the loop with the job's own submissionCount (which
    // increments together with every push at submit time).
    if (jobContract.submittedAgents) {
      let bound = 0;
      if (jobContract.getJob) {
        const rawJob = await withRetry(() => jobContract.getJob!(jobId, overrides));
        bound = Number(
          (rawJob as { submissionCount?: unknown } & ArrayLike<unknown>).submissionCount ??
            (rawJob as ArrayLike<unknown>)[9] ??
            0
        );
      }
      if (!Number.isFinite(bound) || bound < 0) bound = 0;
      for (let idx = 0; idx < bound; idx += 1) {
        const agent = await withRetry(() => jobContract.submittedAgents!(jobId, idx, overrides));
        if (!agent || isZeroAddress(agent)) break;
        let raw: unknown = null;
        if (jobContract.getSubmission) {
          raw = await withRetry(() => jobContract.getSubmission!(jobId, agent, overrides));
        } else if (jobContract.submissions) {
          raw = await withRetry(() => jobContract.submissions!(jobId, agent, overrides));
        }
        if (raw && isValidSubmission(raw)) rawSubmissions.push(raw);
      }
    }
  }

  const validSubmissions = rawSubmissions
    .filter((row) => isValidSubmission(row))
    .map((row) => parseSubmission(row))
    .filter((row) => row.agent && !isZeroAddress(row.agent));

  if (validSubmissions.length === 0) {
    throw new Error("Signal map could not load submissions (RPC read failed).");
  }

  // The finalist read is the source of truth for which tiles are shown.
  // NEVER degrade to "all submissions" on a read failure: that leaked rejected
  // submissions onto the map. Legacy sources without the getter keep the
  // interaction-based fallback below.
  let finalists: string[] = [];
  if (jobContract.getSelectedFinalists) {
    const rows = await withRetry(() => jobContract.getSelectedFinalists!(jobId, overrides));
    finalists = Array.from(rows ?? [])
      .map((address) => String(address))
      .filter((address) => !isZeroAddress(address));
  }

  const submissionIds = validSubmissions.map((submission) => BigInt(submission.submissionId));
  const responseData = await collectResponses(jobContract, submissionIds, batch);

  const eligibleSet = new Set<string>(finalists.map((address) => address.toLowerCase()));

  if (eligibleSet.size === 0) {
    for (const submission of validSubmissions) {
      const data = responseData.get(String(submission.submissionId));
      const hasInteractions = Boolean(
        data && (data.rows.length > 0 || (data.count !== null && data.count > 0))
      );
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

    const responses: SignalResponse[] = [];
    let critiquesReceived = 0;
    let buildOnsReceived = 0;

    const responseRows: ResponseRow[] = responseData.get(submissionId)?.rows ?? [];

    for (const raw of responseRows) {
      const rid = raw.responseId ?? raw[0] ?? 0n;

      const responseType = Number(raw.responseType ?? raw[4] ?? raw[3] ?? 0);
      const responder = String(raw.responder ?? raw[3] ?? raw[1] ?? "");
      const contentURI = String(raw.contentURI ?? raw[5] ?? raw[4] ?? "");
      const stakedAmount = String(raw.stakedAmount ?? raw[6] ?? "0");
      const stakeSlashed = Boolean(raw.stakeSlashed ?? raw[8] ?? false);
      const createdAt = Number(raw.createdAt ?? raw[7] ?? 0);

      const typeLabel = mapResponseType(responseType);
      if (typeLabel === "critique") critiquesReceived += 1;
      if (typeLabel === "builds_on") buildOnsReceived += 1;

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

export function getTileColor(critiquesReceived: number, buildOnsReceived: number): string {
  const total = critiquesReceived + buildOnsReceived;
  if (total === 0) return COLOR_NEUTRAL;
  if (critiquesReceived === buildOnsReceived) return COLOR_MIXED;
  if (critiquesReceived > buildOnsReceived) {
    const intensity = Math.min(critiquesReceived / total, 1);
    const r = Math.round(180 + intensity * 75);
    return `rgb(${r}, 60, 80)`;
  }
  const intensity = Math.min(buildOnsReceived / total, 1);
  const g = Math.round(160 + intensity * 75);
  return `rgb(60, ${g}, 100)`;
}

export function deriveTileColor(tile: SignalTile): string {
  return getTileColor(tile.critiquesReceived, tile.buildOnsReceived);
}

export async function buildTaskHeatmap(
  provider: BrowserProvider | JsonRpcProvider,
  taskId: number,
  sourceId = "current"
): Promise<TaskHeatmap> {
  const readProvider = provider ?? getReadProvider();

  // Pin every read of one build to a single block so submissions, finalists
  // and responses can never straddle two chain states: a lagging or flaky
  // replica then returns one coherent snapshot instead of a mixed one.
  let blockTag: number | undefined;
  try {
    blockTag = await withRetry(() => readProvider.getBlockNumber());
  } catch {
    blockTag = undefined;
  }

  try {
    return await buildTaskHeatmapAt(readProvider, taskId, sourceId, blockTag);
  } catch (error) {
    if (blockTag === undefined) throw error;
    // The node refused the recent historical block (pruned state): redo the
    // whole build unpinned rather than mixing pinned and latest reads.
    return buildTaskHeatmapAt(readProvider, taskId, sourceId, undefined);
  }
}

async function buildTaskHeatmapAt(
  readProvider: BrowserProvider | JsonRpcProvider,
  taskId: number,
  sourceId: string,
  blockTag?: number
): Promise<TaskHeatmap> {
  const contractInstance = getContractForSource(sourceId, readProvider);
  const contract = contractInstance as unknown as JobContractShape & {
    getRevealPhaseEnd?: (taskId: number, overrides?: ReadOverrides) => Promise<bigint | number>;
    isInRevealPhase?: (taskId: number, overrides?: ReadOverrides) => Promise<boolean>;
  };
  const overrides = atBlock(blockTag);

  // Retry reveal-state reads. A transient failure here used to be swallowed
  // into "not in reveal", returning an empty map — so the signal map flipped
  // between empty and populated across refreshes. Only a genuinely-false
  // on-chain value may mean "no reveal"; a persistent read failure now
  // propagates so the caller can show an error with a retry.
  let revealPhaseEnd = 0;
  if (contract.getRevealPhaseEnd) {
    revealPhaseEnd = Number(await withRetry(() => contract.getRevealPhaseEnd!(taskId, overrides)));
  }
  let isRevealPhase = false;
  if (contract.isInRevealPhase) {
    isRevealPhase = Boolean(await withRetry(() => contract.isInRevealPhase!(taskId, overrides)));
  }

  // Build whenever the reveal has been scheduled (or is still active). The old
  // gate (active-reveal only) blanked the map the moment the reveal clock
  // ended — exactly while the creator is choosing winners — and for good
  // after settlement. A truly unselected job (revealPhaseEnd == 0) stays empty.
  if (!isRevealPhase && !(revealPhaseEnd > 0)) {
    return {
      people: [],
      totalActivity: 0,
      revealPhaseEnd,
      isRevealPhase: false
    };
  }

  const contractTarget =
    typeof contractInstance.target === "string"
      ? contractInstance.target
      : await contractInstance.target.getAddress();
  const tiles = await buildSignalMapData(
    contract,
    taskId,
    {
      provider: readProvider,
      target: contractTarget,
      abi: contractInstance.interface.fragments,
      blockTag
    },
    blockTag
  );
  const weighted = computeTileWeights(tiles);

  const people: SignalTileWithWeight[] = weighted.map((tile) => ({
    ...tile,
    username: null,
    avatarUrl: null,
    blockieUrl: generateBlockie(tile.agent),
    color: deriveTileColor(tile)
  }));

  if (typeof window !== "undefined") {
    try {
      const profileStore = JSON.parse(window.localStorage.getItem("archon_profiles") ?? "{}") as Record<
        string,
        { username?: string; avatar?: string }
      >;
      for (const tile of people) {
        const cached = profileStore[tile.agent.toLowerCase()];
        if (cached?.username) tile.username = cached.username;
      }
    } catch {
      // Ignore local profile store parsing errors.
    }
  }

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

  // Deterministic order across refreshes: percentage, then raw activity, then
  // submission id as the unique tiebreaker.
  people.sort(
    (a, b) =>
      b.percentage - a.percentage ||
      b.totalReceived - a.totalReceived ||
      Number(a.submissionId) - Number(b.submissionId)
  );

  return {
    people,
    totalActivity: people.reduce((sum, tile) => sum + tile.totalReceived, 0),
    revealPhaseEnd,
    isRevealPhase
  };
}

