"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ActivityEvent } from "@/lib/activity";
import { UserDisplay } from "@/components/ui/user-display";

const EVENT_STYLES: Record<ActivityEvent["type"], { icon: string; color: string; label: string }> = {
  task_created: { icon: "*", color: "#00E5FF", label: "TASK" },
  task_accepted: { icon: "<>", color: "var(--text-secondary)", label: "ACCEPTED" },
  submission_made: { icon: "^", color: "#00E5FF", label: "SUBMIT" },
  submission_approved: { icon: "v", color: "#00FFA3", label: "APPROVED" },
  response_added: { icon: "->", color: "#FF6B35", label: "RESPONSE" },
  credential_minted: { icon: "[]", color: "#00FFA3", label: "CREDENTIAL" },
  stake_slashed: { icon: "x", color: "#FF3366", label: "SLASHED" },
  agent_joined: { icon: "()", color: "#BF00FF", label: "AGENT" },
  challenge_raised: { icon: "!", color: "#FF6B35", label: "CHALLENGE" },
  reward_claimed: { icon: "$", color: "#F5A623", label: "REWARD" }
};

type Props = {
  events: ActivityEvent[];
  maxVisible?: number;
  terminal?: boolean;
};

export function LiveFeed({ events, maxVisible = 10, terminal = false }: Props) {
  const visible = events.slice(0, Math.min(10, maxVisible));
  const isAddressLike = (value: string) => /^0x[a-fA-F0-9]{40}$/.test(value);

  if (visible.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-4">
        <span className="live-dot" />
        <span className="mono text-xs text-[var(--text-muted)]">Loading recent activity...</span>
      </div>
    );
  }

  return (
    <div className={terminal ? "terminal space-y-0 overflow-hidden" : "space-y-0 overflow-hidden"}>
      <AnimatePresence mode="popLayout" initial={false}>
        {visible.map((eventItem, index) => {
          const style = EVENT_STYLES[eventItem.type] ?? EVENT_STYLES.submission_made;
          const opacity = Math.max(0.3, 1 - index * 0.08);

          return (
            <motion.div
              key={eventItem.id}
              layout
              initial={{ opacity: 0, y: -12, height: 0 }}
              animate={{ opacity, y: 0, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{
                duration: 0.3,
                ease: "easeOut",
                layout: { duration: 0.2 }
              }}
            >
              <div
                className="live-feed-item flex cursor-default items-start gap-3 border-b border-[var(--border)] px-3 py-2.5 transition-colors hover:bg-[var(--elevated)]"
                style={{ opacity }}
              >
                <span className="mono mt-0.5 shrink-0 text-xs font-semibold" style={{ color: style.color }}>
                  {style.icon}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex items-center gap-2">
                    <span className="mono shrink-0 text-[10px] font-bold tracking-wider" style={{ color: style.color }}>
                      {style.label}
                    </span>
                    {eventItem.isAgent ? (
                      <span className="mono border border-[var(--agent-dim)] px-1 text-[9px] text-[var(--agent-primary)]">
                        AGENT
                      </span>
                    ) : null}
                  </div>
                  {isAddressLike(eventItem.actor) ? (
                    <div className="mb-1">
                      <UserDisplay address={eventItem.actor} showAvatar={true} avatarSize={18} className="min-w-0" />
                    </div>
                  ) : null}
                  <p className="max-w-full truncate text-xs leading-snug text-[var(--text-secondary)]">
                    {eventItem.description}
                  </p>
                </div>

                <span className="mono mt-0.5 shrink-0 text-[10px] text-[var(--text-muted)]">{eventItem.timeAgo}</span>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
