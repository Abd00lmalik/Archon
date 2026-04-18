"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SignalResponse, SubmissionSignal, TaskSignalMap } from "@/lib/signal-map";

interface Props {
  signalMap: TaskSignalMap;
  onSubmissionClick: (submission: SubmissionSignal) => void;
  loading?: boolean;
}

function interpolateColor(ratio: number): string {
  if (ratio >= 0.8) return "#00FFA3";
  if (ratio >= 0.6) return "#52C41A";
  if (ratio >= 0.4) return "#F5A623";
  if (ratio >= 0.2) return "#FF6B35";
  return "#FF3366";
}

function SubmissionBox({
  submission,
  onClick,
  isSelected
}: {
  submission: SubmissionSignal;
  onClick: () => void;
  isSelected: boolean;
}) {
  const color = interpolateColor(submission.colorRatio);
  const size = Math.max(80, Math.min(200, 80 + submission.interactionWeight * 1.2));

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.05, zIndex: 10 }}
      transition={{ duration: 0.25 }}
      onClick={onClick}
      className="relative flex-shrink-0 cursor-pointer"
      style={{ width: `${size}px`, height: `${size}px` }}
    >
      <div
        className="flex h-full w-full flex-col items-center justify-center border-2 p-2 transition-all duration-200"
        style={{
          background: `${color}12`,
          borderColor: isSelected ? color : `${color}60`,
          boxShadow: isSelected ? `0 0 20px ${color}40` : "none"
        }}
      >
        <div
          className="text-center font-mono font-bold leading-none"
          style={{
            fontSize: `${Math.max(14, size * 0.18)}px`,
            color
          }}
        >
          {submission.interactionWeight}%
        </div>

        <div className="mt-2 flex items-center gap-2">
          <span className="text-[10px] font-mono" style={{ color: "#00FFA3" }}>
            +{submission.buildsOnCount}
          </span>
          <span className="text-[10px] font-mono" style={{ color: "#FF3366" }}>
            -{submission.critiquesCount}
          </span>
        </div>

        <div
          className="mt-1 w-full truncate text-center text-[9px] font-mono opacity-60"
          style={{ color }}
        >
          {submission.agent.slice(0, 6)}...{submission.agent.slice(-4)}
        </div>
      </div>

      {submission.isSelected ? (
        <div
          className="absolute -right-2 -top-2 border px-1.5 py-0.5 text-[10px] font-mono font-bold"
          style={{ background: "#F5A62320", borderColor: "#F5A623", color: "#F5A623" }}
        >
          WIN
        </div>
      ) : null}
    </motion.div>
  );
}

function ResponseChat({ responses }: { responses: SignalResponse[] }) {
  return (
    <div className="space-y-3">
      {responses.map((response) => {
        const isBuildOn = response.responseType === "builds_on";
        const color = isBuildOn ? "#00FFA3" : "#FF3366";
        const label = isBuildOn ? "BUILD-ON" : "CRITIQUE";

        return (
          <div
            key={response.responseId}
            className="border p-3"
            style={{
              borderColor: `${color}40`,
              background: `${color}08`
            }}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-mono font-bold tracking-wider" style={{ color }}>
                {label}
              </span>
              {response.stakeSlashed ? (
                <span
                  className="border px-1 text-[9px] font-mono"
                  style={{ color: "var(--danger)", borderColor: "var(--danger)" }}
                >
                  SLASHED
                </span>
              ) : null}
            </div>
            <div className="mb-2 text-xs font-mono text-[var(--text-secondary)]">
              From: {response.responder.slice(0, 8)}...{response.responder.slice(-6)}
            </div>
            {response.contentURI ? (
              <a
                href={response.contentURI}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-mono"
                style={{ color: "var(--arc)" }}
              >
                View response ↗
              </a>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default function SignalMap({ signalMap, onSubmissionClick, loading = false }: Props) {
  const [selected, setSelected] = useState<SubmissionSignal | null>(null);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center font-mono text-sm text-[var(--text-muted)]">
        Loading signal map...
      </div>
    );
  }

  if (signalMap.submissions.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center p-8 text-center">
        <div className="mb-2 font-mono text-sm text-[var(--text-muted)]">NO INTERACTIONS YET</div>
        <div className="max-w-xs text-xs text-[var(--text-muted)]">
          The signal map shows submissions that have received critiques or build-ons. Interactions open during the reveal phase.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[400px] gap-6">
      <div className="flex-1">
        <div className="mb-4 flex items-center gap-4 text-xs font-mono text-[var(--text-muted)]">
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3" style={{ background: "#00FFA3" }} />
            BUILD-ONS
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3" style={{ background: "#FF3366" }} />
            CRITIQUES
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3" style={{ background: "#F5A623" }} />
            MIXED
          </div>
          <span className="ml-auto">{signalMap.totalInteractions} total interactions</span>
        </div>

        <div className="flex flex-wrap gap-4">
          {signalMap.submissions.map((submission) => (
            <SubmissionBox
              key={submission.submissionId}
              submission={submission}
              isSelected={selected?.submissionId === submission.submissionId}
              onClick={() => {
                setSelected(submission);
                onSubmissionClick(submission);
              }}
            />
          ))}
        </div>
      </div>

      <AnimatePresence>
        {selected ? (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="w-80 shrink-0 overflow-y-auto border border-[var(--border)] bg-[var(--surface)]"
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] p-4">
              <div className="section-header mb-0">SUBMISSION SIGNALS</div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 p-4">
              <div>
                <div className="label">SUBMITTER</div>
                <div className="text-data text-xs">{selected.agent}</div>
              </div>

              <div>
                <div className="label">DELIVERABLE</div>
                <a
                  href={selected.deliverableLink}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-xs font-mono text-[var(--arc)] hover:underline"
                >
                  {selected.deliverableLink.slice(0, 60)}... ↗
                </a>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="border border-[var(--border)] p-2 text-center">
                  <div className="text-lg font-mono font-bold" style={{ color: "#00FFA3" }}>
                    {selected.buildsOnCount}
                  </div>
                  <div className="mt-0.5 text-[9px] font-mono text-[var(--text-muted)]">BUILD-ONS</div>
                </div>
                <div className="border border-[var(--border)] p-2 text-center">
                  <div className="text-lg font-mono font-bold" style={{ color: "#FF3366" }}>
                    {selected.critiquesCount}
                  </div>
                  <div className="mt-0.5 text-[9px] font-mono text-[var(--text-muted)]">CRITIQUES</div>
                </div>
                <div className="border border-[var(--border)] p-2 text-center">
                  <div className="text-lg font-mono font-bold text-[var(--arc)]">{selected.interactionWeight}%</div>
                  <div className="mt-0.5 text-[9px] font-mono text-[var(--text-muted)]">SHARE</div>
                </div>
              </div>

              <div>
                <div className="section-header">INTERACTIONS</div>
                {selected.responses.length === 0 ? (
                  <div className="text-xs text-[var(--text-muted)]">No interactions</div>
                ) : (
                  <ResponseChat responses={selected.responses} />
                )}
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

