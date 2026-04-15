"use client";

import { motion } from "framer-motion";

type LiveEvent = {
  id: string;
  timestamp: string;
  icon?: string;
  text: string;
  meta?: string;
};

type Props = {
  events: LiveEvent[];
  terminal?: boolean;
};

export function LiveFeed({ events, terminal = false }: Props) {
  return (
    <div className={terminal ? "terminal h-[300px] overflow-y-auto" : "panel h-[300px] overflow-y-auto"}>
      {events.length === 0 ? (
        <p className={terminal ? "text-[#004400] mono" : "text-[var(--text-secondary)] text-sm"}>No live events yet.</p>
      ) : (
        <div className="space-y-1">
          {events.map((eventItem) => (
            <motion.div
              key={eventItem.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              className={terminal ? "flex gap-3 py-1 border-b border-[#0A1A0A] mono text-xs" : "flex items-start gap-3 py-2 border-b border-[var(--border)] text-xs"}
            >
              <span className={terminal ? "text-[#004400] shrink-0" : "text-[var(--text-muted)] mono shrink-0"}>{eventItem.timestamp}</span>
              {eventItem.icon ? <span className={terminal ? "text-[#00AA00]" : "text-[var(--arc)]"}>{eventItem.icon}</span> : null}
              <span className={terminal ? "text-[#00FF41] flex-1" : "text-[var(--text-primary)] flex-1"}>{eventItem.text}</span>
              {eventItem.meta ? (
                <span className={terminal ? "text-[#00AA00] shrink-0" : "text-[var(--text-secondary)] shrink-0"}>{eventItem.meta}</span>
              ) : null}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
