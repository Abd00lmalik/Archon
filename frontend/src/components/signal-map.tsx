"use client";

import { BrowserProvider, JsonRpcProvider } from "ethers";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { UserDisplay } from "@/components/ui/user-display";
import { getTileColor, PersonSignal, SignalResponse, TaskHeatmap } from "@/lib/signal-map";


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

function SignalCard({
  person,
  isSelected,
  onClick
}: {
  person: PersonSignal;
  isSelected: boolean;
  onClick: () => void;
}) {
  const tileColor = getTileColor(person.critiquesReceived, person.buildOnsReceived);
  const displayName = person.username ?? shortAddr(person.agent);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        backgroundColor: tileColor,
        border: `2px solid ${isSelected ? "#FFFFFF" : "transparent"}`,
        boxShadow: isSelected ? "0 0 0 2px var(--arc)" : "none",
        minWidth: 0,
        boxSizing: "border-box"
      }}
      className="relative flex min-h-[140px] w-full flex-col justify-between overflow-hidden rounded-lg p-3 text-left transition-all hover:brightness-110"
      title={`${displayName} (${person.percentage.toFixed(1)}%)`}
    >
      <div className="flex w-full items-center gap-2 overflow-hidden">
        <TileAvatar address={person.agent} size={24} />
        <span
          className="truncate text-xs font-semibold text-[#E8F4FF]"
          style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {displayName}
        </span>
      </div>

      <div className="my-2 flex w-full items-center justify-center">
        <span className="text-3xl font-bold text-white">{person.percentage.toFixed(1)}%</span>
      </div>

      <div className="flex w-full flex-wrap items-center justify-center gap-4 text-[10px] text-white/80">
        <span className="flex items-center gap-1">🔴 {person.critiquesReceived}</span>
        <span className="flex items-center gap-1">🟢 {person.buildOnsReceived}</span>
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

  const resolvedHeight = Math.max(320, containerHeight ?? 400);

  const sortedPeople = useMemo(
    () => [...heatmap.people].sort((a, b) => b.weight - a.weight),
    [heatmap.people]
  );

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
            width: "100%",
            backgroundColor: "#0D1117",
            borderRadius: 8,
            border: "1px solid var(--border)",
            overflowY: "auto",
            maxHeight: 600,
            minHeight: 280,
            padding: 12
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12
            }}
          >
            {sortedPeople.map((person) => (
              <SignalCard
                key={person.submissionId}
                person={person}
                isSelected={selected?.submissionId === person.submissionId}
                onClick={() => setSelected(person)}
              />
            ))}
          </div>
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
