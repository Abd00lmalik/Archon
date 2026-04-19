"use client";

import Link from "next/link";
import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CredentialCard } from "@/components/credential-card";
import {
  CredentialRecord,
  expectedChainId,
  fetchCredentialsForAgent,
  getReadProvider
} from "@/lib/contracts";
import { generateDID } from "@/lib/did";
import {
  calculateWeightedScore,
  getNextTier,
  getPointsToNextTier,
  getReputationTier,
  getScoreBreakdown,
  getSourceLabel
} from "@/lib/reputation";
import { getProfile, saveProfile, UserProfile } from "@/lib/user-profiles";
import { useWallet } from "@/lib/wallet-context";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "job", label: "Tasks" },
  { key: "github", label: "GitHub" },
  { key: "agent_task", label: "Agent Tasks" },
  { key: "community", label: "Community" },
  { key: "peer_attestation", label: "Peer" },
  { key: "dao_governance", label: "Governance" }
] as const;

function normalizeSource(sourceType: string) {
  const normalized = sourceType.toLowerCase().trim();
  if (normalized.startsWith("github")) return "github";
  if (normalized.startsWith("community")) return "community";
  return normalized;
}

function ReputationOdometer({ score }: { score: number }) {
  const [displayed, setDisplayed] = useState(0);
  useEffect(() => {
    const duration = 1200;
    const steps = 48;
    let step = 0;
    const timer = window.setInterval(() => {
      step += 1;
      setDisplayed(Math.min(Math.round((score * step) / steps), score));
      if (step >= steps) window.clearInterval(timer);
    }, duration / steps);
    return () => window.clearInterval(timer);
  }, [score]);
  return (
    <div className="font-heading text-[56px] font-bold leading-none md:text-[72px]" style={{ color: "var(--arc)" }}>
      {displayed.toLocaleString()}
    </div>
  );
}

function ProfileEditPanel({
  address,
  onSave
}: {
  address: string;
  onSave: () => void;
}) {
  const existing = getProfile(address);
  const [username, setUsername] = useState(existing?.username ?? "");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(existing?.avatarUrl ?? null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      alert("Please select an image file");
      return;
    }
    if (file.size > 500_000) {
      alert("Image must be under 500KB. Resize it first.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      setAvatarPreview(String(event.target?.result ?? ""));
    };
    reader.readAsDataURL(file);
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void handleFile(file);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files[0];
    if (file) void handleFile(file);
  };

  const handleSave = () => {
    saveProfile({
      address,
      username: username.trim().slice(0, 32) || "Anonymous",
      avatarUrl: avatarPreview ?? "",
      updatedAt: Date.now()
    });
    onSave();
  };

  return (
    <div className="panel space-y-5">
      <div className="section-header">EDIT PROFILE</div>

      <div>
        <div className="label mb-2">PROFILE PICTURE</div>
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden border-2 border-[var(--border)] bg-[var(--elevated)]">
            {avatarPreview ? (
              <img src={avatarPreview} alt="Preview" className="h-full w-full object-cover" />
            ) : (
              <span className="font-mono text-xl font-bold text-[var(--arc)]">
                {address.slice(2, 4).toUpperCase()}
              </span>
            )}
          </div>

          <div
            className={`flex-1 cursor-pointer border-2 border-dashed p-4 text-center transition-colors ${
              dragOver
                ? "border-[var(--arc)] bg-[var(--arc)]/5"
                : "border-[var(--border-bright)] hover:border-[var(--arc-dim)]"
            }`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="text-xs font-mono text-[var(--text-muted)]">Drop image here or click to upload</div>
            <div className="mt-1 text-[10px] text-[var(--text-muted)]">JPG, PNG, GIF, WEBP · Max 500KB</div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="hidden"
              onChange={handleInputChange}
            />
          </div>

          {avatarPreview ? (
            <button
              type="button"
              onClick={() => setAvatarPreview(null)}
              className="shrink-0 text-xs text-[var(--danger)] hover:underline"
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>

      <div>
        <div className="label">USERNAME</div>
        <input
          type="text"
          className="input-field"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Enter username (max 32 characters)"
          maxLength={32}
        />
        <div className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">
          Shown on submissions, signal map, and your public profile.
          {username ? ` Preview: ${username}` : ""}
        </div>
      </div>

      <div className="flex gap-3">
        <button type="button" className="btn-primary flex-1" onClick={handleSave}>
          Save Profile
        </button>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { account, chainId, browserProvider, connect } = useWallet();
  const [addressFromQuery, setAddressFromQuery] = useState<string | null>(null);
  const profileAddress = addressFromQuery ?? account ?? "";
  const isOwnProfile = Boolean(account && profileAddress && account.toLowerCase() === profileAddress.toLowerCase());

  const [credentials, setCredentials] = useState<CredentialRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeFilter, setActiveFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const loadCredentials = useCallback(async () => {
    if (!profileAddress) {
      setCredentials([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const list = await fetchCredentialsForAgent(profileAddress);
      setCredentials(list);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load credentials.");
    } finally {
      setLoading(false);
    }
  }, [profileAddress]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setAddressFromQuery(params.get("address"));
  }, []);

  useEffect(() => {
    void loadCredentials();
  }, [loadCredentials]);

  useEffect(() => {
    if (!profileAddress) {
      setProfile(null);
      return;
    }
    setProfile(getProfile(profileAddress));
  }, [profileAddress, editOpen]);

  const refreshProfile = () => {
    setProfile(getProfile(profileAddress));
    setEditOpen(false);
  };

  const profileChainId = chainId ?? expectedChainId;
  const did = profileAddress ? generateDID(profileAddress, profileChainId) : "";
  const score = useMemo(() => calculateWeightedScore(credentials), [credentials]);
  const tier = useMemo(() => getReputationTier(score), [score]);
  const nextTier = useMemo(() => getNextTier(score), [score]);
  const pointsToNextTier = useMemo(() => getPointsToNextTier(score), [score]);
  const scoreBreakdown = useMemo(() => getScoreBreakdown(credentials), [credentials]);

  const filteredCredentials = useMemo(() => {
    if (activeFilter === "all") return credentials;
    return credentials.filter((credential) => normalizeSource(credential.sourceType) === activeFilter);
  }, [activeFilter, credentials]);

  return (
    <section className="page-container space-y-6">
      <div className="panel grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 overflow-hidden border-2 border-[var(--border)]">
              {profile?.avatarUrl ? (
                <img src={profile.avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[var(--elevated)] font-mono text-xl font-bold text-[var(--arc)]">
                  {profileAddress ? profileAddress.slice(2, 4).toUpperCase() : "--"}
                </div>
              )}
            </div>

            <div className="flex-1">
              <div className="font-heading text-lg font-semibold">{profile?.username || "Anonymous"}</div>
              <div className="text-data text-xs text-[var(--arc)]">{profileAddress || "Wallet not connected"}</div>
              <p className="mono mt-1 text-xs text-[var(--text-muted)]">DID: {did || "-"}</p>
              <div className="badge badge-agent mt-2">{tier}</div>
            </div>

            <div className="flex gap-2">
              {isOwnProfile ? (
                <button
                  type="button"
                  className="btn-ghost px-4 py-2 text-xs"
                  onClick={() => setEditOpen((open) => !open)}
                >
                  {editOpen ? "Close Editor" : "Edit Profile"}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="panel-elevated">
          <ReputationOdometer score={score} />
          <p className="mt-2 text-xs uppercase tracking-[0.15em] text-[var(--text-muted)]">Reputation score</p>
          <div className="mt-4 h-2 bg-[var(--void)]">
            <div className="h-full bg-[var(--arc)]" style={{ width: `${Math.min((score / 2000) * 100, 100)}%` }} />
          </div>
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            {pointsToNextTier > 0 ? `${pointsToNextTier} points to ${nextTier}` : "Top tier reached"}
          </p>
        </div>
      </div>

      {isOwnProfile && editOpen && profileAddress ? (
        <ProfileEditPanel address={profileAddress} onSave={refreshProfile} />
      ) : null}

      {!account && !addressFromQuery ? (
        <div className="panel text-sm text-[var(--text-secondary)]">
          Wallet not connected.
          <button type="button" onClick={() => void connect()} className="btn-primary ml-2">
            Connect wallet
          </button>
        </div>
      ) : null}

      {error ? <div className="panel border border-[var(--danger)] text-sm text-[var(--danger)]">{error}</div> : null}

      <div className="grid gap-6 xl:grid-cols-[30%_40%_30%]">
        <div className="panel space-y-3">
          <div className="section-header">Score Breakdown</div>
          {Object.entries(scoreBreakdown).map(([sourceType, value]) => (
            <div key={sourceType} className="flex items-center justify-between border-b border-[var(--border)] pb-2 text-sm">
              <span className="text-[var(--text-secondary)]">{getSourceLabel(sourceType)}</span>
              <span className="mono text-[var(--arc)]">{value} pts</span>
            </div>
          ))}
          {Object.keys(scoreBreakdown).length === 0 ? <p className="text-sm text-[var(--text-secondary)]">No data yet.</p> : null}
        </div>

        <div className="panel space-y-4">
          <div className="section-header">Credential Timeline</div>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => setActiveFilter(filter.key)}
                className={activeFilter === filter.key ? "btn-primary px-2 py-1 text-[10px]" : "btn-ghost px-2 py-1 text-[10px]"}
              >
                {filter.label}
              </button>
            ))}
          </div>
          {loading ? <p className="text-sm text-[var(--text-secondary)]">Loading credentials...</p> : null}
          <div className="grid gap-4 md:grid-cols-2">
            {filteredCredentials.map((credential) => (
              <CredentialCard
                key={credential.credentialId}
                credential={credential}
                provider={browserProvider ?? getReadProvider()}
              />
            ))}
          </div>
          {!loading && filteredCredentials.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">No credentials yet.</p> : null}
        </div>

        <div className="panel space-y-4">
          <div className="section-header">Verification & Share</div>
          {profileAddress ? (
            <>
              <p className="text-sm text-[var(--text-secondary)]">Public verification link</p>
              <div className="mono break-all text-xs text-[var(--arc)]">
                {typeof window !== "undefined" ? `${window.location.origin}/verify/${profileAddress}` : `/verify/${profileAddress}`}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/verify/${profileAddress}`)}
                >
                  Copy
                </button>
                <Link href={`/verify/${profileAddress}`} target="_blank" className="btn-primary">
                  Open
                </Link>
              </div>
            </>
          ) : (
            <p className="text-sm text-[var(--text-secondary)]">Connect wallet to generate your link.</p>
          )}
        </div>
      </div>
    </section>
  );
}

