import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { activity, activitySubject } from "@/db/schema";

/** Derived from the pgEnum rather than restated. The hand-written union
 *  silently drifted the moment a subject was added to the schema, so a real
 *  subject was unassignable here while typechecking clean everywhere else. */
export type ActivitySubjectType =
  (typeof activitySubject.enumValues)[number];

/** A page of history, not the whole table. */
const ACTIVITY_CAP = 100;

export type RecordActivityInput = {
  workspaceId: string;
  subjectType: ActivitySubjectType;
  subjectId: string;
  /** Null for system/automation actors — see the schema comment. */
  actorId: string | null;
  verb: string;
  meta?: Record<string, unknown>;
};

/**
 * Writes one activity row.
 *
 * Never throws. Activity is observability, not the operation: a failed
 * insert here must not roll back the stage advance, approval or schedule
 * that it was recording. Losing a history line is bad; losing the user's
 * actual work because the audit table hiccuped is much worse.
 *
 * Pass `tx` when the caller genuinely needs the record to be atomic with
 * its writes (S8's pushToTeam) — there the failure SHOULD propagate, so
 * the transaction rolls back as a unit.
 */
export async function recordActivity(
  input: RecordActivityInput,
  tx?: Pick<typeof db, "insert">,
): Promise<void> {
  const values = {
    workspaceId: input.workspaceId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    actorId: input.actorId,
    verb: input.verb,
    meta: input.meta ?? null,
  };

  if (tx) {
    await tx.insert(activity).values(values);
    return;
  }

  try {
    await db.insert(activity).values(values);
  } catch (error) {
    console.error("[activity] failed to record", input.verb, error);
  }
}

/** One subject's timeline, newest first. */
export function activityForSubjectQuery(
  workspaceId: string,
  subjectType: ActivitySubjectType,
  subjectId: string,
) {
  return db
    .select()
    .from(activity)
    .where(
      and(
        eq(activity.workspaceId, workspaceId),
        eq(activity.subjectType, subjectType),
        eq(activity.subjectId, subjectId),
      ),
    )
    .orderBy(desc(activity.createdAt))
    .limit(ACTIVITY_CAP);
}

export async function listActivityForSubject(
  workspaceId: string,
  subjectType: ActivitySubjectType,
  subjectId: string,
) {
  return activityForSubjectQuery(workspaceId, subjectType, subjectId);
}
