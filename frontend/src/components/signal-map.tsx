"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { PersonSignal, TaskHeatmap } from "@/lib/signal-map";
import { UserDisplay } from "@/components/ui/user-display";
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

interface Props {
  heatmap: TaskHeatmap;
  loading?: boolean;
  containerWidth?: number;
  containerHeight?: number;
  onViewSubmissions?: (address: string) => void;
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

function PersonBox({
  item,
  isTop,
  isSelected,
  onClick
}: {
  item: TreemapItem;
  isTop: boolean;
  isSelected: boolean;
  onClick: () => void;
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

export default function SignalMap({
  heatmap,
  loading = false,
  containerWidth,
  containerHeight,
  onViewSubmissions
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
  const detailWidth = selected ? 260 : 0;
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
        style={{ minHeight: resolvedHeight, background: "#020608" }}
      >
        <span style={{ color: "#3D5A73", fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}>
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
        style={{ minHeight: resolvedHeight, background: "#020608", border: "1px solid #162334" }}
      >
        <div style={{ color: "#3D5A73", fontFamily: "JetBrains Mono, monospace", fontSize: 12, marginBottom: 8 }}>
          NO SIGNALS YET
        </div>
        <div style={{ color: "#3D5A73", fontSize: 11, maxWidth: 300 }}>
          The signal map activates during the reveal phase when participants begin building on and critiquing finalist
          submissions.
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-0">
      <div className="flex-1">
        <div
          className="mb-2 flex items-center gap-4 px-1"
          style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "#3D5A73" }}
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
          className="relative overflow-hidden"
          style={{
            width: mapWidth,
            height: resolvedHeight,
            background: "#020608",
            border: "1px solid #162334"
          }}
        >
          {items.map((item) => (
            <PersonBox
              key={item.person.address.toLowerCase()}
              item={item}
              isTop={item.person.address.toLowerCase() === topAddress}
              isSelected={selected?.address.toLowerCase() === item.person.address.toLowerCase()}
              onClick={() =>
                setSelected((previous) => {
                  if (previous?.address.toLowerCase() === item.person.address.toLowerCase()) {
                    onViewSubmissions?.(item.person.address);
                    return previous;
                  }
                  return item.person;
                })
              }
            />
          ))}
        </div>
      </div>

      <AnimatePresence>
        {selected ? (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 260, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="shrink-0 overflow-hidden"
            style={{
              background: "#0B1520",
              borderTop: "1px solid #162334",
              borderRight: "1px solid #162334",
              borderBottom: "1px solid #162334",
              marginTop: 22
            }}
          >
            <div className="p-4" style={{ width: 260 }}>
              <div className="mb-4 flex items-center justify-between">
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: "JetBrains Mono, monospace",
                    color: "#3D5A73",
                    fontWeight: 700,
                    letterSpacing: "0.1em"
                  }}
                >
                  PARTICIPANT
                </span>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  style={{ color: "#3D5A73", fontSize: 14 }}
                >
                  {"\u2715"}
                </button>
              </div>

              <UserDisplay address={selected.address} showAvatar={true} avatarSize={40} className="mb-3" />
              <div
                className="mb-4 break-all"
                style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "#3D5A73" }}
              >
                {selected.address}
              </div>

              {[
                {
                  label: "ACTIVITY WEIGHT",
                  value: `${selected.activityWeight}%`,
                  color: getTextColor(selected.colorRatio)
                },
                { label: "SUBMISSIONS", value: selected.submissionCount, color: "#00E5FF" },
                { label: "BUILDS GIVEN", value: selected.buildsOnGiven, color: "#00C851" },
                { label: "BUILDS RECEIVED", value: selected.buildsOnReceived, color: "#00C851" },
                { label: "CRITIQUES GIVEN", value: selected.critiquesGiven, color: "#CC0033" },
                { label: "CRITIQUES REC.", value: selected.critiquesReceived, color: "#CC0033" }
              ].map((stat) => (
                <div key={stat.label} className="mb-2 flex items-center justify-between">
                  <span
                    style={{
                      fontFamily: "JetBrains Mono, monospace",
                      fontSize: 9,
                      color: "#3D5A73",
                      letterSpacing: "0.08em"
                    }}
                  >
                    {stat.label}
                  </span>
                  <span
                    style={{
                      fontFamily: "JetBrains Mono, monospace",
                      fontSize: 12,
                      fontWeight: 700,
                      color: String(stat.color)
                    }}
                  >
                    {stat.value}
                  </span>
                </div>
              ))}

              <button
                type="button"
                className="btn-ghost mt-4 w-full py-2 text-[10px]"
                onClick={() => onViewSubmissions?.(selected.address)}
              >
                View submissions by this participant
              </button>
              <div className="mt-2 text-[9px] font-mono text-[#3D5A73]">
                Tip: click the same tile again to jump directly to their submissions.
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

