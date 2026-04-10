"use client";

import { useMemo, useState } from "react";
import { ethers } from "ethers";
import { CredentialRecord, getReadProvider, shortAddress, verifyCredentialOnChain } from "@/lib/contracts";
import { IconArc, IconCheck, IconCommunity, IconGovernance, IconRobot, IconTask, IconWarning } from "@/lib/icons";

type VerificationState = "idle" | "loading" | "verified" | "missing" | "error";

type SourceTheme = {
  gradient: string;
  border: string;
  glow: string;
  accent: string;
  label: string;
  badge: string;
};

const SOURCE_THEMES: Record<string, SourceTheme> = {
  task: {
    gradient: "from-[#0A1F2E] via-[#145B7D] to-[#0A1F2E]",
    border: "#00FFC8",
    glow: "shadow-[0_0_30px_rgba(0,255,200,0.35)]",
    accent: "#00FFC8",
    label: "Task",
    badge: "bg-[#00FFC8]/15 text-[#00FFC8] border-[#00FFC8]/30"
  },
  agent_task: {
    gradient: "from-[#0D0A2E] via-[#2D1B69] to-[#0D0A2E]",
    border: "#8B5CF6",
    glow: "shadow-[0_0_30px_rgba(139,92,246,0.35)]",
    accent: "#8B5CF6",
    label: "Agentic Task",
    badge: "bg-[#8B5CF6]/15 text-[#8B5CF6] border-[#8B5CF6]/30"
  },
  community: {
    gradient: "from-[#0A1A0A] via-[#1A4D1A] to-[#0A1A0A]",
    border: "#22C55E",
    glow: "shadow-[0_0_30px_rgba(34,197,94,0.35)]",
    accent: "#22C55E",
    label: "Community",
    badge: "bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/30"
  },
  peer_attestation: {
    gradient: "from-[#1A0A1A] via-[#4D1A4D] to-[#1A0A1A]",
    border: "#EC4899",
    glow: "shadow-[0_0_30px_rgba(236,72,153,0.35)]",
    accent: "#EC4899",
    label: "Peer Vouching",
    badge: "bg-[#EC4899]/15 text-[#EC4899] border-[#EC4899]/30"
  },
  dao_governance: {
    gradient: "from-[#0A0A1A] via-[#1A1A4D] to-[#0A0A1A]",
    border: "#6366F1",
    glow: "shadow-[0_0_30px_rgba(99,102,241,0.35)]",
    accent: "#6366F1",
    label: "DAO Governance",
    badge: "bg-[#6366F1]/15 text-[#6366F1] border-[#6366F1]/30"
  },
  milestone: {
    gradient: "from-[#1A1000] via-[#4D3300] to-[#1A1000]",
    border: "#F59E0B",
    glow: "shadow-[0_0_30px_rgba(245,158,11,0.35)]",
    accent: "#F59E0B",
    label: "Milestone",
    badge: "bg-[#F59E0B]/15 text-[#F59E0B] border-[#F59E0B]/30"
  }
};

function normalizeSource(sourceType: string) {
  const normalized = sourceType.toLowerCase().trim();
  if (normalized === "job" || normalized === "task") return "task";
  if (normalized.startsWith("community")) return "community";
  if (normalized.startsWith("agent_task")) return "agent_task";
  if (normalized.startsWith("peer_attestation")) return "peer_attestation";
  if (normalized.startsWith("dao_governance")) return "dao_governance";
  if (normalized.startsWith("milestone")) return "milestone";
  return "task";
}

function getSourceIcon(sourceType: string, className: string) {
  if (sourceType === "task") return <IconTask className={className} />;
  if (sourceType === "agent_task") return <IconRobot className={className} />;
  if (sourceType === "community") return <IconCommunity className={className} />;
  if (sourceType === "dao_governance") return <IconGovernance className={className} />;
  if (sourceType === "peer_attestation") return <IconCheck className={className} />;
  return <IconArc className={className} />;
}

function metadataEntries(credential: CredentialRecord) {
  if (!credential.metadata) return [];
  return Object.entries(credential.metadata).filter(([, value]) => String(value).length > 0);
}

function getCredentialTitle(credential: CredentialRecord) {
  if (!credential.metadata) return `Activity #${credential.activityId}`;
  const titleCandidate = credential.metadata.title || credential.metadata.description;
  if (titleCandidate) return String(titleCandidate);
  return `Activity #${credential.activityId}`;
}

function getCredentialSubtitle(credential: CredentialRecord, theme: SourceTheme) {
  if (!credential.metadata) return `${theme.label} completion credential`;
  if (credential.metadata.platform) return `${theme.label} credential on ${credential.metadata.platform}`;
  if (credential.metadata.category) return `${theme.label}: ${credential.metadata.category}`;
  if (credential.metadata.governorContract) return `${theme.label} participation verified`;
  return `${theme.label} completion credential`;
}

function formatDate(unix: number) {
  if (!unix) return "-";
  return new Date(unix * 1000).toLocaleDateString();
}

function drawCertificatePng(credential: CredentialRecord, theme: SourceTheme) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 1600;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const gradient = ctx.createLinearGradient(0, 0, 1200, 1600);
  gradient.addColorStop(0, "#05060a");
  gradient.addColorStop(0.4, "#101725");
  gradient.addColorStop(1, "#05060a");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 6;
  ctx.strokeRect(60, 60, 1080, 1480);

  ctx.fillStyle = theme.accent;
  ctx.font = "700 48px Inter, sans-serif";
  ctx.fillText("ARCHON VERIFIED CREDENTIAL", 120, 180);

  ctx.fillStyle = "#EAEAF0";
  ctx.font = "700 64px Inter, sans-serif";
  ctx.fillText(getCredentialTitle(credential).slice(0, 32), 120, 290);

  ctx.font = "400 34px Inter, sans-serif";
  ctx.fillStyle = "#A3A9B6";
  ctx.fillText(getCredentialSubtitle(credential, theme).slice(0, 48), 120, 350);

  ctx.fillStyle = "#EAEAF0";
  ctx.font = "500 30px Inter, sans-serif";
  ctx.fillText(`Source: ${theme.label}`, 120, 470);
  ctx.fillText(`Weight: +${credential.weight} pts`, 120, 530);
  ctx.fillText(`Issued: ${formatDate(credential.issuedAt)}`, 120, 590);
  ctx.fillText(`Network: Arc Testnet`, 120, 650);
  ctx.fillText(`Chain ID: 5042002`, 120, 710);
  ctx.fillText(`Wallet: ${credential.agent}`, 120, 770);
  ctx.fillText(`Credential ID: #${credential.credentialId}`, 120, 830);

  const entries = metadataEntries(credential).slice(0, 6);
  let y = 930;
  for (const [key, value] of entries) {
    ctx.fillStyle = "#8FD9FF";
    ctx.font = "600 26px Inter, sans-serif";
    ctx.fillText(`${key}:`, 120, y);
    ctx.fillStyle = "#EAEAF0";
    ctx.font = "400 26px Inter, sans-serif";
    ctx.fillText(String(value).slice(0, 56), 280, y);
    y += 66;
  }

  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = `archon-credential-${credential.credentialId}.png`;
  link.click();
}

function CredentialVisual({
  credential,
  theme,
  normalizedSource,
  large
}: {
  credential: CredentialRecord;
  theme: SourceTheme;
  normalizedSource: string;
  large?: boolean;
}) {
  const title = getCredentialTitle(credential);
  const subtitle = getCredentialSubtitle(credential, theme);
  const entries = metadataEntries(credential).slice(0, 4);
  const widthClass = large ? "w-full max-w-[600px]" : "w-[280px]";
  const heightClass = large ? "h-[740px]" : "h-[380px]";

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-[#0B0D13] transition-all duration-300 ${widthClass} ${heightClass}`}
      style={{ borderColor: theme.border }}
    >
      <div className={`absolute inset-0 opacity-90 bg-gradient-to-br ${theme.gradient}`} />

      <div className="relative z-10 flex h-[40%] flex-col justify-between border-b border-white/10 p-4">
        <div className="flex items-center justify-between text-xs text-[#9CA3AF]">
          <span className="inline-flex items-center gap-1">
            <IconArc className="h-3.5 w-3.5" />
            Archon
          </span>
          <span className="arc-mono">#{String(credential.credentialId).padStart(4, "0")}</span>
        </div>
        <div className="flex justify-center">{getSourceIcon(normalizedSource, "h-12 w-12")}</div>
        <div className={`mx-auto rounded-full border px-3 py-1 text-xs ${theme.badge}`}>{theme.label}</div>
      </div>

      <div className="relative z-10 flex h-[60%] flex-col p-4">
        <p className="text-[10px] uppercase tracking-wide text-[#9CA3AF]">Verified Credential</p>
        <h3 className="mt-2 line-clamp-2 text-base font-semibold text-[#EAEAF0]">{title}</h3>
        <p className="mt-1 line-clamp-2 text-xs text-[#AEB6C4]">{subtitle}</p>

        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-[#C4CBD8]">
            <div className="text-[10px] uppercase tracking-wide text-[#7D8698]">Issued</div>
            <div>{formatDate(credential.issuedAt)}</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-[#C4CBD8]">
            <div className="text-[10px] uppercase tracking-wide text-[#7D8698]">Weight</div>
            <div>+{credential.weight} pts</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-[#C4CBD8]">
            <div className="text-[10px] uppercase tracking-wide text-[#7D8698]">Network</div>
            <div>Arc Testnet</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-[#C4CBD8]">
            <div className="text-[10px] uppercase tracking-wide text-[#7D8698]">Chain ID</div>
            <div>5042002</div>
          </div>
        </div>

        {entries.length > 0 ? (
          <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-2 text-[11px] text-[#AEB6C4]">
            {entries.map(([key, value]) => (
              <div key={key} className="truncate">
                <span className="text-[#EAEAF0]">{key}:</span> {String(value)}
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-auto flex items-center justify-between pt-3 text-[10px] text-[#9CA3AF]">
          <span className="arc-mono">{shortAddress(credential.agent)}</span>
          <span className="rounded-full border border-white/15 px-2 py-0.5">ERC-8004</span>
        </div>
      </div>
    </div>
  );
}

export function CredentialCard({
  credential,
  provider
}: {
  credential: CredentialRecord;
  provider?: ethers.Provider | null;
}) {
  const [verification, setVerification] = useState<VerificationState>("idle");
  const [openCertificate, setOpenCertificate] = useState(false);
  const normalizedSource = normalizeSource(credential.sourceType);
  const theme = SOURCE_THEMES[normalizedSource] ?? SOURCE_THEMES.task;

  const verificationLabel = useMemo(() => {
    if (verification === "verified") return "Verified";
    if (verification === "missing") return "Not found";
    if (verification === "error") return "Verification failed";
    return "";
  }, [verification]);

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

  const copyShareLink = async () => {
    if (typeof window === "undefined") return;
    const link = `${window.location.origin}/verify/${credential.agent}`;
    await navigator.clipboard.writeText(link);
  };

  return (
    <>
      <article
        className={`group relative mx-auto w-[280px] rounded-2xl transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_0_40px_rgba(255,255,255,0.08)] ${theme.glow}`}
      >
        <CredentialVisual credential={credential} theme={theme} normalizedSource={normalizedSource} />

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-3 opacity-0 transition-opacity duration-300 group-hover:pointer-events-auto group-hover:opacity-100">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void verifyOnChain()}
              disabled={verification === "loading"}
              className="rounded-lg border px-2 py-1.5 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-60"
              style={{ borderColor: theme.accent, color: theme.accent, background: "rgba(10,12,20,0.85)" }}
            >
              {verification === "loading" ? "Verifying..." : "Verify On-Chain"}
            </button>
            <button
              type="button"
              onClick={() => setOpenCertificate(true)}
              className="rounded-lg border border-white/25 bg-[#0F1118]/85 px-2 py-1.5 text-xs font-medium text-[#EAEAF0] transition-all hover:border-white/40"
            >
              View Certificate
            </button>
          </div>
        </div>

        {verificationLabel ? (
          <div
            className={`absolute right-2 top-2 z-20 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] ${
              verification === "verified"
                ? "bg-emerald-500/15 text-emerald-200"
                : "bg-rose-500/15 text-rose-200"
            }`}
          >
            {verification === "verified" ? <IconCheck className="h-3 w-3" /> : <IconWarning className="h-3 w-3" />}
            {verificationLabel}
          </div>
        ) : null}
      </article>

      {openCertificate ? (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm"
          onClick={() => setOpenCertificate(false)}
        >
          <div
            className="w-full max-w-[700px] rounded-2xl border border-white/15 bg-[#0D1017] p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[#EAEAF0]">Credential Certificate</h3>
              <button
                type="button"
                onClick={() => setOpenCertificate(false)}
                className="rounded-lg border border-white/15 px-2 py-1 text-xs text-[#9CA3AF] hover:text-[#EAEAF0]"
              >
                Close
              </button>
            </div>

            <div className="flex justify-center">
              <CredentialVisual credential={credential} theme={theme} normalizedSource={normalizedSource} large />
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => drawCertificatePng(credential, theme)}
                className="archon-button-secondary px-3 py-2 text-xs"
              >
                Download as PNG
              </button>
              <button
                type="button"
                onClick={() => void copyShareLink()}
                className="archon-button-primary px-3 py-2 text-xs"
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
