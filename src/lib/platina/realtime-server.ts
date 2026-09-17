/**
 * Server-only half of the Platina Realtime spine: the opaque topic token and
 * the post-commit broadcast. Never import this from a client component —
 * `node:crypto` and the secret must not reach a browser bundle.
 */
import "server-only";
import { createHmac } from "node:crypto";
import {
  PLATINA_BROADCAST_EVENT,
  platinaChannelName,
  type PlatinaRealtimeScope,
} from "./realtime";

/**
 * Returns null when PLATINA_REALTIME_SECRET is unset — callers must treat
 * null as "no Realtime, poll instead", never as "fall back to the raw
 * workspace id".
 */
export function platinaTopicToken(workspaceId: string): string | null {
  const secret = process.env.PLATINA_REALTIME_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update(workspaceId).digest("hex");
}

/**
 * Server-side broadcast via Realtime REST, called AFTER the database write
 * commits — a signal for a write that rolls back makes every client show a
 * lie. Fire-and-forget: a Realtime outage must never fail the action; the
 * polling fallback covers missed signals.
 */
export async function broadcastPlatinaSignal(
  workspaceId: string,
  scope: PlatinaRealtimeScope,
  entityId?: string,
): Promise<void> {
  const token = platinaTopicToken(workspaceId);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!token || !url || !key) return;
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          {
            topic: platinaChannelName(token),
            event: PLATINA_BROADCAST_EVENT,
            payload: entityId ? { scope, id: entityId } : { scope },
          },
        ],
      }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // degradation ladder: poll fallback covers missed signals
  }
}
