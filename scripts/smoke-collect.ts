/**
 * Runs one approved scan spec straight through the fetch adapter, bypassing
 * Inngest entirely. Separates "the scheduler is broken" from "Apify is
 * broken", which look identical from the UI.
 *
 * Usage: npx tsx scripts/smoke-collect.ts --ws <workspaceId> --spec <specId> [--insert]
 * Costs one real Apify run. Writes nothing unless --insert is passed.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const ws = arg("ws");
  const specId = arg("spec");
  if (!ws || !specId) {
    console.error("usage: smoke-collect --ws <workspaceId> --spec <specId> [--insert]");
    process.exit(1);
  }

  // A bare tsx run does not load .env.local, and @/db reads DATABASE_URL at
  // import time — so load it first and import everything else afterwards.
  process.loadEnvFile(".env.local");

  const { getScanSpec, insertSignalDocuments } = await import("@/db/queries/platina");
  const { runApprovedScan } = await import("@/lib/platina/fetch/registry");
  // Registers the "apify" adapter as a side effect, as audit-run.ts does.
  const { registerWatersAdapter } = await import("@/lib/platina/fetch/waters");
  registerWatersAdapter();

  const spec = await getScanSpec(ws, specId);
  if (!spec) throw new Error("scan spec not found in that workspace");
  console.log(`spec "${spec.name}" [${spec.status}] — ${spec.targets.length} target(s)`);

  const outcome = await runApprovedScan({
    id: spec.id,
    workspaceId: spec.workspaceId,
    status: spec.status,
    targets: spec.targets,
  });
  const inserted = process.argv.includes("--insert")
    ? await insertSignalDocuments(ws, spec.id, outcome.docs)
    : "not written (pass --insert)";

  console.log(`fetched:  ${outcome.docs.length}`);
  console.log(`inserted: ${inserted}`);
  console.log(`failures: ${outcome.failures.length}`);
  for (const f of outcome.failures) console.log(`  - ${f.target}: ${f.error}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

export {};
