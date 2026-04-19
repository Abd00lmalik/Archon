"use client";

import { useEffect, useState } from "react";
import { getProfile, UserProfile } from "@/lib/user-profiles";

interface UserDisplayProps {
  address: string;
  showAvatar?: boolean;
  avatarSize?: number;
  className?: string;
}

export function UserDisplay({
  address,
  showAvatar = false,
  avatarSize = 24,
  className = ""
}: UserDisplayProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    if (!address) return;
    const sync = () => setProfile(getProfile(address));
    sync();
    const timer = window.setInterval(sync, 2000);
    return () => window.clearInterval(timer);
  }, [address]);

  const displayName = profile?.username ? profile.username : `${address.slice(0, 6)}...${address.slice(-4)}`;

  if (showAvatar) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <div
          className="flex shrink-0 items-center justify-center overflow-hidden border border-[var(--border)]"
          style={{ width: avatarSize, height: avatarSize }}
        >
          {profile?.avatarUrl ? (
            <img src={profile.avatarUrl} alt={displayName} className="h-full w-full object-cover" />
          ) : (
            <span
              className="font-mono font-bold"
              style={{
                fontSize: Math.max(8, Math.floor(avatarSize * 0.35)),
                color: "var(--arc)"
              }}
            >
              {address.slice(2, 4).toUpperCase()}
            </span>
          )}
        </div>
        <span className="truncate font-mono text-xs">{displayName}</span>
      </div>
    );
  }

  return <span className={`font-mono text-xs ${className}`}>{displayName}</span>;
}

