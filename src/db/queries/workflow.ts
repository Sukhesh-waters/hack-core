import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  clients,
  content,
  users,
  workflowStates,
  type WorkflowRule,
} from "@/db/schema";
import { recordActivity } from "@/lib/activity";
import { notify } from "@/db/queries/notifications";
import type { MembershipRole } from "@/lib/permissions";
import type { ProductionStage } from "@/lib/production";

import {
  decideTransition,
  type LoadedWorkflow,
  type EngineState,
  type EngineTransition,
} from "@/lib/workflow/engine";
import {
  evaluateConditions,
  evaluateValidators,
  isPostActionKind,
  validateRuleConfig,
} from "@/lib/workflow/rules";
import {
  ensureContentWorkflow,
  workflowStatesQuery,
  workflowTransitionsQuery,
} from "./workflow-seed";

/**
 * Loads a workspace's default content workflow into the shape the pure
 * engine expects, seeding it on first use.
 */
export async function loadContentWorkflow(
  workspaceId: string,
): Promise<LoadedWorkflow> {
  const workflowId = await ensureContentWorkflow(workspaceId);
  const [states, transitions] = await Promise.all([
    workflowStatesQuery(workspaceId, workflowId),
    workflowTransitionsQuery(workspaceId, workflowId),
  ]);

  return {
    id: workflowId,
    name: "Content production",
    states: states.map(
      (s): EngineState => ({
        id: s.id,
        key: s.key,
        name: s.name,
        category: s.category,
        colorKey: s.colorKey,
        position: s.position,
        wipLimit: s.wipLimit,
        legacyStage: s.legacyStage as ProductionStage | null,
      }),
    ),
    transitions: transitions.map(
      (t): EngineTransition => ({
        id: t.id,
        fromStateId: t.fromStateId,
        toStateId: t.toStateId,
        name: t.name,
        position: t.position,
        conditions: t.conditions,
        validators: t.validators,
        postActions: t.postActions,
      }),
    ),
  };
}

/**
 * The guarded write. `workflow_state_id = fromStateId` in the WHERE is what
 * makes a raced or stale move match zero rows instead of applying twice —
 * the same pattern advanceStageQuery uses, and the reason a second tab
 * clicking the same button gets an honest error rather than a silent
 * double-apply.
 *
 * Dual-writes production_stage only when the target state mirrors an enum
 * value. A custom state leaves the legacy column untouched rather than
 * guessing at a word the enum doesn't have.
 */
export function applyTransitionQuery(input: {
  workspaceId: string;
  contentId: string;
  fromStateId: string;
  toStateId: string;
  legacyStage: ProductionStage | null;
}) {
  return db
    .update(content)
    .set({
      workflowStateId: input.toStateId,
      ...(input.legacyStage ? { productionStage: input.legacyStage } : {}),
    })
    .where(
      and(
        eq(content.workspaceId, input.workspaceId),
        eq(content.id, input.contentId),
        eq(content.workflowStateId, input.fromStateId),
      ),
    )
    .returning({ id: content.id });
}

export type TransitionResult =
  | { ok: true; toStateId: string; toName: string }
  | { ok: false; error: string };

/**
 * Moves one content row through its workflow.
 *
 * Legality is decided by the pure engine against the workspace's own
 * workflow rows — not by any hardcoded graph — and the write is guarded on
 * the state we believed the row was in.
 */
export async function transitionContent(input: {
  workspaceId: string;
  contentId: string;
  toStateId: string;
  actorId: string | null;
  /** Needed for `requires_capability` conditions. A system-initiated move
   *  (no signed-in actor) has no role to check against, so it skips
   *  conditions entirely — an automation isn't subject to a human gate. */
  actorRole?: MembershipRole;
}): Promise<TransitionResult> {
  const { workspaceId, contentId, toStateId, actorId, actorRole } = input;

  const [row] = await db
    .select({
      id: content.id,
      title: content.title,
      workflowStateId: content.workflowStateId,
      productionStage: content.productionStage,
      assigneeId: content.assigneeId,
      body: content.body,
      complianceStatus: content.complianceStatus,
    })
    .from(content)
    .where(and(eq(content.workspaceId, workspaceId), eq(content.id, contentId)))
    .limit(1);
  if (!row) return { ok: false, error: "That card is no longer available." };

  const workflow = await loadContentWorkflow(workspaceId);

  // A row that predates the engine (or was created by a path that doesn't
  // set the state yet) is adopted into its matching state rather than
  // refused — refusing would strand real work behind a migration detail.
  // The `productionStage !== null` guard matters: a custom state also has
  // `legacyStage === null`, so without it a row that was never staged at
  // all would false-match the first custom state instead of correctly
  // falling through to "isn't on a workflow yet".
  const fromStateId =
    row.workflowStateId ??
    (row.productionStage
      ? (workflow.states.find((s) => s.legacyStage === row.productionStage)
          ?.id ?? null)
      : null);
  if (!fromStateId) {
    return {
      ok: false,
      error: "This card isn't on a workflow yet.",
    };
  }

  const decision = decideTransition({
    workflow,
    fromStateId,
    toStateId,
  });
  if (!decision.ok) return { ok: false, error: decision.error };

  // W5 — rules are evaluated AFTER graph legality and BEFORE the write.
  // Graph legality answers "does this edge exist"; rules answer "is this
  // specific row, right now, allowed to use it". A transition that exists
  // but is gated must fail exactly like one that doesn't, from the caller's
  // point of view — a rejected move either way, never a partial state.
  if (actorId && actorRole) {
    const ruleContext = {
      actorId,
      actorRole,
      content: {
        assigneeId: row.assigneeId,
        body: row.body,
        complianceStatus: row.complianceStatus,
      },
    };
    const conditionCheck = evaluateConditions(
      decision.transition.conditions,
      ruleContext,
    );
    if (!conditionCheck.ok) return { ok: false, error: conditionCheck.reason };

    const validatorCheck = evaluateValidators(
      decision.transition.validators,
      ruleContext,
    );
    if (!validatorCheck.ok) return { ok: false, error: validatorCheck.reason };
  }

  const moved = await applyTransitionQuery({
    workspaceId,
    contentId,
    fromStateId,
    toStateId,
    legacyStage: decision.legacyStage,
  });
  if (moved.length === 0) {
    return {
      ok: false,
      error: "This card was already moved. Refresh to see its state.",
    };
  }

  const from = workflow.states.find((s) => s.id === fromStateId);
  await recordActivity({
    workspaceId,
    subjectType: "content",
    subjectId: contentId,
    actorId,
    verb: "stage_advanced",
    meta: {
      from: from?.key ?? null,
      to: decision.to.key,
      transition: decision.transition.name,
    },
  });

  // Post-actions run after the write has already succeeded. They are
  // consequences of the move, not conditions of it — a notification that
  // fails to send must never make the move itself look like it failed, so
  // this never affects the returned result.
  await runPostActions({
    workspaceId,
    contentId,
    title: row.title,
    assigneeId: row.assigneeId,
    postActions: decision.transition.postActions,
  });

  return { ok: true, toStateId, toName: decision.to.name };
}

async function runPostActions(input: {
  workspaceId: string;
  contentId: string;
  title: string;
  assigneeId: string | null;
  postActions: WorkflowRule[];
}): Promise<void> {
  const { workspaceId, contentId, title, assigneeId, postActions } = input;

  for (const rule of postActions) {
    if (!isPostActionKind(rule.kind)) continue;
    const checked = validateRuleConfig(rule.kind, rule.config);
    if (!checked.ok) continue;

    // Each rule runs in its own try/catch: a failing notification must not
    // stop a later set_due_offset from applying, and — the whole reason
    // this function is never awaited under a try in the caller — must not
    // throw back out and make an already-successful move look like it
    // failed. See the call site's comment in transitionContent.
    try {
      if (rule.kind === "notify_assignee" && assigneeId) {
        await notify({
          workspaceId,
          userId: assigneeId,
          kind: "assigned",
          subjectType: "content",
          subjectId: contentId,
          body:
            (checked.config.message as string | undefined) ??
            `"${title}" moved and needs your attention.`,
        });
      }

      if (rule.kind === "set_due_offset") {
        const days = checked.config.days as number;
        const dueAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        await db
          .update(content)
          .set({ dueAt })
          .where(
            and(
              eq(content.workspaceId, workspaceId),
              eq(content.id, contentId),
            ),
          );
      }
    } catch {
      // Swallowed deliberately — a post-action is a consequence of the
      // move, not a condition of it. There is nowhere to surface this to
      // the actor without making a successful move read as a failure.
    }
  }
}

/**
 * Board cards keyed by the AUTHORITATIVE workflow state.
 *
 * Deliberately joins on workflow_state_id rather than matching
 * production_stage against legacy_stage. The legacy match looks equivalent
 * and is not: the moment a workspace adds a state the enum has no word for,
 * a card sitting in it still carries whatever production_stage it last had,
 * so a legacy-keyed board silently files it under the wrong column. Reading
 * the column the engine actually writes is the only version that stays
 * correct once customisation exists.
 */
export function contentByStateQuery(workspaceId: string) {
  return db
    .select({
      stateId: content.workflowStateId,
      id: content.id,
      title: content.title,
      clientId: content.clientId,
      clientName: clients.name,
      type: content.type,
      revisionCount: content.revisionCount,
      assigneeId: content.assigneeId,
      // LEFT join: an unassigned card is still on the board. An inner join
      // here would silently drop every card the moment nobody owned it.
      assigneeName: users.name,
      dueAt: content.dueAt,
    })
    .from(content)
    .innerJoin(workflowStates, eq(workflowStates.id, content.workflowStateId))
    .innerJoin(clients, eq(clients.id, content.clientId))
    .leftJoin(users, eq(users.id, content.assigneeId))
    .where(eq(content.workspaceId, workspaceId))
    .orderBy(workflowStates.position, content.createdAt)
    .limit(500);
}

export async function listContentByState(workspaceId: string) {
  return contentByStateQuery(workspaceId);
}
