import { z } from "zod";
import type { AutomationAction, AutomationTrigger } from "@/db/schema";

/**
 * Pure planners for the automation rules engine (A1). The impure Inngest
 * runner (A2, not built in this slice) stays thin — everything decidable
 * without I/O lives here, fully unit-tested. Deterministic condition-
 * checking only: no AI/router calls anywhere in this file (constitution).
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Is a scheduled (cron) run due? Exact analog of harness.ts's nextRunDue,
 *  minus the "manual" cadence (automation cadence is hourly|daily only). */
export function automationRunDue(
  rule: {
    cadence: "hourly" | "daily";
    enabled: boolean;
    lastRunAt: Date | null;
  },
  now: Date,
): boolean {
  if (!rule.enabled) return false;
  if (!rule.lastRunAt) return true;
  const interval = rule.cadence === "hourly" ? HOUR_MS : DAY_MS;
  return now.getTime() - rule.lastRunAt.getTime() >= interval;
}

/**
 * Convert a trigger's days/hours field to an absolute cutoff timestamp a
 * `createdAt < cutoff` read query can compare against. Pure arithmetic —
 * no I/O.
 */
export function triggerCutoff(trigger: AutomationTrigger, now: Date): Date {
  switch (trigger.kind) {
    case "idea_stale":
      return new Date(now.getTime() - trigger.days * DAY_MS);
    case "approval_stale":
      return new Date(now.getTime() - trigger.hours * HOUR_MS);
    case "ticket_unassigned":
      return new Date(now.getTime() - trigger.hours * HOUR_MS);
    case "event":
      return now;
  }
}

/** Zod discriminated union validating each AutomationTrigger member, round-
 *  trip tested like harnessRuleSchema. */
export const automationTriggerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("idea_stale"),
    days: z.number().int().positive("Days must be greater than zero"),
  }),
  z.object({
    kind: z.literal("approval_stale"),
    hours: z.number().int().positive("Hours must be greater than zero"),
  }),
  z.object({
    kind: z.literal("ticket_unassigned"),
    hours: z.number().int().positive("Hours must be greater than zero"),
  }),
  z.object({
    kind: z.literal("event"),
    verb: z.string().min(1, "Verb is required"),
    filter: z.record(z.string(), z.unknown()).optional(),
  }),
]);

/** Zod discriminated union validating each AutomationAction member. */
export const automationActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create_ticket"),
    title: z.string().trim().min(1, "Title is required").max(200),
    priority: z.enum(["high", "medium", "low"]),
  }),
  z.object({
    kind: z.literal("hub_message"),
    body: z.string().trim().min(1, "Body is required").max(2000),
  }),
  z.object({
    kind: z.literal("hub_reminder"),
    title: z.string().trim().min(1, "Title is required").max(200),
    hoursFromNow: z.number().positive("Must be greater than zero"),
    ownerId: z.string().min(1, "Owner is required"),
  }),
  z.object({
    kind: z.literal("email"),
    subject: z.string().trim().min(1, "Subject is required").max(200),
    body: z.string().trim().min(1, "Body is required").max(5000),
    audience: z.literal("team"),
  }),
]);

export type AutomationTriggerInput = z.infer<typeof automationTriggerSchema>;
export type AutomationActionInput = z.infer<typeof automationActionSchema>;

/** Wrapping schema for the rule shell (name/cadence/enabled) — the A2 rule
 *  form composes this with automationTriggerSchema/automationActionSchema,
 *  which stay separate so the trigger-kind/action-kind selects can validate
 *  their own sub-shape independently. */
export const automationRuleShellSchema = z.object({
  workspaceId: z.string().min(1, "Missing workspace"),
  name: z.string().trim().min(1, "Give the rule a name.").max(140),
  cadence: z.enum(["hourly", "daily"]),
  enabled: z.boolean().optional().default(false),
});

// ---------------------------------------------------------------------------
// Plain-English formatters (A2) — pure, unit-tested. Used by the rule list
// UI so a non-technical reader can see what a rule does without opening the
// JSON trigger/action payload.
// ---------------------------------------------------------------------------

/** One line per AutomationTrigger kind. */
export function describeTrigger(trigger: AutomationTrigger): string {
  switch (trigger.kind) {
    case "idea_stale":
      return `Idea sits unassigned for ${trigger.days}+ day${trigger.days === 1 ? "" : "s"}`;
    case "approval_stale":
      return `Approval sits pending for ${trigger.hours}+ hour${trigger.hours === 1 ? "" : "s"}`;
    case "ticket_unassigned":
      return `High-priority ticket is unassigned for ${trigger.hours}+ hour${trigger.hours === 1 ? "" : "s"}`;
    case "event":
      return `Domain event "${trigger.verb}" is received`;
  }
}

/** One line per AutomationAction kind. */
export function describeAction(action: AutomationAction): string {
  switch (action.kind) {
    case "create_ticket":
      return `Create a ${action.priority}-priority ticket: "${action.title}"`;
    case "hub_message":
      return "Post a message to Team Hub";
    case "hub_reminder":
      return `Set a reminder ("${action.title}") ${action.hoursFromNow}h from now`;
    case "email":
      return `Email the team: "${action.subject}"`;
  }
}

// ---------------------------------------------------------------------------
// C2 — reject the one confirmed-nonsensical trigger/action combination
// (yc-standards-audit.md, "Automation engine": trigger=ticket_unassigned +
// action=create_ticket produces a ticket about an unassigned ticket — a
// circular, useless rule nothing previously prevented). Deliberately
// narrow: the reject-list is exactly this one evidenced bad pairing, not a
// speculative semantic ontology over every trigger×action combination.
// Everything else is sensible by default.
// ---------------------------------------------------------------------------

/** Used both client-side (rule-form.tsx filters the nonsensical action out
 *  of the action-kind select so it's never selectable) and server-side
 *  (automations/actions.ts rejects it before the DB write, as defense in
 *  depth in case the client-side filter is ever bypassed). */
export function isSensibleRule(
  triggerKind: AutomationTrigger["kind"],
  actionKind: AutomationAction["kind"],
): boolean {
  return !(triggerKind === "ticket_unassigned" && actionKind === "create_ticket");
}

// ---------------------------------------------------------------------------
// F9.2 — back-link a create_ticket action to the row that triggered it.
// ---------------------------------------------------------------------------

/** Same shape createTicket accepts for linkedType/linkedId (src/db/queries/
 *  tickets.ts's TicketLinkType) — kept local to avoid a query-layer import
 *  in this pure lib file. */
export type AutomationTicketLink =
  | { linkedType: "idea"; linkedId: string }
  | { linkedType: null; linkedId: null };

/**
 * Map a matched trigger row to the {linkedType, linkedId} a create_ticket
 * action should carry, so the resulting ticket's detail page can render a
 * real clickable back-link (F9.3's resolveTicketLink) to whatever caused it
 * to be created.
 *
 * `ticketLinkType` (src/db/schema.ts) only has content/idea/campaign/client
 * — there is no "approval" or "ticket" value. Rather than extend the enum
 * (a migration) for a value F9.3's resolveTicketLink couldn't resolve to a
 * sensible target anyway, only idea_stale maps to a real link:
 *
 * - idea_stale: the matched row IS an idea, and "idea" is a valid enum
 *   value with a working resolve target (/plan) — maps cleanly.
 * - approval_stale: no "approval" enum value exists, and there's no
 *   per-approval detail page to link to even if there were — left null.
 * - ticket_unassigned: the matched row is itself a ticket. A ticket
 *   pointing at another ticket via linkedType isn't representable in the
 *   enum (no "ticket" value) — and ticket-to-ticket relations already have
 *   a real mechanism (parentTicketId sub-tasks), so this isn't a gap
 *   worth papering over — left null.
 */
export function linkForTrigger(
  triggerKind: AutomationTrigger["kind"],
  matchedRowId: string,
): AutomationTicketLink {
  switch (triggerKind) {
    case "idea_stale":
      return { linkedType: "idea", linkedId: matchedRowId };
    case "approval_stale":
    case "ticket_unassigned":
    case "event":
      return { linkedType: null, linkedId: null };
  }
}
