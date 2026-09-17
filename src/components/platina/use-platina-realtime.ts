"use client";

import { useEffect, useRef, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  platinaChannelName,
  type PlatinaRealtimeScope,
} from "@/lib/platina/realtime";

let client: SupabaseClient | null = null;

function supabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  client ??= createClient(url, key, {
    realtime: { params: { eventsPerSecond: 5 } },
  });
  return client;
}

export type PlatinaLiveState = "live" | "reconnecting" | "polling";

export const PLATINA_POLL_INTERVAL_MS = 20_000;

/**
 * Platina live invalidation. Subscribes to the opaque topic token issued by
 * the membership-checked layout — the raw workspace id never reaches the
 * channel name. Polling runs unconditionally as the documented fallback;
 * a Realtime signal simply makes convergence faster.
 */
export function usePlatinaRealtime({
  topicToken,
  scopes,
  onSignal,
}: {
  topicToken: string | null;
  scopes?: PlatinaRealtimeScope[];
  onSignal: (scope: PlatinaRealtimeScope | "poll") => void;
}): { state: PlatinaLiveState } {
  const [state, setState] = useState<PlatinaLiveState>(
    topicToken ? "reconnecting" : "polling",
  );
  const onSignalRef = useRef(onSignal);
  onSignalRef.current = onSignal;
  const scopesRef = useRef(scopes);
  scopesRef.current = scopes;

  useEffect(() => {
    const sb = topicToken ? supabase() : null;
    if (!sb || !topicToken) {
      setState("polling");
    } else {
      setState("reconnecting");
      const channel = sb.channel(platinaChannelName(topicToken));
      channel
        .on("broadcast", { event: "platina" }, (msg) => {
          const scope = (msg.payload as { scope?: PlatinaRealtimeScope })
            ?.scope;
          if (!scope) return;
          const filter = scopesRef.current;
          if (!filter || filter.length === 0 || filter.includes(scope)) {
            onSignalRef.current(scope);
          }
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") setState("live");
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            setState("reconnecting");
          }
        });
      return () => {
        void sb.removeChannel(channel);
      };
    }
  }, [topicToken]);

  // Polling fallback — always active, whether Realtime is up or not.
  useEffect(() => {
    const interval = setInterval(
      () => onSignalRef.current("poll"),
      PLATINA_POLL_INTERVAL_MS,
    );
    return () => clearInterval(interval);
  }, []);

  return { state };
}
