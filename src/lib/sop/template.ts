/**
 * S1 — the SOP template vocabulary: what a step may declare, and how those
 * declarations read on screen.
 *
 * Kept separate from `dependencies.ts` (graph shape) and from the server
 * actions (I/O) so the meaning of a gate, a "creates", and an offset lives
 * in exactly one place that both the builder UI and the run instantiation in
 * S2 read from. Mirrors how `custom-fields.ts` centralises field-type meaning
 * — that registry is why a dropdown can't store a value outside its options,
 * and the same discipline keeps a step from declaring a gate nothing honours.
 */

import { z } from "zod";
import { sopStepCreates, sopStepGate } from "@/db/schema";

export type SopStepGate = (typeof sopStepGate.enumValues)[number];
export type SopStepCreates = (typeof sopStepCreates.enumValues)[number];

export const SOP_STEP_GATES = sopStepGate.enumValues;
export const SOP_STEP_CREATES = sopStepCreates.enumValues;

/**
 * A gate is what makes a step something other than a checkbox. `none` is
 * ticked by whoever owns it; `approval` and `compliance` are closed by
 * another system and cannot be ticked by hand (enforced in S4) — otherwise
 * "client signed off" would mean "someone said it did".
 */
export const SOP_GATE_META: Record<
  SopStepGate,
  { label: string; hint: string }
> = {
  none: {
    label: "No gate",
    hint: "The owner marks it done when it's done.",
  },
  approval: {
    label: "Approval",
    hint: "Closes only when someone with approval rights signs off.",
  },
  compliance: {
    label: "Compliance",
    hint: "Closes only when the compliance check passes.",
  },
};

/** What running the step brings into existence, if anything. */
export const SOP_CREATES_META: Record<
  SopStepCreates,
  { label: string; hint: string }
> = {
  none: { label: "Nothing", hint: "A step to do, with no new record." },
  task: { label: "A hub task", hint: "Adds a task to the Team Hub list." },
  content: { label: "A content draft", hint: "Opens a draft in the Studio." },
  ticket: { label: "A ticket", hint: "Opens a ticket on the Tickets board." },
  doc: { label: "A doc", hint: "Creates a workspace doc to fill in." },
};

/**
 * Offsets are stored as plain integers and rendered relative to the anchor,
 * which is what makes a template reusable: "three days before launch" is true
 * for every launch, "17 August" is true for one.
 */
export function formatOffset(days: number): string {
  if (days === 0) return "Anchor day";
  if (days < 0) return `${Math.abs(days)}d before`;
  return `${days}d after`;
}

/** The compact form used in dense rows and the run timeline. */
export function shortOffset(days: number): string {
  if (days === 0) return "D0";
  return days < 0 ? `D-${Math.abs(days)}` : `D+${days}`;
}

/**
 * A year either side of the anchor. Wide enough for any real campaign,
 * narrow enough that a typo (2000 instead of 20) is refused rather than
 * silently scheduling a step in the next century.
 */
export const MAX_OFFSET_DAYS = 365;

export const sopTemplateSchema = z.object({
  name: z.string().trim().min(1, "Give the template a name").max(80),
  description: z.string().trim().max(500).nullable().optional(),
  anchorLabel: z
    .string()
    .trim()
    .min(1, "Name the date a run starts from")
    .max(40),
});

export const sopStepSchema = z.object({
  title: z.string().trim().min(1, "Give the step a title").max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  dueOffsetDays: z.coerce
    .number()
    .int("Offsets are whole days")
    .min(-MAX_OFFSET_DAYS, `No earlier than ${MAX_OFFSET_DAYS} days before`)
    .max(MAX_OFFSET_DAYS, `No later than ${MAX_OFFSET_DAYS} days after`),
  gate: z.enum(SOP_STEP_GATES),
  creates: z.enum(SOP_STEP_CREATES),
  dependsOn: z.array(z.string()).default([]),
});

export type SopStepInput = z.infer<typeof sopStepSchema>;

/**
 * The assignee rule as it arrives from a form. "role" defers the choice to
 * instantiation (S2 resolves it against the run's members), which is what
 * lets one template serve every client without naming names.
 */
export const sopAssigneeRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unassigned") }),
  z.object({ kind: z.literal("role"), value: z.enum(["owner", "admin", "member"]) }),
  z.object({ kind: z.literal("user"), value: z.string().min(1) }),
]);
