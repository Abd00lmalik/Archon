export type TaskDisplayStatus = "Open" | "Under Review" | "Reveal Phase" | "Closed";

export interface TaskStatusInput {
  status: number;
  deadline: number;
  submissionCount: number;
  finalistCount: number;
  isInRevealPhase: boolean;
  revealPhaseEnd: number;
  winnersFinalized: boolean;
  rewardsClaimed: boolean;
}

export function deriveDisplayStatus(t: TaskStatusInput): TaskDisplayStatus {
  const now = Math.floor(Date.now() / 1000);

  if (t.isInRevealPhase && t.revealPhaseEnd > now) {
    return "Reveal Phase";
  }

  if (t.isInRevealPhase && t.revealPhaseEnd <= now && !t.winnersFinalized) {
    return "Under Review";
  }

  if (t.winnersFinalized && t.rewardsClaimed) {
    return "Closed";
  }

  if (t.deadline <= now && t.submissionCount === 0) {
    return "Closed";
  }

  if (t.deadline <= now && t.submissionCount > 0 && !t.isInRevealPhase) {
    return "Under Review";
  }

  if (t.deadline > now) {
    return "Open";
  }

  return "Closed";
}

export function statusColor(s: TaskDisplayStatus): string {
  switch (s) {
    case "Open":
      return "var(--pulse)";
    case "Under Review":
      return "var(--amber, #f59e0b)";
    case "Reveal Phase":
      return "var(--arc, #6366f1)";
    case "Closed":
      return "var(--text-muted)";
  }
}

export function statusColorHex(s: TaskDisplayStatus): string {
  switch (s) {
    case "Open":
      return "#00FFA3";
    case "Under Review":
      return "#F5A623";
    case "Reveal Phase":
      return "#00E5FF";
    case "Closed":
      return "#7A9BB5";
  }
}

export function mapRawStatusFlags(rawStatus: number): {
  winnersFinalized: boolean;
  rewardsClaimed: boolean;
} {
  // ERC8183Job.sol:
  // 0 Open, 1 InProgress, 2 Submitted, 3 SelectionPhase, 4 RevealPhase, 5 Approved, 6 Rejected.
  // Finalization is terminal once status is Approved or Rejected.
  const winnersFinalized = rawStatus === 5 || rawStatus === 6;
  // Reward-claim completeness is not exposed directly; use terminal state as the best available signal.
  const rewardsClaimed = rawStatus === 5 || rawStatus === 6;
  return { winnersFinalized, rewardsClaimed };
}
