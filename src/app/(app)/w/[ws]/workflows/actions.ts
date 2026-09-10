"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/auth";
import { db } from "@/db";
import {
  content,
  workflowStates,
  workflowTransitions,
  type WorkflowRule,
} from "@/db/schema";
import { requireCapability } from "@/db/queries/memberships";
import { loadContentWorkflow } from "@/db/queries/workflow";
import { actionErrorMessage } from "@/lib/action-errors";
import { WORKFLOW_STATE_COLORS } from "@/lib/workflow/defaults";
import { validateRuleConfig, type WorkflowRuleCategory } from "@/lib/workflow/rules";

export type WorkflowAdminState = { error?: string } | undefined;

const COLOR_KEYS = Object.keys(WORKFLOW_STATE_COLORS) as [string, ...string[]];

/** Slug for a new state's stable machine key. Keys are what code and
 *  seeded data match on, so they stay lowercase and punctuation-free even
 *  when the display name doesn't. */
function toKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

const addStateSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1, "Give the state a name").max(40),
  category: z.enum(["todo", "doing", "done"]),
  colorKey: z.enum(COLOR_KEYS),
  wipLimit: z.coerce.number().int().min(0).max(999).nullable().optional(),
});

export async function addStateAction(
  _prev: WorkflowAdminState,
  formData: FormData,
): Promise<WorkflowAdminState> {
  const rawLimit = formData.get("wipLimit");
  const parsed = addStateSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    name: formData.get("name"),
    category: formData.get("category"),
    colorKey: formData.get("colorKey"),
    wipLimit: rawLimit === "" || rawLimit === null ? null : rawLimit,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, name, category, colorKey, wipLimit } = parsed.data;

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, "workflow.edit");

    const workflow = await loadContentWorkflow(workspaceId);
    const key = toKey(name);
    if (!key) return { error: "That name has no usable letters or digits." };
    if (workflow.states.some((s) => s.key === key)) {
      return { error: `A state called "${name}" already exists.` };
    }

    // Appended at the end. Inserting mid-board would silently renumber
    // every state after it, and reordering is its own explicit action.
    const nextPosition =
      Math.max(-1, ...workflow.states.map((s) => s.position)) + 1;

    await db.insert(workflowStates).values({
      workspaceId,
      workflowId: workflow.id,
      key,
      name,
      category,
      colorKey,
      position: nextPosition,
      wipLimit: wipLimit ?? null,
      // Custom states have no enum value to mirror, so transitions into
      // them stop dual-writing production_stage. That is intended: it is
      // what "this workspace has customised" means.
      legacyStage: null,
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/workflows`);
  revalidatePath(`/w/${workspaceId}/production`);
  return undefined;
}

const renameStateSchema = z.object({
  workspaceId: z.string().min(1),
  stateId: z.string().min(1),
  name: z.string().trim().min(1, "Give the state a name").max(40),
  wipLimit: z.coerce.number().int().min(0).max(999).nullable().optional(),
});

/**
 * Renames a state and sets its WIP limit. The KEY is deliberately never
 * changed: seeded rows, legacy_stage mapping and any stored reference match
 * on it, so renaming "Internal review" to "Client review" must move the
 * label without breaking what points at it.
 */
export async function renameStateAction(
  _prev: WorkflowAdminState,
  formData: FormData,
): Promise<WorkflowAdminState> {
  const rawLimit = formData.get("wipLimit");
  const parsed = renameStateSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    stateId: formData.get("stateId"),
    name: formData.get("name"),
    wipLimit: rawLimit === "" || rawLimit === null ? null : rawLimit,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, stateId, name, wipLimit } = parsed.data;

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, "workflow.edit");

    const updated = await db
      .update(workflowStates)
      .set({ name, wipLimit: wipLimit ?? null })
      .where(
        and(
          eq(workflowStates.workspaceId, workspaceId),
          eq(workflowStates.id, stateId),
        ),
      )
      .returning({ id: workflowStates.id });
    if (updated.length === 0) return { error: "That state no longer exists." };
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/workflows`);
  revalidatePath(`/w/${workspaceId}/production`);
  return undefined;
}

const deleteStateSchema = z.object({
  workspaceId: z.string().min(1),
  stateId: z.string().min(1),
});

/**
 * Removes a state, refusing while any card still sits in it.
 *
 * The cascade would happily delete the row and null out every card's
 * workflow_state_id, silently dropping that work off every board. Refusing
 * with a count tells the admin exactly what to move first.
 */
export async function deleteStateAction(
  _prev: WorkflowAdminState,
  formData: FormData,
): Promise<WorkflowAdminState> {
  const parsed = deleteStateSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    stateId: formData.get("stateId"),
  });
  if (!parsed.success) return { error: "Missing state." };
  const { workspaceId, stateId } = parsed.data;

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, "workflow.edit");

    const [{ count } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(content)
      .where(
        and(
          eq(content.workspaceId, workspaceId),
          eq(content.workflowStateId, stateId),
        ),
      );
    if (count > 0) {
      return {
        error: `${count} card${count === 1 ? " is" : "s are"} still in this state — move them first.`,
      };
    }

    const workflow = await loadContentWorkflow(workspaceId);
    if (workflow.states.length <= 1) {
      return { error: "A workflow needs at least one state." };
    }

    await db
      .delete(workflowStates)
      .where(
        and(
          eq(workflowStates.workspaceId, workspaceId),
          eq(workflowStates.id, stateId),
        ),
      );
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/workflows`);
  revalidatePath(`/w/${workspaceId}/production`);
  return undefined;
}

const moveStateSchema = z.object({
  workspaceId: z.string().min(1),
  stateId: z.string().min(1),
  direction: z.enum(["left", "right"]),
});

/** Swaps a state with its neighbour. Swapping rather than renumbering keeps
 *  every other position untouched, so two admins reordering different parts
 *  of the board can't clobber each other. */
export async function moveStateAction(
  _prev: WorkflowAdminState,
  formData: FormData,
): Promise<WorkflowAdminState> {
  const parsed = moveStateSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    stateId: formData.get("stateId"),
    direction: formData.get("direction"),
  });
  if (!parsed.success) return { error: "Missing state." };
  const { workspaceId, stateId, direction } = parsed.data;

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, "workflow.edit");

    const workflow = await loadContentWorkflow(workspaceId);
    const ordered = [...workflow.states].sort(
      (a, b) => a.position - b.position,
    );
    const index = ordered.findIndex((s) => s.id === stateId);
    if (index === -1) return { error: "That state no longer exists." };

    const swapWith = direction === "left" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= ordered.length) return undefined;

    const a = ordered[index];
    const b = ordered[swapWith];
    await db.transaction(async (tx) => {
      await tx
        .update(workflowStates)
        .set({ position: b.position })
        .where(
          and(
            eq(workflowStates.workspaceId, workspaceId),
            eq(workflowStates.id, a.id),
          ),
        );
      await tx
        .update(workflowStates)
        .set({ position: a.position })
        .where(
          and(
            eq(workflowStates.workspaceId, workspaceId),
            eq(workflowStates.id, b.id),
          ),
        );
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/workflows`);
  revalidatePath(`/w/${workspaceId}/production`);
  return undefined;
}

const transitionSchema = z.object({
  workspaceId: z.string().min(1),
  fromStateId: z.string().min(1),
  toStateId: z.string().min(1),
  name: z.string().trim().min(1, "Name the move, e.g. “Send back”").max(40),
});

export async function addTransitionAction(
  _prev: WorkflowAdminState,
  formData: FormData,
): Promise<WorkflowAdminState> {
  const parsed = transitionSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    fromStateId: formData.get("fromStateId"),
    toStateId: formData.get("toStateId"),
    name: formData.get("name"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, fromStateId, toStateId, name } = parsed.data;

  if (fromStateId === toStateId) {
    return { error: "A state can't transition to itself." };
  }

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, "workflow.edit");

    const workflow = await loadContentWorkflow(workspaceId);
    const known = new Set(workflow.states.map((s) => s.id));
    if (!known.has(fromStateId) || !known.has(toStateId)) {
      return { error: "That state isn't part of this workflow." };
    }
    if (
      workflow.transitions.some(
        (t) => t.fromStateId === fromStateId && t.toStateId === toStateId,
      )
    ) {
      return { error: "That move already exists." };
    }

    await db.insert(workflowTransitions).values({
      workspaceId,
      workflowId: workflow.id,
      fromStateId,
      toStateId,
      name,
      position: workflow.transitions.length,
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/workflows`);
  revalidatePath(`/w/${workspaceId}/production`);
  return undefined;
}

const deleteTransitionSchema = z.object({
  workspaceId: z.string().min(1),
  transitionId: z.string().min(1),
});

export async function deleteTransitionAction(
  _prev: WorkflowAdminState,
  formData: FormData,
): Promise<WorkflowAdminState> {
  const parsed = deleteTransitionSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    transitionId: formData.get("transitionId"),
  });
  if (!parsed.success) return { error: "Missing move." };
  const { workspaceId, transitionId } = parsed.data;

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, "workflow.edit");

    const workflow = await loadContentWorkflow(workspaceId);
    const target = workflow.transitions.find((t) => t.id === transitionId);
    // The initial transition defines where new work starts. Deleting it
    // would leave the workflow unable to say what a new card becomes.
    if (target && target.fromStateId === null) {
      return { error: "The starting move can't be removed." };
    }

    await db
      .delete(workflowTransitions)
      .where(
        and(
          eq(workflowTransitions.workspaceId, workspaceId),
          eq(workflowTransitions.id, transitionId),
        ),
      );
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/workflows`);
  revalidatePath(`/w/${workspaceId}/production`);
  return undefined;
}

const addRuleSchema = z.object({
  workspaceId: z.string().min(1),
  transitionId: z.string().min(1),
  category: z.enum(["condition", "validator", "postAction"]),
  kind: z.string().min(1),
  // Rule-specific fields arrive as individual form fields rather than one
  // JSON blob — a raw JSON textarea is how a malformed rule ends up gating
  // a transition nobody can then explain. Each kind names its own fields.
  capability: z.string().optional(),
  message: z.string().optional(),
  days: z.string().optional(),
});

/**
 * W5 — attaches one rule to a transition.
 *
 * Config is assembled per-kind, then validated through the SAME registry
 * the engine evaluates with (validateRuleConfig) — an admin cannot attach a
 * rule the evaluator would silently skip as malformed, because the two use
 * the one schema.
 */
export async function addRuleAction(
  _prev: WorkflowAdminState,
  formData: FormData,
): Promise<WorkflowAdminState> {
  const parsed = addRuleSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    transitionId: formData.get("transitionId"),
    category: formData.get("category"),
    kind: formData.get("kind"),
    capability: formData.get("capability") || undefined,
    message: formData.get("message") || undefined,
    days: formData.get("days") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, transitionId, category, kind } = parsed.data;

  const config: Record<string, unknown> = {};
  if (kind === "requires_capability") config.capability = parsed.data.capability;
  if (kind === "notify_assignee" && parsed.data.message) {
    config.message = parsed.data.message;
  }
  if (kind === "set_due_offset") config.days = Number(parsed.data.days ?? 0);

  const checked = validateRuleConfig(kind, config);
  if (!checked.ok) return { error: checked.error };

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, "workflow.edit");

    const workflow = await loadContentWorkflow(workspaceId);
    const transition = workflow.transitions.find((t) => t.id === transitionId);
    if (!transition) return { error: "That move no longer exists." };

    const source: Record<WorkflowRuleCategory, WorkflowRule[]> = {
      condition: transition.conditions,
      validator: transition.validators,
      postAction: transition.postActions,
    };
    const rule: WorkflowRule = { kind, config: checked.config };
    await setRulesColumn(workspaceId, transitionId, category, [
      ...source[category],
      rule,
    ]);
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/workflows`);
  return undefined;
}

/**
 * Writes one rule category's column, chosen explicitly rather than through
 * a computed property key — drizzle's `.set()` is typed against the exact
 * row shape, and a `{[dynamicKey]: value}` object defeats that checking
 * silently instead of failing to compile.
 */
async function setRulesColumn(
  workspaceId: string,
  transitionId: string,
  category: WorkflowRuleCategory,
  value: WorkflowRule[],
): Promise<void> {
  const where = and(
    eq(workflowTransitions.workspaceId, workspaceId),
    eq(workflowTransitions.id, transitionId),
  );
  if (category === "condition") {
    await db.update(workflowTransitions).set({ conditions: value }).where(where);
  } else if (category === "validator") {
    await db.update(workflowTransitions).set({ validators: value }).where(where);
  } else {
    await db.update(workflowTransitions).set({ postActions: value }).where(where);
  }
}

const removeRuleSchema = z.object({
  workspaceId: z.string().min(1),
  transitionId: z.string().min(1),
  category: z.enum(["condition", "validator", "postAction"]),
  index: z.coerce.number().int().min(0),
});

export async function removeRuleAction(
  _prev: WorkflowAdminState,
  formData: FormData,
): Promise<WorkflowAdminState> {
  const parsed = removeRuleSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    transitionId: formData.get("transitionId"),
    category: formData.get("category"),
    index: formData.get("index"),
  });
  if (!parsed.success) return { error: "Missing rule." };
  const { workspaceId, transitionId, category, index } = parsed.data;

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, "workflow.edit");

    const workflow = await loadContentWorkflow(workspaceId);
    const transition = workflow.transitions.find((t) => t.id === transitionId);
    if (!transition) return { error: "That move no longer exists." };

    const source: Record<WorkflowRuleCategory, WorkflowRule[]> = {
      condition: transition.conditions,
      validator: transition.validators,
      postAction: transition.postActions,
    };
    const next = source[category].filter((_, i) => i !== index);
    await setRulesColumn(workspaceId, transitionId, category, next);
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/workflows`);
  return undefined;
}
