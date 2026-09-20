"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/auth";
import { db } from "@/db";
import { ideas } from "@/db/schema";
import { getBrandProfile } from "@/db/queries/brand";
import { rejectIdea } from "@/db/queries/ideas";
import { requireMembership } from "@/db/queries/memberships";
import { actionErrorMessage } from "@/lib/action-errors";
import { and, eq, inArray } from "drizzle-orm";
import {
  brandDnaFromProfile,
  NO_BRAND_CONTEXT_ERROR,
} from "@/lib/ai/brand-merge";
import { combineIdeas } from "@/lib/ai/agents/strategy";
import { runWithAiCost } from "@/lib/ai/usage-context";
import { runIdeationFlow } from "@/lib/orchestrator/ideation";
import { MIN_BASELINE_N } from "@/lib/scoring";
import { acceptIdea } from "@/lib/plan/accept-idea";

export type IdeationState = { error?: string } | undefined;

const topicSchema = z.object({
  workspaceId: z.string().min(1),
  clientId: z.string().min(1, "Pick a client"),
  topic: z.string().trim().min(3, "Topic is too short").max(120),
  // G1 — optional. Empty string from the "No goal" <option> normalizes to
  // undefined so the rest of the action can treat "no goal" uniformly.
  goalId: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export async function runIdeation(
  _prev: IdeationState,
  formData: FormData,
): Promise<IdeationState> {
  const parsed = topicSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    clientId: formData.get("clientId"),
    topic: formData.get("topic"),
    goalId: formData.get("goalId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, clientId, topic, goalId } = parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    const result = await runWithAiCost(
      { workspaceId, purpose: "ideation" },
      () => runIdeationFlow({ workspaceId, clientId, topic, goalId }),
    );

    if (result.status === "insufficient_context") {
      if (result.state === "insufficient_baseline") {
        // Min-N gate: an honest refusal, not fabricated ideas
        return {
          error: `Insufficient baseline — ${result.sampleSize ?? 0} of ${MIN_BASELINE_N} scored posts. Import more history before ideating.`,
        };
      }
      return { error: result.reason ?? NO_BRAND_CONTEXT_ERROR };
    }
    if (result.status === "invalid_proposal") {
      return {
        error: `The AI proposed unusable ideas (${result.reason}) — try again.`,
      };
    }
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/ideation`);
  return undefined;
}

export async function draftIdea(
  _prev: IdeationState,
  formData: FormData,
): Promise<IdeationState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const ideaId = String(formData.get("ideaId") ?? "");

  let contentId: string;
  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    ({ contentId } = await acceptIdea({ workspaceId, ideaId, actorId: user.id }));
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  redirect(`/w/${workspaceId}/studio/${contentId}`);
}

const rejectSchema = z.object({
  workspaceId: z.string().min(1),
  ideaId: z.string().min(1),
  reason: z.string().trim().min(3, "Give a reason").max(500),
});

/**
 * Ideation's own reject path — mirrors Plan & Validate's rejectIdeaAction so
 * the status menu on this surface can archive an idea without leaving the
 * page. Shares the same guarded query (status="new" only), so a stale form
 * can't mutate an already-decided idea from either surface.
 */
export async function rejectIdeaAction(
  _prev: IdeationState,
  formData: FormData,
): Promise<IdeationState> {
  const parsed = rejectSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    ideaId: formData.get("ideaId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, ideaId, reason } = parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    await rejectIdea(workspaceId, ideaId, reason);
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/ideation`);
  return undefined;
}

const combineActionSchema = z.object({
  workspaceId: z.string().min(1),
  clientId: z.string().min(1),
  ideaIds: z.array(z.string().min(1)).min(2, "Select at least 2 ideas to combine"),
});

export async function combineIdeasAction(
  workspaceId: string,
  clientId: string,
  ideaIds: string[],
): Promise<IdeationState> {
  try {
    const parsed = combineActionSchema.parse({ workspaceId, clientId, ideaIds });
    const user = await requireUser();
    await requireMembership(parsed.workspaceId, user.id);

    const profile = await getBrandProfile(parsed.workspaceId, parsed.clientId);
    const dna = brandDnaFromProfile(profile);
    if (!dna) return { error: NO_BRAND_CONTEXT_ERROR };

    const selectedIdeas = await db
      .select({ topic: ideas.topic, hook: ideas.hook, angle: ideas.angle, format: ideas.format })
      .from(ideas)
      .where(
        and(
          eq(ideas.workspaceId, parsed.workspaceId),
          inArray(ideas.id, parsed.ideaIds),
        ),
      );

    if (selectedIdeas.length < 2) {
      return { error: "Could not load selected ideas." };
    }

    const combined = await combineIdeas({ ideas: selectedIdeas, identity: dna });

    await db.insert(ideas).values({
      workspaceId: parsed.workspaceId,
      clientId: parsed.clientId,
      topic: `Combined: ${selectedIdeas[0].topic}`,
      hook: combined.hook,
      angle: combined.angle,
      format: combined.format,
      whyReason: combined.why.reason,
      citations: [],
      combinedFrom: parsed.ideaIds,
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/ideation`);
  return undefined;
}
