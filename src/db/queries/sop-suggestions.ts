import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { sopSuggestions } from "@/db/schema";
import { recordActivity } from "@/lib/activity";

export function listPendingSopSuggestionsQuery(workspaceId: string) {
  return db
    .select()
    .from(sopSuggestions)
    .where(
      and(
        eq(sopSuggestions.workspaceId, workspaceId),
        isNull(sopSuggestions.appliedAt),
        isNull(sopSuggestions.dismissedAt),
      ),
    )
    .orderBy(desc(sopSuggestions.createdAt))
    .limit(50);
}

export async function createSopSuggestion(input: {
  workspaceId: string;
  sopTemplateId?: string;
  reason: string;
  suggestedChanges: Record<string, unknown>;
}) {
  const [row] = await db
    .insert(sopSuggestions)
    .values(input)
    .returning({ id: sopSuggestions.id });
  return row.id;
}

export async function applySopSuggestion(input: {
  workspaceId: string;
  suggestionId: string;
  actorId?: string;
}) {
  await db
    .update(sopSuggestions)
    .set({ appliedAt: new Date() })
    .where(
      and(
        eq(sopSuggestions.workspaceId, input.workspaceId),
        eq(sopSuggestions.id, input.suggestionId),
      ),
    );

  void recordActivity({
    workspaceId: input.workspaceId,
    subjectType: "doc",
    subjectId: input.suggestionId,
    actorId: input.actorId ?? null,
    verb: "applied",
  });
}

export async function dismissSopSuggestion(input: {
  workspaceId: string;
  suggestionId: string;
  actorId?: string;
}) {
  await db
    .update(sopSuggestions)
    .set({ dismissedAt: new Date() })
    .where(
      and(
        eq(sopSuggestions.workspaceId, input.workspaceId),
        eq(sopSuggestions.id, input.suggestionId),
      ),
    );

  void recordActivity({
    workspaceId: input.workspaceId,
    subjectType: "doc",
    subjectId: input.suggestionId,
    actorId: input.actorId ?? null,
    verb: "dismissed",
  });
}
