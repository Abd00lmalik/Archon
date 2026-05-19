"use client";

import { BrowserProvider, JsonRpcProvider } from "ethers";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { UserDisplay } from "@/components/ui/user-display";
import { getTileColor, PersonSignal, SignalResponse, TaskHeatmap } from "@/lib/signal-map";

type Rect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type TreemapNode = {
  person: PersonSignal;
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

function shortAddr(address: string): string {
  if (!address) return "unknown";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function TileAvatar({ address, size }: { address: string; size: number }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    try {
      const profiles = JSON.parse(window.localStorage.getItem("archon_profiles") ?? "{}") as Record<
        string,
        { avatar?: string }
      >;
      const p = profiles[address.toLowerCase()];
      if (p?.avatar) setSrc(p.avatar);
    } catch {
      setSrc(null);
    }
  }, [address]);

  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        style={{ borderRadius: "50%", flexShrink: 0, objectFit: "cover" }}
      />
    );
  }

  const hue = parseInt(address.slice(2, 8), 16) % 360;
  const letter = address.slice(2, 3).toUpperCase();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `hsl(${hue}, 60%, 45%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.45,
        fontWeight: 700,
        color: "#fff",
        flexShrink: 0
      }}
    >
      {letter}
    </div>
  );
}

function worst(row: number[], sideLength: number): number {
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
): { placed: TreemapNode[]; rest: Rect } {
  const totalRowArea = rowAreas.reduce((acc, value) => acc + value, 0);
  const placed: TreemapNode[] = [];

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

function squarify(items: PersonSignal[], x: number, y: number, w: number, h: number): TreemapNode[] {
  if (!items.length || w <= 0 || h <= 0) return [];

  const totalWeight = items.reduce((acc, item) => acc + Math.max(item.weight, 1), 0);
  if (totalWeight <= 0) return [];

  const totalArea = w * h;
  const weightedItems = items.map((item) => ({
    person: item,
    area: (Math.max(item.weight, 1) / totalWeight) * totalArea
  }));

  const result: TreemapNode[] = [];
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
        worst(nextRowAreas, sideLength) <= worst(rowAreas, sideLength)
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

function patchLastNode(nodes: TreemapNode[], containerW: number, containerH: number): TreemapNode[] {
  if (nodes.length === 0) return nodes;
  const patched = nodes.map((node) => ({ ...node, rect: { ...node.rect } }));
  const last = patched[patched.length - 1];
  last.rect.w = containerW - last.rect.x;
  last.rect.h = containerH - last.rect.y;
  return patched;
}

function prettyType(type: SignalResponse["responseType"]): string {
  if (type === "builds_on") return "BUILDS ON";
  if (type === "critique") return "CRITIQUE";
  return "OTHER";
}

function formatTs(ts: number): string {
  if (!ts) return "";
  const millis = ts > 1_000_000_000_000 ? ts : ts * 1000;
  return new Date(millis).toLocaleString();
}

function ResponseThread({
  responses,
  isCreator,
  onSlash
}: {
  responses: SignalResponse[];
  isCreator: boolean;
  onSlash?: (responseId: bigint) => Promise<void> | void;
}) {
  if (responses.length === 0) {
    return (
      <div className="border-t border-[var(--border)] px-4 py-5 text-center text-[13px] text-[var(--text-muted)]">
        No interactions received yet.
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--border)]">
      {responses.map((response, index) => {
        const accent = getTileColor(
          response.responseType === "critique" ? 1 : 0,
          response.responseType === "builds_on" ? 1 : 0
        );
        return (
          <div
            key={response.responseId || index}
            style={{
              padding: "10px 14px",
              background: index % 2 === 0 ? "#0F1116" : "#11151C",
              borderLeft: `2px solid ${response.stakeSlashed ? "#3D5A73" : accent}`,
              borderBottom: "1px solid var(--border)",
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
                  border: `1px solid ${response.stakeSlashed ? "var(--border-bright)" : `${accent}`}`
                }}
              >
                {prettyType(response.responseType)}
              </span>
              <span className="font-mono text-[10px] text-[var(--text-muted)]">Responded by:</span>
              <UserDisplay address={response.responder} showAvatar={true} avatarSize={16} className="min-w-0" />
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
              {response.decoded?.content || response.decoded?.summary || "No readable content provided."}
            </p>

            {response.decoded?.evidence ? (
              <a
                href={response.decoded.evidence}
                target="_blank"
                rel="noopener noreferrer"
                className="mb-2 inline-block max-w-full break-all font-mono text-[11px] text-[var(--arc)]"
              >
                Evidence -&gt;
              </a>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-[var(--text-muted)]">
              <span>{(Number(response.stakedAmount) / 1e6).toFixed(3)} USDC stake</span>
              <span>Slashed: {response.stakeSlashed ? "yes" : "no"}</span>
              {response.timestamp > 0 ? <span>{formatTs(response.timestamp)}</span> : null}
              {isCreator && !response.stakeSlashed && onSlash ? (
                <button
                  type="button"
                  onClick={() => void onSlash(BigInt(response.responseId))}
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

function TileBox({
  node,
  isSelected,
  onClick,
  containerW,
  containerH
}: {
  node: TreemapNode;
  isSelected: boolean;
  onClick: () => void;
  containerW: number;
  containerH: number;
}) {
  const { person, rect } = node;
  const tileColor = getTileColor(person.critiquesReceived, person.buildOnsReceived);
  const displayName = person.username ?? shortAddr(person.agent);

  const clampedRect = {
    x: Math.max(0, rect.x),
    y: Math.max(0, rect.y),
    w: Math.min(rect.w, containerW - rect.x),
    h: Math.min(rect.h, containerH - rect.y),
  };

  const tileW = clampedRect.w;
  const tileH = clampedRect.h;

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: "absolute",
        left: clampedRect.x,
        top: clampedRect.y,
        width: Math.max(clampedRect.w - 1, 1),
        height: Math.max(clampedRect.h - 1, 1),
        boxSizing: "border-box",
        overflow: "hidden",
        border: `1px solid ${isSelected ? "#E8F4FF" : "rgba(232,244,255,0.2)"}`,
        cursor: "pointer",
        padding: 0,
        background: "transparent"
      }}
      title={`${displayName} (${person.percentage.toFixed(1)}%)`}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          padding: "6px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          overflow: "hidden",
          backgroundColor: tileColor,
          cursor: "pointer"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
          <TileAvatar address={person.agent} size={tileW > 120 ? 28 : 20} />
          {tileW > 80 ? (
            <span
              style={{
                fontSize: tileW > 150 ? 11 : 9,
                color: "#E8F4FF",
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: tileW - 50
              }}
            >
              {displayName}
            </span>
          ) : null}
        </div>

        {tileH > 60 ? (
          <div
            style={{
              fontSize: Math.min(tileW, tileH) > 80 ? 20 : 14,
              fontWeight: 700,
              color: "#FFFFFF",
              lineHeight: 1,
              textAlign: "center"
            }}
          >
            {person.percentage.toFixed(1)}%
          </div>
        ) : null}

        {tileH > 80 && tileW > 80 ? (
          <div style={{ display: "flex", gap: 6, fontSize: 9, color: "rgba(255,255,255,0.75)" }}>
            <span>≡ƒö┤ {person.critiquesReceived}</span>
            <span>≡ƒƒó {person.buildOnsReceived}</span>
          </div>
        ) : null}
      </div>
    </button>
  );
}

function DetailPanel({
  selected,
  isCreator,
  onClose,
  onViewSubmissions,
  onSlashResponse,
  setSelected
}: {
  selected: PersonSignal;
  isCreator: boolean;
  onClose: () => void;
  onViewSubmissions?: (address: string) => void;
  onSlashResponse?: (responseId: bigint) => Promise<void> | void;
  setSelected: (updater: (current: PersonSignal) => PersonSignal) => void;
}) {
  const handleSlash = async (responseId: bigint) => {
    await onSlashResponse?.(responseId);
    setSelected((current) => ({
      ...current,
      responses: current.responses.map((row) =>
        row.responseId === responseId.toString() ? { ...row, stakeSlashed: true } : row
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
        maxHeight: "calc(100vh - 80px)",
        overflowY: "auto",
        zIndex: 60
      }}
    >
      <div style={{ width: 360, maxWidth: "100%", overflowY: "auto" }}>
        <div className="flex items-start justify-between border-b border-[var(--border)] px-4 py-4">
          <div>
            <div className="font-heading text-[15px] font-bold text-[var(--text-primary)]">Submission Detail</div>
            <div className="mt-2 text-xs text-[var(--text-muted)]">Submission by:</div>
            <UserDisplay address={selected.agent} showAvatar={true} avatarSize={18} className="mt-1" />
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ color: "var(--text-muted)", fontSize: 18, background: "none", border: "none", cursor: "pointer" }}
          >
            x
          </button>
        </div>

        <div className="border-b border-[var(--border)] px-4 py-4">
          <div className="mb-2 font-mono text-[10px] tracking-[0.1em] text-[var(--text-muted)]">DELIVERABLE</div>
          {selected.deliverableLink ? (
            <a
              href={String(selected.deliverableLink)}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all font-mono text-xs text-[var(--arc)]"
            >
              {String(selected.deliverableLink)}
            </a>
          ) : (
            <div className="text-xs text-[var(--text-muted)]">No deliverable link available for this tile.</div>
          )}
          <div className="mt-2 font-mono text-[10px] text-[var(--text-muted)]">
            Total interactions received: {selected.totalReceived}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 font-mono text-[10px] tracking-[0.1em] text-[var(--text-muted)]">
            <span>RESPONSES ON THIS SUBMISSION</span>
            <span>{selected.responses.length} total</span>
            {onViewSubmissions ? (
              <button
                type="button"
                className="font-mono text-[10px] text-[var(--arc)]"
                onClick={() => onViewSubmissions(selected.agent)}
              >
                View list
              </button>
            ) : null}
          </div>

          <ResponseThread
            responses={selected.responses}
            isCreator={isCreator}
            onSlash={onSlashResponse ? handleSlash : undefined}
          />
        </div>
      </div>
    </motion.div>
  );
}

export default function SignalMap(props: Props) {
  const {
    heatmap,
    loading = false,
    containerWidth,
    containerHeight,
    isCreator = false,
    onViewSubmissions,
    onSlashResponse
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 400 });
  const [selected, setSelected] = useState<PersonSignal | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setDims({ w: Math.floor(rect.width), h: Math.floor(rect.height) });
    }
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e && e.contentRect.width > 0) {
        setDims({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) });
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const resolvedWidth = Math.max(320, containerWidth ?? dims.w);
  const resolvedHeight = Math.max(320, containerHeight ?? 400);

  const sortedPeople = useMemo(
    () => [...heatmap.people].sort((a, b) => b.weight - a.weight),
    [heatmap.people]
  );

  const nodes = useMemo(() => {
    const laidOut = squarify(sortedPeople, 0, 0, resolvedWidth, resolvedHeight);
    return patchLastNode(laidOut, resolvedWidth, resolvedHeight);
  }, [resolvedHeight, resolvedWidth, sortedPeople]);

  useEffect(() => {
    setSelected((current) => {
      if (!current) return current;
      return heatmap.people.find((tile) => tile.submissionId === current.submissionId) ?? null;
    });
  }, [heatmap.people]);

  if (loading) {
    return (
      <div
        ref={containerRef}
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
        ref={containerRef}
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
    <div className="signal-map-wrapper flex gap-0 overflow-hidden" style={{ minHeight: resolvedHeight }}>
      <div className="flex-1">
        <div
          className="mb-2 flex items-center gap-4 px-1"
          style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "var(--text-muted)" }}
        >
          <div className="flex items-center gap-1.5">
            <div style={{ width: 10, height: 10, background: getTileColor(0, 4) }} />
            BUILD-ONS
          </div>
          <div className="flex items-center gap-1.5">
            <div style={{ width: 10, height: 10, background: getTileColor(4, 0) }} />
            CRITIQUES
          </div>
          <div className="flex items-center gap-1.5">
            <div style={{ width: 10, height: 10, background: "#F5A623" }} />
            MIXED
          </div>
          <span className="ml-auto">
            {heatmap.totalActivity} interactions - {heatmap.people.length} submissions
          </span>
        </div>

        <div
          ref={containerRef}
          style={{
            position: "relative",
            width: "100%",
            height: 400,
            minHeight: 280,
            maxHeight: 600,
            backgroundColor: "#0D1117",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          {nodes.map((node) => (
            <TileBox
              key={node.person.submissionId}
              node={node}
              isSelected={selected?.submissionId === node.person.submissionId}
              onClick={() => setSelected(node.person)}
              containerW={resolvedWidth}
              containerH={resolvedHeight}
            />
          ))}
        </div>
      </div>

      <AnimatePresence>
        {selected ? (
          <DetailPanel
            selected={selected}
            isCreator={isCreator}
            onClose={() => setSelected(null)}
            onViewSubmissions={onViewSubmissions}
            onSlashResponse={onSlashResponse}
            setSelected={(updater) => {
              setSelected((current) => (current ? updater(current) : current));
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
