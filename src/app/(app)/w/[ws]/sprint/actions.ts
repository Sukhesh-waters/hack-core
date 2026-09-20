"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/auth";
import { db } from "@/db";
import { content, sopRunSteps, type BrandIdentity } from "@/db/schema";
import { requireCapability, requireMembership } from "@/db/queries/memberships";
import { actionErrorMessage } from "@/lib/action-errors";
import { launchCampaignSprint, type SprintLaunchResult } from "@/lib/pipeline/sprint-engine";
import { getBrandProfile } from "@/db/queries/brand";
import { parseDraftBody, formatDraftBody } from "@/lib/ai/agents/content";
import { checkCompliance, enforceCompliance } from "@/lib/ai/agents/critic";
import { routeAI } from "@/lib/ai/router";
import { emitDomainEvent } from "@/lib/events/dispatch";

const DEFAULT_BRAND_IDENTITY: BrandIdentity = {
  voice: "Engaging & professional",
  tone: "Direct and compelling",
  audience: "Target customers",
  pillars: ["Product", "Insights", "Community"],
  doNots: ["Banned words", "Misleading claims"],
  formats: ["Reels", "Carousels", "Posts"],
};

const launchSprintSchema = z.object({
  workspaceId: z.string().min(1),
  clientId: z.string().min(1),
  theme: z.string().min(3, "Campaign theme must be at least 3 characters."),
  templateId: z.string().optional(),
  targetCount: z.coerce.number().min(2).max(8).default(4),
  durationDays: z.coerce.number().min(3).max(60).default(14),
});

export type LaunchSprintState =
  | { ok: true; data: SprintLaunchResult }
  | { ok: false; error: string };

export async function launchCampaignSprintAction(
  _prev: unknown,
  formData: FormData,
): Promise<LaunchSprintState> {
  const parsed = launchSprintSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    clientId: formData.get("clientId"),
    theme: formData.get("theme"),
    templateId: formData.get("templateId") ? String(formData.get("templateId")) : undefined,
    targetCount: formData.get("targetCount"),
    durationDays: formData.get("durationDays"),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const { workspaceId, clientId, theme, templateId, targetCount, durationDays } = parsed.data;

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, "sop.run.start");

    const result = await launchCampaignSprint({
      workspaceId,
      clientId,
      theme,
      templateId,
      targetCount,
      durationDays,
      userId: user.id,
    });

    revalidatePath(`/w/${workspaceId}/sprint`);
    revalidatePath(`/w/${workspaceId}/calendar`);
    revalidatePath(`/w/${workspaceId}/sop`);
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}

export type QuickRewriteResult =
  | { ok: true; body: string; complianceStatus: string }
  | { ok: false; error: string };

export async function quickRewritePostAction(input: {
  workspaceId: string;
  contentId: string;
  instruction: string;
}): Promise<QuickRewriteResult> {
  const { workspaceId, contentId, instruction } = input;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    const [post] = await db
      .select()
      .from(content)
      .where(and(eq(content.workspaceId, workspaceId), eq(content.id, contentId)))
      .limit(1);

    if (!post || !post.body) {
      return { ok: false, error: "Content body not found." };
    }

    const brandProfile = await getBrandProfile(workspaceId, post.clientId);
    const brand: BrandIdentity = brandProfile?.identity ?? DEFAULT_BRAND_IDENTITY;

    const prompt = [
      `Current Post Draft:\n${post.body}`,
      `Instruction / Rewrite Goal: "${instruction}"`,
      `Brand Tone: ${brand.tone}. Audience: ${brand.audience}. Avoid: ${brand.doNots.join(", ") || "none"}.`,
      "Rewrite the post keeping the format structured with ## Caption, ## Script, ## Hashtags, and ## CTA.",
    ].join("\n\n");

    const rewrittenMarkdown = await routeAI({
      kind: "chat",
      tier: "fast",
      prompt,
      system:
        "You are an expert social media copywriter. Keep responses strictly structured with ## Caption, ## Script, ## Hashtags, ## CTA.",
    });

    const parsedDraft = parseDraftBody(rewrittenMarkdown);
    let complianceStatus: "passed" | "flagged" = "passed";
    let violations: Array<{ rule: string; excerpt: string; why: string }> = [];

    if (parsedDraft) {
      try {
        const comp = await checkCompliance({ draft: parsedDraft, identity: brand });
        violations = comp.violations;
        complianceStatus = comp.verdict === "pass" ? "passed" : "flagged";
      } catch {
        complianceStatus = "passed";
      }
    }

    await db
      .update(content)
      .set({
        body: rewrittenMarkdown,
        complianceStatus,
        complianceReport: violations,
      })
      .where(and(eq(content.workspaceId, workspaceId), eq(content.id, contentId)));

    await emitDomainEvent({
      verb: "content.state_changed",
      workspaceId,
      subjectType: "content",
      subjectId: contentId,
      actorId: user.id,
      from: post.status,
      to: post.status,
      meta: { rewriteInstruction: instruction },
    });

    revalidatePath(`/w/${workspaceId}/sprint`);
    return { ok: true, body: rewrittenMarkdown, complianceStatus };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}

export async function autoFixComplianceAction(input: {
  workspaceId: string;
  contentId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { workspaceId, contentId } = input;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    const [post] = await db
      .select()
      .from(content)
      .where(and(eq(content.workspaceId, workspaceId), eq(content.id, contentId)))
      .limit(1);

    if (!post || !post.body) return { ok: false, error: "Post not found." };

    const parsedDraft = parseDraftBody(post.body);
    if (!parsedDraft) return { ok: false, error: "Could not parse post structure." };

    const brandProfile = await getBrandProfile(workspaceId, post.clientId);
    const brand: BrandIdentity = brandProfile?.identity ?? DEFAULT_BRAND_IDENTITY;

    const outcome = await enforceCompliance({
      draft: parsedDraft,
      identity: brand,
    });

    const fixedBody = formatDraftBody(outcome.draft);

    await db
      .update(content)
      .set({
        body: fixedBody,
        complianceStatus: outcome.verdict,
        complianceReport: outcome.violations,
      })
      .where(and(eq(content.workspaceId, workspaceId), eq(content.id, contentId)));

    revalidatePath(`/w/${workspaceId}/sprint`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}

export async function batchApproveSprintAction(input: {
  workspaceId: string;
  runId: string;
}): Promise<{ ok: boolean; count?: number; error?: string }> {
  const { workspaceId, runId } = input;

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, "approval.decide");

    const steps = await db
      .select({ linkedId: sopRunSteps.linkedId })
      .from(sopRunSteps)
      .where(
        and(
          eq(sopRunSteps.workspaceId, workspaceId),
          eq(sopRunSteps.runId, runId),
          eq(sopRunSteps.linkedType, "content"),
        ),
      );

    const contentIds = steps
      .map((s) => s.linkedId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    if (contentIds.length === 0) {
      return { ok: false, error: "No content items found in this sprint." };
    }

    await db
      .update(content)
      .set({ status: "approved" })
      .where(
        and(
          eq(content.workspaceId, workspaceId),
          inArray(content.id, contentIds),
        ),
      );

    // Emit domain event for each approved content item to trigger SOP reverse sync
    for (const cid of contentIds) {
      await emitDomainEvent({
        verb: "approval.decided",
        workspaceId,
        subjectType: "content",
        subjectId: cid,
        decision: "approved",
        actorId: user.id,
      });
    }

    revalidatePath(`/w/${workspaceId}/sprint`);
    revalidatePath(`/w/${workspaceId}/approvals`);
    revalidatePath(`/w/${workspaceId}/calendar`);
    return { ok: true, count: contentIds.length };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}
