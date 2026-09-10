import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  content,
  workflows,
  workflowStates,
  workflowTransitions,
  workTypes,
} from "@/db/schema";
import {
  CONTENT_WORK_TYPE_KEY,
  DEFAULT_CONTENT_STATES,
  DEFAULT_CONTENT_TRANSITIONS,
} from "@/lib/workflow/defaults";

export type SeedResult = {
  workflowId: string;
  created: boolean;
  backfilled: number;
};

/**
 * W1 — gives one workspace the default content workflow and points its
 * existing rows at it.
 *
 * Idempotent by construction: it looks for the seeded work type first and
 * returns the existing workflow untouched if it's already there. That
 * matters because this runs lazily on read (see ensureContentWorkflow
 * callers) rather than as a one-shot script — a workspace created next
 * month needs seeding just as much as one that exists today, and a
 * migration file can't reach a row that doesn't exist yet.
 *
 * The whole thing is one transaction: a workflow with states but no
 * transitions is a dead end no UI could escape from, so partial seeding is
 * worse than none.
 */
export async function seedContentWorkflow(
  workspaceId: string,
): Promise<SeedResult> {
  const existing = await db
    .select({ id: workflows.id })
    .from(workflows)
    .innerJoin(workTypes, eq(workTypes.id, workflows.workTypeId))
    .where(
      and(
        eq(workflows.workspaceId, workspaceId),
        eq(workTypes.key, CONTENT_WORK_TYPE_KEY),
        eq(workflows.isDefault, true),
      ),
    )
    .limit(1);

  if (existing[0]) {
    const backfilled = await backfillContentStates(workspaceId);
    return { workflowId: existing[0].id, created: false, backfilled };
  }

  const workflowId = await db.transaction(async (tx) => {
    const [workType] = await tx
      .insert(workTypes)
      .values({
        workspaceId,
        key: CONTENT_WORK_TYPE_KEY,
        name: "Content",
        description: "Posts, reels and everything else that ships to a client.",
      })
      .returning({ id: workTypes.id });

    const [workflow] = await tx
      .insert(workflows)
      .values({
        workspaceId,
        workTypeId: workType.id,
        name: "Content production",
        isDefault: true,
      })
      .returning({ id: workflows.id });

    const stateRows = await tx
      .insert(workflowStates)
      .values(
        DEFAULT_CONTENT_STATES.map((state, index) => ({
          workspaceId,
          workflowId: workflow.id,
          key: state.key,
          name: state.name,
          category: state.category,
          colorKey: state.colorKey,
          position: index,
          legacyStage: state.legacyStage,
        })),
      )
      .returning({ id: workflowStates.id, key: workflowStates.key });

    const idByKey = new Map(stateRows.map((row) => [row.key, row.id]));

    await tx.insert(workflowTransitions).values(
      DEFAULT_CONTENT_TRANSITIONS.map((transition, index) => ({
        workspaceId,
        workflowId: workflow.id,
        fromStateId: transition.from ? idByKey.get(transition.from) : null,
        toStateId: idByKey.get(transition.to)!,
        name: transition.name,
        position: index,
      })),
    );

    return workflow.id;
  });

  const backfilled = await backfillContentStates(workspaceId);
  return { workflowId, created: true, backfilled };
}

/**
 * Points content rows at the workflow state matching their legacy
 * production_stage.
 *
 * Only touches rows where workflow_state_id IS NULL, so it is safe to run
 * repeatedly and can never stomp a state the engine already set. Rows with
 * a null production_stage are deliberately left alone: they were never on a
 * board, and inventing a stage for them would put work in front of people
 * that nobody had staged.
 */
export async function backfillContentStates(
  workspaceId: string,
): Promise<number> {
  // RETURNING is what makes the count honest. Without it an UPDATE gives
  // back no rows and any length check reports 0 no matter how many rows
  // moved — a seed script that silently under-reports is worse than one
  // that reports nothing, because it looks like a no-op that succeeded.
  const rows = await db.execute(sql`
    UPDATE ${content} AS c
    SET workflow_state_id = s.id
    FROM ${workflowStates} AS s
    INNER JOIN ${workflows} AS w ON w.id = s.workflow_id
    INNER JOIN ${workTypes} AS wt ON wt.id = w.work_type_id
    WHERE c.workspace_id = ${workspaceId}
      AND s.workspace_id = ${workspaceId}
      AND wt.key = ${CONTENT_WORK_TYPE_KEY}
      AND w.is_default = true
      AND c.workflow_state_id IS NULL
      AND c.production_stage IS NOT NULL
      AND s.legacy_stage = c.production_stage
    RETURNING c.id
  `);
  return rows.length;
}

/** The default content workflow for a workspace, seeding it on first use. */
export async function ensureContentWorkflow(
  workspaceId: string,
): Promise<string> {
  const { workflowId } = await seedContentWorkflow(workspaceId);
  return workflowId;
}

/** States of one workflow, board order. */
export function workflowStatesQuery(workspaceId: string, workflowId: string) {
  return db
    .select()
    .from(workflowStates)
    .where(
      and(
        eq(workflowStates.workspaceId, workspaceId),
        eq(workflowStates.workflowId, workflowId),
      ),
    )
    .orderBy(workflowStates.position)
    .limit(100);
}

/** Transitions of one workflow, including the initial (fromStateId null). */
export function workflowTransitionsQuery(
  workspaceId: string,
  workflowId: string,
) {
  return db
    .select()
    .from(workflowTransitions)
    .where(
      and(
        eq(workflowTransitions.workspaceId, workspaceId),
        eq(workflowTransitions.workflowId, workflowId),
      ),
    )
    .orderBy(workflowTransitions.position)
    .limit(500);
}

/** The state a brand-new row adopts — the target of the initial transition. */
export function initialStateQuery(workspaceId: string, workflowId: string) {
  return db
    .select({ toStateId: workflowTransitions.toStateId })
    .from(workflowTransitions)
    .where(
      and(
        eq(workflowTransitions.workspaceId, workspaceId),
        eq(workflowTransitions.workflowId, workflowId),
        isNull(workflowTransitions.fromStateId),
      ),
    )
    .limit(1);
}
