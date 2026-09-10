import { z } from "zod";

/**
 * Plain (non "use server") module — zod schemas that need unit tests can't
 * live in a server-action file, since those files may only export async
 * functions (F1 lesson, src/lib/validation.ts precedent).
 */

const ticketStatusValues = ["open", "in_progress", "blocked", "done"] as const;
const ticketPriorityValues = ["high", "medium", "low"] as const;
const ticketLinkTypeValues = ["content", "idea", "campaign", "client"] as const;

/**
 * FormData.get(name) returns "" for a rendered-but-unselected field (e.g. a
 * native <select>'s value="" "Unassigned"/"No client"/"No link" option) and
 * `null` for a field that isn't rendered in the DOM at all (e.g.
 * add-subtask-form.tsx only submits title/workspaceId/parentTicketId — every
 * other createTicketSchema key arrives as null). Neither shape is
 * `undefined`, so z.optional()/.default() — which only short-circuit for a
 * literal `undefined` — never get a chance to treat either as "not
 * provided," and whatever's chained after (.min(1), .enum(), .default())
 * runs against "" or null and fails. Every optional field below must
 * preprocess through this BEFORE its own validation, not just add
 * .optional() and assume that's enough.
 */
const emptyToUndefined = (v: unknown) => (v === "" || v == null ? undefined : v);

const optionalTrimmed = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

const optionalId = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).optional(),
);

const optionalLinkType = z.preprocess(
  emptyToUndefined,
  z.enum(ticketLinkTypeValues).optional(),
);

const dueAtInput = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .optional()
    .refine((v) => !v || !Number.isNaN(Date.parse(v)), {
      message: "Invalid due date",
    }),
);

/** Comma-separated label input from a plain text field — trims, drops
 *  empties, dedupes. Matches the "no new shadcn component" instruction. */
const labelsInput = z
  .string()
  .optional()
  .transform((v) => {
    if (!v) return undefined;
    const labels = [
      ...new Set(
        v
          .split(",")
          .map((label) => label.trim())
          .filter((label) => label.length > 0),
      ),
    ];
    return labels;
  });

export const createTicketSchema = z
  .object({
    workspaceId: z.string().min(1, "Missing workspace"),
    title: z.string().trim().min(1, "Give the ticket a title.").max(140),
    description: optionalTrimmed(4000),
    // .default() only substitutes for a literal `undefined` — a form that
    // doesn't render a priority field at all (add-subtask-form.tsx) submits
    // null, which .default() does NOT catch; same emptyToUndefined
    // preprocess needed here as every other optional field above.
    priority: z.preprocess(
      emptyToUndefined,
      z.enum(ticketPriorityValues).default("medium"),
    ),
    assigneeId: optionalId,
    dueAt: dueAtInput,
    linkedType: optionalLinkType,
    linkedId: optionalId,
    // T5: optional parent ticket — cross-workspace/nonexistent parent is
    // rejected at the action layer (assertParentTicketInWorkspace), not here.
    parentTicketId: optionalId,
    // F9.5: optional client association — cross-workspace/nonexistent client
    // is rejected at the action layer (assertClientInWorkspace), not here.
    clientId: optionalId,
  })
  .refine((v) => Boolean(v.linkedType) === Boolean(v.linkedId), {
    message: "linkedType and linkedId must both be set, or both be empty.",
    path: ["linkedId"],
  });

export const advanceTicketStatusSchema = z.object({
  workspaceId: z.string().min(1, "Missing workspace"),
  ticketId: z.string().min(1, "Missing ticket"),
  from: z.enum(ticketStatusValues),
  to: z.enum(ticketStatusValues),
});

export const assignTicketSchema = z.object({
  workspaceId: z.string().min(1, "Missing workspace"),
  ticketId: z.string().min(1, "Missing ticket"),
  assigneeId: optionalId,
});

export const addTicketCommentSchema = z.object({
  workspaceId: z.string().min(1, "Missing workspace"),
  ticketId: z.string().min(1, "Missing ticket"),
  body: z
    .string()
    .trim()
    .min(1, "Comment can't be empty.")
    .max(4000, "Comment is too long."),
});

export const updateTicketSchema = z
  .object({
    workspaceId: z.string().min(1, "Missing workspace"),
    ticketId: z.string().min(1, "Missing ticket"),
    title: z.string().trim().min(1, "Give the ticket a title.").max(140),
    description: optionalTrimmed(4000),
    priority: z.enum(ticketPriorityValues),
    dueAt: dueAtInput,
    linkedType: optionalLinkType,
    linkedId: optionalId,
  })
  .refine((v) => Boolean(v.linkedType) === Boolean(v.linkedId), {
    message: "linkedType and linkedId must both be set, or both be empty.",
    path: ["linkedId"],
  });

/** Standalone label-edit form on the ticket detail page — separate from
 *  updateTicketSchema so a label save doesn't require re-submitting every
 *  other ticket field. */
export const updateTicketLabelsSchema = z.object({
  workspaceId: z.string().min(1, "Missing workspace"),
  ticketId: z.string().min(1, "Missing ticket"),
  labels: labelsInput,
});

/** T4: hard-delete a ticket. Gated to owner-only — see
 *  src/lib/ticket-permissions.ts and deleteTicketAction. */
export const deleteTicketSchema = z.object({
  workspaceId: z.string().min(1, "Missing workspace"),
  ticketId: z.string().min(1, "Missing ticket"),
});
