/**
 * Per-(workspace, key) running novelty/engagement/pressure expectation (B4 —
 * metacognitive Brain surprise filter, wired in W3a). The Welford
 * mean/variance arithmetic itself lives in src/lib/platina/surprise.ts (pure,
 * DB-free) — this module only reads and upserts the stored {n, mean, m2} one
 * row keeps per src/lib/platina/surprise.ts `expectationKey` value. Every
 * query filters workspace_id explicitly (app-layer isolation; see
 * CLAUDE.md), asserted in platina-expectations.test.ts, following the house
 * pattern in platina-brain.ts.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { platinaExpectations } from "@/db/platina-schema";
import type { Expectation } from "@/lib/platina/surprise";

/** This (workspace, key)'s expectation row, if any — exported so its SQL shape is testable. */
export function expectationQuery(workspaceId: string, key: string) {
  return db
    .select({ n: platinaExpectations.n, mean: platinaExpectations.mean, m2: platinaExpectations.m2 })
    .from(platinaExpectations)
    .where(and(eq(platinaExpectations.workspaceId, workspaceId), eq(platinaExpectations.key, key)))
    .limit(1);
}

/** null = never observed before (cold start) — the caller passes this straight into decideSurprise. */
export async function getExpectation(workspaceId: string, key: string): Promise<Expectation | null> {
  const [row] = await expectationQuery(workspaceId, key);
  return row ?? null;
}

/**
 * ON CONFLICT (workspace_id, key) DO UPDATE — one row per key, always the
 * latest folded-in Welford state. Exported so its SQL shape is testable.
 */
export function upsertExpectationQuery(workspaceId: string, key: string, next: Expectation) {
  return db
    .insert(platinaExpectations)
    .values({ workspaceId, key, n: next.n, mean: next.mean, m2: next.m2 })
    .onConflictDoUpdate({
      target: [platinaExpectations.workspaceId, platinaExpectations.key],
      set: { n: next.n, mean: next.mean, m2: next.m2, updatedAt: new Date() },
    });
}

/**
 * Persists one more observation, surprising or not — see surprise.ts's file
 * header for why a biased sample (only saving on "analyse") would be worse
 * than no filter at all.
 */
export async function upsertExpectation(workspaceId: string, key: string, next: Expectation): Promise<void> {
  await upsertExpectationQuery(workspaceId, key, next);
}
