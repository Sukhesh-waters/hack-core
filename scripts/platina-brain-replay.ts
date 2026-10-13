/**
 * Recovery L2 (plan §11.1, §11.3): documents were skipped that should not
 * have been (surprise filter, untestable, gate) — requeue them.
 *
 *   npx tsx scripts/platina-brain-replay.ts --ws waters-gcc-internal --cause surprise --since 2026-10-01T00:00:00Z
 *   npx tsx scripts/platina-brain-replay.ts --ws waters-gcc-internal --cause surprise --since 2026-10-01T00:00:00Z --limit 20 --apply
 *
 * Dry run prints the count and an estimated model-call cost (2 per
 * document: proposer + challenger) before anything is queued. --apply
 * resets the selected documents to processing_state "unprocessed" with
 * skip_reason/skip_cause/processing_started_at cleared — nothing is
 * dispatched directly. The next `platina-contradict-sweep` run (the 6-hourly
 * cron, or a `platina/contradict.requested` event) picks them up through
 * `listUnresolvedSignals`: same job, same `claimSignal`, same throttle, same
 * daily cap. No document is ever deleted; a skip is a status, not a loss.
 *
 * DEDUPE CAVEAT (checked against src/inngest/functions/platina/{contradict-
 * sweep,signal-analyze}.ts): the sweep's dispatch id is
 * `analyze:<signalId>:<10-minute bucket of now>` (lib/platina/analysis.ts
 * analyzeEventId) — Inngest drops a repeat of that exact id within 24h. A
 * replay itself never collides (it only resets rows; it sends no event).
 * The one real window: if you force an immediate sweep (sending
 * `platina/contradict.requested` by hand) within 10 minutes of the SAME
 * document's most recent dispatch, the fresh dispatch computes the same
 * id as that recent one and is silently dropped — the document stays
 * `unprocessed` and is picked up cleanly by the next sweep tick instead
 * (cron is 6-hourly, far outside the 10-minute window, so this only bites a
 * manually forced immediate re-sweep). Nothing is lost either way; at worst
 * it waits one more cron tick. Prefer waiting >10 minutes after a skip
 * before forcing an immediate sweep on the same documents.
 */
import { parseRecoveryArgs, planReplay } from "@/lib/platina/brain-recovery";
import type { BrainSkipCause } from "@/db/platina-schema";

const REPLAYABLE_CAUSES: ReadonlySet<string> = new Set(["surprise", "untestable", "gate"]);

async function main() {
  process.loadEnvFile(".env.local");
  const parsed = parseRecoveryArgs(process.argv.slice(2));
  if (!parsed.ok) throw new Error(parsed.error);
  const { ws: slug, cause, since, limit, apply } = parsed.args;
  if (!slug || !cause || !since) {
    throw new Error("usage: --ws <slug> --cause surprise|untestable|gate --since <ISO date> [--limit N] [--apply]");
  }
  if (!REPLAYABLE_CAUSES.has(cause)) {
    throw new Error(`--cause must be one of: ${[...REPLAYABLE_CAUSES].join(", ")} (got "${cause}")`);
  }

  const { db } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const { workspaces } = await import("@/db/schema");
  const { listSkippedSignals, resetSkippedSignals } = await import("@/db/queries/platina-brain-recovery");

  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.slug, slug));
  if (!workspace) throw new Error(`no workspace "${slug}"`);

  const docs = await listSkippedSignals(workspace.id, cause as BrainSkipCause, since);
  const plan = planReplay(docs, { cause, since, limit: limit ?? undefined });

  console.log(`\n${slug}: ${plan.summary}`);
  console.log(
    "\nDedupe note: a replay only resets rows, it dispatches no event. The next sweep (6-hourly cron, or an\n" +
      "immediate platina/contradict.requested) dispatches these normally. Forcing an immediate sweep within 10\n" +
      "minutes of these documents' last dispatch may be silently deduped by Inngest for that one tick; the next\n" +
      "cron tick picks them up regardless. Nothing is lost.",
  );

  if (!apply) {
    console.log("\nDry run. Nothing changed. Re-run with --apply.");
    process.exit(0);
  }
  if (plan.selectedIds.length === 0) {
    console.log("\nNothing to replay.");
    process.exit(0);
  }

  const reset = await resetSkippedSignals(workspace.id, plan.selectedIds);
  console.log(`\ndone. ${reset.length} document(s) reset to unprocessed. The normal sweep will pick them up.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

export {};
