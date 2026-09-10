"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/auth";
import {
  contentType,
  isVideoContentType,
  type ContentTypeValue,
} from "@/db/schema";
import { getClientById, getContentById } from "@/db/queries/clients";
import { getMembership, requireMembership } from "@/db/queries/memberships";
import {
  createScheduledPost,
  setPlanSlot,
  updatePlanCellQuery,
  type PlanCellValues,
} from "@/db/queries/schedule";
import { getBrandProfile } from "@/db/queries/brand";
import {
  getRevisionQuery,
  markRevisionAppliedQuery,
  recordRevision,
} from "@/db/queries/revisions";
import { addComment, listComments } from "@/db/queries/comments";
import { actionErrorMessage } from "@/lib/action-errors";
import { emitDomainEvent } from "@/lib/events/dispatch";
import { recordActivity, listActivityForSubject } from "@/lib/activity";
import { notify } from "@/db/queries/notifications";
import {
  brandDnaFromProfile,
  NO_BRAND_CONTEXT_ERROR,
} from "@/lib/ai/brand-merge";
import { retrieveDrivers } from "@/lib/ai/retrieval";
import { runWithAiCost } from "@/lib/ai/usage-context";
import { resolvePlanWrite } from "@/lib/plan/apply-fields";
import {
  isEmptySuggestion,
  PLAN_DECLARED_ONLY_NOTE,
  suggestPlanRow,
} from "@/lib/plan/suggest-row";
import { MIN_BASELINE_N } from "@/lib/scoring";
import { parseSlotDateTime } from "@/lib/calendar";
import { PLAN_CELL_FIELDS, type PlanCellField } from "@/lib/plan-cell";
import { contentPlanFieldsSchema } from "@/lib/validation";

export type CalendarActionState = { error?: string } | undefined;

export type PlanCellResult = { ok: true } | { ok: false; error: string };

const planCellSchema = z.object({
  workspaceId: z.string().min(1),
  contentId: z.string().min(1),
  field: z.enum(PLAN_CELL_FIELDS),
  value: z.union([z.string(), z.number(), z.null()]),
});

/** Empty string from an input means "cleared", not "set to empty". */
function blankToNull(value: string | number | null): string | number | null {
  return typeof value === "string" && value.trim() === "" ? null : value;
}

/**
 * The single-cell write path, shared by updatePlanCellAction (one row, one
 * caller-authenticated request) and bulkUpdatePlanCellsAction (many rows,
 * ONE auth check up front). Auth is deliberately NOT done in here — the
 * caller does it once and passes the resolved user down, so a 200-row bulk
 * edit doesn't re-run requireUser/requireMembership 200 times, and so this
 * function can't accidentally be called without having checked either.
 *
 * This is the one and only place plan-cell validation lives. Extracting it
 * means the bulk path can never drift from the single-cell path's rules —
 * there is no second copy of the video/duration check, the title-length
 * check, or the assignee-membership check to keep in sync.
 */
async function writePlanCell(params: {
  workspaceId: string;
  contentId: string;
  field: PlanCellField;
  value: string | number | null;
  user: Awaited<ReturnType<typeof requireUser>>;
}): Promise<PlanCellResult> {
  const { workspaceId, contentId, field, value, user } = params;

  try {
    const row = await getContentById(workspaceId, contentId);
    if (!row) return { ok: false, error: "That row is no longer available." };

    if (field === "scheduledFor") {
      const when = value === null ? null : new Date(String(value));
      if (when !== null && Number.isNaN(when.getTime())) {
        return { ok: false, error: "Pick a valid date and time." };
      }
      return await setPlanSlot({
        workspaceId,
        contentId,
        clientId: row.clientId,
        scheduledFor: when,
      });
    }

    if (field === "assigneeId" && value !== null) {
      const member = await getMembership(workspaceId, String(value));
      if (!member) {
        return { ok: false, error: "That person isn't in this workspace." };
      }
    }

    // Validate the row as it would be AFTER the edit, not the delta alone:
    // typing a duration onto a static row is a violation only the resulting
    // pair can catch.
    //
    // Moving to a non-video type is the one case where the pair resolves
    // itself: a static post has no duration by definition, so the duration
    // is cleared with the type rather than reported as an error about a
    // field the planner never touched.
    const movingToNonVideo =
      field === "type" && !isVideoContentType(String(value) as ContentTypeValue);
    const next = {
      type: field === "type" ? String(value) : row.type,
      durationSec: movingToNonVideo
        ? null
        : field === "durationSec"
          ? value === null
            ? null
            : Number(value)
          : row.durationSec,
    };
    const check = contentPlanFieldsSchema.safeParse(next);
    if (!check.success) {
      return { ok: false, error: check.error.issues[0].message };
    }

    const values: PlanCellValues = {};
    switch (field) {
      case "type":
        values.type = check.data.type;
        // Clear the stale duration in the same write, so the row can never
        // sit in a state the validator would reject on the next edit.
        if (movingToNonVideo) values.durationSec = null;
        break;
      case "durationSec":
        values.durationSec = check.data.durationSec ?? null;
        break;
      case "title": {
        const title = String(value ?? "").trim();
        if (!title) return { ok: false, error: "Give the post a title." };
        if (title.length > 140) {
          return { ok: false, error: "Keep titles to 140 characters." };
        }
        values.title = title;
        break;
      }
      case "pillar":
        values.pillar = value === null ? null : String(value).trim().slice(0, 120);
        break;
      case "strategyNote":
        values.strategyNote =
          value === null ? null : String(value).trim().slice(0, 2000);
        break;
      case "assigneeId":
        values.assigneeId = value === null ? null : String(value);
        break;
      case "dueAt": {
        if (value === null) {
          values.dueAt = null;
          break;
        }
        const due = new Date(String(value));
        if (Number.isNaN(due.getTime())) {
          return { ok: false, error: "Pick a valid due date." };
        }
        values.dueAt = due;
        break;
      }
    }

    const updated = await updatePlanCellQuery({
      workspaceId,
      contentId,
      values,
    });
    if (updated.length === 0) {
      return { ok: false, error: "That row is no longer available." };
    }

    // Only ownership and deadline changes are worth a history line. Every
    // keystroke in a pillar or strategy cell is not an event.
    if (field === "assigneeId" || field === "dueAt") {
      await recordActivity({
        workspaceId,
        subjectType: "content",
        subjectId: contentId,
        actorId: user.id,
        verb: field === "assigneeId" ? "assigned" : "due_set",
        meta: { to: value },
      });
    }

    // A notification needs a specific recipient. Assignment has one;
    // a due-date change does not, so it stays activity-only.
    // Assigning to yourself is not news — no self-notify.
    if (field === "assigneeId" && value !== null && String(value) !== user.id) {
      await notify({
        workspaceId,
        userId: String(value),
        kind: "assigned",
        subjectType: "content",
        subjectId: contentId,
        body: `${user.name ?? "Someone"} assigned you "${row.title}"`,
      });
    }
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }

  return { ok: true };
}

export async function updatePlanCellAction(input: {
  workspaceId: string;
  contentId: string;
  field: PlanCellField;
  value: string | number | null;
}): Promise<PlanCellResult> {
  const parsed = planCellSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That field can't be edited here." };
  }
  const { workspaceId, contentId, field } = parsed.data;
  const value = blankToNull(parsed.data.value);

  let result: PlanCellResult;
  let userId: string;
  try {
    const user = await requireUser();
    userId = user.id;
    await requireMembership(workspaceId, user.id);
    result = await writePlanCell({ workspaceId, contentId, field, value, user });
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
  if (!result.ok) return result;

  await emitDomainEvent({
    verb: "slot.scheduled",
    workspaceId,
    subjectType: "content",
    subjectId: contentId,
    actorId: userId,
    meta: { field, value },
  });
  revalidatePath(`/w/${workspaceId}/calendar`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// U5 — bulk edit: apply one field across many selected rows
// ---------------------------------------------------------------------------

/** A crafted request can't drive an unbounded write loop through this path. */
const BULK_MAX_IDS = 200;

const bulkPlanCellSchema = z.object({
  workspaceId: z.string().min(1),
  contentIds: z
    .array(z.string().min(1))
    .min(1, "Select at least one row.")
    .max(BULK_MAX_IDS, `Bulk edits are capped at ${BULK_MAX_IDS} rows at once.`),
  field: z.enum(PLAN_CELL_FIELDS),
  value: z.union([z.string(), z.number(), z.null()]),
});

export type BulkPlanCellResult =
  | { ok: true; updated: string[]; failed: { id: string; error: string }[] }
  | { ok: false; error: string };

/**
 * Bulk edit for the spreadsheet-style plan grid (U5) — set ONE column across
 * many selected rows in a single round trip.
 *
 * requireUser/requireMembership run exactly ONCE here, not once per row —
 * that's the whole point of a bulk path over N calls to updatePlanCellAction.
 * Every row after that still goes through writePlanCell, the SAME validation
 * the single-cell path uses, so a bulk write can never do something a single
 * edit couldn't: `field` is restricted to PLAN_CELL_FIELDS by the schema
 * (status/complianceStatus/productionStage are never members of that enum),
 * and each write is scoped to workspaceId same as any other row query — a
 * client-supplied id for a row in another workspace simply matches nothing
 * and comes back as a per-row failure, never a cross-tenant write.
 *
 * Failure is per-row, not all-or-nothing: a bulk edit where 3 of 10 rows
 * fail (a static-typed row rejecting a duration, an assignee who left the
 * workspace, a row deleted mid-edit) says so in `failed`, and the 7 that
 * succeeded are not rolled back to make the response simpler to read.
 */
export async function bulkUpdatePlanCellsAction(input: {
  workspaceId: string;
  contentIds: string[];
  field: PlanCellField;
  value: string | number | null;
}): Promise<BulkPlanCellResult> {
  const parsed = bulkPlanCellSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "That bulk edit isn't valid.",
    };
  }
  const { workspaceId, contentIds, field } = parsed.data;
  const value = blankToNull(parsed.data.value);

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    const updated: string[] = [];
    const failed: { id: string; error: string }[] = [];

    // Sequential, not Promise.all: each row is a full validated write against
    // the same content row a single-cell edit would touch, and a request for
    // 200 ids shouldn't fan out into 200 concurrent database writes.
    for (const contentId of contentIds) {
      const result = await writePlanCell({
        workspaceId,
        contentId,
        field,
        value,
        user,
      });
      if (result.ok) updated.push(contentId);
      else failed.push({ id: contentId, error: result.error });
    }

    if (updated.length > 0) {
      await emitDomainEvent({
        verb: "slot.scheduled",
        workspaceId,
        subjectType: "content",
        subjectId: updated[0],
        actorId: user.id,
        meta: { count: updated.length },
      });
    }
    revalidatePath(`/w/${workspaceId}/calendar`);
    return { ok: true, updated, failed };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}

export type AskPlanRowResult =
  | { ok: true; revisionId: string; fields: string[] }
  | { ok: false; error: string };

const askPlanRowSchema = z.object({
  workspaceId: z.string().min(1),
  contentId: z.string().min(1),
});

/**
 * One AI suggestion for one plan row (S3).
 *
 * The suggestion is never applied here. It lands in content_revisions
 * unapplied and the grid shows a badge; a human takes it field by field in
 * the compare drawer. The row itself is untouched by this action — that
 * separation is the whole reason content_revisions exists.
 */
export async function askPlanRowAction(input: {
  workspaceId: string;
  contentId: string;
}): Promise<AskPlanRowResult> {
  const parsed = askPlanRowSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Missing row reference." };
  const { workspaceId, contentId } = parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    const row = await getContentById(workspaceId, contentId);
    if (!row) return { ok: false, error: "That row is no longer available." };

    const [client, profile] = await Promise.all([
      getClientById(workspaceId, row.clientId),
      getBrandProfile(workspaceId, row.clientId),
    ]);
    if (!client) return { ok: false, error: "Client not found." };
    const dna = brandDnaFromProfile(profile);
    if (!dna) return { ok: false, error: NO_BRAND_CONTEXT_ERROR };

    const rowContext = {
      clientName: client.name,
      title: row.title,
      type: row.type,
      durationSec: row.durationSec,
      pillar: row.pillar,
      strategyNote: row.strategyNote,
      scheduledForIso: null,
    };

    const outcome = await runWithAiCost(
      { workspaceId, purpose: "plan_suggestion" },
      async () => {
        // Baseline layer only. retrieveDrivers reads first-party posts and
        // nothing else — pattern rows never enter this prompt.
        const retrieval = await retrieveDrivers({
          workspaceId,
          clientId: row.clientId,
          topic: row.pillar ?? row.title,
        });

        if (retrieval.status === "insufficient_baseline") {
          if (!profile?.declared) {
            return {
              error: `Insufficient baseline — ${retrieval.sampleSize} of ${MIN_BASELINE_N} scored posts. Import more history before asking for suggestions.`,
            } as const;
          }
          return {
            suggestion: await suggestPlanRow({
              row: rowContext,
              identity: dna,
              brief:
                "No first-party baseline yet. Advise strictly from the declared brand context above — do not fabricate performance evidence.",
              drivers: [],
              declaredOnly: true,
            }),
            declaredOnly: true,
          } as const;
        }

        return {
          suggestion: await suggestPlanRow({
            row: rowContext,
            identity: dna,
            brief: retrieval.brief,
            drivers: retrieval.drivers,
            declaredOnly: false,
          }),
          declaredOnly: false,
        } as const;
      },
    );
    if ("error" in outcome) {
      return {
        ok: false,
        error: outcome.error ?? "Couldn't generate a suggestion.",
      };
    }

    const { suggestion, declaredOnly } = outcome;
    if (isEmptySuggestion(suggestion)) {
      return {
        ok: false,
        error: declaredOnly
          ? "No suggestion this time — there's no baseline yet to justify a change."
          : "No changes suggested for this row.",
      };
    }

    // priorFields carries only what the suggestion actually touches, so the
    // compare view shows current-vs-proposed for those fields and nothing
    // else. Written after the model returns: a router failure throws above
    // and leaves no orphan revision.
    const prior: Record<string, unknown> = {};
    for (const key of Object.keys(suggestion)) {
      prior[key] = (rowContext as Record<string, unknown>)[key] ?? null;
    }

    const revisionId = await recordRevision({
      workspaceId,
      contentId,
      authorKind: "ai",
      authorId: null,
      fields: suggestion,
      priorFields: prior,
      note: declaredOnly ? PLAN_DECLARED_ONLY_NOTE : undefined,
    });

    revalidatePath(`/w/${workspaceId}/calendar`);
    return { ok: true, revisionId, fields: Object.keys(suggestion) };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}

export type ApplyRevisionResult =
  | { ok: true; applied: string[] }
  | { ok: false; error: string };

const applyRevisionSchema = z.object({
  workspaceId: z.string().min(1),
  revisionId: z.string().min(1),
  fields: z.array(z.string()),
});

/**
 * Take some or all of a proposal (S5).
 *
 * Partial apply writes TWO records: the original revision is stamped
 * applied, and a new revision records exactly which fields actually landed.
 * Without the second record the audit trail would imply all four fields
 * were applied when only two were — the history has to be able to say what
 * really happened.
 */
export async function applyRevisionAction(input: {
  workspaceId: string;
  revisionId: string;
  fields: string[];
}): Promise<ApplyRevisionResult> {
  const parsed = applyRevisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Missing revision." };
  const { workspaceId, revisionId, fields } = parsed.data;

  // An empty selection is a discard, never an apply-all. Guessing "they
  // meant everything" is the one interpretation that can silently rewrite
  // a plan the human was reviewing precisely because they weren't sure.
  if (fields.length === 0) {
    return discardRevisionAction({ workspaceId, revisionId });
  }

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    const [revision] = await getRevisionQuery(workspaceId, revisionId);
    if (!revision) return { ok: false, error: "Suggestion not found." };
    if (revision.appliedAt) {
      return { ok: false, error: "This suggestion was already applied." };
    }

    const row = await getContentById(workspaceId, revision.contentId);
    if (!row) return { ok: false, error: "That row is no longer available." };

    const resolved = resolvePlanWrite({
      current: { type: row.type, durationSec: row.durationSec },
      proposed: revision.fields,
      selected: fields,
    });
    if (!resolved.ok) return { ok: false, error: resolved.error };
    const { values, scheduledFor, applied } = resolved.write;

    if (applied.includes("assigneeId") && values.assigneeId) {
      const member = await getMembership(workspaceId, values.assigneeId);
      if (!member) {
        return { ok: false, error: "That person isn't in this workspace." };
      }
    }

    // Claim the revision first. The guard lives in the WHERE, so a second
    // person accepting the same suggestion matches 0 rows and is told so
    // rather than double-writing the plan.
    const claimed = await markRevisionAppliedQuery({
      workspaceId,
      revisionId,
      appliedById: user.id,
    });
    if (claimed.length === 0) {
      return { ok: false, error: "Someone just applied this suggestion." };
    }

    if (scheduledFor !== undefined) {
      const slot = await setPlanSlot({
        workspaceId,
        contentId: revision.contentId,
        clientId: row.clientId,
        scheduledFor,
      });
      if (!slot.ok) return { ok: false, error: slot.error };
    }

    if (Object.keys(values).length > 0) {
      await updatePlanCellQuery({
        workspaceId,
        contentId: revision.contentId,
        values,
      });
    }

    // The record of what actually landed, and what it replaced.
    const appliedFields: Record<string, unknown> = {};
    const priorFields: Record<string, unknown> = {};
    for (const field of applied) {
      appliedFields[field] = (revision.fields as Record<string, unknown>)[
        field
      ];
      priorFields[field] =
        (revision.priorFields as Record<string, unknown>)[field] ?? null;
    }
    await recordRevision({
      workspaceId,
      contentId: revision.contentId,
      authorKind: "human",
      authorId: user.id,
      fields: appliedFields,
      priorFields,
      note: `Applied ${applied.length} of ${Object.keys(revision.fields).length} suggested fields`,
    });

    await recordActivity({
      workspaceId,
      subjectType: "content",
      subjectId: revision.contentId,
      actorId: user.id,
      verb: "revision_applied",
      meta: { fields: applied, authorKind: revision.authorKind },
    });

    revalidatePath(`/w/${workspaceId}/calendar`);
    return { ok: true, applied };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}

export async function discardRevisionAction(input: {
  workspaceId: string;
  revisionId: string;
}): Promise<ApplyRevisionResult> {
  const { workspaceId, revisionId } = input;
  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    const [revision] = await getRevisionQuery(workspaceId, revisionId);
    if (!revision) return { ok: false, error: "Suggestion not found." };
    if (revision.appliedAt) {
      return { ok: false, error: "This suggestion was already applied." };
    }

    // Discarding stamps it as resolved rather than deleting it: the table is
    // append-only, and "we considered this and said no" is history worth
    // keeping. Nothing is written to the content row.
    const claimed = await markRevisionAppliedQuery({
      workspaceId,
      revisionId,
      appliedById: user.id,
    });
    if (claimed.length === 0) {
      return { ok: false, error: "Someone just resolved this suggestion." };
    }

    revalidatePath(`/w/${workspaceId}/calendar`);
    return { ok: true, applied: [] };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}

/**
 * Restore is not a revert.
 *
 * It reads what the fields held before an earlier revision and proposes
 * those values as a NEW revision, then applies it. History is never
 * mutated or rolled back — going back is itself a recorded forward step.
 */
export async function restoreRevisionAction(input: {
  workspaceId: string;
  revisionId: string;
}): Promise<ApplyRevisionResult> {
  const { workspaceId, revisionId } = input;
  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    const [revision] = await getRevisionQuery(workspaceId, revisionId);
    if (!revision) return { ok: false, error: "Revision not found." };

    const prior = revision.priorFields as Record<string, unknown>;
    const restorable = Object.keys(prior).filter(
      (f) => prior[f] !== null && prior[f] !== undefined,
    );
    if (restorable.length === 0) {
      return { ok: false, error: "There's no earlier value to restore." };
    }

    const row = await getContentById(workspaceId, revision.contentId);
    if (!row) return { ok: false, error: "That row is no longer available." };

    const newId = await recordRevision({
      workspaceId,
      contentId: revision.contentId,
      authorKind: "human",
      authorId: user.id,
      fields: prior,
      priorFields: {
        type: row.type,
        durationSec: row.durationSec,
        pillar: row.pillar,
        strategyNote: row.strategyNote,
        title: row.title,
        assigneeId: row.assigneeId,
        dueAt: row.dueAt ? row.dueAt.toISOString() : null,
      },
      note: "Restored earlier values",
    });

    return await applyRevisionAction({
      workspaceId,
      revisionId: newId,
      fields: restorable,
    });
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}

const addSlotSchema = z.object({
  workspaceId: z.string().min(1),
  clientId: z.string().min(1),
  title: z.string().trim().min(1, "Give the post a title.").max(140),
  type: z.enum(contentType.enumValues),
  day: z.string(),
  time: z.string(),
});

export async function addCalendarPostAction(
  _prev: CalendarActionState,
  formData: FormData,
): Promise<CalendarActionState> {
  const parsed = addSlotSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    clientId: formData.get("clientId"),
    title: formData.get("title"),
    type: formData.get("type"),
    day: formData.get("day"),
    time: formData.get("time"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, clientId, title, type, day, time } = parsed.data;

  const scheduledFor = parseSlotDateTime(day, time);
  if (!scheduledFor) return { error: "Pick a valid day and time." };

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    const client = await getClientById(workspaceId, clientId);
    if (!client) return { error: "Client not found in this workspace." };
    await createScheduledPost({
      workspaceId,
      clientId,
      title,
      type,
      scheduledFor,
    });
    await emitDomainEvent({
      verb: "slot.scheduled",
      workspaceId,
      subjectType: "content",
      subjectId: clientId,
      slotDate: scheduledFor,
      actorId: user.id,
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/calendar`);
  return undefined;
}

// ---------------------------------------------------------------------------
// U4 — detail panel: on-demand row detail (activity + comments)
// ---------------------------------------------------------------------------

export type RowActivityView = {
  id: string;
  verb: string;
  actorId: string | null;
  meta: Record<string, unknown> | null;
  createdAtIso: string;
};

export type RowCommentView = {
  id: string;
  body: string;
  createdAtIso: string;
  authorName: string | null;
  authorEmail: string;
};

export type RowDetailResult =
  | { ok: true; activity: RowActivityView[]; comments: RowCommentView[] }
  | { ok: false; error: string };

const rowDetailSchema = z.object({
  workspaceId: z.string().min(1),
  contentId: z.string().min(1),
});

/**
 * Detail-panel data, fetched on demand for the ONE row the planner opened.
 *
 * Activity and comments are per-row history; pulling them for all 200 rows
 * on the grid's initial load would be an N+1 the page never needs to pay —
 * the panel is the only consumer, and it only ever shows one row at a time.
 */
export async function loadRowDetailAction(
  workspaceId: string,
  contentId: string,
): Promise<RowDetailResult> {
  const parsed = rowDetailSchema.safeParse({ workspaceId, contentId });
  if (!parsed.success) return { ok: false, error: "Missing row reference." };

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    const row = await getContentById(workspaceId, contentId);
    if (!row) return { ok: false, error: "That row is no longer available." };

    const [activityRows, commentRows] = await Promise.all([
      listActivityForSubject(workspaceId, "content", contentId),
      listComments(workspaceId, contentId),
    ]);

    return {
      ok: true,
      activity: activityRows.map((a) => ({
        id: a.id,
        verb: a.verb,
        actorId: a.actorId,
        meta: a.meta,
        createdAtIso: a.createdAt.toISOString(),
      })),
      comments: commentRows.map((c) => ({
        id: c.id,
        body: c.body,
        createdAtIso: c.createdAt.toISOString(),
        authorName: c.authorName,
        authorEmail: c.authorEmail,
      })),
    };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}

const addRowCommentSchema = z.object({
  workspaceId: z.string().min(1),
  contentId: z.string().min(1),
  body: z.string().trim().min(1, "Write something first").max(1000),
});

export type AddRowCommentResult =
  | { ok: true; comment: RowCommentView }
  | { ok: false; error: string };

/**
 * Post a comment from the detail panel.
 *
 * Returns just the one new comment, not the whole (200-row-capped) thread —
 * the author is always the caller's own session user, so every field the
 * client needs (name, email, body, timestamp) is already in hand from
 * `user` and the insert's `.returning()`, with no second query required. The
 * caller appends it to whatever thread it already has loaded.
 */
export async function addPlanRowCommentAction(input: {
  workspaceId: string;
  contentId: string;
  body: string;
}): Promise<AddRowCommentResult> {
  const parsed = addRowCommentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const { workspaceId, contentId, body } = parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    const row = await getContentById(workspaceId, contentId);
    if (!row) return { ok: false, error: "That row is no longer available." };

    const inserted = await addComment({
      workspaceId,
      contentId,
      authorId: user.id,
      body,
    });

    return {
      ok: true,
      comment: {
        id: inserted.id,
        body,
        createdAtIso: inserted.createdAt.toISOString(),
        authorName: user.name ?? null,
        authorEmail: user.email ?? "",
      },
    };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}
