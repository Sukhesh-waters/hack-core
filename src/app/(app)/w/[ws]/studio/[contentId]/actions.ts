"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/auth";
import { db } from "@/db";
import { content, posts } from "@/db/schema";
import { getBrandProfile } from "@/db/queries/brand";
import { getContentById } from "@/db/queries/clients";
import { addComment } from "@/db/queries/comments";
import { seedDraftBodyQuery } from "@/db/queries/production";
import { requireMembership } from "@/db/queries/memberships";
import { recordRevision } from "@/db/queries/revisions";
import { actionErrorMessage } from "@/lib/action-errors";
import { recordActivity } from "@/lib/activity";
import { createSopSuggestion } from "@/db/queries/sop-suggestions";
import { closeComplianceGatesForContent } from "@/db/queries/sop";
import { inngest } from "@/inngest/client";
import { pushToTeam } from "@/lib/plan/push-to-team";
import { rescoreRequestedEvent } from "@/lib/rescore";
import {
  type Draft,
  formatDraftBody,
  normalizeHashtags,
  parseDraftBody,
  refineDraft,
} from "@/lib/ai/generation-agent";
import { enforceCompliance } from "@/lib/ai/compliance-agent";
import {
  brandDnaFromProfile,
  NO_BRAND_CONTEXT_ERROR,
} from "@/lib/ai/brand-merge";
import { runWithAiCost } from "@/lib/ai/usage-context";

export type RefineState = { error?: string } | undefined;

const refineSchema = z.object({
  workspaceId: z.string().min(1),
  contentId: z.string().min(1),
  feedback: z.string().trim().min(3, "Tell the agent what to change").max(500),
});

export async function refineDraftAction(
  _prev: RefineState,
  formData: FormData,
): Promise<RefineState> {
  const parsed = refineSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    contentId: formData.get("contentId"),
    feedback: formData.get("feedback"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, contentId, feedback } = parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    const row = await getContentById(workspaceId, contentId);
    if (!row?.body) return { error: "Draft not found." };
    const draft = parseDraftBody(row.body);
    if (!draft) return { error: "This content isn't a structured draft." };

    const profile = await getBrandProfile(workspaceId, row.clientId);
    const dna = brandDnaFromProfile(profile);
    if (!dna) return { error: NO_BRAND_CONTEXT_ERROR };

    const refined = await runWithAiCost(
      { workspaceId, purpose: "refine" },
      () => refineDraft({ draft, feedback, identity: dna }),
    );
    await db
      .update(content)
      .set({ body: formatDraftBody(refined) })
      .where(and(eq(content.workspaceId, workspaceId), eq(content.id, row.id)));
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/studio/${contentId}`);
  return undefined;
}

const startDraftSchema = z.object({
  workspaceId: z.string().min(1),
  contentId: z.string().min(1),
  caption: z.string().trim().min(3, "Add a caption"),
  script: z.string().trim().min(3, "Add a script"),
  hashtags: z.string().trim(),
  cta: z.string().trim().min(2, "Add a call to action"),
});

/**
 * Direct-add content (Production "New card", Calendar "Add to this day")
 * starts with an empty body — there's no AI-generation entry point for it
 * the way accepted ideas get one, so without this it can never pass
 * compliance and is permanently stuck. Lets a human type the draft by hand
 * in the same caption/script/hashtags/CTA shape the AI pipeline produces,
 * so everything downstream (compliance, refine, publish) works unchanged.
 */
export async function startDraftAction(
  _prev: RefineState,
  formData: FormData,
): Promise<RefineState> {
  const parsed = startDraftSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    contentId: formData.get("contentId"),
    caption: formData.get("caption"),
    script: formData.get("script"),
    hashtags: formData.get("hashtags"),
    cta: formData.get("cta"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, contentId, caption, script, hashtags, cta } =
    parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    const row = await getContentById(workspaceId, contentId);
    if (!row) return { error: "Draft not found." };
    if (row.body) return { error: "This draft already has content." };

    const draft: Draft = {
      caption,
      script,
      hashtags: normalizeHashtags(hashtags),
      cta,
    };
    const seeded = await seedDraftBodyQuery({
      workspaceId,
      contentId: row.id,
      body: formatDraftBody(draft),
    });
    if (seeded.length === 0) {
      return { error: "This draft already has content." };
    }
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  // Seeding a body changes how this card reads everywhere it appears, not
  // just in studio: production shows it as compliance-eligible and the
  // calendar stops rendering it as an empty slot.
  revalidatePath(`/w/${workspaceId}/studio/${contentId}`);
  revalidatePath(`/w/${workspaceId}/production`);
  revalidatePath(`/w/${workspaceId}/calendar`);
  return undefined;
}

const commentSchema = z.object({
  workspaceId: z.string().min(1),
  contentId: z.string().min(1),
  body: z.string().trim().min(1, "Write something first").max(1000),
});

/** Collab (W7): flat thread per draft; the thread UI polls for new rows. */
export async function addCommentAction(
  _prev: RefineState,
  formData: FormData,
): Promise<RefineState> {
  const parsed = commentSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    contentId: formData.get("contentId"),
    body: formData.get("body"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, contentId, body } = parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    const row = await getContentById(workspaceId, contentId);
    if (!row) return { error: "Draft not found." };
    await addComment({ workspaceId, contentId, authorId: user.id, body });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/studio/${contentId}`);
  return undefined;
}

const complianceSchema = z.object({
  workspaceId: z.string().min(1),
  contentId: z.string().min(1),
});

/**
 * Compliance run (W6): check → at most one auto-fix retry → re-check.
 * Passed drafts move to review; flagged drafts stay put with the report.
 */
export async function runComplianceAction(
  _prev: RefineState,
  formData: FormData,
): Promise<RefineState> {
  const parsed = complianceSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    contentId: formData.get("contentId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, contentId } = parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    const row = await getContentById(workspaceId, contentId);
    if (!row?.body) return { error: "Draft not found." };
    const draft = parseDraftBody(row.body);
    if (!draft) return { error: "This content isn't a structured draft." };

    const profile = await getBrandProfile(workspaceId, row.clientId);
    const dna = brandDnaFromProfile(profile);
    if (!dna) return { error: NO_BRAND_CONTEXT_ERROR };

    const outcome = await runWithAiCost(
      { workspaceId, purpose: "compliance" },
      () => enforceCompliance({ draft, identity: dna }),
    );
    await db
      .update(content)
      .set({
        body: formatDraftBody(outcome.draft),
        complianceStatus: outcome.verdict,
        complianceReport: outcome.violations,
        ...(outcome.verdict === "passed" && row.status === "draft"
          ? { status: "review" as const }
          : {}),
      })
      .where(and(eq(content.workspaceId, workspaceId), eq(content.id, row.id)));
    await recordActivity({
      workspaceId,
      subjectType: "content",
      subjectId: contentId,
      actorId: user.id,
      verb: "compliance_run",
      meta: {
        verdict: outcome.verdict,
        violations: outcome.violations?.length ?? 0,
      },
    });

    // S4 — a compliance-gated SOP step closes here, where the check
    // actually ran, rather than by anyone asserting it passed. Only on a
    // pass, and only for steps linked to this exact draft.
    if (outcome.verdict === "passed") {
      const touchedRuns = await closeComplianceGatesForContent({
        workspaceId,
        contentId,
        userId: user.id,
      });
      for (const runId of touchedRuns) {
        revalidatePath(`/w/${workspaceId}/sop/runs/${runId}`);
      }
      if (touchedRuns.length > 0) revalidatePath(`/w/${workspaceId}/sop`);
    }
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/studio/${contentId}`);
  return undefined;
}

const pushToTeamSchema = z.object({
  workspaceId: z.string().min(1),
  contentId: z.string().min(1),
  assigneeId: z.string().min(1, "Pick who owns this"),
  dueAt: z.coerce.date(),
  note: z.string().trim().max(1000).optional(),
});

/** S8 — one click turns an approved draft into assigned work everywhere. */
export async function pushToTeamAction(
  _prev: RefineState,
  formData: FormData,
): Promise<RefineState> {
  const parsed = pushToTeamSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    contentId: formData.get("contentId"),
    assigneeId: formData.get("assigneeId"),
    dueAt: formData.get("dueAt"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, contentId, assigneeId, dueAt, note } = parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    const result = await pushToTeam({
      workspaceId,
      contentId,
      assigneeId,
      dueAt,
      note,
      actorId: user.id,
    });
    if (!result.ok) return { error: result.error };
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/studio/${contentId}`);
  revalidatePath(`/w/${workspaceId}/production`);
  revalidatePath(`/w/${workspaceId}/tickets`);
  revalidatePath(`/w/${workspaceId}/hub`);
  return undefined;
}

const markPublishedSchema = z.object({
  workspaceId: z.string().min(1),
  contentId: z.string().min(1),
});

/**
 * Publish-back (W7): marks a draft published once it's live. Real
 * performance metrics arrive separately via the Meta connector or CSV
 * import — this action never touches `posts` directly, but it does queue
 * a rescore sweep (C2s) so the learning loop re-weights once results land.
 */
export async function markPublishedAction(
  _prev: RefineState,
  formData: FormData,
): Promise<RefineState> {
  const parsed = markPublishedSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    contentId: formData.get("contentId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, contentId } = parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    const row = await getContentById(workspaceId, contentId);
    if (!row) return { error: "Draft not found." };
    if (row.status === "published") {
      return { error: "This draft is already marked published." };
    }
    if (row.status !== "approved" && row.status !== "scheduled") {
      return {
        error: "Mark as published once the draft is approved or scheduled.",
      };
    }

    await db
      .update(content)
      .set({ status: "published" })
      .where(and(eq(content.workspaceId, workspaceId), eq(content.id, row.id)));

    // UC-MEA-09: Close the loop between planned and published content
    await db.insert(posts).values({
      workspaceId,
      clientId: row.clientId,
      source: "first_party",
      externalId: row.id,
      caption: row.body ? row.body.slice(0, 500) : (row.title ?? "Published draft"),
      format: row.type ?? "post",
      postedAt: new Date(),
    });

    await recordActivity({
      workspaceId,
      subjectType: "content",
      subjectId: contentId,
      actorId: user.id,
      verb: "published",
    });

    await inngest.send(rescoreRequestedEvent(workspaceId));

    if (row.title) {
      await createSopSuggestion({
        workspaceId,
        reason: `Content "${row.title}" published — review SOP template timing and format performance`,
        suggestedChanges: {
          contentId: row.id,
          type: row.type,
          publishedAt: new Date().toISOString(),
        },
      });
    }
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/studio/${contentId}`);
  return undefined;
}

const updateSectionsSchema = z.object({
  workspaceId: z.string().min(1),
  contentId: z.string().min(1),
  caption: z.string().trim().min(3, "Caption is required"),
  script: z.string().trim().min(3, "Script is required"),
  hashtags: z.string().trim(),
  cta: z.string().trim().min(2, "CTA is required"),
});

export async function updateDraftSectionsAction(
  _prev: RefineState,
  formData: FormData,
): Promise<RefineState> {
  const parsed = updateSectionsSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    contentId: formData.get("contentId"),
    caption: formData.get("caption"),
    script: formData.get("script"),
    hashtags: formData.get("hashtags"),
    cta: formData.get("cta"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, contentId, caption, script, hashtags, cta } = parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    const row = await getContentById(workspaceId, contentId);
    if (!row) return { error: "Draft not found." };

    const priorDraft = row.body ? parseDraftBody(row.body) : null;
    const newDraft: Draft = {
      caption,
      script,
      hashtags: normalizeHashtags(hashtags.split(/\s+/).filter(Boolean)),
      cta,
    };
    const newBody = formatDraftBody(newDraft);

    await db
      .update(content)
      .set({ body: newBody })
      .where(and(eq(content.workspaceId, workspaceId), eq(content.id, row.id)));

    if (priorDraft) {
      await recordRevision({
        workspaceId,
        contentId,
        authorKind: "human",
        authorId: user.id,
        fields: { title: row.title ?? undefined, strategyNote: newBody },
        priorFields: { title: row.title ?? undefined, strategyNote: row.body ?? undefined },
        note: "Human field-level edit in Studio",
      });
    }

    await recordActivity({
      workspaceId,
      subjectType: "content",
      subjectId: contentId,
      actorId: user.id,
      verb: "edited",
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/studio/${contentId}`);
  return undefined;
}

export async function autoFixComplianceAction(
  workspaceId: string,
  contentId: string,
): Promise<{ ok: boolean; error?: string; draft?: Draft }> {
  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    const row = await getContentById(workspaceId, contentId);
    if (!row) return { ok: false, error: "Draft not found." };
    if (!row.body) return { ok: false, error: "Draft has no body to fix." };

    const profile = await getBrandProfile(workspaceId, row.clientId);
    const dna = brandDnaFromProfile(profile);
    if (!dna) return { ok: false, error: NO_BRAND_CONTEXT_ERROR };

    const currentDraft = parseDraftBody(row.body);
    if (!currentDraft) return { ok: false, error: "This content isn't a structured draft." };

    const declared = profile?.declared;
    const prompt = `Please rewrite this marketing draft to strictly adhere to brand guidelines and eliminate all banned words, avoid topics, or tone violations.

Brand Context:
- Mission: ${declared?.mission ?? ""}
- Tone Pillars: ${(declared?.tones ?? []).join(", ")}
- Banned Words: ${(declared?.bannedWords ?? []).join(", ")}
- Avoid Topics: ${(declared?.avoidTopics ?? []).join(", ")}

Original Draft:
Caption: ${currentDraft.caption}
Script: ${currentDraft.script}
CTA: ${currentDraft.cta}
Hashtags: ${currentDraft.hashtags.join(" ")}`;

    const fixedDraft = await runWithAiCost(
      { workspaceId, purpose: "refine" },
      () =>
        refineDraft({
          draft: currentDraft,
          feedback: prompt,
          identity: dna,
        }),
    );

    const newBody = formatDraftBody(fixedDraft);

    await db
      .update(content)
      .set({ body: newBody, complianceStatus: "passed" })
      .where(and(eq(content.workspaceId, workspaceId), eq(content.id, row.id)));

    await recordRevision({
      workspaceId,
      contentId,
      authorKind: "ai",
      authorId: user.id,
      fields: { title: row.title ?? undefined, strategyNote: newBody },
      priorFields: { title: row.title ?? undefined, strategyNote: row.body ?? undefined },
      note: "AI auto-fixed compliance violations",
    });

    await recordActivity({
      workspaceId,
      subjectType: "content",
      subjectId: contentId,
      actorId: user.id,
      verb: "edited",
    });

    revalidatePath(`/w/${workspaceId}/studio/${contentId}`);
    return { ok: true, draft: fixedDraft };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}
