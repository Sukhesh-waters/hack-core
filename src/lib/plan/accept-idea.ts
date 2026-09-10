import { db } from "@/db";
import { content, contentType } from "@/db/schema";
import { recordActivity } from "@/lib/activity";
import { getBrandProfile } from "@/db/queries/brand";
import {
  claimIdeaForDrafting,
  getIdea,
  releaseIdeaClaim,
} from "@/db/queries/ideas";
import {
  brandDnaFromProfile,
  NO_BRAND_CONTEXT_ERROR,
} from "@/lib/ai/brand-merge";
import { formatDraftBody, generateDraft } from "@/lib/ai/generation-agent";
import { runWithAiCost } from "@/lib/ai/usage-context";

type ContentType = (typeof contentType.enumValues)[number];

export function mapIdeaFormatToContentType(format: string | null): ContentType {
  const f = (format ?? "").toLowerCase();
  if (f.includes("reel")) return "reel";
  if (f.includes("carousel")) return "carousel";
  if (f.includes("story")) return "story";
  return "post";
}

/**
 * The ONE accept path — called from Ideation, Team Hub, and Plan & Validate.
 * new → drafted: generates the AI draft body, inserts the content row seeded
 * at production_stage "brief", flips the idea. Throws plain Errors; callers
 * ("use server" actions) catch and map via actionErrorMessage.
 */
export async function acceptIdea(input: {
  workspaceId: string;
  ideaId: string;
  actorId?: string | null;
}): Promise<{ contentId: string }> {
  const { workspaceId, ideaId } = input;
  const idea = await getIdea(workspaceId, ideaId);
  if (!idea) throw new Error("Idea not found.");
  if (idea.status !== "new") {
    throw new Error("This idea has already been decided.");
  }

  const profile = await getBrandProfile(workspaceId, idea.clientId);
  const dna = brandDnaFromProfile(profile);
  if (!dna) throw new Error(NO_BRAND_CONTEXT_ERROR);

  // Claim the idea (new → drafted) BEFORE spending AI budget. If another
  // request (a second tab, or the Plan/Hub pair racing on the same idea)
  // already claimed it, we lose here and stop — no double generation, no
  // duplicate content row.
  const claimed = await claimIdeaForDrafting(workspaceId, ideaId);
  if (claimed.length === 0) {
    throw new Error("This idea has already been decided.");
  }

  try {
    const draft = await runWithAiCost(
      { workspaceId, purpose: "generation" },
      () =>
        generateDraft({
          idea: { hook: idea.hook, angle: idea.angle, format: idea.format },
          identity: dna,
        }),
    );

    const [row] = await db
      .insert(content)
      .values({
        workspaceId,
        clientId: idea.clientId,
        ideaId: idea.id,
        type: mapIdeaFormatToContentType(idea.format),
        title: idea.hook,
        body: formatDraftBody(draft),
        status: "draft",
        productionStage: "brief",
      })
      .returning({ id: content.id });

    // Recorded against the idea, not the draft: the event is "this idea was
    // accepted", and the content row is its consequence.
    await recordActivity({
      workspaceId,
      subjectType: "idea",
      subjectId: ideaId,
      actorId: input.actorId ?? null,
      verb: "idea_accepted",
      meta: { contentId: row.id },
    });

    return { contentId: row.id };
  } catch (error) {
    // Generation or insert failed after we claimed — release the claim so
    // the idea returns to the queue instead of being stranded in "drafted".
    await releaseIdeaClaim(workspaceId, ideaId);
    throw error;
  }
}
