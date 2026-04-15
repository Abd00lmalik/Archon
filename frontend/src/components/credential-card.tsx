"use client";

import { useMemo, useState } from "react";
import { ethers } from "ethers";
import { CredentialRecord, getReadProvider, shortAddress, verifyCredentialOnChain } from "@/lib/contracts";
import { IconArc, IconCheck, IconCommunity, IconGovernance, IconRobot, IconTask, IconWarning } from "@/lib/icons";

type VerificationState = "idle" | "loading" | "verified" | "missing" | "error";

type SourceTheme = {
  border: string;
  accent: string;
  bg: string;
  glow: string;
  label: string;
};

const SOURCE_THEMES: Record<string, SourceTheme> = {
  task: { border: "#00E5FF", accent: "#00E5FF", bg: "#08131e", glow: "0 0 30px rgba(0,229,255,0.25)", label: "Task" },
  agent_task: { border: "#BF00FF", accent: "#BF00FF", bg: "#0d0518", glow: "0 0 30px rgba(191,0,255,0.25)", label: "Agentic" },
  community: { border: "#00FFA3", accent: "#00FFA3", bg: "#071911", glow: "0 0 30px rgba(0,255,163,0.25)", label: "Community" },
  peer_attestation: { border: "#FF6B35", accent: "#FF6B35", bg: "#1a0d07", glow: "0 0 30px rgba(255,107,53,0.25)", label: "Peer" },
  dao_governance: { border: "#F5A623", accent: "#F5A623", bg: "#1a1306", glow: "0 0 30px rgba(245,166,35,0.25)", label: "Governance" },
  milestone: { border: "#7A9BB5", accent: "#7A9BB5", bg: "#0f1b26", glow: "0 0 30px rgba(122,155,181,0.22)", label: "Milestone" }
};

function normalizeSource(sourceType: string) {
  const normalized = sourceType.toLowerCase().trim();
  if (normalized === "job") return "task";
  if (normalized.startsWith("agent_task")) return "agent_task";
  if (normalized.startsWith("community")) return "community";
  if (normalized.startsWith("peer_attestation")) return "peer_attestation";
  if (normalized.startsWith("dao_governance")) return "dao_governance";
  if (normalized.startsWith("milestone")) return "milestone";
  return "task";
}

function sourceIcon(sourceType: string) {
  if (sourceType === "task") return <IconTask className="h-10 w-10" />;
  if (sourceType === "agent_task") return <IconRobot className="h-10 w-10" />;
  if (sourceType === "community") return <IconCommunity className="h-10 w-10" />;
  if (sourceType === "dao_governance") return <IconGovernance className="h-10 w-10" />;
  return <IconArc className="h-10 w-10" />;
}

function formatDate(unix: number) {
  if (!unix) return "-";
  return new Date(unix * 1000).toLocaleDateString();
}

export function CredentialCard({ credential, provider }: { credential: CredentialRecord; provider?: ethers.Provider | null }) {
  const [verification, setVerification] = useState<VerificationState>("idle");
  const [showModal, setShowModal] = useState(false);

  const normalizedSource = normalizeSource(credential.sourceType);
  const theme = SOURCE_THEMES[normalizedSource] ?? SOURCE_THEMES.task;

  const title = useMemo(() => {
    if (!credential.metadata) return `Task #${credential.activityId}`;
    return String(credential.metadata.title || credential.metadata.description || `Task #${credential.activityId}`);
  }, [credential]);

  const verifyOnChain = async () => {
    setVerification("loading");
    try {
      const exists = await verifyCredentialOnChain(
        credential.agent,
        credential.activityId,
        credential.sourceType,
        provider ?? getReadProvider()
      );
      setVerification(exists ? "verified" : "missing");
    } catch {
      setVerification("error");
    }
  };

  return (
    <>
      <article
        className="credential-nft group mx-auto w-[240px] cursor-pointer border"
        style={{ borderColor: theme.border, background: theme.bg, boxShadow: theme.glow }}
      >
        <div className="relative flex h-[130px] items-center justify-center border-b" style={{ borderColor: `${theme.border}44` }}>
          <div className="absolute left-2 top-2 text-[10px] text-[var(--text-muted)]">ARCHON</div>
          <div className="absolute right-2 top-2 mono text-[10px] text-[var(--text-muted)]">#{String(credential.credentialId).padStart(4, "0")}</div>
          <div style={{ color: theme.accent }}>{sourceIcon(normalizedSource)}</div>
        </div>

        <div className="p-3">
          <div className="mb-2 inline-flex border px-2 py-1 text-[10px] uppercase tracking-wider" style={{ borderColor: `${theme.border}66`, color: theme.accent }}>
            {theme.label}
          </div>
          <h3 className="line-clamp-2 font-heading text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
          <p className="mt-1 text-[11px] text-[var(--text-secondary)]">Verified Credential</p>

          <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-[var(--text-secondary)]">
            <div>
              <div className="text-[var(--text-muted)]">Issued</div>
              <div>{formatDate(credential.issuedAt)}</div>
            </div>
            <div>
              <div className="text-[var(--text-muted)]">Weight</div>
              <div className="mono text-[var(--gold)]">+{credential.weight} pts</div>
            </div>
            <div>
              <div className="text-[var(--text-muted)]">Network</div>
              <div>Arc Testnet</div>
            </div>
            <div>
              <div className="text-[var(--text-muted)]">Chain</div>
              <div className="mono">5042002</div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-2">
            <span className="mono text-[10px] text-[var(--text-muted)]">{shortAddress(credential.agent)}</span>
            <span className="mono text-[10px] text-[var(--text-data)]">ERC-8004</span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 opacity-0 transition group-hover:opacity-100">
            <button onClick={() => void verifyOnChain()} className="btn-ghost px-2 py-1 text-[10px]" type="button">
              {verification === "loading" ? "..." : "Verify"}
            </button>
            <button onClick={() => setShowModal(true)} className="btn-primary px-2 py-1 text-[10px]" type="button">
              Certificate
            </button>
          </div>

          {verification !== "idle" && verification !== "loading" ? (
            <div className="mt-2 flex items-center gap-1 text-[10px]" style={{ color: verification === "verified" ? "var(--pulse)" : "var(--danger)" }}>
              {verification === "verified" ? <IconCheck className="h-3 w-3" /> : <IconWarning className="h-3 w-3" />}
              {verification === "verified" ? "Verified" : "Not verified"}
            </div>
          ) : null}
        </div>
      </article>

      {showModal ? (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/80 p-4" onClick={() => setShowModal(false)}>
          <div className="panel max-w-[650px]" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-heading text-lg">Certificate View</h3>
              <button className="btn-ghost" onClick={() => setShowModal(false)} type="button">
                Close
              </button>
            </div>
            <div className="flex justify-center">
              <article className="credential-nft w-[420px] border" style={{ borderColor: theme.border, background: theme.bg, boxShadow: theme.glow }}>
                <div className="p-6 text-center">
                  <div className="mx-auto mb-4 w-fit" style={{ color: theme.accent }}>{sourceIcon(normalizedSource)}</div>
                  <h4 className="font-heading text-2xl">{title}</h4>
                  <p className="mt-2 text-sm text-[var(--text-secondary)]">{theme.label} credential on Arc Testnet</p>
                  <div className="mt-6 grid gap-2 text-left text-sm">
                    <div>Credential ID: #{credential.credentialId}</div>
                    <div>Weight: +{credential.weight} pts</div>
                    <div>Wallet: {credential.agent}</div>
                  </div>
                </div>
              </article>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/verify/${credential.agent}`)}
              >
                Share
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
