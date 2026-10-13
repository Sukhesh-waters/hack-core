/**
 * Recovery L4 backstop and the required step before every mode flip to `on`
 * (plan §11.4, §11.6): a point-in-time copy of a workspace's Brain chunk
 * states, config and funnel, and the restore that returns to it.
 *
 *   npx tsx scripts/platina-brain-snapshot.ts --ws waters-gcc-internal [--stage gate]
 *     -> writes backups/<date>-brain-<slug>[-<stage>].json
 *
 *   npx tsx scripts/platina-brain-snapshot.ts --restore backups/2026-10-13-brain-waters-gcc-internal.json [--archive-new] [--apply]
 *     -> dry run by default: prints what planRestore would change.
 *        --apply: state changes through setBrainState (cause
 *        "restore:<file basename>"), modes and config knobs restored too.
 *        Rows created since the snapshot are left alone unless
 *        --archive-new: the live pipeline keeps writing real insights, and
 *        until B1's written_by marker they cannot be told apart.
 *        Content and embeddings are never touched.
 */
import { basename } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseRecoveryArgs, planRestore, type BrainSnapshot } from "@/lib/platina/brain-recovery";

async function main() {
  process.loadEnvFile(".env.local");
  const parsed = parseRecoveryArgs(process.argv.slice(2));
  if (!parsed.ok) throw new Error(parsed.error);
  const { ws: slug, stage, restore, apply, archiveNew } = parsed.args;

  const { db } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const { workspaces } = await import("@/db/schema");
  const { getWorkspaceConfig } = await import("@/db/queries/platina");
  const { setBrainState, setBrainModes, setBrainConfig, brainFunnelCounts } = await import("@/db/queries/platina-brain");
  const { listBrainChunkStates } = await import("@/db/queries/platina-brain-recovery");

  if (restore) {
    const snapshot = JSON.parse(readFileSync(restore, "utf8")) as BrainSnapshot;
    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.slug, snapshot.slug));
    if (!workspace) throw new Error(`no workspace "${snapshot.slug}" (from the snapshot file)`);
    if (workspace.id !== snapshot.workspaceId) {
      console.warn(`warning: workspace id in the file (${snapshot.workspaceId}) does not match the live row for "${snapshot.slug}" (${workspace.id}). Proceeding against the live id.`);
    }

    const currentChunks = (await listBrainChunkStates(workspace.id)).map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
    }));
    const plan = planRestore(snapshot, currentChunks, { archiveNew });

    console.log(`\nrestoring ${snapshot.slug} from ${restore} (taken ${snapshot.takenAt})`);
    console.log(`  ${plan.stateChanges.length} chunk(s) to revert:`);
    for (const change of plan.stateChanges) console.log(`    ${change.chunkId} -> ${JSON.stringify(change.next)}`);
    if (archiveNew) {
      console.log(`  ${plan.archive.length} chunk(s) created since the snapshot, to archive (kept, never deleted):`);
      for (const id of plan.archive) console.log(`    ${id}`);
    } else {
      console.log(`  ${plan.newSinceSnapshot.length} chunk(s) created since the snapshot are left as they are (--archive-new to archive them)`);
    }
    console.log(`  modes -> ${JSON.stringify(plan.modes)}`);
    console.log(`  config -> ${JSON.stringify(snapshot.config)}`);

    if (!apply) {
      console.log("\nDry run. Nothing changed. Re-run with --apply.");
      process.exit(0);
    }

    const cause = `restore:${basename(restore)}`;
    for (const change of plan.stateChanges) await setBrainState(workspace.id, change.chunkId, change.next, cause);
    for (const id of plan.archive) await setBrainState(workspace.id, id, { status: "archived" }, cause);
    await setBrainModes(workspace.id, plan.modes);
    await setBrainConfig(workspace.id, snapshot.config);

    console.log(`\ndone. ${plan.stateChanges.length} chunk(s) reverted, ${plan.archive.length} archived, modes and config restored.`);
    process.exit(0);
  }

  if (!slug) throw new Error("usage: --ws <slug> [--stage <stage>]  OR  --restore <file> [--apply]");

  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.slug, slug));
  if (!workspace) throw new Error(`no workspace "${slug}"`);

  const config = await getWorkspaceConfig(workspace.id);
  const chunks = (await listBrainChunkStates(workspace.id)).map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }));
  const funnel = await brainFunnelCounts(workspace.id, new Date(0));

  const snapshot: BrainSnapshot = {
    version: 1,
    workspaceId: workspace.id,
    slug,
    takenAt: new Date().toISOString(),
    ...(stage ? { stage } : {}),
    modes: config?.brainModes ?? {},
    config: {
      surpriseFloor: config?.surpriseFloor ?? 1.0,
      surpriseAuditShare: config?.surpriseAuditShare ?? 0.1,
      derivedContextShare: config?.derivedContextShare ?? 0.4,
    },
    chunks,
    funnel,
  };

  mkdirSync("backups", { recursive: true });
  const file = `backups/${new Date().toISOString().slice(0, 10)}-brain-${slug}${stage ? `-${stage}` : ""}.json`;
  writeFileSync(file, JSON.stringify(snapshot, null, 1));
  console.log(`\nsnapshot: ${file}`);
  console.log(`  ${chunks.length} Brain chunk(s), modes ${JSON.stringify(snapshot.modes)}, config ${JSON.stringify(snapshot.config)}`);
  console.log(`  funnel: ${funnel.length} (stage, decision) row(s) since all-time`);
  console.log(`\nRestore with: npx tsx scripts/platina-brain-snapshot.ts --restore ${file} [--apply]`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

export {};
