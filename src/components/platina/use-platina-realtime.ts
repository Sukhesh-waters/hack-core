"use client";

import { useEffect, useRef, useState } from "react";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import {
  platinaChannelName,
  type PlatinaRealtimeScope,
} from "@/lib/platina/realtime";
import {
  MAX_SUBSCRIBE_ATTEMPTS,
  nextLiveState,
  type PlatinaLiveState,
} from "@/lib/platina/realtime-state";

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

/**
 * One channel per topic for the whole tab (R6).
 *
 * Two components — or one component whose effect runs twice, which is exactly
 * what React does in development StrictMode — used to create two channels on
 * the same topic. The second join conflicts with the first and comes back
 * CHANNEL_ERROR, so the header pill sat on "Reconnecting" forever while the
 * transport itself was fine. (Verified 2026-09-21: an isolated subscribe to
 * this project SUBSCRIBEs and a REST broadcast returns 202.)
 *
 * Sharing the channel also means N subscribed components cost one socket
 * topic, not N.
 */
type Shared = {
  channel: RealtimeChannel;
  listeners: Set<(scope: PlatinaRealtimeScope) => void>;
  states: Set<(state: PlatinaLiveState) => void>;
  state: PlatinaLiveState;
  attempts: number;
  detail: string | null;
};
const shared = new Map<string, Shared>();

export type { PlatinaLiveState };
export { MAX_SUBSCRIBE_ATTEMPTS };

export const PLATINA_POLL_INTERVAL_MS = 20_000;

function publish(entry: Shared, state: PlatinaLiveState, detail: string | null) {
  entry.state = state;
  entry.detail = detail;
  for (const listener of entry.states) listener(state);
}

function join(topicToken: string, sb: SupabaseClient): Shared {
  const existing = shared.get(topicToken);
  if (existing) return existing;

  const channel = sb.channel(platinaChannelName(topicToken));
  const entry: Shared = {
    channel,
    listeners: new Set(),
    states: new Set(),
    state: "reconnecting",
    attempts: 0,
    detail: null,
  };
  shared.set(topicToken, entry);

  channel
    .on("broadcast", { event: "platina" }, (msg) => {
      const scope = (msg.payload as { scope?: PlatinaRealtimeScope })?.scope;
      if (!scope) return;
      for (const listener of entry.listeners) listener(scope);
    })
    .subscribe((status, error) => {
      // The decision itself lives in lib/platina/realtime-state.ts, where it
      // is unit-tested: no transport is ever claimed that is not connected,
      // and "Reconnecting" is never a permanent state.
      const next = nextLiveState({
        status: status as "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED",
        attempts: entry.attempts,
        reason: error?.message ?? null,
      });
      entry.attempts = next.attempts;
      publish(entry, next.state, next.detail);
    });
  return entry;
}

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
}): { state: PlatinaLiveState; detail: string | null } {
  const [state, setState] = useState<PlatinaLiveState>(
    topicToken ? "reconnecting" : "polling",
  );
  const [detail, setDetail] = useState<string | null>(null);
  const onSignalRef = useRef(onSignal);
  onSignalRef.current = onSignal;
  const scopesRef = useRef(scopes);
  scopesRef.current = scopes;

  useEffect(() => {
    const sb = topicToken ? supabase() : null;
    if (!sb || !topicToken) {
      setState("polling");
      return;
    }

    const entry = join(topicToken, sb);
    // An already-joined channel does not fire its callback again: adopt the
    // state it is in, or the pill would sit on "reconnecting" for a channel
    // that is live.
    setState(entry.state);
    setDetail(entry.detail);

    const onScope = (scope: PlatinaRealtimeScope) => {
      const filter = scopesRef.current;
      if (!filter || filter.length === 0 || filter.includes(scope)) {
        onSignalRef.current(scope);
      }
    };
    const onState = (next: PlatinaLiveState) => {
      setState(next);
      setDetail(shared.get(topicToken)?.detail ?? null);
    };
    entry.listeners.add(onScope);
    entry.states.add(onState);

    return () => {
      entry.listeners.delete(onScope);
      entry.states.delete(onState);
      // The last component to leave takes the channel with it.
      if (entry.listeners.size === 0 && entry.states.size === 0) {
        shared.delete(topicToken);
        void sb.removeChannel(entry.channel);
      }
    };
  }, [topicToken]);

  // Polling fallback — always active, whether Realtime is up or not.
  useEffect(() => {
    const interval = setInterval(
      () => onSignalRef.current("poll"),
      PLATINA_POLL_INTERVAL_MS,
    );
    return () => clearInterval(interval);
  }, []);

  return { state, detail };
}

/** Test seam: drops the shared channel registry between cases. */
export function __resetPlatinaRealtime() {
  shared.clear();
}
