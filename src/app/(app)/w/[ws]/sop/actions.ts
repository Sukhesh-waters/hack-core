"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/auth";
import { db } from "@/db";
import {
  clients,
  content,
  hubTasks,
  sopRunSteps,
  sopRuns,
  sopSteps,
  sopTemplates,
  tickets,
  workspaceDocs,
} from "@/db/schema";
import {
  listWorkspaceMembers,
  requireCapability,
} from "@/db/queries/memberships";
import {
  generateTemplateDraft,
  type GeneratedSopTemplate,
  suggestNextAction,
  type StepSuggestion,
} from "@/lib/ai/agents/strategy";


import {
  assignRunStep,
  cancelSopRun,
  getRunStep,
  loadSopRun,
  loadSopTemplate,
  moveRunStep,
  nextStepPosition,
  sopRunStepsQuery,
  sopStepsQuery,
  applyRescheduledDates,
  reanchorSopRun,
  templateBelongsToWorkspace,
} from "@/db/queries/sop";
import {
  ensureContentWorkflow,
  initialStateQuery,
} from "@/db/queries/workflow-seed";
import { actionErrorMessage } from "@/lib/action-errors";
import { recordActivity } from "@/lib/activity";
import { notify } from "@/db/queries/notifications";
import { emitDomainEvent } from "@/lib/events/dispatch";
import {
  unknownDependencies,
  wouldCreateCycle,
  type SopStepNode,
} from "@/lib/sop/dependencies";
import { instantiateRun } from "@/lib/sop/instantiate";
import { reanchoredDates, rescheduledDates } from "@/lib/sop/risk";
import {
  sopAssigneeRuleSchema,
  sopStepSchema,
  sopTemplateSchema,
} from "@/lib/sop/template";

/**
 * `savedAt` is what tells the client a submit actually succeeded. Returning
 * bare `undefined` made success indistinguishable from "never submitted",
 * so the add-step form had no signal to clear itself — and an uncontrolled
 * form that never clears silently carries the last step's gate, offset and
 * dependencies into the next one. Caught by adding two steps in a browser;
 * it typechecks and tests fine either way.
 */
export type SopActionState =
  | { error?: string; savedAt?: number }
  | undefined;

const ok = (): SopActionState => ({ savedAt: Date.now() });

/**
 * Every action here is gated on `sop.template.edit`, not merely on
 * membership: a template defines the approval gates other people are
 * subject to, so "can edit the process" is a different question from "is in
 * this workspace". `requireCapability` throws a PermissionError whose
 * message names the action, which actionErrorMessage surfaces verbatim.
 */
const CAP = "sop.template.edit" as const;

function requireWorkspaceId(formData: FormData): string | { error: string } {
  const workspaceId = formData.get("workspaceId");
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    return { error: "Missing workspace" };
  }
  return workspaceId;
}

/** Template id from a form, re-checked against the workspace by the caller.
 *  A template id is client-supplied and is never proof of ownership. */
function requireTemplateId(formData: FormData): string | { error: string } {
  const templateId = formData.get("templateId");
  if (typeof templateId !== "string" || templateId.length === 0) {
    return { error: "Missing template" };
  }
  return templateId;
}

export async function createTemplateAction(
  _prev: SopActionState,
  formData: FormData,
): Promise<SopActionState> {
  const workspaceId = requireWorkspaceId(formData);
  if (typeof workspaceId !== "string") return workspaceId;

  const parsed = sopTemplateSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || null,
    anchorLabel: formData.get("anchorLabel") || "Anchor date",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, CAP);
    await db.insert(sopTemplates).values({
      workspaceId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      anchorLabel: parsed.data.anchorLabel,
      createdById: user.id,
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/sop`);
  return ok();
}

export type GenerateTemplateActionState = {
  draft?: GeneratedSopTemplate;
  error?: string;
  savedAt?: number;
};

export async function generateTemplateFromProseAction(
  _prev: GenerateTemplateActionState,
  formData: FormData,
): Promise<GenerateTemplateActionState> {
  const workspaceId = requireWorkspaceId(formData);
  if (typeof workspaceId !== "string") return { error: workspaceId.error };

  const description = formData.get("description");
  if (typeof description !== "string" || !description.trim()) {
    return { error: "Provide a description of the process to generate." };
  }

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, CAP);
    const draft = await generateTemplateDraft({
      description,
      workspaceId,
    });
    return { draft, savedAt: Date.now() };
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}

export async function commitGeneratedTemplateAction(
  _prev: SopActionState,
  formData: FormData,
): Promise<SopActionState> {
  const workspaceId = requireWorkspaceId(formData);
  if (typeof workspaceId !== "string") return workspaceId;

  const name = formData.get("name");
  const description = formData.get("description") || null;
  const anchorLabel = formData.get("anchorLabel") || "Anchor date";
  const stepsJson = formData.get("stepsJson");

  if (typeof name !== "string" || !name.trim()) return { error: "Give the template a name" };
  if (typeof stepsJson !== "string") return { error: "Invalid step data" };

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, CAP);

    const parsedSteps = JSON.parse(stepsJson) as Array<{
      tempId: string;
      title: string;
      description?: string | null;
      dueOffsetDays: number;
      gate: "none" | "approval" | "compliance";
      creates: "none" | "task" | "content" | "ticket" | "doc";
      assigneeRole?: "owner" | "admin" | "member" | null;
      dependsOnTempIds: string[];
    }>;

    await db.transaction(async (tx) => {
      const [tpl] = await tx
        .insert(sopTemplates)
        .values({
          workspaceId,
          name: name.trim(),
          description: typeof description === "string" ? description.trim() : null,
          anchorLabel: typeof anchorLabel === "string" ? anchorLabel.trim() : "Anchor date",
          createdById: user.id,
        })
        .returning({ id: sopTemplates.id });

      // First pass: generate UUID step ids mapping from tempId
      const tempIdToUuid = new Map<string, string>();
      for (const step of parsedSteps) {
        tempIdToUuid.set(step.tempId, crypto.randomUUID());
      }

      // Second pass: insert steps with remapped dependency UUIDs
      for (let i = 0; i < parsedSteps.length; i++) {
        const step = parsedSteps[i];
        const stepId = tempIdToUuid.get(step.tempId) ?? crypto.randomUUID();
        const remappedDependsOn = step.dependsOnTempIds
          .map((id) => tempIdToUuid.get(id))
          .filter((id): id is string => Boolean(id));

        const assigneeRule = step.assigneeRole
          ? { kind: "role" as const, value: step.assigneeRole }
          : { kind: "unassigned" as const };

        await tx.insert(sopSteps).values({
          id: stepId,
          workspaceId,
          templateId: tpl.id,
          position: i,
          title: step.title.trim(),
          description: step.description?.trim() ?? null,
          assigneeRule,
          dueOffsetDays: step.dueOffsetDays,
          gate: step.gate,
          creates: step.creates,
          dependsOn: remappedDependsOn,
        });
      }
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/sop`);
  return ok();
}

export type SuggestionActionState = {
  suggestion?: StepSuggestion | null;
  error?: string;
};

export async function suggestNextActionAction(
  _prev: SuggestionActionState,
  formData: FormData,
): Promise<SuggestionActionState> {
  const workspaceId = requireWorkspaceId(formData);
  if (typeof workspaceId !== "string") return { error: workspaceId.error };
  const runId = formData.get("runId");
  const stepId = formData.get("stepId");

  if (typeof runId !== "string" || typeof stepId !== "string") {
    return { error: "Missing run or step parameters." };
  }

  try {
    await requireUser();
    const runData = await loadSopRun(workspaceId, runId);
    if (!runData) return { error: "Run not found." };

    const targetStep = runData.steps.find((s) => s.id === stepId);
    if (!targetStep) return { error: "Step not found." };

    const suggestion = await suggestNextAction({
      step: targetStep,
      allSteps: runData.steps,
      run: runData.run,
    });

    return { suggestion };
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}



export async function updateTemplateAction(
  _prev: SopActionState,
  formData: FormData,
): Promise<SopActionState> {
  const workspaceId = requireWorkspaceId(formData);
  if (typeof workspaceId !== "string") return workspaceId;
  const templateId = requireTemplateId(formData);
  if (typeof templateId !== "string") return templateId;

  const parsed = sopTemplateSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || null,
    anchorLabel: formData.get("anchorLabel") || "Anchor date",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, CAP);
    await db
      .update(sopTemplates)
      .set({
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        anchorLabel: parsed.data.anchorLabel,
      })
      .where(
        and(
          eq(sopTemplates.workspaceId, workspaceId),
          eq(sopTemplates.id, templateId),
        ),
      );
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/sop/${templateId}`);
  revalidatePath(`/w/${workspaceId}/sop`);
  return ok();
}

/** Soft-retire. Never a delete: a run started from this template still
 *  references its steps, and hard-deleting would strand that history. */
export async function archiveTemplateAction(
  _prev: SopActionState,
  formData: FormData,
): Promise<SopActionState> {
  const workspaceId = requireWorkspaceId(formData);
  if (typeof workspaceId !== "string") return workspaceId;
  const templateId = requireTemplateId(formData);
  if (typeof templateId !== "string") return templateId;

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, CAP);
    await db
      .update(sopTemplates)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(sopTemplates.workspaceId, workspaceId),
          eq(sopTemplates.id, templateId),
        ),
      );
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/sop`);
  return ok();
}

export async function addStepAction(
  _prev: SopActionState,
  formData: FormData,
): Promise<SopActionState> {
  const workspaceId = requireWorkspaceId(formData);
  if (typeof workspaceId !== "string") return workspaceId;
  const templateId = requireTemplateId(formData);
  if (typeof templateId !== "string") return templateId;

  const parsed = sopStepSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || null,
    dueOffsetDays: formData.get("dueOffsetDays") ?? 0,
    gate: formData.get("gate") ?? "none",
    creates: formData.get("creates") ?? "none",
    dependsOn: formData.getAll("dependsOn").map(String),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const assignee = sopAssigneeRuleSchema.safeParse(
    parseAssigneeRule(formData),
  );
  if (!assignee.success) return { error: "Pick who owns this step." };

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, CAP);

    // The template id came from the client. Without this check a guessed id
    // would hang a step off another workspace's template.
    if (!(await templateBelongsToWorkspace(workspaceId, templateId))) {
      return { error: "That template isn't in this workspace." };
    }

    const existing = (await sopStepsQuery(workspaceId, templateId)).map(
      (s): SopStepNode => ({ id: s.id, dependsOn: s.dependsOn }),
    );
    // Drop references to steps deleted in another tab mid-edit rather than
    // failing the save over an edge that's already gone.
    const stale = new Set(unknownDependencies(existing, parsed.data.dependsOn));
    const known = parsed.data.dependsOn.filter((id) => !stale.has(id));

    // No cycle check here on purpose: a step that doesn't exist yet has
    // nothing pointing at it, so its dependencies can only run backwards
    // into the existing graph. Cycles first become possible on edit.
    const position = await nextStepPosition(workspaceId, templateId);
    await db.insert(sopSteps).values({
      workspaceId,
      templateId,
      position,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      assigneeRule: assignee.data,
      dueOffsetDays: parsed.data.dueOffsetDays,
      gate: parsed.data.gate,
      creates: parsed.data.creates,
      dependsOn: known,
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/sop/${templateId}`);
  return ok();
}

export async function updateStepAction(
  _prev: SopActionState,
  formData: FormData,
): Promise<SopActionState> {
  const workspaceId = requireWorkspaceId(formData);
  if (typeof workspaceId !== "string") return workspaceId;
  const templateId = requireTemplateId(formData);
  if (typeof templateId !== "string") return templateId;

  const stepId = formData.get("stepId");
  if (typeof stepId !== "string" || stepId.length === 0) {
    return { error: "Missing step" };
  }

  const parsed = sopStepSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || null,
    dueOffsetDays: formData.get("dueOffsetDays") ?? 0,
    gate: formData.get("gate") ?? "none",
    creates: formData.get("creates") ?? "none",
    dependsOn: formData.getAll("dependsOn").map(String),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const assignee = sopAssigneeRuleSchema.safeParse(
    parseAssigneeRule(formData),
  );
  if (!assignee.success) return { error: "Pick who owns this step." };

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, CAP);

    const existing = (await sopStepsQuery(workspaceId, templateId)).map(
      (s): SopStepNode => ({ id: s.id, dependsOn: s.dependsOn }),
    );
    if (!existing.some((s) => s.id === stepId)) {
      return { error: "That step isn't in this template." };
    }

    const stale = new Set(unknownDependencies(existing, parsed.data.dependsOn));
    const known = parsed.data.dependsOn.filter(
      (id) => id !== stepId && !stale.has(id),
    );

    /**
     * A cycle means a run where every step in the loop waits forever. Caught
     * at authoring time, against the PROPOSED edges — checking the stored
     * ones would reject the very edit that breaks an existing cycle.
     */
    if (wouldCreateCycle(existing, stepId, known)) {
      return {
        error: "That would make these steps wait on each other in a loop.",
      };
    }

    await db
      .update(sopSteps)
      .set({
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        assigneeRule: assignee.data,
        dueOffsetDays: parsed.data.dueOffsetDays,
        gate: parsed.data.gate,
        creates: parsed.data.creates,
        dependsOn: known,
      })
      .where(
        and(
          eq(sopSteps.workspaceId, workspaceId),
          eq(sopSteps.templateId, templateId),
          eq(sopSteps.id, stepId),
        ),
      );
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/sop/${templateId}`);
  return ok();
}

/**
 * Deleting a step also strips it from every sibling's dependsOn, in one
 * transaction. Skipping that would leave dangling ids that read as
 * "waiting on something" forever — the run equivalent of a deadlock.
 */
export async function deleteStepAction(
  _prev: SopActionState,
  formData: FormData,
): Promise<SopActionState> {
  const workspaceId = requireWorkspaceId(formData);
  if (typeof workspaceId !== "string") return workspaceId;
  const templateId = requireTemplateId(formData);
  if (typeof templateId !== "string") return templateId;

  const stepId = formData.get("stepId");
  if (typeof stepId !== "string" || stepId.length === 0) {
    return { error: "Missing step" };
  }

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, CAP);

    const existing = await sopStepsQuery(workspaceId, templateId);
    if (!existing.some((s) => s.id === stepId)) {
      return { error: "That step isn't in this template." };
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(sopSteps)
        .where(
          and(
            eq(sopSteps.workspaceId, workspaceId),
            eq(sopSteps.templateId, templateId),
            eq(sopSteps.id, stepId),
          ),
        );

      for (const sibling of existing) {
        if (!sibling.dependsOn.includes(stepId)) continue;
        await tx
          .update(sopSteps)
          .set({ dependsOn: sibling.dependsOn.filter((d) => d !== stepId) })
          .where(
            and(
              eq(sopSteps.workspaceId, workspaceId),
              eq(sopSteps.id, sibling.id),
            ),
          );
      }
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/sop/${templateId}`);
  return ok();
}

/** Swaps a step with its neighbour. Reordering is a real authoring need
 *  (the list reads as a sequence) and stays independent of dependencies —
 *  position is presentation, dependsOn is truth. */
export async function moveStepAction(
  _prev: SopActionState,
  formData: FormData,
): Promise<SopActionState> {
  const workspaceId = requireWorkspaceId(formData);
  if (typeof workspaceId !== "string") return workspaceId;
  const templateId = requireTemplateId(formData);
  if (typeof templateId !== "string") return templateId;

  const stepId = formData.get("stepId");
  const direction = formData.get("direction");
  if (typeof stepId !== "string" || stepId.length === 0) {
    return { error: "Missing step" };
  }
  if (direction !== "up" && direction !== "down") {
    return { error: "Invalid direction" };
  }

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, CAP);

    const steps = await sopStepsQuery(workspaceId, templateId);
    const index = steps.findIndex((s) => s.id === stepId);
    if (index === -1) return { error: "That step isn't in this template." };

    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= steps.length) return undefined; // at the edge

    const a = steps[index];
    const b = steps[swapWith];
    await db.transaction(async (tx) => {
      await tx
        .update(sopSteps)
        .set({ position: b.position })
        .where(
          and(eq(sopSteps.workspaceId, workspaceId), eq(sopSteps.id, a.id)),
        );
      await tx
        .update(sopSteps)
        .set({ position: a.position })
        .where(
          and(eq(sopSteps.workspaceId, workspaceId), eq(sopSteps.id, b.id)),
        );
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/sop/${templateId}`);
  return ok();
}

/** Rebuilds the discriminated union from three flat form fields. */
function parseAssigneeRule(formData: FormData): unknown {
  const kind = formData.get("assigneeKind");
  if (kind === "role") {
    return { kind: "role", value: formData.get("assigneeRole") };
  }
  if (kind === "user") {
    return { kind: "user", value: formData.get("assigneeUserId") };
  }
  return { kind: "unassigned" };
}

// ---------------------------------------------------------------------------
// S2 — starting a run.
// ---------------------------------------------------------------------------

const startRunSchema = z.object({
  templateId: z.string().min(1, "Pick a template"),
  name: z.string().trim().min(1, "Name this run").max(120),
  anchorDate: z.coerce.date({ error: "Pick a valid date" }),
  clientId: z.string().min(1).nullable().optional(),
});

/**
 * Template + a date -> real, dated, dependency-ordered work.
 *
 * Everything lands in ONE transaction: a run whose steps failed to insert is
 * an empty process staring at someone with no way to tell whether it was
 * meant to be empty. The steps are computed by the pure `instantiateRun`
 * before the transaction opens, so the write itself is a straight insert
 * with no logic that could half-apply.
 */
export async function startRunAction(
  _prev: SopActionState,
  formData: FormData,
): Promise<SopActionState> {
  const workspaceId = requireWorkspaceId(formData);
  if (typeof workspaceId !== "string") return workspaceId;

  const parsed = startRunSchema.safeParse({
    templateId: formData.get("templateId"),
    name: formData.get("name"),
    anchorDate: formData.get("anchorDate"),
    clientId: formData.get("clientId") || null,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  let runId: string;
  try {
    const user = await requireUser();
    // Starting a run is the one SOP capability a member holds: they do the
    // work, they just can't rewrite the process.
    await requireCapability(workspaceId, user.id, "sop.run.start");

    const loaded = await loadSopTemplate(workspaceId, parsed.data.templateId);
    if (!loaded) return { error: "That template isn't in this workspace." };
    if (loaded.steps.length === 0) {
      return {
        error: "This template has no steps yet — add some before running it.",
      };
    }

    // A client id arrives from a <select>; confirm it's ours before storing
    // it, or a guessed id would attach this run to another workspace's client.
    if (parsed.data.clientId) {
      const [owned] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(
          and(
            eq(clients.workspaceId, workspaceId),
            eq(clients.id, parsed.data.clientId),
          ),
        )
        .limit(1);
      if (!owned) return { error: "That client isn't in this workspace." };
    }

    const members = await listWorkspaceMembers(workspaceId);
    const memberIds = new Set(members.map((m) => m.userId));

    const steps = instantiateRun({
      steps: loaded.steps,
      anchorDate: parsed.data.anchorDate,
      isMember: (userId) => memberIds.has(userId),
      newId: () => crypto.randomUUID(),
    });

    runId = crypto.randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(sopRuns).values({
        id: runId,
        workspaceId,
        templateId: parsed.data.templateId,
        clientId: parsed.data.clientId ?? null,
        name: parsed.data.name,
        anchorDate: parsed.data.anchorDate,
        startedById: user.id,
      });
      await tx.insert(sopRunSteps).values(
        steps.map((s) => ({
          id: s.id,
          workspaceId,
          runId,
          templateStepId: s.templateStepId,
          position: s.position,
          title: s.title,
          description: s.description,
          assigneeId: s.assigneeId,
          assigneeRole: s.assigneeRole,
          dueAt: s.dueAt,
          status: s.status,
          gate: s.gate,
          creates: s.creates,
          completesWhen: s.completesWhen,
          dependsOn: s.dependsOn,
        })),
      );

      for (const s of steps) {
        if (s.assigneeId && s.assigneeId !== user.id && s.status === "ready") {
          await notify(
            {
              workspaceId,
              userId: s.assigneeId,
              kind: "assigned",
              subjectType: "sop_run_step",
              subjectId: s.id,
              body: `You were assigned to "${s.title}" in run "${parsed.data.name}".`,
            },
            tx,
          );
        }
      }
    });

    await emitDomainEvent({
      verb: "sop_step.completed",
      workspaceId,
      subjectType: "sop_run_step",
      subjectId: runId,
      runId,
      actorId: user.id,
      meta: { runStarted: true, runName: parsed.data.name },
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/sop`);
  redirect(`/w/${workspaceId}/sop/runs/${runId}`);
}

// ---------------------------------------------------------------------------
// S3 — working a run.
// ---------------------------------------------------------------------------

function requireRunIds(
  formData: FormData,
): { runId: string; stepId: string } | { error: string } {
  const runId = formData.get("runId");
  const stepId = formData.get("stepId");
  if (typeof runId !== "string" || runId.length === 0) {
    return { error: "Missing run" };
  }
  if (typeof stepId !== "string" || stepId.length === 0) {
    return { error: "Missing step" };
  }
  return { runId, stepId };
}

/**
 * Working a run needs `sop.run.start`, the one SOP capability a member
 * holds. Members do the work; they just can't rewrite the process that
 * defines it.
 */
const RUN_CAP = "sop.run.start" as const;

export async function startStepAction(
  _prev: SopActionState,
  formData: FormData,
): Promise<SopActionState> {
  const workspaceId = requireWorkspaceId(formData);
  if (typeof workspaceId !== "string") return workspaceId;
  const ids = requireRunIds(formData);
  if ("error" in ids) return ids;

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, RUN_CAP);
    const result = await moveRunStep({
      workspaceId,
      runId: ids.runId,
      stepId: ids.stepId,
      userId: user.id,
      to: "in_progress",
      // Only a genuinely unblocked step can be started. Allowing "blocked"
      // here would let someone start work the graph says isn't ready.
      expectFrom: ["ready"],
    });
    if (!result.ok) return { error: result.error };

    await emitDomainEvent({
      verb: "sop_step.completed",
      workspaceId,
      subjectType: "sop_run_step",
      subjectId: ids.stepId,
      runId: ids.runId,
      actorId: user.id,
      meta: { to: "in_progress" },
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/sop/runs/${ids.runId}`);
  revalidatePath(`/w/${workspaceId}/my-work`);
  return ok();
}

/**
 * Completing a step by hand.
 *
 * A GATED step is refused here. The whole point of an approval or
 * compliance gate is that the step closes because something actually
 * happened — a sign-off, a passing check — not because someone ticked a
 * box. Letting the manual path close them would make "Client signed off"
 * mean "somebody said it did". S4 wires the mechanisms that legitimately
 * close them.
 */
export async function completeStepAction(
  _prev: SopActionState,
  formData: FormData,
): Promise<SopActionState> {
  const workspaceId = requireWorkspaceId(formData);
  if (typeof workspaceId !== "string") return workspaceId;
  const ids = requireRunIds(formData);
  if ("error" in ids) return ids;

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, RUN_CAP);

    const step = await getRunStep(workspaceId, ids.runId, ids.stepId);
    if (!step) return { error: "That step isn't in this run." };
    if (step.gate !== "none") {
      return {
        error:
          step.gate === "approval"
            ? "This step closes when it's approved, not by hand."
            : "This step closes when the compliance check passes, not by hand.",
      };
    }

    const result = await moveRunStep({
      workspaceId,
      runId: ids.runId,
      stepId: ids.stepId,
      userId: user.id,
      to: "done",
      expectFrom: ["ready", "in_progress"],
    });
    if (!result.ok) return { error: result.error };

    await emitDomainEvent({
      verb: "sop_step.completed",
      workspaceId,
      subjectType: "sop_run_step",
      subjectId: ids.stepId,
      runId: ids.runId,
      actorId: user.id,
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/sop/runs/${ids.runId}`);
  revalidatePath(`/w/${workspaceId}/sop`);
  revalidatePath(`/w/${workspaceId}/my-work`);
  return ok();
}

/**
 * Skipping is the honest escape hatch for a step that turned out not to
 * apply. It is deliberately NOT "done": closing it as done would inflate
 * completion metrics with work nobody did. Downstream steps still unblock,
 * because a skip is a decision the step will never happen.
 *
 * A gate does not block a skip — deciding a step doesn't apply is a
 * different act from asserting it was satisfied.
 */
export async function skipStepAction(
  _prev: SopActionState,
  formData: FormData,
): Promise<SopActionState> {
  const workspaceId = requireWorkspaceId(formData);
  if (typeof workspaceId !== "string") return workspaceId;
  const ids = requireRunIds(formData);
  if ("error" in ids) return ids;

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, RUN_CAP);
    const result = await moveRunStep({
      workspaceId,
      runId: ids.runId,
      stepId: ids.stepId,
      userId: user.id,
      to: "skipped",
      expectFrom: ["blocked", "ready", "in_progress"],
    });
    if (!result.ok) return { error: result.error };

    await emitDomainEvent({
      verb: "sop_step.completed",
      workspaceId,
      subjectType: "sop_run_step",
      subjectId: ids.stepId,
      runId: ids.runId,
      actorId: user.id,
      meta: { to: "skipped" },
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/sop/runs/${ids.runId}`);
  revalidatePath(`/w/${workspaceId}/sop`);
  revalidatePath(`/w/${workspaceId}/my-work`);
  return ok();
}

/**
 * Reopening a closed (done or skipped) step moves it back to ready,
 * re-blocks dependent steps, and reactivates the run if it was completed.
 */
export async function reopenStepAction(
  _prev: SopActionState,
  formData: FormData,
): Promise<SopActionState> {
  const workspaceId = requireWorkspaceId(formData);
  if (typeof workspaceId !== "string") return workspaceId;
  const ids = requireRunIds(formData);
  if ("error" in ids) return ids;

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, RUN_CAP);
    const result = await moveRunStep({
      workspaceId,
      runId: ids.runId,
      stepId: ids.stepId,
      userId: user.id,
      to: "ready",
      expectFrom: ["done", "skipped"],
    });
    if (!result.ok) return { error: result.error };

    await emitDomainEvent({
      verb: "sop_step.completed",
      workspaceId,
      subjectType: "sop_run_step",
      subjectId: ids.stepId,
      runId: ids.runId,
      actorId: user.id,
      meta: { to: "ready" },
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/sop/runs/${ids.runId}`);
  revalidatePath(`/w/${workspaceId}/sop`);
  revalidatePath(`/w/${workspaceId}/my-work`);
  return ok();
}

/** Claims or reassigns a step. The assignee must be a member of THIS
 *  workspace — a user id from a crafted request is never trusted. */
export async function assignStepAction(
  _prev: SopActionState,
  formData: FormData,
): Promise<SopActionState> {
  const workspaceId = requireWorkspaceId(formData);
  if (typeof workspaceId !== "string") return workspaceId;
  const ids = requireRunIds(formData);
  if ("error" in ids) return ids;

  const raw = formData.get("assigneeId");
  const assigneeId = typeof raw === "string" && raw.length > 0 ? raw : null;

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, RUN_CAP);

    if (assigneeId) {
      const members = await listWorkspaceMembers(workspaceId);
      if (!members.some((m) => m.userId === assigneeId)) {
        return { error: "That person isn't in this workspace." };
      }
    }

    const step = await getRunStep(workspaceId, ids.runId, ids.stepId);
    if (!step) return { error: "That step isn't in this run." };

    const moved = await assignRunStep({
      workspaceId,
      runId: ids.runId,
      stepId: ids.stepId,
      assigneeId,
    });
    if (!moved) return { error: "That step isn't in this run." };

    if (assigneeId && assigneeId !== user.id) {
      await notify({
        workspaceId,
        userId: assigneeId,
        kind: "assigned",
        subjectType: "sop_run_step",
        subjectId: ids.stepId,
        body: `You were assigned to "${step.title}".`,
      });
    }

    await emitDomainEvent({
      verb: "sop_step.assigned",
      workspaceId,
      subjectType: "sop_run_step",
      subjectId: ids.stepId,
      runId: ids.runId,
      actorId: user.id,
      meta: { assigneeId },
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/sop/runs/${ids.runId}`);
  return ok();
}

// ---------------------------------------------------------------------------
// E13 — bulk-assign a run's unassigned ready steps to the caller.
// ---------------------------------------------------------------------------

export type BulkAssignResult =
  | { assignedCount: number; error?: undefined }
  | { assignedCount?: undefined; error: string };

/**
 * "Assign all my unassigned ready steps to me" — the one-click case E13
 * names directly, not a general multi-select. Reuses the exact guarded path
 * assignStepAction uses per step (assignRunStep), so a bulk assign can never
 * do anything a single assign couldn't.
 *
 * Failure is per-step, not all-or-nothing — same rule the calendar's
 * bulkUpdatePlanCellsAction follows (src/app/(app)/w/[ws]/calendar/actions.ts):
 * one step that changed status between page load and click should not block
 * the rest. No notify() call: assigning to yourself never needs one (see
 * the `assigneeId !== user.id` guard in assignStepAction above).
 */
export async function bulkAssignReadyStepsToSelfAction(
  workspaceId: string,
  runId: string,
): Promise<BulkAssignResult> {
  if (!workspaceId || !runId) return { error: "Invalid run identifier." };

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, RUN_CAP);

    const steps = await sopRunStepsQuery(workspaceId, runId);
    const targets = steps.filter(
      (s) => s.status === "ready" && s.assigneeId === null,
    );
    if (targets.length === 0) {
      return { error: "No unassigned ready steps to claim." };
    }

    let assignedCount = 0;
    for (const step of targets) {
      const moved = await assignRunStep({
        workspaceId,
        runId,
        stepId: step.id,
        assigneeId: user.id,
      });
      if (!moved) continue;
      assignedCount++;
      await emitDomainEvent({
        verb: "sop_step.assigned",
        workspaceId,
        subjectType: "sop_run_step",
        subjectId: step.id,
        runId,
        actorId: user.id,
        meta: { assigneeId: user.id, bulk: true },
      });
    }

    if (assignedCount === 0) {
      return { error: "Those steps changed before they could be claimed — try again." };
    }

    revalidatePath(`/w/${workspaceId}/sop/runs/${runId}`);
    return { assignedCount };
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// S4 — deciding a gate.
// ---------------------------------------------------------------------------

/**
 * The legitimate way an approval-gated step closes.
 *
 * S3 refuses manual completion of a gated step precisely so this path is the
 * only one — "Client signed off" has to mean somebody with the right to sign
 * off actually did. That right is `approval.decide`, the same capability the
 * content approval queue uses, not `sop.run.start`: the person doing the work
 * must not be able to approve their own step.
 *
 * A rejection does not fail the step, it returns it. The work still has to
 * happen; someone just said not like this. So it goes back to in_progress
 * with the reason recorded, rather than to some terminal "rejected" state
 * that would strand everything downstream.
 */
export async function decideGateStepAction(
  _prev: SopActionState,
  formData: FormData,
): Promise<SopActionState> {
  const workspaceId = requireWorkspaceId(formData);
  if (typeof workspaceId !== "string") return workspaceId;
  const ids = requireRunIds(formData);
  if ("error" in ids) return ids;

  const decision = formData.get("decision");
  if (decision !== "approve" && decision !== "reject") {
    return { error: "Invalid decision" };
  }
  const rawReason = formData.get("reason");
  const reason =
    typeof rawReason === "string" ? rawReason.trim().slice(0, 500) : "";
  if (decision === "reject" && reason.length === 0) {
    return { error: "Say why, so whoever picks it back up knows what to fix." };
  }

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, "approval.decide");

    const step = await getRunStep(workspaceId, ids.runId, ids.stepId);
    if (!step) return { error: "That step isn't in this run." };
    if (step.gate !== "approval") {
      return { error: "That step isn't waiting on an approval." };
    }

    const result = await moveRunStep({
      workspaceId,
      runId: ids.runId,
      stepId: ids.stepId,
      userId: user.id,
      to: decision === "approve" ? "done" : "in_progress",
      expectFrom: ["ready", "in_progress"],
      rejectionReason: decision === "reject" ? reason : null,
    });
    if (!result.ok) return { error: result.error };

    // Written after the move rather than inside it: an audit row failing
    // must not roll back a decision someone already made and saw succeed.
    await recordActivity({
      workspaceId,
      subjectType: "sop_run_step",
      subjectId: ids.stepId,
      actorId: user.id,
      verb: decision === "approve" ? "gate_approved" : "gate_rejected",
      meta: { runId: ids.runId, reason: reason || null },
    });

    if (decision === "reject" && step.assigneeId && step.assigneeId !== user.id) {
      await notify({
        workspaceId,
        userId: step.assigneeId,
        kind: "approval_needed",
        subjectType: "sop_run_step",
        subjectId: ids.stepId,
        body: `Gate rejected on "${step.title}": ${reason}`,
      });
    }

    if (decision === "approve") {
      await emitDomainEvent({
        verb: "sop_step.completed",
        workspaceId,
        subjectType: "sop_run_step",
        subjectId: ids.stepId,
        runId: ids.runId,
        actorId: user.id,
        meta: { decision },
      });
    }
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/sop/runs/${ids.runId}`);
  revalidatePath(`/w/${workspaceId}/approvals`);
  revalidatePath(`/w/${workspaceId}/sop`);
  revalidatePath(`/w/${workspaceId}/my-work`);
  return ok();
}

// ---------------------------------------------------------------------------
// S4 — materialising what a step creates.
// ---------------------------------------------------------------------------

/** Slug for a doc created by a run step. Collides only with another doc of
 *  the same title in the same workspace, which the unique index catches. */
function docSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base.length > 0 ? base : "step";
}

/**
 * Brings a step's `creates` into existence, on demand.
 *
 * Deliberately NOT done at instantiation. A 14-step template would dump 14
 * empty drafts and tickets into the workspace the moment someone started a
 * run — most of them for steps nobody will touch for weeks, and several for
 * steps that end up skipped. Creating on demand means every row that exists
 * is one somebody actually reached.
 *
 * Idempotent by linkedId: a second click returns the existing row rather
 * than making a duplicate, which is what makes this safe to retry.
 */
export async function materialiseStepAction(
  _prev: SopActionState,
  formData: FormData,
): Promise<SopActionState> {
  const workspaceId = requireWorkspaceId(formData);
  if (typeof workspaceId !== "string") return workspaceId;
  const ids = requireRunIds(formData);
  if ("error" in ids) return ids;

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, RUN_CAP);

    const loaded = await loadSopRun(workspaceId, ids.runId);
    if (!loaded) return { error: "That run isn't in this workspace." };
    const step = loaded.steps.find((s) => s.id === ids.stepId);
    if (!step) return { error: "That step isn't in this run." };
    if (step.creates === "none") {
      return { error: "This step doesn't create anything." };
    }
    if (step.linkedId) return ok(); // already made — retry is a no-op

    // Content and tickets belong to a client. A run without one has nothing
    // to attach them to, and guessing would file work under the wrong brand.
    if (
      (step.creates === "content" || step.creates === "ticket") &&
      !loaded.run.clientId
    ) {
      return {
        error: "This run has no client, so there's nothing to file this under.",
      };
    }

    let linkedType: string;
    let linkedId: string;

    if (step.creates === "content") {
      // The Production board renders from workflow_state_id (W3), so a row
      // created with only the legacy productionStage set is invisible on
      // it. Seed the workflow's own initial state, the same one the engine
      // would assign, or the draft exists but appears nowhere.
      const workflowId = await ensureContentWorkflow(workspaceId);
      const [initial] = await initialStateQuery(workspaceId, workflowId);

      const [row] = await db
        .insert(content)
        .values({
          workspaceId,
          clientId: loaded.run.clientId!,
          type: "post",
          title: step.title,
          status: "draft",
          productionStage: "brief",
          workflowStateId: initial?.toStateId ?? null,
        })
        .returning({ id: content.id });
      linkedType = "content";
      linkedId = row.id;
    } else if (step.creates === "ticket") {
      const [row] = await db
        .insert(tickets)
        .values({
          workspaceId,
          title: step.title,
          description: step.description,
          assigneeId: step.assigneeId,
          dueAt: step.dueAt,
          createdById: user.id,
          clientId: loaded.run.clientId,
        })
        .returning({ id: tickets.id });
      linkedType = "ticket";
      linkedId = row.id;
    } else if (step.creates === "doc") {
      const [row] = await db
        .insert(workspaceDocs)
        .values({
          workspaceId,
          slug: `${docSlug(step.title)}-${Date.now().toString(36)}`,
          title: step.title,
          body: step.description ?? "",
          createdById: user.id,
          updatedById: user.id,
        })
        .returning({ id: workspaceDocs.id });
      linkedType = "doc";
      linkedId = row.id;
    } else {
      const [row] = await db
        .insert(hubTasks)
        .values({
          workspaceId,
          title: step.title,
          createdById: user.id,
          originRunStepId: step.id,
        })
        .returning({ id: hubTasks.id });
      linkedType = "task";
      linkedId = row.id;
    }

    await db
      .update(sopRunSteps)
      .set({ linkedType, linkedId })
      .where(
        and(
          eq(sopRunSteps.workspaceId, workspaceId),
          eq(sopRunSteps.runId, ids.runId),
          eq(sopRunSteps.id, ids.stepId),
          // Guard: if another tab already linked one, keep theirs rather
          // than orphaning it.
          isNull(sopRunSteps.linkedId),
        ),
      );
    await emitDomainEvent({
      verb: "sop_step.completed",
      workspaceId,
      subjectType: "sop_run_step",
      subjectId: ids.stepId,
      runId: ids.runId,
      actorId: user.id,
      meta: { materialised: true },
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/sop/runs/${ids.runId}`);
  revalidatePath(`/w/${workspaceId}/my-work`);
  revalidatePath(`/w/${workspaceId}/production`);
  return ok();
}

// ---------------------------------------------------------------------------
// S5 — rescheduling downstream, explicitly.
// ---------------------------------------------------------------------------

/**
 * Shifts everything waiting on a slipped step by N days.
 *
 * This exists as a deliberate action rather than an automatic consequence.
 * A due date is a commitment other people planned around; moving it behind
 * their back is worse than showing the run as late. So the system says
 * "these 4 steps are at risk, shifting them 5 days" and a human decides.
 *
 * The slipped step keeps its own date — that date is the evidence of the
 * slip, and rewriting it would erase the only record that anything went
 * wrong.
 */
export async function rescheduleDownstreamAction(
  _prev: SopActionState,
  formData: FormData,
): Promise<SopActionState> {
  const workspaceId = requireWorkspaceId(formData);
  if (typeof workspaceId !== "string") return workspaceId;
  const ids = requireRunIds(formData);
  if ("error" in ids) return ids;

  const parsedDays = z.coerce
    .number()
    .int("Whole days only")
    .refine((d) => d !== 0, "Pick a number of days to shift by")
    .refine((d) => Math.abs(d) <= 365, "That's more than a year")
    .safeParse(formData.get("days"));
  if (!parsedDays.success) {
    return { error: parsedDays.error.issues[0].message };
  }

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, RUN_CAP);

    const loaded = await loadSopRun(workspaceId, ids.runId);
    if (!loaded) return { error: "That run isn't in this workspace." };
    if (!loaded.steps.some((s) => s.id === ids.stepId)) {
      return { error: "That step isn't in this run." };
    }

    const moves = rescheduledDates(
      loaded.steps.map((s) => ({
        id: s.id,
        status: s.status,
        dueAt: s.dueAt,
        dependsOn: s.dependsOn,
      })),
      ids.stepId,
      parsedDays.data,
    );
    if (moves.length === 0) {
      return { error: "Nothing downstream is still open to move." };
    }

    const moved = await applyRescheduledDates({
      workspaceId,
      runId: ids.runId,
      moves,
    });

    await emitDomainEvent({
      verb: "sop_step.completed",
      workspaceId,
      subjectType: "sop_run_step",
      subjectId: ids.stepId,
      runId: ids.runId,
      actorId: user.id,
      meta: { rescheduled: true, days: parsedDays.data, moved },
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/sop/runs/${ids.runId}`);
  revalidatePath(`/w/${workspaceId}/sop`);
  revalidatePath(`/w/${workspaceId}/calendar`);
  revalidatePath(`/w/${workspaceId}/my-work`);
  return ok();
}

export async function cancelRunAction(
  workspaceId: string,
  runId: string,
): Promise<SopActionState> {
  if (!workspaceId || !runId) return { error: "Invalid run identifier." };

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, RUN_CAP);

    const result = await cancelSopRun({
      workspaceId,
      runId,
      userId: user.id,
    });

    if (!result.ok) return { error: result.error };

    await emitDomainEvent({
      verb: "sop_step.completed",
      workspaceId,
      subjectType: "sop_run_step",
      subjectId: runId,
      actorId: user.id,
      meta: { status: "cancelled", skippedCount: result.skippedCount },
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/sop`);
  revalidatePath(`/w/${workspaceId}/sop/runs/${runId}`);
  revalidatePath(`/w/${workspaceId}/approvals`);
  revalidatePath(`/w/${workspaceId}/my-work`);
  return ok();
}

/**
 * Re-anchors an entire active run to a new anchor date (E9).
 * Shifts all open steps by the delta between old and new anchor dates,
 * leaving closed steps intact.
 */
export async function reanchorRunAction(
  _prev: SopActionState,
  formData: FormData,
): Promise<SopActionState> {
  const workspaceId = requireWorkspaceId(formData);
  if (typeof workspaceId !== "string") return workspaceId;

  const runId = formData.get("runId");
  if (typeof runId !== "string" || runId.length === 0) {
    return { error: "Missing run" };
  }

  const rawDate = formData.get("anchorDate");
  if (typeof rawDate !== "string" || rawDate.length === 0) {
    return { error: "Pick a new anchor date" };
  }
  const newAnchorDate = new Date(rawDate);
  if (isNaN(newAnchorDate.getTime())) {
    return { error: "Invalid anchor date" };
  }

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, RUN_CAP);

    const loaded = await loadSopRun(workspaceId, runId);
    if (!loaded) return { error: "That run isn't in this workspace." };
    if (loaded.run.status !== "active") {
      return { error: "Only active runs can be re-anchored." };
    }

    // Calculate days delta between old anchor date and new anchor date
    const oldAnchor = new Date(loaded.run.anchorDate);
    const msDiff = newAnchorDate.getTime() - oldAnchor.getTime();
    const days = Math.round(msDiff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return { error: "New anchor date is the same as the current anchor date." };
    }
    if (Math.abs(days) > 365) {
      return { error: "Cannot shift run by more than 365 days." };
    }

    const moves = reanchoredDates(
      loaded.steps.map((s) => ({
        id: s.id,
        status: s.status,
        dueAt: s.dueAt,
        dependsOn: s.dependsOn,
      })),
      days,
    );

    const result = await reanchorSopRun({
      workspaceId,
      runId,
      userId: user.id,
      newAnchorDate,
      days,
      moves,
    });

    if (!result.ok) return { error: result.error };

    await emitDomainEvent({
      verb: "sop_step.completed",
      workspaceId,
      subjectType: "sop_run_step",
      subjectId: runId,
      actorId: user.id,
      meta: { reanchored: true, days, movedCount: result.moved },
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/sop/runs/${runId}`);
  revalidatePath(`/w/${workspaceId}/sop`);
  revalidatePath(`/w/${workspaceId}/calendar`);
  revalidatePath(`/w/${workspaceId}/my-work`);
  return ok();
}

