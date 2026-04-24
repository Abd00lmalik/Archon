"use client";

import { BrowserProvider, JsonRpcProvider } from "ethers";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { UserDisplay } from "@/components/ui/user-display";
import { PersonSignal, SignalResponse, TaskHeatmap } from "@/lib/signal-map";

type Rect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type TreemapItem = {
  tile: PersonSignal;
  rect: Rect;
};

interface Props {
  heatmap: TaskHeatmap;
  loading?: boolean;
  containerWidth?: number;
  containerHeight?: number;
  taskId?: number;
  sourceId?: string;
  provider?: BrowserProvider | JsonRpcProvider | null;
  isCreator?: boolean;
  onViewSubmissions?: (address: string) => void;
  onSlashResponse?: (responseId: bigint) => Promise<void> | void;
}

const MIN_TILE_LABEL = 60;
const MIN_TILE_PERCENT = 80;

function formatAddress(address: string): string {
  if (!address) return "unknown";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function tileBg(color: string): string {
  if (color.includes("var(")) {
    return "rgba(14,22,33,0.92)";
  }
  return color;
}

function metricColor(type: SignalResponse["responseType"]): string {
  if (type === "builds_on") return "var(--arc-green, #22c55e)";
  if (type === "critique") return "var(--pulse, #ef4444)";
  return "var(--amber, #f59e0b)";
}

function prettyType(type: SignalResponse["responseType"]): string {
  if (type === "builds_on") return "BUILDS ON";
  if (type === "critique") return "CRITIQUE";
  return "OTHER";
}

function toDisplayDate(ts: number): string {
  if (!ts) return "";
  const millis = ts > 1_000_000_000_000 ? ts : ts * 1000;
  return new Date(millis).toLocaleString();
}

function worst(row: number[], shortSide: number): number {
  if (row.length === 0 || shortSide <= 0) return Number.POSITIVE_INFINITY;
  const sum = row.reduce((acc, n) => acc + n, 0);
  const max = Math.max(...row);
  const min = Math.min(...row);
  const s2 = shortSide * shortSide;
  return Math.max((s2 * max) / (sum * sum), (sum * sum) / (s2 * min));
}

function layoutRow(
  rowIndices: number[],
  rowAreas: number[],
  x: number,
  y: number,
  w: number,
  h: number,
  horizontal: boolean
): { rects: Rect[]; nextX: number; nextY: number; nextW: number; nextH: number } {
  const rowArea = rowAreas.reduce((acc, n) => acc + n, 0);
  const rects: Rect[] = [];

  if (horizontal) {
    const rowW = h > 0 ? rowArea / h : 0;
    let cy = y;
    for (let i = 0; i < rowAreas.length; i += 1) {
      const itemH = rowW > 0 ? rowAreas[i] / rowW : 0;
      rects[rowIndices[i]] = { x, y: cy, w: rowW, h: itemH };
      cy += itemH;
    }
    return { rects, nextX: x + rowW, nextY: y, nextW: w - rowW, nextH: h };
  }

  const rowH = w > 0 ? rowArea / w : 0;
  let cx = x;
  for (let i = 0; i < rowAreas.length; i += 1) {
    const itemW = rowH > 0 ? rowAreas[i] / rowH : 0;
    rects[rowIndices[i]] = { x: cx, y, w: itemW, h: rowH };
    cx += itemW;
  }
  return { rects, nextX: x, nextY: y + rowH, nextW: w, nextH: h - rowH };
}

function squarify(items: Array<{ weight: number }>, x: number, y: number, w: number, h: number): Rect[] {
  if (items.length === 0 || w <= 0 || h <= 0) return [];
  if (items.length === 1) return [{ x, y, w, h }];

  const totalWeight = items.reduce((acc, item) => acc + Math.max(item.weight, 0.0001), 0);
  const totalArea = w * h;
  const areas = items.map((item) => (Math.max(item.weight, 0.0001) / totalWeight) * totalArea);
  const rects: Rect[] = new Array(items.length);

  const remaining = areas.map((area, idx) => ({ area, idx }));
  let cx = x;
  let cy = y;
  let cw = w;
  let ch = h;

  while (remaining.length > 0 && cw > 0 && ch > 0) {
    const horizontal = cw >= ch;
    const shortSide = horizontal ? ch : cw;
    const rowAreas: number[] = [];
    const rowIndices: number[] = [];

    while (remaining.length > 0) {
      const next = remaining[0];
      const attempt = [...rowAreas, next.area];
      if (rowAreas.length === 0 || worst(attempt, shortSide) <= worst(rowAreas, shortSide)) {
        rowAreas.push(next.area);
        rowIndices.push(next.idx);
        remaining.shift();
      } else {
        break;
      }
    }

    const placed = layoutRow(rowIndices, rowAreas, cx, cy, cw, ch, horizontal);
    for (const idx of rowIndices) {
      rects[idx] = placed.rects[idx];
    }

    cx = placed.nextX;
    cy = placed.nextY;
    cw = Math.max(0, placed.nextW);
    ch = Math.max(0, placed.nextH);
  }

  if (rects.length > 0) {
    const last = rects[rects.length - 1];
    if (last) {
      last.w = Math.max(1, x + w - last.x);
      last.h = Math.max(1, y + h - last.y);
    }
  }

  return rects.map((rect) => ({
    x: Math.max(0, rect.x),
    y: Math.max(0, rect.y),
    w: Math.max(1, rect.w),
    h: Math.max(1, rect.h)
  }));
}

function ResponseItem({
  response,
  isCreator,
  onSlash
}: {
  response: SignalResponse;
  isCreator: boolean;
  onSlash?: (responseId: bigint) => Promise<void> | void;
}) {
  const accent = metricColor(response.responseType);
  return (
    <div
      style={{
        borderBottom: "1px solid var(--border)",
        borderLeft: `2px solid ${response.stakeSlashed ? "var(--text-muted)" : accent}`,
        padding: "10px 12px",
        opacity: response.stakeSlashed ? 0.6 : 1
      }}
    >
      <div className="mb-1.5 flex items-center gap-2 text-[10px]" style={{ fontFamily: "JetBrains Mono, monospace" }}>
        <span
          style={{
            border: `1px solid ${accent}`,
            color: response.stakeSlashed ? "var(--text-muted)" : accent,
            padding: "2px 6px",
            letterSpacing: "0.06em",
            fontWeight: 700
          }}
        >
          {prettyType(response.responseType)}
        </span>
        <span style={{ color: "var(--text-muted)" }}>Responded by</span>
        <UserDisplay address={response.responder} showAvatar={true} avatarSize={16} className="min-w-0" />
      </div>

      <div style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.5, wordBreak: "break-word" }}>
        {response.decoded?.content || response.decoded?.summary || "No readable content provided."}
      </div>

      {response.decoded?.evidence ? (
        <a
          href={response.decoded.evidence}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block break-all text-[11px]"
          style={{ color: "var(--arc)" }}
        >
          Evidence ?
        </a>
      ) : null}

      <div
        className="mt-2 flex flex-wrap items-center gap-2 text-[10px]"
        style={{ color: "var(--text-muted)", fontFamily: "JetBrains Mono, monospace" }}
      >
        <span>Stake: {(Number(response.stakedAmount) / 1e6).toFixed(3)} USDC</span>
        <span>·</span>
        <span>Slashed: {response.stakeSlashed ? "yes" : "no"}</span>
        {response.timestamp > 0 ? (
          <>
            <span>·</span>
            <span>{toDisplayDate(response.timestamp)}</span>
          </>
        ) : null}
        {isCreator && !response.stakeSlashed && onSlash ? (
          <button
            type="button"
            className="ml-auto border px-2 py-1 text-[10px]"
            style={{ borderColor: "var(--pulse, #ef4444)", color: "var(--pulse, #ef4444)" }}
            onClick={() => void onSlash(BigInt(response.responseId))}
          >
            Slash
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SubmissionDetailPanel({
  tile,
  isCreator,
  onClose,
  onViewSubmissions,
  onSlashResponse,
  updateSelected
}: {
  tile: PersonSignal;
  isCreator: boolean;
  onClose: () => void;
  onViewSubmissions?: (address: string) => void;
  onSlashResponse?: (responseId: bigint) => Promise<void> | void;
  updateSelected: (updater: (current: PersonSignal) => PersonSignal) => void;
}) {
  const handleSlash = async (responseId: bigint) => {
    await onSlashResponse?.(responseId);
    updateSelected((current) => ({
      ...current,
      responses: current.responses.map((r) =>
        r.responseId === responseId.toString() ? { ...r, stakeSlashed: true } : r
      )
    }));
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
        overflowY: "auto",
        zIndex: 60
      }}
    >
      <div className="flex items-start justify-between border-b border-[var(--border)] px-4 py-4">
        <div>
          <div className="font-heading text-[15px] font-bold text-[var(--text-primary)]">Submission Detail</div>
          <div className="mt-2 text-[12px] text-[var(--text-secondary)]">
            Submission by <UserDisplay address={tile.agent} showAvatar={true} avatarSize={16} className="inline-flex" />
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{ color: "var(--text-muted)", fontSize: 18, background: "none", border: "none", cursor: "pointer" }}
        >
          ?
        </button>
      </div>

      <div className="border-b border-[var(--border)] px-4 py-4 text-[12px]">
        <div className="mb-2 font-mono text-[10px] tracking-[0.1em] text-[var(--text-muted)]">DELIVERABLE</div>
        {tile.deliverableLink ? (
          <a href={tile.deliverableLink} target="_blank" rel="noopener noreferrer" className="break-all" style={{ color: "var(--arc)" }}>
            {tile.deliverableLink}
          </a>
        ) : (
          <div className="text-[var(--text-muted)]">No deliverable link available for this submission.</div>
        )}
        <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-[var(--text-muted)]" style={{ fontFamily: "JetBrains Mono, monospace" }}>
          <span>Submission ID: {tile.submissionId}</span>
          <span>Total received: {tile.totalReceived}</span>
          <span>Build-ons: {tile.buildOnsReceived}</span>
          <span>Critiques: {tile.critiquesReceived}</span>
        </div>
      </div>

      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 font-mono text-[10px] tracking-[0.1em] text-[var(--text-muted)]">
        <span>INTERACTIONS RECEIVED</span>
        <span>{tile.responses.length}</span>
        {onViewSubmissions ? (
          <button type="button" className="text-[var(--arc)]" onClick={() => onViewSubmissions(tile.agent)}>
            View list
          </button>
        ) : null}
      </div>

      {tile.responses.length === 0 ? (
        <div className="px-4 py-6 text-center text-[13px] text-[var(--text-muted)]">No interactions received yet.</div>
      ) : (
        <div>
          {tile.responses.map((response) => (
            <ResponseItem
              key={response.responseId}
              response={response}
              isCreator={isCreator}
              onSlash={onSlashResponse ? handleSlash : undefined}
            />
          ))}
        </div>
      )}
    </motion.div>
  );
}

function TileBox({
  item,
  isSelected,
  onClick,
  onDoubleClick
}: {
  item: TreemapItem;
  isSelected: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}) {
  const { tile, rect } = item;
  const showLabel = rect.w >= MIN_TILE_LABEL && rect.h >= MIN_TILE_LABEL;
  const showPercent = rect.w >= MIN_TILE_PERCENT && rect.h >= 40;
  const title = tile.username || formatAddress(tile.agent);
  const color = tile.color;

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className="absolute overflow-hidden text-left"
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: Math.max(rect.w - 1, 1),
        height: Math.max(rect.h - 1, 1),
        overflow: "hidden",
        boxSizing: "border-box",
        background: tileBg(color),
        border: `1px solid ${isSelected ? color : "rgba(122,155,181,0.35)"}`,
        boxShadow: isSelected ? `inset 0 0 0 1px ${color}` : "none",
        padding: 8,
        cursor: "pointer"
      }}
      title={`${title} (${tile.percentage.toFixed(1)}%)`}
    >
      <div style={{ color, fontFamily: "JetBrains Mono, monospace", fontSize: 10, letterSpacing: "0.06em" }}>
        {prettyType(tile.critiquesReceived > tile.buildOnsReceived ? "critique" : tile.buildOnsReceived > tile.critiquesReceived ? "builds_on" : tile.totalReceived === 0 ? "other" : "other")}
      </div>

      {showLabel ? (
        <div style={{ marginTop: 6, color: "var(--text-primary)", fontFamily: "JetBrains Mono, monospace", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {title}
        </div>
      ) : null}

      {showPercent ? (
        <div style={{ marginTop: 6, color: "var(--text-primary)", fontFamily: "JetBrains Mono, monospace", fontSize: 20, fontWeight: 700 }}>
          {tile.percentage.toFixed(1)}%
        </div>
      ) : null}

      {showLabel ? (
        <div style={{ marginTop: 6, color: "var(--text-muted)", fontFamily: "JetBrains Mono, monospace", fontSize: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          +{tile.buildOnsReceived} / -{tile.critiquesReceived}
        </div>
      ) : null}
    </motion.button>
  );
}

export default function SignalMap({
  heatmap,
  loading = false,
  containerWidth,
  containerHeight,
  isCreator = false,
  onViewSubmissions,
  onSlashResponse
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 600, h: 360 });
  const [selected, setSelected] = useState<PersonSignal | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setDims({ w: Math.floor(rect.width), h: Math.floor(rect.height) });
    }
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || entry.contentRect.width <= 0 || entry.contentRect.height <= 0) return;
      setDims({
        w: Math.floor(entry.contentRect.width),
        h: Math.floor(entry.contentRect.height)
      });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setSelected((current) => {
      if (!current) return current;
      return heatmap.people.find((tile) => tile.submissionId === current.submissionId) ?? null;
    });
  }, [heatmap.people]);

  const resolvedHeight = Math.max(360, containerHeight ?? dims.h);
  const resolvedWidth = Math.max(260, containerWidth ?? dims.w);

  const sortedTiles = useMemo(
    () => [...heatmap.people].sort((a, b) => b.weight - a.weight),
    [heatmap.people]
  );

  const treemap = useMemo(() => {
    const rects = squarify(sortedTiles.map((tile) => ({ weight: tile.weight })), 0, 0, resolvedWidth, resolvedHeight);
    return sortedTiles.map((tile, idx) => ({ tile, rect: rects[idx] }));
  }, [resolvedHeight, resolvedWidth, sortedTiles]);

  if (loading) {
    return (
      <div ref={containerRef} className="flex w-full items-center justify-center" style={{ minHeight: resolvedHeight }}>
        <span style={{ color: "var(--text-muted)", fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}>
          Loading signal map...
        </span>
      </div>
    );
  }

  if (!heatmap.people.length) {
    return (
      <div
        ref={containerRef}
        className="flex w-full flex-col items-center justify-center p-8 text-center"
        style={{ minHeight: resolvedHeight, background: "var(--surface)", border: "1px solid var(--border)" }}
      >
        <div style={{ color: "var(--text-muted)", fontFamily: "JetBrains Mono, monospace", fontSize: 12, marginBottom: 8 }}>
          NO SIGNALS YET
        </div>
        <div style={{ color: "var(--text-muted)", fontSize: 11, maxWidth: 320 }}>
          The signal map activates during reveal phase when participants build on and critique finalist submissions.
        </div>
      </div>
    );
  }

  return (
    <div className="signal-map-wrapper flex overflow-hidden" style={{ height: resolvedHeight, minHeight: 360 }}>
      <div className="flex-1">
        <div
          className="mb-2 flex items-center gap-4 px-1"
          style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "var(--text-muted)" }}
        >
          <div className="flex items-center gap-1.5">
            <div style={{ width: 10, height: 10, background: "var(--arc-green, #22c55e)" }} />
            BUILDS ON
          </div>
          <div className="flex items-center gap-1.5">
            <div style={{ width: 10, height: 10, background: "var(--pulse, #ef4444)" }} />
            CRITIQUE
          </div>
          <div className="flex items-center gap-1.5">
            <div style={{ width: 10, height: 10, background: "var(--amber, #f59e0b)" }} />
            MIXED
          </div>
          <span className="ml-auto">{heatmap.totalActivity} interactions · {heatmap.people.length} submissions</span>
        </div>

        <div
          ref={containerRef}
          className="signal-map-container relative overflow-hidden"
          style={{
            width: resolvedWidth,
            height: resolvedHeight,
            minHeight: 360,
            background: "var(--surface)",
            border: "1px solid var(--border)"
          }}
        >
          {treemap.map((item) => (
            <TileBox
              key={item.tile.submissionId}
              item={item}
              isSelected={selected?.submissionId === item.tile.submissionId}
              onClick={() => setSelected(item.tile)}
              onDoubleClick={() => setSelected({ ...item.tile })}
            />
          ))}
        </div>
      </div>

      <AnimatePresence>
        {selected ? (
          <SubmissionDetailPanel
            tile={selected}
            isCreator={isCreator}
            onClose={() => setSelected(null)}
            onViewSubmissions={onViewSubmissions}
            onSlashResponse={onSlashResponse}
            updateSelected={(updater) => {
              setSelected((current) => (current ? updater(current) : current));
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}


