import { BrowserProvider, JsonRpcProvider } from "ethers";
import {
  getReadProvider,
  isValidSubmission,
  parseSubmission,
  ZERO_ADDRESS
} from "@/lib/contracts";
import { getContractForSource } from "@/lib/task-adapter";
import { fetchUserProfile } from "@/lib/user-profiles";

export interface PersonSignal {
  address: string;
  username: string | null;
  avatarUrl: string | null;
  blockieUrl: string;
  role: "submitter" | "responder" | "both";
  submissionId?: number;
  deliverableLink?: string;
  submittedAt?: number;
  submissionCount: number;
  buildsOnGiven: number;
  buildsOnReceived: number;
  critiquesGiven: number;
  critiquesReceived: number;
  totalActivity: number;
  activityWeight: number;
  dominantSignal: "builds_on" | "critiques" | "neutral";
  colorRatio: number;
}

export interface TaskHeatmap {
  people: PersonSignal[];
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

export async function buildTaskHeatmap(
  provider: BrowserProvider | JsonRpcProvider,
  taskId: number,
  sourceId = "current"
): Promise<TaskHeatmap> {
  console.log("[heatmap] Building for task:", taskId, "source:", sourceId);
  const readProvider = provider ?? getReadProvider();
  const jobContract = getContractForSource(sourceId, readProvider);
  const contract = jobContract as unknown as {
    getSubmissions?: (taskId: number) => Promise<unknown[]>;
    submittedAgents?: (taskId: number, index: number) => Promise<string>;
    submissions?: (taskId: number, agent: string) => Promise<unknown>;
    getSelectedFinalists?: (taskId: number) => Promise<string[]>;
    getSubmissionResponses?: (submissionId: bigint | number) => Promise<Array<bigint | number>>;
    submissionResponses?: (submissionId: bigint | number, index: bigint | number) => Promise<bigint | number>;
    submissionResponseCount?: (submissionId: bigint | number) => Promise<bigint | number>;
    getResponse?: (responseId: bigint | number) => Promise<unknown>;
    getRevealPhaseEnd?: (taskId: number) => Promise<bigint | number>;
    isInRevealPhase?: (taskId: number) => Promise<boolean>;
  };

  const peopleMap = new Map<string, PersonSignal>();

  const isZero = (address: string) => {
    const normalized = String(address ?? "").toLowerCase();
    return (
      !normalized ||
      normalized === ZERO_ADDRESS.toLowerCase() ||
      normalized.replace(/^0x/, "").replace(/0/g, "") === ""
    );
  };

  const getOrCreate = (address: string, defaultRole: PersonSignal["role"]): PersonSignal => {
    const normalized = address.toLowerCase();
    const existing = peopleMap.get(normalized);
    if (existing) {
      if (defaultRole === "submitter" && existing.role === "responder") existing.role = "both";
      if (defaultRole === "responder" && existing.role === "submitter") existing.role = "both";
      return existing;
    }
    const checksumish = normalized;
    const created: PersonSignal = {
      address: checksumish,
      username: null,
      avatarUrl: null,
      blockieUrl: generateBlockie(checksumish),
      role: defaultRole,
      submissionCount: 0,
      buildsOnGiven: 0,
      buildsOnReceived: 0,
      critiquesGiven: 0,
      critiquesReceived: 0,
      totalActivity: 0,
      activityWeight: 0,
      dominantSignal: "neutral",
      colorRatio: 0.5
    };
    peopleMap.set(normalized, created);
    return created;
  };

  const loadResponseIds = async (submissionId: bigint | number): Promise<Array<bigint | number>> => {
    const explicit = contract.getSubmissionResponses
      ? await contract.getSubmissionResponses(submissionId).catch(() => null)
      : null;
    if (explicit) return Array.from(explicit);

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

  let rawSubmissions: unknown[] = [];
  try {
    if (!contract.getSubmissions) throw new Error("getSubmissions unavailable");
    rawSubmissions = Array.from((await contract.getSubmissions?.(taskId)) ?? []);
  } catch (error) {
    console.warn("[heatmap] getSubmissions failed, scanning submittedAgents:", error);
    for (let i = 0; i < 50; i += 1) {
      try {
        const agent = await contract.submittedAgents?.(taskId, i);
        if (!agent || isZero(agent)) break;
        const submission = await contract.submissions?.(taskId, agent);
        if (submission && isValidSubmission(submission)) rawSubmissions.push(submission);
      } catch {
        break;
      }
    }
  }

  const validSubmissions = rawSubmissions
    .filter((submission) => isValidSubmission(submission))
    .map((submission) => parseSubmission(submission))
    .filter((submission) => !isZero(submission.agent));

  let finalists: string[] = [];
  try {
    finalists = Array.from((await contract.getSelectedFinalists?.(taskId)) ?? [])
      .map((address) => String(address))
      .filter((address) => !isZero(address));
  } catch {
    finalists = [];
  }

  const eligibleAddresses = new Set(finalists.map((address) => address.toLowerCase()));

  // Auto-reveal fallback: if no explicit finalists exist, include only submitters
  // whose submissions have received at least one interaction.
  if (eligibleAddresses.size === 0) {
    for (const submission of validSubmissions) {
      try {
        const responseCount =
          Number((await contract.submissionResponseCount?.(BigInt(submission.submissionId))) ?? 0);
        if (responseCount > 0) {
          eligibleAddresses.add(submission.agent.toLowerCase());
          continue;
        }
      } catch {
        // Fall through to the response-list fallback below.
      }

      try {
        const responseIds = await loadResponseIds(BigInt(submission.submissionId));
        if (Array.from(responseIds).length > 0) {
          eligibleAddresses.add(submission.agent.toLowerCase());
        }
      } catch {
        // No response visibility for this submission.
      }
    }
  }

  const visibleSubmissions = validSubmissions.filter((submission) =>
    eligibleAddresses.has(submission.agent.toLowerCase())
  );

  console.log(`[heatmap] task #${taskId} valid submissions: ${validSubmissions.length}`);
  console.log(`[heatmap] task #${taskId} eligible finalist tiles: ${visibleSubmissions.length}`);

  for (const parsedSubmission of visibleSubmissions) {
    const agent = String(parsedSubmission.agent ?? "");
    if (isZero(agent)) continue;

    const submitter = getOrCreate(agent, "submitter");
    submitter.submissionCount += 1;
    if (submitter.submissionId === undefined) {
      submitter.submissionId = parsedSubmission.submissionId;
      submitter.deliverableLink = parsedSubmission.deliverableLink;
      submitter.submittedAt = parsedSubmission.submittedAt;
    }

    try {
      const responseIds = await loadResponseIds(BigInt(parsedSubmission.submissionId));
      for (const responseId of responseIds as Array<bigint | number>) {
        try {
          const response = (await contract.getResponse?.(responseId)) as Record<string, unknown> & unknown[];
          const responder = String(response.responder ?? response[3] ?? "");
          const stakeSlashed = Boolean(response.stakeSlashed ?? response[8] ?? false);
          const responseType = Number(response.responseType ?? response[4] ?? 0);
          if (isZero(responder) || stakeSlashed) continue;

          const responderPerson = peopleMap.get(responder.toLowerCase());
          if (responderPerson && responderPerson.role === "submitter") {
            responderPerson.role = "both";
          }

          if (responseType === 0) {
            submitter.buildsOnReceived += 1;
            if (responderPerson) responderPerson.buildsOnGiven += 1;
          } else {
            submitter.critiquesReceived += 1;
            if (responderPerson) responderPerson.critiquesGiven += 1;
          }
        } catch {
          // Skip malformed response rows.
        }
      }
    } catch {
      // Submission has no responses.
    }
  }

  const people = Array.from(peopleMap.values());
  for (const person of people) {
    const receivedSignals = person.buildsOnReceived + person.critiquesReceived;
    person.totalActivity =
      (person.submissionCount > 0 ? 1 : 0) +
      person.buildsOnGiven +
      person.critiquesGiven +
      Math.floor(receivedSignals / 2);

    if (person.submissionCount > 0 && person.totalActivity === 0) {
      person.totalActivity = 1;
    }
  }

  const globalActivity = people.reduce((sum, person) => sum + person.totalActivity, 0) || people.length;

  for (const person of people) {
    person.activityWeight = globalActivity > 0 ? Math.round((person.totalActivity / globalActivity) * 100) : 0;
    const buildSignals = person.buildsOnGiven + person.buildsOnReceived;
    const critiqueSignals = person.critiquesGiven + person.critiquesReceived;
    const totalSignals = buildSignals + critiqueSignals;
    person.colorRatio = totalSignals === 0 ? 0.5 : buildSignals / totalSignals;
    person.dominantSignal =
      person.colorRatio > 0.6 ? "builds_on" : person.colorRatio < 0.4 ? "critiques" : "neutral";
  }

  const weightSum = people.reduce((sum, person) => sum + person.activityWeight, 0);
  if (weightSum !== 100 && people.length > 0) {
    const largest = people.reduce((left, right) =>
      left.activityWeight >= right.activityWeight ? left : right
    );
    largest.activityWeight += 100 - weightSum;
  }

  await Promise.all(
    people.map(async (person) => {
      try {
        const profile = await fetchUserProfile(readProvider, person.address);
        if (profile) {
          person.username = profile.username || null;
          person.avatarUrl = profile.avatarUrl || null;
        }
      } catch {
        // Non-blocking profile read.
      }
    })
  );

  people.sort((a, b) => b.activityWeight - a.activityWeight);

  console.log(`[signalMap] task #${taskId} tiles: ${people.length}`);
  people.forEach((person) => {
    console.log(
      `  ${person.address.slice(0, 10)} role:${person.role} weight:${person.activityWeight}%`
    );
  });

  return {
    people,
    totalActivity: globalActivity,
    revealPhaseEnd,
    isRevealPhase
  };
}
