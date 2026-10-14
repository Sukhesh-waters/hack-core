/**
 * B0 (metacognitive Brain) — queries behind Admin -> Health's "Brain quality"
 * card (plan §5 B0, §8). Every query filters workspace_id explicitly
 * (app-layer isolation; see CLAUDE.md) and platina-brain-quality.test.ts
 * asserts it in the generated SQL, following the house pattern in
 * platina-learning.ts / platina-brain.ts.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { platinaBrainTelemetry, platinaDebateTranscripts, platinaSignalDocuments } from "@/db/platina-schema";

export type BrainQualityTranscriptRow = {
  promptVersion: string | null;
  proposerModel: string | null;
  objected: boolean | null;
  state: "agreed" | "qualified" | "contested" | "refuted";
  /** B2 — whether this round's challenger saw the blind prompt. */
  blinded: boolean | null;
};

/**
 * Debate transcripts since a moment — the input to the "Second opinion
 * objected", "Agreement rate" and B2's "blind vs. not" / "may not be blind"
 * rows. Null promptVersion/proposerModel mean the transcript predates
 * B0/B2 tracking ("before tracking"), not a 0.
 */
export function brainQualityTranscriptsQuery(workspaceId: string, since: Date) {
  return db
    .select({
      promptVersion: platinaDebateTranscripts.promptVersion,
      proposerModel: platinaDebateTranscripts.proposerModel,
      objected: platinaDebateTranscripts.objected,
      state: platinaDebateTranscripts.state,
      blinded: platinaDebateTranscripts.blinded,
    })
    .from(platinaDebateTranscripts)
    .where(
      and(eq(platinaDebateTranscripts.workspaceId, workspaceId), gte(platinaDebateTranscripts.createdAt, since)),
    );
}

export async function listBrainQualityTranscripts(
  workspaceId: string,
  since: Date,
): Promise<BrainQualityTranscriptRow[]> {
  return brainQualityTranscriptsQuery(workspaceId, since);
}

/**
 * Documents fetched since a moment, across all adapters — the "Documents
 * read by a model" row's denominator. The caller decides the window; when it
 * is zero the card shows "not enough data yet", never a synthesised share.
 */
export function fetchedDocumentCountQuery(workspaceId: string, since: Date) {
  return db
    .select({ n: sql<number>`count(*)::int` })
    .from(platinaSignalDocuments)
    .where(and(eq(platinaSignalDocuments.workspaceId, workspaceId), gte(platinaSignalDocuments.fetchedAt, since)));
}

export async function fetchedDocumentCount(workspaceId: string, since: Date): Promise<number> {
  const [row] = await fetchedDocumentCountQuery(workspaceId, since);
  return row?.n ?? 0;
}

export type AuditSampleRow = { foundSomething: boolean };

/**
 * B4 — stage "analysis" decision "audit_sample" telemetry rows for the
 * window: the "Spot checks that found something" row's raw input. Grouped
 * counts (`brainFunnelCountsQuery`) cannot answer "how many of these found
 * something" — that lives only in each row's `detail.foundSomething`
 * (signal-analyze.ts writes it next to the chunk/finding it describes), so
 * this reads the raw rows instead of a count.
 */
export function auditSampleDetailQuery(workspaceId: string, since: Date) {
  return db
    .select({ detail: platinaBrainTelemetry.detail })
    .from(platinaBrainTelemetry)
    .where(
      and(
        eq(platinaBrainTelemetry.workspaceId, workspaceId),
        eq(platinaBrainTelemetry.stage, "analysis"),
        eq(platinaBrainTelemetry.decision, "audit_sample"),
        gte(platinaBrainTelemetry.createdAt, since),
      ),
    );
}

export async function listAuditSampleDetail(workspaceId: string, since: Date): Promise<AuditSampleRow[]> {
  const rows = await auditSampleDetailQuery(workspaceId, since);
  return rows.map((row) => ({
    foundSomething: Boolean((row.detail as Record<string, unknown> | null)?.foundSomething),
  }));
}
