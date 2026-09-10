/**
 * Supabase Realtime signaling. Payloads are signal-only ({scope}) — tenant
 * content never crosses the broadcast channel; clients refetch through
 * authenticated server actions.
 *
 * D1: generalised to support SOP, workflow and cockpit scopes alongside the
 * original hub scopes. One channel per workspace; scopes multiplex within it.
 */

export type RealtimeScope =
  | "messages"
  | "approvals"
  | "tasks"
  | "reminders"
  | "plan"
  | "sop"        // run step moved / unblocked / run completed / gate decided
  | "workflow"   // content transitioned, production board changed
  | "cockpit"    // metrics invalidated
  | "calendar"   // plan-grid cell edited, slot scheduled, AI suggestion applied
  | "my-work"    // my work items updated/assigned
  | "notifications" // unread notification count changed
  | "dm"         // internal direct message sent, conversation updated
  | "kb";        // knowledge base source or chunk ingested / updated


/** @deprecated Use RealtimeScope — kept so existing hub call sites compile. */
export type HubScope = RealtimeScope;

export function hubChannelName(workspaceId: string) {
  return `ws:${workspaceId}:hub`;
}

/** Server-side broadcast via Realtime REST. Fire-and-forget: a Realtime
 *  outage must never fail the action — clients fall back to the 30s poll.
 *
 *  MUST be called AFTER the transaction commits, never inside it.
 *  A signal for a write that then rolls back makes every client show a lie. */
export async function broadcastSignal(
  workspaceId: string,
  scope: RealtimeScope,
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return;
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
            topic: hubChannelName(workspaceId),
            event: "hub",
            payload: { scope },
          },
        ],
      }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // degradation ladder: poll fallback covers missed signals
  }
}

/** @deprecated Use broadcastSignal — kept for backward compatibility. */
export async function broadcastHubSignal(
  workspaceId: string,
  scope: HubScope,
): Promise<void> {
  return broadcastSignal(workspaceId, scope);
}

