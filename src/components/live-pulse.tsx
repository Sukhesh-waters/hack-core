"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { formatUpdatedAgo, isRecentlyUpdated } from "@/lib/live-status";

/**
 * The "live" visual grammar the 2026-08-17 audit found missing everywhere:
 * even on surfaces where the broadcast pipeline is fully correct, nothing
 * on screen told a user it was live rather than a stale page load. Drop
 * this next to any header on a real-time surface.
 */
export function LivePulse({ lastSignalAt }: { lastSignalAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const recent = isRecentlyUpdated(lastSignalAt, now);
  const label = formatUpdatedAgo(lastSignalAt, now);

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/70">
      <span className="relative flex size-1.5" aria-hidden>
        {recent ? (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-teal opacity-75" />
        ) : null}
        <span
          className={cn(
            "relative inline-flex size-1.5 rounded-full",
            recent ? "bg-brand-teal" : "bg-muted-foreground/40",
          )}
        />
      </span>
      {label || "live"}
    </span>
  );
}
