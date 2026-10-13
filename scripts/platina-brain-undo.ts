/**
 * Recovery L1 (plan §11.1, §11.2): a stage changed Brain chunk state wrongly
 * (bad refutations, bad promotions, resolve v2 states) — undo it without
 * losing anything collected since.
 *
 *   npx tsx scripts/platina-brain-undo.ts --ws waters-gcc-internal --cause grading --since 2026-10-01T00:00:00Z
 *   npx tsx scripts/platina-brain-undo.ts --ws waters-gcc-internal --cause grading --since 2026-10-01T00:00:00Z --apply
 *
 * Without --cause, undoes every cause since --since EXCEPT a prior undo's
 * own rows (planUndo's default). To undo a specific prior undo, pass its
 * exact cause: --cause undo:<run id> (the run id a previous --apply printed).
 *
 * Dry run by default. --apply writes the inverse through setBrainState with
 * cause "undo:<run id>" (run id = this run's timestamp) and prints that run
 * id, so this undo can itself be undone the same way.
 */
import { parseRecoveryArgs, planUndo } from "@/lib/platina/brain-recovery";

async function main() {
  process.loadEnvFile(".env.local");
  const parsed = parseRecoveryArgs(process.argv.slice(2));
  if (!parsed.ok) throw new Error(parsed.error);
  const { ws: slug, cause, since, apply } = parsed.args;
  if (!slug || !since) throw new Error("usage: --ws <slug> --since <ISO date> [--cause <cause>] [--apply]");

  const { db } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const { workspaces } = await import("@/db/schema");
  const { setBrainState, listBrainStateLog } = await import("@/db/queries/platina-brain");

  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.slug, slug));
  if (!workspace) throw new Error(`no workspace "${slug}"`);

  // Fetch broadly by `since` only — planUndo owns the cause match (and the
  // "never sweep up a prior undo by default" rule) in pure, tested code.
  // field/fromValue/toValue are untyped jsonb/text columns at the DB layer
  // (same cast setBrainState's own toPatch() makes).
  const rows = (await listBrainStateLog(workspace.id, { since })).map((r) => ({
    brainChunkId: r.brainChunkId,
    field: r.field as "status" | "confidence" | "agreementState",
    fromValue: r.fromValue as string | number | null,
    toValue: r.toValue as string | number | null,
    createdAt: r.createdAt,
    cause: r.cause,
  }));
  const inverse = planUndo(rows, { cause: cause ?? undefined, since });

  console.log(`\n${slug}: ${inverse.length} change(s) to undo${cause ? ` for cause "${cause}"` : ""} since ${since.toISOString()}`);
  for (const row of inverse) console.log(`  ${row.brainChunkId} ${row.field}: ${row.fromValue} -> ${row.toValue}`);

  if (!apply) {
    console.log("\nDry run. Nothing changed. Re-run with --apply.");
    process.exit(0);
  }
  if (inverse.length === 0) {
    console.log("\nNothing to undo.");
    process.exit(0);
  }

  const runId = Date.now();
  const runCause = `undo:${runId}`;
  for (const row of inverse) {
    await setBrainState(workspace.id, row.brainChunkId, { [row.field]: row.toValue }, runCause);
  }
  console.log(`\ndone. ${inverse.length} change(s) applied under cause "${runCause}".`);
  console.log(`To undo this undo: --cause ${runCause} --since ${since.toISOString()} --apply`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

export {};
