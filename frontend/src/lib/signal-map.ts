import { BrowserProvider, JsonRpcProvider } from "ethers";
import {
  getReadProvider,
  getJobContract,
  isValidSubmission,
  parseSubmission,
  ZERO_ADDRESS
} from "@/lib/contracts";
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
  taskId: number
): Promise<TaskHeatmap> {
  console.log("[heatmap] Building for task:", taskId);
  const readProvider = provider ?? getReadProvider();
  const jobContract = getJobContract(readProvider);

  const peopleMap = new Map<string, PersonSignal>();

  const getOrCreate = (address: string): PersonSignal => {
    const key = address.toLowerCase();
    const existing = peopleMap.get(key);
    if (existing) return existing;
    const created: PersonSignal = {
      address,
      username: null,
      avatarUrl: null,
      blockieUrl: generateBlockie(address),
      role: "submitter",
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
    peopleMap.set(key, created);
    return created;
  };

  let rawSubmissions: unknown[] = [];
  try {
    rawSubmissions = Array.from(await jobContract.getSubmissions(taskId));
  } catch (error) {
    console.warn("[heatmap] getSubmissions failed:", error);
    return { people: [], totalActivity: 0, revealPhaseEnd: 0, isRevealPhase: false };
  }

  const validSubmissions = rawSubmissions.filter((submission) => isValidSubmission(submission));

  for (let i = 0; i < validSubmissions.length; i += 1) {
    const parsedSubmission = parseSubmission(validSubmissions[i]);
    const submission = validSubmissions[i] as Record<string, unknown> & unknown[];
    const agent = String(parsedSubmission.agent ?? submission.agent ?? submission[1] ?? "");
    if (!agent || agent.toLowerCase() === ZERO_ADDRESS.toLowerCase()) continue;

    const submitter = getOrCreate(agent);
    submitter.submissionCount += 1;
    if (submitter.submissionId === undefined) {
      submitter.submissionId = parsedSubmission.submissionId;
      submitter.deliverableLink = parsedSubmission.deliverableLink;
      submitter.submittedAt = parsedSubmission.submittedAt;
    }

    try {
      const profile = await fetchUserProfile(readProvider, agent);
      if (profile) {
        submitter.username = profile.username || null;
        submitter.avatarUrl = profile.avatarUrl || null;
      }
    } catch {
      // Non-blocking profile read.
    }

    const rawSubmissionId = submission.submissionId ?? submission.id ?? submission[0] ?? parsedSubmission.submissionId;
    const submissionId =
      rawSubmissionId !== undefined && rawSubmissionId !== null
        ? BigInt(String(rawSubmissionId))
        : BigInt(parsedSubmission.submissionId);

    try {
      const responseIds = await jobContract.getSubmissionResponses(submissionId);
      for (const responseId of responseIds as Array<bigint | number>) {
        try {
          const response = (await jobContract.getResponse(responseId)) as Record<string, unknown> & unknown[];
          const responder = String(response.responder ?? response[3] ?? "");
          const stakeSlashed = Boolean(response.stakeSlashed ?? response[8] ?? false);
          const responseType = Number(response.responseType ?? response[4] ?? 0);
          if (!responder || responder.toLowerCase() === ZERO_ADDRESS.toLowerCase() || stakeSlashed) continue;

          const responderPerson = getOrCreate(responder);
          responderPerson.role = responderPerson.submissionCount > 0 ? "both" : "responder";

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
      globalActivity > 0 ? Math.round((person.totalActivity / globalActivity) * 100) : 0;
    const totalSignals = person.buildsOnGiven + person.critiquesGiven;
    person.colorRatio = totalSignals === 0 ? 0.5 : person.buildsOnGiven / totalSignals;
    person.dominantSignal =
      person.colorRatio > 0.6 ? "builds_on" : person.colorRatio < 0.4 ? "critiques" : "neutral";
  }

  people.sort((a, b) => b.activityWeight - a.activityWeight);

  let revealPhaseEnd = 0;
  let isRevealPhase = false;
  try {
    revealPhaseEnd = Number(await jobContract.getRevealPhaseEnd(taskId));
    isRevealPhase = Boolean(await jobContract.isInRevealPhase(taskId));
  } catch {
    revealPhaseEnd = 0;
    isRevealPhase = false;
  }

  return {
    people,
    totalActivity: globalActivity,
    revealPhaseEnd,
    isRevealPhase
  };
}
