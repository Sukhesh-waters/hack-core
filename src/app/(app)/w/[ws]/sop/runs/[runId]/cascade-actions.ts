"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/auth";
import { db } from "@/db";
import { sopRunSteps, sopSuggestions } from "@/db/schema";
import { requireCapability } from "@/db/queries/memberships";
import { actionErrorMessage } from "@/lib/action-errors";
import { sopRunStepsQuery } from "@/db/queries/sop";
import {
  computeCascade,
  computeScopedRunHash,
  type CascadeResult,
} from "@/lib/sop/cascade";
import { emitDomainEvent } from "@/lib/events/dispatch";

const RUN_CAP = "sop.run.start" as const;

export type CreateCascadeResult =
  | { ok: true; proposalId: string; cascade: CascadeResult }
  | { ok: false; error: string };

export async function createCascadeProposalAction(input: {
  workspaceId: string;
  runId: string;
  slippedStepId: string;
  actualCompletionDate: string | Date;
}): Promise<CreateCascadeResult> {
  const { workspaceId, runId, slippedStepId } = input;
  const actualDate =
    typeof input.actualCompletionDate === "string"
      ? new Date(input.actualCompletionDate)
      : input.actualCompletionDate;

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, RUN_CAP);

    const steps = await sopRunStepsQuery(workspaceId, runId);
    if (steps.length === 0) return { ok: false, error: "Run not found or has no steps." };

    const slippedStep = steps.find((s) => s.id === slippedStepId);
    if (!slippedStep) return { ok: false, error: "Target step not found." };

    const cascade = computeCascade({
      steps,
      slippedStepId,
      actualCompletionDate: actualDate,
    });

    if (cascade.moves.length === 0) {
      return { ok: false, error: "No downstream dates need shifting." };
    }

    const proposalId = crypto.randomUUID();
    await db.insert(sopSuggestions).values({
      id: proposalId,
      workspaceId,
      runId,
      kind: "cascade",
      scopedRunHash: cascade.scopedRunHash,
      reason: `Schedule cascade: "${slippedStep.title}" slipped by ${cascade.slipDays} days.`,
      suggestedChanges: {
        slippedStepId,
        slipDays: cascade.slipDays,
        moves: cascade.moves,
        breaches: cascade.breaches,
      },
    });

    return { ok: true, proposalId, cascade };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}

export async function applyCascadeProposalAction(input: {
  workspaceId: string;
  runId: string;
  proposalId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { workspaceId, runId, proposalId } = input;

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, RUN_CAP);

    const [proposal] = await db
      .select()
      .from(sopSuggestions)
      .where(
        and(
          eq(sopSuggestions.workspaceId, workspaceId),
          eq(sopSuggestions.runId, runId),
          eq(sopSuggestions.id, proposalId),
        ),
      )
      .limit(1);

    if (!proposal) return { ok: false, error: "Proposal not found." };
    if (proposal.appliedAt) return { ok: false, error: "Proposal already applied." };
    if (proposal.dismissedAt) return { ok: false, error: "Proposal was dismissed." };

    const changes = proposal.suggestedChanges as {
      slippedStepId: string;
      moves: Array<{ stepId: string; toDate: string }>;
    };

    const currentSteps = await sopRunStepsQuery(workspaceId, runId);
    const affectedIds = new Set(changes.moves.map((m) => m.stepId));
    affectedIds.add(changes.slippedStepId);

    const affectedSteps = currentSteps.filter((s) => affectedIds.has(s.id));
    const currentHash = computeScopedRunHash(affectedSteps);

    // Concurrency / Stale Hash Guard
    if (proposal.scopedRunHash && currentHash !== proposal.scopedRunHash) {
      return {
        ok: false,
        error:
          "The schedule was modified concurrently by a teammate. Please recompute the cascade proposal.",
      };
    }

    // Apply updates inside a transaction
    await db.transaction(async (tx) => {
      for (const move of changes.moves) {
        await tx
          .update(sopRunSteps)
          .set({ dueAt: new Date(move.toDate) })
          .where(
            and(
              eq(sopRunSteps.workspaceId, workspaceId),
              eq(sopRunSteps.runId, runId),
              eq(sopRunSteps.id, move.stepId),
            ),
          );
      }

      await tx
        .update(sopSuggestions)
        .set({ appliedAt: new Date() })
        .where(
          and(
            eq(sopSuggestions.workspaceId, workspaceId),
            eq(sopSuggestions.id, proposalId),
          ),
        );
    });

    // Emit domain event for the slip
    await emitDomainEvent({
      verb: "sop_step.slipped",
      workspaceId,
      subjectType: "sop_run_step",
      subjectId: changes.slippedStepId,
      runId,
      actorId: user.id,
      meta: { movesCount: changes.moves.length },
    });

    revalidatePath(`/w/${workspaceId}/sop/runs/${runId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}

export async function dismissCascadeProposalAction(input: {
  workspaceId: string;
  runId: string;
  proposalId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { workspaceId, runId, proposalId } = input;

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, RUN_CAP);

    await db
      .update(sopSuggestions)
      .set({ dismissedAt: new Date() })
      .where(
        and(
          eq(sopSuggestions.workspaceId, workspaceId),
          eq(sopSuggestions.runId, runId),
          eq(sopSuggestions.id, proposalId),
        ),
      );

    revalidatePath(`/w/${workspaceId}/sop/runs/${runId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}
