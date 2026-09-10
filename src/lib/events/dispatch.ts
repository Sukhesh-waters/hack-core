import { inngest } from "@/inngest/client";
import { recordActivity } from "@/lib/activity";
import { broadcastSignal, type RealtimeScope } from "@/lib/realtime";
import type { DomainEvent } from "./registry";

/**
 * Maps domain events to relevant Realtime scopes for fast-path UI invalidation.
 */
export function mapEventToRealtimeScopes(event: DomainEvent): RealtimeScope[] {
  const verb = event.verb;
  if (verb.startsWith("content.")) return ["workflow", "calendar", "my-work"];
  if (verb.startsWith("sop_step.")) return ["sop", "my-work", "notifications"];
  if (verb.startsWith("ticket.")) return ["tasks", "my-work", "notifications"];
  if (verb.startsWith("approval.")) return ["approvals", "workflow", "my-work"];
  if (verb.startsWith("slot.")) return ["calendar", "my-work"];
  if (verb.startsWith("hub_message.")) return ["messages"];
  if (verb.startsWith("hub_task.")) return ["tasks"];
  if (verb.startsWith("hub_reminder.")) return ["reminders"];
  return ["workflow"];
}

/**
 * Single entry point for emitting typed domain events.
 *
 * 1. Writes an audit row to the `activity` table (never-throws contract preserved).
 * 2. Broadcasts fast-path Realtime signals to active workspace subscribers.
 * 3. Enqueues a reliable Inngest event for async subscribers (reverse-sync, automations).
 */
export async function emitDomainEvent(event: DomainEvent): Promise<void> {
  // 1. Audit / Activity recording (never throws)
  await recordActivity({
    workspaceId: event.workspaceId,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    actorId: event.actorId,
    verb: event.verb,
    meta: event.meta,
  });

  // 2. Realtime broadcast (fast-path, non-blocking)
  const scopes = mapEventToRealtimeScopes(event);
  for (const scope of scopes) {
    void broadcastSignal(event.workspaceId, scope);
  }

  // 3. Inngest background event dispatch (guaranteed delivery & retry)
  try {
    await inngest.send({
      name: `domain/${event.verb}`,
      data: event,
    });
  } catch (error) {
    // In local dev without Inngest dev server or on transient errors, do not crash the caller
    console.warn(`[events/dispatch] Inngest dispatch failed for ${event.verb}:`, error);
  }
}
