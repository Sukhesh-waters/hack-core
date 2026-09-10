"use client";

import { useEffect, useRef, useState } from "react";
import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { hubChannelName, type RealtimeScope } from "@/lib/realtime";

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

export type UseWorkspaceRealtimeOptions = {
  workspaceId: string;
  userId?: string;
  scopes?: RealtimeScope[];
  onSignal: (scope: RealtimeScope) => void;
};

type Subscriber = {
  id: symbol;
  userId?: string;
  scopesRef: React.MutableRefObject<RealtimeScope[] | undefined>;
  onSignalRef: React.MutableRefObject<(scope: RealtimeScope) => void>;
  onPresenceSync?: (onlineIds: Set<string>) => void;
};

/**
 * Multiplexer for a single workspace's Realtime channel.
 * Manages one Supabase Realtime channel subscription per workspace topic
 * (`ws:<workspaceId>:hub`) regardless of how many components (bell, presence,
 * page live hooks) mount concurrently on the page.
 */
class WorkspaceChannelHub {
  private workspaceId: string;
  private channel: RealtimeChannel;
  private subscribers = new Set<Subscriber>();
  private trackedUserIds = new Set<string>();
  private currentOnlineIds = new Set<string>();
  private isSubscribed = false;

  constructor(sb: SupabaseClient, workspaceId: string, initialUserId?: string) {
    this.workspaceId = workspaceId;
    this.channel = sb.channel(hubChannelName(workspaceId), {
      config: {
        presence: { key: initialUserId || "" },
      },
    });

    this.channel
      .on("broadcast", { event: "hub" }, (msg) => {
        const scope = (msg.payload as { scope?: RealtimeScope })?.scope;
        if (scope) {
          this.subscribers.forEach((sub) => {
            const filter = sub.scopesRef.current;
            if (!filter || filter.length === 0 || filter.includes(scope)) {
              sub.onSignalRef.current(scope);
            }
          });
        }
      })
      .on("presence", { event: "sync" }, () => {
        const state = this.channel.presenceState() as Record<
          string,
          Array<{ userId?: string }>
        >;
        const ids = new Set<string>();
        for (const [key, presences] of Object.entries(state)) {
          if (key && key !== "presence") {
            ids.add(key);
          }
          if (Array.isArray(presences)) {
            for (const p of presences) {
              if (p?.userId) ids.add(p.userId);
            }
          }
        }
        this.currentOnlineIds = ids;
        this.subscribers.forEach((sub) => {
          sub.onPresenceSync?.(ids);
        });
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          this.isSubscribed = true;
          this.syncPresence();
        }
      });
  }

  public subscribe(sub: Subscriber) {
    this.subscribers.add(sub);
    if (sub.userId) {
      this.trackedUserIds.add(sub.userId);
      if (this.isSubscribed) {
        this.syncPresence();
      }
    }
    if (this.currentOnlineIds.size > 0 && sub.onPresenceSync) {
      sub.onPresenceSync(this.currentOnlineIds);
    }
  }

  public unsubscribe(sub: Subscriber) {
    this.subscribers.delete(sub);
    if (sub.userId) {
      const stillHasUser = Array.from(this.subscribers).some(
        (s) => s.userId === sub.userId,
      );
      if (!stillHasUser) {
        this.trackedUserIds.delete(sub.userId);
      }
    }
    if (this.subscribers.size === 0) {
      const sb = supabase();
      if (sb) {
        sb.removeChannel(this.channel);
      }
      channelHubs.delete(this.workspaceId);
    }
  }

  private syncPresence() {
    if (!this.isSubscribed) return;
    for (const uid of this.trackedUserIds) {
      void this.channel.track({ userId: uid });
    }
  }
}

const channelHubs = new Map<string, WorkspaceChannelHub>();

/**
 * General-purpose Supabase Realtime subscription hook for workspace events.
 * Listens on topic `ws:<workspaceId>:hub`.
 * Deduplicates channels across multiple concurrent callers in the same workspace.
 * Filtering by `scopes` is done client-side. If `scopes` is omitted or empty, all signals call `onSignal`.
 */
export function useWorkspaceRealtime({
  workspaceId,
  userId,
  scopes,
  onSignal,
}: UseWorkspaceRealtimeOptions) {
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const onSignalRef = useRef(onSignal);
  onSignalRef.current = onSignal;
  const scopesRef = useRef(scopes);
  scopesRef.current = scopes;

  useEffect(() => {
    const sb = supabase();
    if (!sb || !workspaceId) return;

    let hub = channelHubs.get(workspaceId);
    if (!hub) {
      hub = new WorkspaceChannelHub(sb, workspaceId, userId);
      channelHubs.set(workspaceId, hub);
    }

    const sub: Subscriber = {
      id: Symbol(),
      userId,
      scopesRef,
      onSignalRef,
      onPresenceSync: (ids) => setOnlineIds(new Set(ids)),
    };

    hub.subscribe(sub);

    return () => {
      hub.unsubscribe(sub);
    };
  }, [workspaceId, userId]);

  return { onlineIds };
}

