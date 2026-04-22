"use client";

import { BrowserProvider, JsonRpcProvider } from "ethers";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { UserDisplay } from "@/components/ui/user-display";
import {
  getJobContract,
  isValidSubmission,
  parseSubmission,
  SubmissionRecord,
  ZERO_ADDRESS
} from "@/lib/contracts";
import { DecodedInteraction, decodeInteractionContent } from "@/lib/content-decoder";
import { PersonSignal, TaskHeatmap } from "@/lib/signal-map";
import { getProfile } from "@/lib/user-profiles";

type Rect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type TreemapItem = {
  person: PersonSignal;
  rect: Rect;
};

type ParsedInteraction = {
  responseId: bigint;
  responder: string;
  responseType: "builds_on" | "critiques" | "alternative";
  contentURI: string;
  decoded: DecodedInteraction;
  stakedAmount: bigint;
  createdAt: number;
  stakeSlashed: boolean;
  stakeReturned: boolean;
  interactionRewardClaimed: boolean;
};

type SubmissionDetail = {
  submission: Partial<SubmissionRecord>;
  responses: ParsedInteraction[];
};

interface Props {
  heatmap: TaskHeatmap;
  loading?: boolean;
  containerWidth?: number;
  containerHeight?: number;
  taskId?: number;
  provider?: BrowserProvider | JsonRpcProvider | null;
  isCreator?: boolean;
  onViewSubmissions?: (address: string) => void;
  onSlashResponse?: (responseId: bigint) => Promise<void> | void;
}

function getColor(ratio: number): string {
  if (ratio >= 0.75) return "#1a7a4a";
  if (ratio >= 0.55) return "#1a5c3a";
  if (ratio >= 0.45) return "#5c4a00";
  if (ratio >= 0.25) return "#5c2a00";
  return "#5c0a1a";
}

function getBorderColor(ratio: number): string {
  if (ratio >= 0.75) return "#00C851";
  if (ratio >= 0.55) return "#00875A";
  if (ratio >= 0.45) return "#CC7700";
  if (ratio >= 0.25) return "#CC4400";
  return "#CC0033";
}

function getTextColor(ratio: number): string {
  if (ratio >= 0.75) return "#00FF7A";
  if (ratio >= 0.55) return "#00C851";
  if (ratio >= 0.45) return "#FFB800";
  if (ratio >= 0.25) return "#FF6B35";
  return "#FF3366";
}

function worstAspectRatio(row: number[], sideLength: number): number {
  if (!row.length) return Number.POSITIVE_INFINITY;
  const sum = row.reduce((acc, value) => acc + value, 0);
  const max = Math.max(...row);
  const min = Math.min(...row);
  const sideSquared = sideLength * sideLength;
  return Math.max((sideSquared * max) / (sum * sum), (sum * sum) / (sideSquared * min));
}

function layoutRow(
  rowItems: PersonSignal[],
  rowAreas: number[],
  rect: Rect,
  horizontal: boolean
): { placed: TreemapItem[]; rest: Rect } {
  const totalRowArea = rowAreas.reduce((acc, value) => acc + value, 0);
  const placed: TreemapItem[] = [];

  if (horizontal) {
    const rowWidth = totalRowArea / rect.h;
    let offsetY = rect.y;
    for (let i = 0; i < rowItems.length; i += 1) {
      const itemHeight = rowAreas[i] / rowWidth;
      placed.push({
        person: rowItems[i],
        rect: { x: rect.x, y: offsetY, w: rowWidth, h: itemHeight }
      });
      offsetY += itemHeight;
    }
    return {
      placed,
      rest: { x: rect.x + rowWidth, y: rect.y, w: rect.w - rowWidth, h: rect.h }
    };
  }

  const rowHeight = totalRowArea / rect.w;
  let offsetX = rect.x;
  for (let i = 0; i < rowItems.length; i += 1) {
    const itemWidth = rowAreas[i] / rowHeight;
    placed.push({
      person: rowItems[i],
      rect: { x: offsetX, y: rect.y, w: itemWidth, h: rowHeight }
    });
    offsetX += itemWidth;
  }
  return {
    placed,
    rest: { x: rect.x, y: rect.y + rowHeight, w: rect.w, h: rect.h - rowHeight }
  };
}

function squarify(items: PersonSignal[], x: number, y: number, w: number, h: number): TreemapItem[] {
  if (!items.length || w <= 0 || h <= 0) return [];

  const totalWeight = items.reduce((acc, item) => acc + Math.max(item.activityWeight, 1), 0);
  if (totalWeight <= 0) return [];

  const totalArea = w * h;
  const weightedItems = items.map((item) => ({
    person: item,
    area: (Math.max(item.activityWeight, 1) / totalWeight) * totalArea
  }));

  const result: TreemapItem[] = [];
  let rect: Rect = { x, y, w, h };
  const remaining = [...weightedItems];

  while (remaining.length > 0 && rect.w > 0 && rect.h > 0) {
    const horizontal = rect.w >= rect.h;
    const sideLength = horizontal ? rect.h : rect.w;
    const row: typeof remaining = [];
    let rowAreas: number[] = [];

    while (remaining.length > 0) {
      const next = remaining[0];
      const nextRowAreas = [...rowAreas, next.area];
      if (
        rowAreas.length === 0 ||
        worstAspectRatio(nextRowAreas, sideLength) <= worstAspectRatio(rowAreas, sideLength)
      ) {
        row.push(next);
        rowAreas = nextRowAreas;
        remaining.shift();
      } else {
        break;
      }
    }

    if (row.length === 0) {
      row.push(remaining.shift()!);
      rowAreas = [row[0].area];
    }

    const placed = layoutRow(
      row.map((entry) => entry.person),
      rowAreas,
      rect,
      horizontal
    );
    result.push(...placed.placed);
    rect = placed.rest;
  }

  return result;
}

function MiniSignalBar({ buildsOn, critiques }: { buildsOn: number; critiques: number }) {
  const total = buildsOn + critiques;
  if (total <= 0) return null;
  return (
    <div className="mt-1 flex h-1.5 w-full overflow-hidden">
      {buildsOn > 0 ? (
        <div style={{ width: `${(buildsOn / total) * 100}%`, background: "#00C851", opacity: 0.8 }} />
      ) : null}
      {critiques > 0 ? (
        <div style={{ width: `${(critiques / total) * 100}%`, background: "#FF3366", opacity: 0.8 }} />
      ) : null}
    </div>
  );
}

async function fetchSubmissionDetail(
  person: PersonSignal,
  taskId: number,
  provider: BrowserProvider | JsonRpcProvider
): Promise<SubmissionDetail> {
  const contract = getJobContract(provider);
  let submission: Partial<SubmissionRecord> = {
    submissionId: person.submissionId,
    agent: person.address,
    deliverableLink: person.deliverableLink,
    submittedAt: person.submittedAt
  };

  try {
    const rawSubmissions = Array.from((await contract.getSubmissions(taskId)) as unknown[]);
    const found = rawSubmissions.find((raw) => {
      if (!isValidSubmission(raw)) return false;
      const parsed = parseSubmission(raw);
      return (
        parsed.submissionId === person.submissionId ||
        parsed.agent.toLowerCase() === person.address.toLowerCase()
      );
    });
    if (found) {
      submission = parseSubmission(found);
    }
  } catch (error) {
    console.warn("[signal-map] getSubmissions detail lookup failed:", error);
  }

  const submissionId = submission.submissionId ?? person.submissionId;
  if (submissionId === undefined || submissionId === null) {
    return { submission, responses: [] };
  }

  const responses: ParsedInteraction[] = [];
  try {
    const responseIds = Array.from((await contract.getSubmissionResponses(BigInt(submissionId))) as Array<bigint | number>);
    for (const responseId of responseIds) {
      try {
        const raw = (await contract.getResponse(responseId)) as Record<string, unknown> & unknown[];
        const responder = String(raw.responder ?? raw[3] ?? "");
        if (!responder || responder.toLowerCase() === ZERO_ADDRESS.toLowerCase()) continue;

        const rawType = Number(raw.responseType ?? raw[4] ?? 0);
        const contentURI = String(raw.contentURI ?? raw[5] ?? "");
        responses.push({
          responseId: BigInt(String(raw.responseId ?? raw[0] ?? responseId)),
          responder,
          responseType: rawType === 0 ? "builds_on" : rawType === 1 ? "critiques" : "alternative",
          contentURI,
          decoded: decodeInteractionContent(contentURI, rawType),
          stakedAmount: BigInt(String(raw.stakedAmount ?? raw[6] ?? 0)),
          createdAt: Number(raw.createdAt ?? raw[7] ?? 0),
          stakeSlashed: Boolean(raw.stakeSlashed ?? raw[8] ?? false),
          stakeReturned: Boolean(raw.stakeReturned ?? raw[9] ?? false),
          interactionRewardClaimed: Boolean(raw.interactionRewardClaimed ?? raw[10] ?? false)
        });
      } catch {
        // Skip malformed response rows.
      }
    }
  } catch (error) {
    console.warn("[signal-map] getSubmissionResponses failed:", error);
  }

  return { submission, responses };
}

function ResponseThread({
  responses,
  isCreator,
  onSlash
}: {
  responses: ParsedInteraction[];
  isCreator: boolean;
  onSlash?: (responseId: bigint) => Promise<void> | void;
}) {
  if (responses.length === 0) {
    return (
      <div className="border-t border-[var(--border)] px-4 py-5 text-center text-[13px] text-[var(--text-muted)]">
        No interactions yet.
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--border)]">
      {responses.map((response, index) => {
        const isBuild = response.responseType === "builds_on";
        const accent =
          response.responseType === "alternative" ? "#F5A623" : isBuild ? "#00FFA3" : "#FF3366";
        const label =
          response.responseType === "alternative" ? "ALTERNATIVE" : isBuild ? "BUILD-ON" : "CRITIQUE";
        const status = response.stakeSlashed
          ? "Slashed"
          : response.stakeReturned
            ? "Stake Returned"
            : response.interactionRewardClaimed
              ? "Reward Claimed"
              : "Active";

        return (
          <div
            key={response.responseId?.toString() ?? index}
            style={{
              padding: "10px 14px",
              background: index % 2 === 0 ? "transparent" : "rgba(255,255,255,0.012)",
              borderLeft: `2px solid ${response.stakeSlashed ? "#3D5A73" : accent}`,
              borderBottom: "1px solid var(--border)",
              opacity: response.stakeSlashed ? 0.58 : 1,
              maxWidth: "100%",
              overflow: "hidden"
            }}
          >
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <span
                style={{
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  color: response.stakeSlashed ? "var(--text-muted)" : accent,
                  padding: "2px 6px",
                  border: `1px solid ${response.stakeSlashed ? "var(--border-bright)" : `${accent}50`}`
                }}
              >
                {response.stakeSlashed ? "SLASHED" : label}
              </span>
              <UserDisplay address={response.responder} showAvatar={true} avatarSize={16} className="min-w-0" />
              <span className="ml-auto shrink-0 font-mono text-[10px] text-[var(--text-muted)]">
                {response.createdAt > 0
                  ? new Date(response.createdAt * 1000).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit"
                    })
                  : ""}
              </span>
            </div>

            <p
              style={{
                fontFamily: "Inter, sans-serif",
                fontSize: 13,
                color: "var(--text-secondary)",
                lineHeight: 1.5,
                margin: "0 0 5px",
                wordBreak: "break-word"
              }}
            >
              {response.decoded.content || response.decoded.summary || "No readable content provided."}
            </p>

            {response.decoded.evidence ? (
              <a
                href={response.decoded.evidence}
                target="_blank"
                rel="noopener noreferrer"
                className="mb-2 inline-block max-w-full break-all font-mono text-[11px] text-[var(--arc)]"
              >
                View evidence {"\u2197"}
              </a>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-[var(--text-muted)]">
              <span>{(Number(response.stakedAmount) / 1e6).toFixed(3)} USDC staked</span>
              <span>{"\u00b7"}</span>
              <span>{status}</span>
              {isCreator && !response.stakeSlashed && !response.stakeReturned && onSlash ? (
                <button
                  type="button"
                  onClick={() => void onSlash(response.responseId)}
                  className="ml-auto border border-[var(--danger)]/40 px-2 py-1 font-mono text-[9px] tracking-[0.06em] text-[var(--danger)]"
                >
                  SLASH
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PersonBox({
  item,
  isTop,
  isSelected,
  onClick,
  onDoubleClick
}: {
  item: TreemapItem;
  isTop: boolean;
  isSelected: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}) {
  const { person, rect } = item;
  const profile = getProfile(person.address);
  const displayName = profile?.username
    ? profile.username
    : `${person.address.slice(2, 6)}...${person.address.slice(-4)}`;
  const bg = getColor(person.colorRatio);
  const border = getBorderColor(person.colorRatio);
  const textColor = getTextColor(person.colorRatio);
  const isSmall = rect.w < 96 || rect.h < 72;
  const isMicro = rect.w < 56 || rect.h < 40;

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className="absolute overflow-hidden text-left"
      style={{
        left: rect.x + 1,
        top: rect.y + 1,
        width: Math.max(rect.w - 2, 0),
        height: Math.max(rect.h - 2, 0),
        background: bg,
        border: `1px solid ${isSelected ? border : `${border}80`}`,
        boxShadow: isSelected ? `inset 0 0 0 1px ${border}` : "none"
      }}
    >
      {isMicro ? (
        <div className="flex h-full w-full items-center justify-center">
          <span className="font-mono text-[10px] font-bold" style={{ color: textColor }}>
            {person.activityWeight}%
          </span>
        </div>
      ) : isSmall ? (
        <div className="flex h-full flex-col items-center justify-center p-1">
          <span className="font-mono text-sm font-bold leading-none" style={{ color: textColor }}>
            {person.activityWeight}%
          </span>
          <span className="mt-1 truncate font-mono text-[9px]" style={{ color: `${textColor}CC` }}>
            {displayName}
          </span>
        </div>
      ) : (
        <div className="relative flex h-full flex-col p-2">
          {isTop ? (
            <div className="absolute right-1 top-1 text-sm" style={{ color: textColor }}>
              {"\u265B"}
            </div>
          ) : null}
          <div className="mb-1 flex items-center gap-2">
            <div
              className="flex shrink-0 items-center justify-center overflow-hidden rounded-full border"
              style={{
                width: Math.min(28, rect.h * 0.22),
                height: Math.min(28, rect.h * 0.22),
                borderColor: `${border}60`,
                background: `${border}25`
              }}
            >
              {profile?.avatarUrl ? (
                <img
                  src={profile.avatarUrl}
                  alt={displayName}
                  className="h-full w-full object-cover"
                  onError={(event) => {
                    (event.target as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <span className="font-mono text-[10px] font-bold" style={{ color: textColor }}>
                  {person.address.slice(2, 4).toUpperCase()}
                </span>
              )}
            </div>
            <span
              className="truncate font-mono font-semibold"
              style={{ color: textColor, fontSize: Math.min(12, Math.max(9, rect.h * 0.08)) }}
            >
              {displayName}
            </span>
          </div>

          <div
            className="font-heading font-bold leading-none"
            style={{ color: textColor, fontSize: Math.min(34, Math.max(16, rect.h * 0.22)) }}
          >
            {person.activityWeight}%
          </div>

          {rect.h > 90 ? (
            <div className="mt-auto flex gap-2 text-[10px] font-mono">
              {person.buildsOnGiven > 0 ? <span style={{ color: "#00C851" }}>+{person.buildsOnGiven}</span> : null}
              {person.critiquesGiven > 0 ? <span style={{ color: "#FF3366" }}>-{person.critiquesGiven}</span> : null}
              {person.submissionCount > 0 ? <span style={{ color: `${textColor}CC` }}>^{person.submissionCount}</span> : null}
            </div>
          ) : null}

          {rect.h > 112 ? (
            <MiniSignalBar
              buildsOn={person.buildsOnGiven + person.buildsOnReceived}
              critiques={person.critiquesGiven + person.critiquesReceived}
            />
          ) : null}
        </div>
      )}
    </motion.button>
  );
}

function SubmissionDetailPanel({
  person,
  taskId,
  provider,
  isCreator,
  onClose,
  onViewSubmissions,
  onSlashResponse
}: {
  person: PersonSignal;
  taskId?: number;
  provider?: BrowserProvider | JsonRpcProvider | null;
  isCreator: boolean;
  onClose: () => void;
  onViewSubmissions?: (address: string) => void;
  onSlashResponse?: (responseId: bigint) => Promise<void> | void;
}) {
  const [detail, setDetail] = useState<SubmissionDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (!provider || taskId === undefined || person.submissionId === undefined) {
      setDetail({
        submission: {
          submissionId: person.submissionId,
          agent: person.address,
          deliverableLink: person.deliverableLink,
          submittedAt: person.submittedAt
        },
        responses: []
      });
      return () => {
        active = false;
      };
    }

    setLoading(true);
    fetchSubmissionDetail(person, taskId, provider)
      .then((nextDetail) => {
        if (active) setDetail(nextDetail);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [person, provider, taskId]);

  const handleSlash = async (responseId: bigint) => {
    await onSlashResponse?.(responseId);
    if (provider && taskId !== undefined) {
      setLoading(true);
      try {
        setDetail(await fetchSubmissionDetail(person, taskId, provider));
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <motion.div
      initial={{ x: 360, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 360, opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="tile-detail-panel"
      style={{
        position: "fixed",
        right: 0,
        top: 80,
        bottom: 0,
        width: 360,
        maxWidth: "100vw",
        background: "var(--surface)",
        borderLeft: "1px solid var(--border)",
        boxShadow: "-10px 0 30px rgba(0,0,0,0.28)",
        maxHeight: "calc(100vh - 80px)",
        overflowY: "auto",
        zIndex: 60
      }}
    >
      <div style={{ width: 360, maxWidth: "100%", overflowY: "auto" }}>
        <div className="flex items-start justify-between border-b border-[var(--border)] px-4 py-4">
          <div>
            <div className="font-heading text-[15px] font-bold text-[var(--text-primary)]">Submission Detail</div>
            <UserDisplay address={person.address} showAvatar={true} avatarSize={18} className="mt-2" />
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ color: "var(--text-muted)", fontSize: 18, background: "none", border: "none", cursor: "pointer" }}
          >
            {"\u2715"}
          </button>
        </div>

        <div className="border-b border-[var(--border)] px-4 py-4">
          <div className="mb-2 font-mono text-[10px] tracking-[0.1em] text-[var(--text-muted)]">DELIVERABLE</div>
          {detail?.submission?.deliverableLink ? (
            <a
              href={String(detail.submission.deliverableLink)}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all font-mono text-xs text-[var(--arc)]"
            >
              {String(detail.submission.deliverableLink).slice(0, 100)}
              {String(detail.submission.deliverableLink).length > 100 ? "..." : ""} {"\u2197"}
            </a>
          ) : (
            <div className="text-xs text-[var(--text-muted)]">No deliverable link available for this tile.</div>
          )}
          {detail?.submission?.submittedAt ? (
            <div className="mt-2 font-mono text-[10px] text-[var(--text-muted)]">
              Submitted {new Date(Number(detail.submission.submittedAt) * 1000).toLocaleString()}
            </div>
          ) : null}
        </div>

        <div>
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 font-mono text-[10px] tracking-[0.1em] text-[var(--text-muted)]">
            <span>{loading ? "LOADING..." : "INTERACTIONS"}</span>
            <span>{detail?.responses.length ?? 0} total</span>
            {onViewSubmissions ? (
              <button
                type="button"
                className="font-mono text-[10px] text-[var(--arc)]"
                onClick={() => onViewSubmissions(person.address)}
              >
                View list
              </button>
            ) : null}
          </div>

          {loading ? (
            <div className="px-4 py-6 text-center font-mono text-xs text-[var(--text-muted)]">Loading...</div>
          ) : (
            <ResponseThread responses={detail?.responses ?? []} isCreator={isCreator} onSlash={handleSlash} />
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default function SignalMap({
  heatmap,
  loading = false,
  containerWidth,
  containerHeight,
  taskId,
  provider,
  isCreator = false,
  onViewSubmissions,
  onSlashResponse
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState({ w: 640, h: 400 });
  const [selected, setSelected] = useState<PersonSignal | null>(null);

  useEffect(() => {
    if (!wrapRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setMeasured({
        w: Math.max(320, Math.floor(entry.contentRect.width)),
        h: Math.max(320, Math.floor(entry.contentRect.height))
      });
    });
    observer.observe(wrapRef.current);
    return () => observer.disconnect();
  }, []);

  const resolvedHeight = containerHeight ?? measured.h;
  const resolvedWidth = containerWidth ?? measured.w;
  const detailWidth = 0;
  const mapWidth = Math.max(260, resolvedWidth - detailWidth);

  const sortedPeople = useMemo(
    () => [...heatmap.people].sort((a, b) => b.activityWeight - a.activityWeight),
    [heatmap.people]
  );

  const items = useMemo(
    () => squarify(sortedPeople, 0, 0, mapWidth, resolvedHeight),
    [mapWidth, resolvedHeight, sortedPeople]
  );

  const topAddress = sortedPeople[0]?.address.toLowerCase() ?? "";

  if (loading) {
    return (
      <div
        ref={wrapRef}
        className="flex w-full items-center justify-center"
        style={{ minHeight: resolvedHeight, background: "var(--surface)" }}
      >
        <span style={{ color: "var(--text-muted)", fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}>
          Loading signal map...
        </span>
      </div>
    );
  }

  if (!heatmap.people.length) {
    return (
      <div
        ref={wrapRef}
        className="flex w-full flex-col items-center justify-center p-8 text-center"
        style={{ minHeight: resolvedHeight, background: "var(--surface)", border: "1px solid var(--border)" }}
      >
        <div style={{ color: "var(--text-muted)", fontFamily: "JetBrains Mono, monospace", fontSize: 12, marginBottom: 8 }}>
          NO SIGNALS YET
        </div>
        <div style={{ color: "var(--text-muted)", fontSize: 11, maxWidth: 300 }}>
          The signal map activates during the reveal phase when participants begin building on and critiquing finalist
          submissions.
        </div>
      </div>
    );
  }

  return (
    <div className="signal-map-wrapper flex gap-0 overflow-hidden" style={{ height: resolvedHeight }}>
      <div className="flex-1">
        <div
          className="mb-2 flex items-center gap-4 px-1"
          style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "var(--text-muted)" }}
        >
          <div className="flex items-center gap-1.5">
            <div style={{ width: 10, height: 10, background: "#00C851" }} />
            BUILD-ONS
          </div>
          <div className="flex items-center gap-1.5">
            <div style={{ width: 10, height: 10, background: "#CC0033" }} />
            CRITIQUES
          </div>
          <div className="flex items-center gap-1.5">
            <div style={{ width: 10, height: 10, background: "#CC7700" }} />
            MIXED
          </div>
          <span className="ml-auto">
            {heatmap.totalActivity} interactions - {heatmap.people.length} participants
          </span>
        </div>

        <div
          ref={wrapRef}
          className="signal-map-container relative overflow-hidden"
          style={{
            width: mapWidth,
            height: resolvedHeight,
            maxHeight: resolvedHeight,
            background: "var(--surface)",
            border: "1px solid var(--border)"
          }}
        >
          {items.map((item) => (
            <PersonBox
              key={item.person.address.toLowerCase()}
              item={item}
              isTop={item.person.address.toLowerCase() === topAddress}
              isSelected={selected?.address.toLowerCase() === item.person.address.toLowerCase()}
              onClick={() => setSelected(item.person)}
              onDoubleClick={() => setSelected({ ...item.person })}
            />
          ))}
        </div>
      </div>

      <AnimatePresence>
        {selected ? (
          <SubmissionDetailPanel
            person={selected}
            taskId={taskId}
            provider={provider}
            isCreator={isCreator}
            onClose={() => setSelected(null)}
            onViewSubmissions={onViewSubmissions}
            onSlashResponse={onSlashResponse}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
