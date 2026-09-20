import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { insights } from "@/db/schema";

const INSIGHT_LIMIT = 50;

/** Builder exported for .toSQL() tests. */
export function insightsQuery(workspaceId: string) {
  return db
    .select()
    .from(insights)
    .where(eq(insights.workspaceId, workspaceId))
    .orderBy(desc(insights.createdAt))
    .limit(INSIGHT_LIMIT);
}

export type InsightRow = Awaited<ReturnType<typeof insightsQuery>>[number];

export async function listInsights(workspaceId: string) {
  return insightsQuery(workspaceId);
}

/**
 * Builder exported for .toSQL() tests. Scoped by workspace AND id — a
 * client-supplied insightId is never proof it belongs to this workspace.
 * Used server-side before trusting an insight cited on a decision (G2).
 */
export function insightByIdQuery(workspaceId: string, insightId: string) {
  return db
    .select()
    .from(insights)
    .where(and(eq(insights.workspaceId, workspaceId), eq(insights.id, insightId)))
    .limit(1);
}

export async function getInsightById(workspaceId: string, insightId: string) {
  const rows = await insightByIdQuery(workspaceId, insightId);
  return rows[0] ?? null;
}

export async function createInsights(input: {
  workspaceId: string;
  patternRunId?: string | null;
  observations: { pattern: string; suggestion: string; evidence: string[] }[];
}) {
  if (input.observations.length === 0) return;
  await db.insert(insights).values(
    input.observations.map((o) => ({
      workspaceId: input.workspaceId,
      pattern: o.pattern,
      suggestion: o.suggestion,
      // Already stripped by validateEvidence in src/lib/ai/agents/critic.ts.
      // Persist its output; do NOT add a second validation layer here.
      evidencePatternIds: o.evidence,
      patternRunId: input.patternRunId ?? null,
    })),
  );
}
