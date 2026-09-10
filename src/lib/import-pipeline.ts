import type { posts } from "@/db/schema";
import type { ParsedPostRow } from "@/lib/csv-import";
import type { NormalizedMeta } from "@/lib/normalize";
import {
  computeEngagementRate,
  scoreAgainstBaseline,
  type BaselinePoint,
} from "@/lib/scoring";

export type PlannedPost = typeof posts.$inferInsert;

/** A job stuck at "processing" past this window was almost certainly killed
 * mid-import (serverless timeout, aborted request) — the failed-status update
 * only runs inside the same request's catch block. */
export const IMPORT_STALE_MS = 15 * 60 * 1000;

export type ImportJobDisplayStatus =
  | "processing"
  | "complete"
  | "failed"
  | "stalled";

/** Derive the status to show for an import job. "processing" older than the
 * stale window is reported as "stalled" so an abandoned job is distinguishable
 * from one still running. Pure — no I/O. */
export function importJobDisplayStatus(
  job: { status: string; createdAt: Date },
  now: Date = new Date(),
): ImportJobDisplayStatus {
  if (
    job.status === "processing" &&
    now.getTime() - job.createdAt.getTime() > IMPORT_STALE_MS
  ) {
    return "stalled";
  }
  if (
    job.status === "processing" ||
    job.status === "complete" ||
    job.status === "failed"
  ) {
    return job.status;
  }
  return "processing";
}

/**
 * Pure planner: turns parsed CSV rows into insert-ready post rows with
 * scores. Baseline = the account's existing first-party points + this
 * import's computable rows (self-inclusion is negligible at min-N sizes).
 */
export function buildImportPlan(input: {
  workspaceId: string;
  clientId: string;
  importJobId: string;
  rows: ParsedPostRow[];
  meta: (NormalizedMeta | null)[];
  existingBaseline: BaselinePoint[];
  now?: Date;
}): PlannedPost[] {
  const now = input.now ?? new Date();
  const incoming = input.rows.map((row) => ({
    row,
    engagementRate: computeEngagementRate(row),
  }));

  const baseline: BaselinePoint[] = [
    ...input.existingBaseline,
    ...incoming
      .filter((entry) => entry.engagementRate !== null)
      .map((entry) => ({
        value: entry.engagementRate as number,
        postedAt: entry.row.postedAt,
      })),
  ];

  return incoming.map(({ row, engagementRate }, i) => {
    const score =
      engagementRate === null
        ? null
        : scoreAgainstBaseline(engagementRate, baseline, now);
    const scored = score?.status === "scored" ? score : null;
    return {
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      importJobId: input.importJobId,
      source: "first_party" as const,
      externalId: row.externalId ?? null,
      caption: row.caption ?? null,
      format: input.meta[i]?.format ?? null,
      topics: input.meta[i]?.topics ?? null,
      postedAt: row.postedAt,
      reach: row.reach ?? null,
      likes: row.likes ?? null,
      comments: row.comments ?? null,
      shares: row.shares ?? null,
      saves: row.saves ?? null,
      engagementRate,
      zScore: scored?.zScore ?? null,
      magnitude: scored?.magnitude ?? null,
      direction: scored?.direction ?? null,
      scoreStatus: score === null ? ("unscored" as const) : score.status,
    };
  });
}
