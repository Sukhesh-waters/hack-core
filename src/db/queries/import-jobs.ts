import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { importJobs } from "@/db/schema";

/** Timeout message shown in the import-jobs list — re-upload is the retry
 * (the CSV isn't stored, so the parse itself can't be auto-retried). */
export const IMPORT_TIMEOUT_ERROR =
  "Timed out — the import did not complete. Re-upload the CSV.";

/**
 * Builder for the stalled-import sweep (exposed for .toSQL() tests).
 *
 * Cron-only cross-workspace exception (same shape as the account-sync sweep
 * in inngest/functions/account-sync.ts): this UPDATE intentionally has no
 * workspace_id in its WHERE because the hourly sweep must catch every
 * workspace's stuck imports in one tick, not one workspace at a time. It is
 * never reachable from a user request — only the import-timeout Inngest cron
 * calls it. Safety comes from the WHERE guard instead of workspace scoping:
 * `status = 'processing'` means a job that already finished (complete or
 * failed) between the query being planned and executed simply won't match,
 * so this can't race a concurrent completion into a false "failed".
 */
export function failStalledImportJobsQuery(cutoff: Date) {
  return db
    .update(importJobs)
    .set({ status: "failed", error: IMPORT_TIMEOUT_ERROR })
    .where(
      and(eq(importJobs.status, "processing"), lt(importJobs.createdAt, cutoff)),
    )
    .returning({ id: importJobs.id });
}

/** Flips every import stuck in "processing" past `cutoff` to "failed".
 * Returns the count of rows flipped so the caller (Inngest step) can report
 * it. */
export async function failStalledImportJobs(cutoff: Date): Promise<number> {
  const rows = await failStalledImportJobsQuery(cutoff);
  return rows.length;
}
