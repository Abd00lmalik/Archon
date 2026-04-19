"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PersonSignal, TaskHeatmap } from "@/lib/signal-map";
import { UserDisplay } from "@/components/ui/user-display";

interface TreemapNode {
  person: PersonSignal;
  x: number;
  y: number;
  width: number;
  height: number;
}

function computeTreemap(
  people: PersonSignal[],
  containerWidth: number,
  containerHeight: number
): TreemapNode[] {
  if (!people.length || containerWidth <= 0 || containerHeight <= 0) return [];
  const total = people.reduce((sum, person) => sum + Math.max(0, person.activityWeight), 0);
  if (total <= 0) return [];

  const nodes: TreemapNode[] = [];
  const sorted = [...people].sort((a, b) => b.activityWeight - a.activityWeight);
  let remainingX = 0;
  let remainingY = 0;
  let remainingWidth = containerWidth;
  let remainingHeight = containerHeight;

  for (let i = 0; i < sorted.length; i += 1) {
    const person = sorted[i];
    const fraction = person.activityWeight / total;
    if (i === sorted.length - 1) {
      nodes.push({ person, x: remainingX, y: remainingY, width: remainingWidth, height: remainingHeight });
      break;
    }

    if (remainingWidth >= remainingHeight) {
      const width = Math.max(24, Math.round(remainingWidth * fraction * 2));
      const clamped = Math.min(width, remainingWidth);
      nodes.push({ person, x: remainingX, y: remainingY, width: clamped, height: remainingHeight });
      remainingX += clamped;
      remainingWidth -= clamped;
    } else {
      const height = Math.max(24, Math.round(remainingHeight * fraction * 2));
      const clamped = Math.min(height, remainingHeight);
      nodes.push({ person, x: remainingX, y: remainingY, width: remainingWidth, height: clamped });
      remainingY += clamped;
      remainingHeight -= clamped;
    }
  }

  return nodes;
}

function interpolateColor(ratio: number): string {
  if (ratio >= 0.75) return "#00C851";
  if (ratio >= 0.55) return "#00875A";
  if (ratio >= 0.45) return "#CC7700";
  if (ratio >= 0.25) return "#CC4400";
  return "#CC0033";
}

function MiniSparkline({
  buildsOn,
  critiques,
  width
}: {
  buildsOn: number;
  critiques: number;
  width: number;
}) {
  const total = buildsOn + critiques;
  if (total === 0) return null;
  const greenWidth = (buildsOn / total) * width;
  const redWidth = (critiques / total) * width;
  return (
    <div style={{ width, height: 8, display: "flex" }}>
      {buildsOn > 0 ? <div style={{ width: greenWidth, height: 8, background: "#00C851", opacity: 0.7 }} /> : null}
      {critiques > 0 ? <div style={{ width: redWidth, height: 8, background: "#CC0033", opacity: 0.7 }} /> : null}
    </div>
  );
}

function HeatmapBox({
  node,
  isSelected,
  isTop,
  onClick
}: {
  node: TreemapNode;
  isSelected: boolean;
  isTop: boolean;
  onClick: () => void;
}) {
  const { person, x, y, width, height } = node;
  const color = interpolateColor(person.colorRatio);
  const displayName = person.username ?? person.address.slice(2, 6);
  const isTiny = width < 80 || height < 60;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ zIndex: 20, scale: 1.02 }}
      transition={{ duration: 0.2 }}
      onClick={onClick}
      className="absolute cursor-pointer select-none"
      style={{
        left: x + 1,
        top: y + 1,
        width: width - 2,
        height: height - 2,
        background: `${color}18`,
        border: `1px solid ${isSelected ? color : `${color}60`}`,
        boxShadow: isSelected ? `0 0 0 2px ${color}, inset 0 0 20px ${color}15` : "none",
        overflow: "hidden"
      }}
    >
      {isTop ? (
        <div className="absolute right-1 top-1 text-[10px]" style={{ color }}>
          ♛
        </div>
      ) : null}

      {isTiny ? (
        <div className="flex h-full w-full items-center justify-center">
          <span className="font-mono text-[10px] font-bold" style={{ color }}>
            {person.activityWeight}%
          </span>
        </div>
      ) : (
        <div className="flex h-full flex-col p-2">
          <div className="mb-1 flex items-center gap-2">
            <div
              className="flex shrink-0 items-center justify-center overflow-hidden border"
              style={{
                width: Math.min(32, Math.floor(height * 0.25)),
                height: Math.min(32, Math.floor(height * 0.25)),
                borderColor: `${color}80`,
                background: `${color}20`
              }}
            >
              {person.avatarUrl ? (
                <img src={person.avatarUrl} alt={displayName} className="h-full w-full object-cover" />
              ) : (
                <span className="font-mono font-bold" style={{ fontSize: Math.min(12, Math.floor(height * 0.1)), color }}>
                  {person.address.slice(2, 4).toUpperCase()}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <div
                className="truncate font-mono font-bold"
                style={{ fontSize: Math.min(12, Math.max(9, Math.floor(height * 0.08))), color }}
              >
                {displayName}
              </div>
            </div>
          </div>

          <div
            className="font-mono font-bold leading-none"
            style={{ fontSize: Math.min(28, Math.max(14, Math.floor(height * 0.2))), color }}
          >
            {person.activityWeight}%
          </div>

          {height > 80 ? (
            <div className="mt-1 flex gap-2">
              {person.buildsOnGiven > 0 ? (
                <span className="text-[10px] font-mono" style={{ color: "#00C851" }}>
                  +{person.buildsOnGiven}
                </span>
              ) : null}
              {person.critiquesGiven > 0 ? (
                <span className="text-[10px] font-mono" style={{ color: "#CC0033" }}>
                  -{person.critiquesGiven}
                </span>
              ) : null}
            </div>
          ) : null}

          {height > 100 ? (
            <div className="mt-auto pt-1">
              <MiniSparkline
                buildsOn={person.buildsOnGiven + person.buildsOnReceived}
                critiques={person.critiquesGiven + person.critiquesReceived}
                width={Math.max(10, width - 20)}
              />
            </div>
          ) : null}
        </div>
      )}
    </motion.div>
  );
}

interface Props {
  heatmap: TaskHeatmap;
  loading?: boolean;
  containerWidth?: number;
  containerHeight?: number;
}

export default function SignalMap({
  heatmap,
  loading = false,
  containerWidth = 500,
  containerHeight = 400
}: Props) {
  const [selected, setSelected] = useState<PersonSignal | null>(null);

  const treemapNodes = useMemo(
    () => computeTreemap(heatmap.people, containerWidth, containerHeight),
    [heatmap.people, containerWidth, containerHeight]
  );

  const topWeight = useMemo(
    () => heatmap.people.reduce((max, person) => Math.max(max, person.activityWeight), 0),
    [heatmap.people]
  );

  if (loading) {
    return (
      <div
        className="flex items-center justify-center font-mono text-xs text-[var(--text-muted)]"
        style={{ width: containerWidth, height: containerHeight }}
      >
        Loading signal map...
      </div>
    );
  }

  if (!heatmap.people.length) {
    return (
      <div
        className="flex flex-col items-center justify-center p-8 text-center"
        style={{ width: containerWidth, height: containerHeight }}
      >
        <div className="mb-2 font-mono text-xs text-[var(--text-muted)]">NO SIGNALS YET</div>
        <div className="max-w-xs text-[10px] text-[var(--text-muted)]">
          Interactions appear here during the reveal phase. Critiques show red, build-ons show green.
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-4">
      <div>
        <div className="mb-2 flex items-center gap-4 text-[10px] font-mono text-[var(--text-muted)]">
          <div className="flex items-center gap-1">
            <div className="h-2 w-2" style={{ background: "#00C851" }} />
            BUILD-ONS
          </div>
          <div className="flex items-center gap-1">
            <div className="h-2 w-2" style={{ background: "#CC0033" }} />
            CRITIQUES
          </div>
          <span className="ml-auto">
            {heatmap.totalActivity} interactions · {heatmap.people.length} participants
          </span>
        </div>

        <div
          className="relative border border-[var(--border)] bg-[var(--void)]"
          style={{ width: containerWidth, height: containerHeight }}
        >
          {treemapNodes.map((node) => (
            <HeatmapBox
              key={node.person.address}
              node={node}
              isSelected={selected?.address.toLowerCase() === node.person.address.toLowerCase()}
              isTop={node.person.activityWeight === topWeight && topWeight > 0}
              onClick={() =>
                setSelected((current) =>
                  current?.address.toLowerCase() === node.person.address.toLowerCase() ? null : node.person
                )
              }
            />
          ))}
        </div>
      </div>

      <AnimatePresence>
        {selected ? (
          <motion.div
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 260 }}
            exit={{ opacity: 0, width: 0 }}
            className="shrink-0 overflow-hidden border border-[var(--border)] bg-[var(--surface)]"
            style={{ height: containerHeight + 26 }}
          >
            <div className="h-full space-y-4 overflow-y-auto p-4">
              <div className="mb-4 flex items-center justify-between">
                <div className="section-header mb-0 text-[10px]">PARTICIPANT</div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  ✕
                </button>
              </div>

              <UserDisplay address={selected.address} showAvatar={true} avatarSize={40} className="mb-4" />
              <div className="mb-3 break-all text-[10px] font-mono text-[var(--text-muted)]">{selected.address}</div>

              <div className="mb-4">
                <span
                  className="badge text-[10px]"
                  style={{
                    color: interpolateColor(selected.colorRatio),
                    borderColor: `${interpolateColor(selected.colorRatio)}60`,
                    background: `${interpolateColor(selected.colorRatio)}10`
                  }}
                >
                  {selected.role.toUpperCase()}
                </span>
              </div>

              <div className="space-y-2">
                {[
                  { label: "ACTIVITY WEIGHT", value: `${selected.activityWeight}%`, color: interpolateColor(selected.colorRatio) },
                  { label: "SUBMISSIONS", value: selected.submissionCount, color: "var(--arc)" },
                  { label: "BUILDS GIVEN", value: selected.buildsOnGiven, color: "#00C851" },
                  { label: "BUILDS RECEIVED", value: selected.buildsOnReceived, color: "#00C851" },
                  { label: "CRITIQUES GIVEN", value: selected.critiquesGiven, color: "#CC0033" },
                  { label: "CRITIQUES REC.", value: selected.critiquesReceived, color: "#CC0033" }
                ].map((stat) => (
                  <div key={stat.label} className="flex items-center justify-between text-[10px]">
                    <span className="font-mono text-[var(--text-muted)]">{stat.label}</span>
                    <span className="font-mono font-bold" style={{ color: stat.color }}>
                      {stat.value}
                    </span>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => window.open(`/profile?address=${selected.address}`, "_blank")}
                className="btn-ghost mt-4 w-full py-2 text-[10px]"
              >
                View Full Profile ↗
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
