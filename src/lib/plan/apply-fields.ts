import { isVideoContentType, type ContentTypeValue } from "@/db/schema";
import { contentPlanFieldsSchema } from "@/lib/validation";
import { isEditablePlanField, type PlanEditableFields } from "@/lib/plan-cell";

/** The content-column writes a revision resolves to, plus the schedule move
 *  (which lives on a different table) kept separate. */
export type ResolvedPlanWrite = {
  values: {
    type?: ContentTypeValue;
    durationSec?: number | null;
    pillar?: string | null;
    strategyNote?: string | null;
    title?: string;
    assigneeId?: string | null;
    dueAt?: Date | null;
  };
  scheduledFor?: Date | null;
  applied: string[];
};

export type ResolveResult =
  | { ok: true; write: ResolvedPlanWrite }
  | { ok: false; error: string };

/**
 * Turns a revision's proposed fields into validated writes.
 *
 * Shared with the per-cell path on purpose: an AI suggestion must not be
 * able to write a value a human couldn't type. The duration/type invariant
 * is checked against the row as it would be AFTER every selected field is
 * applied — accepting `type: static` and `durationSec: 30` together is a
 * violation even though each looks fine alone.
 */
export function resolvePlanWrite(input: {
  current: { type: string; durationSec: number | null };
  proposed: Partial<PlanEditableFields>;
  /** Subset the human selected. Empty means nothing was chosen. */
  selected: string[];
}): ResolveResult {
  const { current, proposed, selected } = input;

  const applied = selected.filter(
    (f) => isEditablePlanField(f) && f in proposed,
  );
  if (applied.length === 0) {
    return { ok: false, error: "Nothing selected to apply." };
  }

  const write: ResolvedPlanWrite = { values: {}, applied };

  const nextType = applied.includes("type")
    ? String(proposed.type)
    : current.type;

  const durationSelected = applied.includes("durationSec");

  // Moving to a non-video type clears the duration with it, so the reviewer
  // isn't refused over a field they never selected.
  //
  // But an explicitly selected duration always wins the tie-break: choosing
  // `static` AND `durationSec: 30` together is a real conflict the reviewer
  // asked for, and it must fail validation rather than be silently dropped.
  const movingToNonVideo =
    applied.includes("type") &&
    !isVideoContentType(nextType as ContentTypeValue);

  const nextDuration = durationSelected
    ? proposed.durationSec === null || proposed.durationSec === undefined
      ? null
      : Number(proposed.durationSec)
    : movingToNonVideo
      ? null
      : current.durationSec;

  const check = contentPlanFieldsSchema.safeParse({
    type: nextType,
    durationSec: nextDuration,
  });
  if (!check.success) {
    return { ok: false, error: check.error.issues[0].message };
  }

  for (const field of applied) {
    switch (field) {
      case "type":
        write.values.type = check.data.type;
        if (movingToNonVideo && !durationSelected)
          write.values.durationSec = null;
        break;
      case "durationSec":
        write.values.durationSec = check.data.durationSec ?? null;
        break;
      case "title": {
        const title = String(proposed.title ?? "").trim();
        if (!title) return { ok: false, error: "A title can't be empty." };
        if (title.length > 140) {
          return { ok: false, error: "Keep titles to 140 characters." };
        }
        write.values.title = title;
        break;
      }
      case "pillar":
        write.values.pillar = proposed.pillar
          ? String(proposed.pillar).trim().slice(0, 120)
          : null;
        break;
      case "strategyNote":
        write.values.strategyNote = proposed.strategyNote
          ? String(proposed.strategyNote).trim().slice(0, 2000)
          : null;
        break;
      case "assigneeId":
        write.values.assigneeId = proposed.assigneeId
          ? String(proposed.assigneeId)
          : null;
        break;
      case "dueAt": {
        if (!proposed.dueAt) {
          write.values.dueAt = null;
          break;
        }
        const due = new Date(String(proposed.dueAt));
        if (Number.isNaN(due.getTime())) {
          return { ok: false, error: "That due date isn't valid." };
        }
        write.values.dueAt = due;
        break;
      }
      case "scheduledFor": {
        if (!proposed.scheduledFor) {
          write.scheduledFor = null;
          break;
        }
        const when = new Date(String(proposed.scheduledFor));
        if (Number.isNaN(when.getTime())) {
          return { ok: false, error: "That publish slot isn't valid." };
        }
        write.scheduledFor = when;
        break;
      }
    }
  }

  return { ok: true, write };
}
