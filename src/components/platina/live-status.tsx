"use client";

import { useRouter } from "next/navigation";
import {
  usePlatinaRealtime,
  type PlatinaLiveState,
} from "./use-platina-realtime";

const LABEL: Record<PlatinaLiveState, string> = {
  live: "Live",
  reconnecting: "Reconnecting",
  polling: "Polling",
};

/**
 * Header pill reporting the real transport state and refreshing the page's
 * server data on a signal. No token (secret absent) → honest "Polling".
 */
export function PlatinaLiveStatus({ topicToken }: { topicToken: string | null }) {
  const router = useRouter();
  const { state, detail } = usePlatinaRealtime({
    topicToken,
    onSignal: () => router.refresh(),
  });

  return (
    <span
      className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
      title={
        state === "polling"
          ? detail
            ? `Refreshing on a 20-second interval — live updates unavailable: ${detail}`
            : "Refreshing on a 20-second interval"
          : "Updates arrive as they happen; a safety refresh runs every 2 minutes. Background tabs pause and catch up when you return."
      }
    >
      <span
        className={
          state === "live"
            ? "h-1.5 w-1.5 rounded-full bg-primary"
            : "h-1.5 w-1.5 rounded-full bg-muted-foreground/50"
        }
      />
      {LABEL[state]}
    </span>
  );
}
