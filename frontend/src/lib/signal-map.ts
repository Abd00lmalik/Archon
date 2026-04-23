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

  const finalistSet = new Set(finalists.map((address) => address.toLowerCase()));
  // Strict live rule: finalist submissions drive submitter tiles during reveal.
  // Responders are added below only when a real non-slashed response exists.
  const visibleSubmissions = finalistSet.size > 0
    ? validSubmissions.filter((submission) => finalistSet.has(submission.agent.toLowerCase()))
    : validSubmissions;

  console.log(`[heatmap] task #${taskId} valid submissions: ${validSubmissions.length}`);
  console.log(`[heatmap] task #${taskId} finalist submissions: ${visibleSubmissions.length}`);

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
      const responseIds = await contract.getSubmissionResponses?.(BigInt(parsedSubmission.submissionId)) ?? [];
      for (const responseId of responseIds as Array<bigint | number>) {
        try {
          const response = (await contract.getResponse?.(responseId)) as Record<string, unknown> & unknown[];
          const responder = String(response.responder ?? response[3] ?? "");
          const stakeSlashed = Boolean(response.stakeSlashed ?? response[8] ?? false);
          const responseType = Number(response.responseType ?? response[4] ?? 0);
          if (isZero(responder) || stakeSlashed) continue;

          const responderPerson = getOrCreate(responder, "responder");

          if (responseType === 0) {
            submitter.buildsOnReceived += 1;
            responderPerson.buildsOnGiven += 1;
          } else {
            submitter.critiquesReceived += 1;
            responderPerson.critiquesGiven += 1;
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
  let globalActivity = 0;
  for (const person of people) {
    person.totalActivity =
      person.submissionCount +
      person.buildsOnGiven +
      person.buildsOnReceived +
      person.critiquesGiven +
      person.critiquesReceived;
    globalActivity += person.totalActivity;
  }

  for (const person of people) {
    person.activityWeight =
      globalActivity > 0 ? Math.round((person.totalActivity / globalActivity) * 100) : Math.round(100 / people.length);
    const buildSignals = person.buildsOnGiven + person.buildsOnReceived;
    const critiqueSignals = person.critiquesGiven + person.critiquesReceived;
    const totalSignals = buildSignals + critiqueSignals;
    person.colorRatio = totalSignals === 0 ? 0.5 : buildSignals / totalSignals;
    person.dominantSignal =
      person.colorRatio > 0.6 ? "builds_on" : person.colorRatio < 0.4 ? "critiques" : "neutral";
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

  let revealPhaseEnd = 0;
  let isRevealPhase = false;
  try {
    revealPhaseEnd = Number((await contract.getRevealPhaseEnd?.(taskId)) ?? 0);
    isRevealPhase = Boolean((await contract.isInRevealPhase?.(taskId)) ?? false);
  } catch {
    revealPhaseEnd = 0;
    isRevealPhase = false;
  }

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
