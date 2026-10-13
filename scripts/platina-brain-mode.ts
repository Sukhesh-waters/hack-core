/**
 * Recovery L0 (plan §11.1): flip a Brain stage's mode back to `off` in
 * seconds, no data change, the next job or request takes the old path.
 *
 *   npx tsx scripts/platina-brain-mode.ts --ws waters-gcc-internal
 *   npx tsx scripts/platina-brain-mode.ts --ws waters-gcc-internal --stage gate --mode off --apply
 *
 * With --stage and --mode but no --apply, prints what would change (dry
 * run). --apply writes it. Without --stage/--mode, just shows the current
 * modes. Refuses an unknown stage or mode.
 */
import { parseRecoveryArgs } from "@/lib/platina/brain-recovery";

async function main() {
  process.loadEnvFile(".env.local");
  const parsed = parseRecoveryArgs(process.argv.slice(2));
  if (!parsed.ok) throw new Error(parsed.error);
  const { ws: slug, stage, mode, apply } = parsed.args;
  if (!slug) throw new Error("usage: --ws <slug> [--stage <stage> --mode <off|shadow|on> [--apply]]");

  const { db } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const { workspaces } = await import("@/db/schema");
  const { getBrainModes, setBrainModes } = await import("@/db/queries/platina-brain");

  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.slug, slug));
  if (!workspace) throw new Error(`no workspace "${slug}"`);

  const current = await getBrainModes(workspace.id);
  console.log(`\n${slug} — Brain stage modes:`);
  for (const [s, m] of Object.entries(current)) console.log(`  ${s}: ${m}`);

  if (!stage && !mode) {
    console.log("\nNo --stage/--mode given: showing only. Nothing changed.");
    process.exit(0);
  }
  if (!stage || !mode) {
    throw new Error("need both --stage and --mode to change anything");
  }

  console.log(`\n${apply ? "Setting" : "Would set"} ${stage}: ${current[stage]} -> ${mode}`);
  if (!apply) {
    console.log("Dry run. Nothing changed. Re-run with --apply.");
    process.exit(0);
  }

  await setBrainModes(workspace.id, { [stage]: mode });
  console.log(`done. ${stage} is now ${mode}.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

export {};
