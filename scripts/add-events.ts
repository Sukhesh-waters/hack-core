/**
 * Add conference/event pages to a workspace (campaign intelligence C4). Same
 * approval path as the Audits "conference preset" button: a scan spec, a
 * confirm gate event, a first run sent to the job runner. Weekly — an event
 * page changes rarely, and each read is one Firecrawl credit.
 *
 *   npx tsx scripts/add-events.ts --ws waters-gcc-internal \
 *     --preset arablab --preset whx-labs --preset pittcon \
 *     --url "ASMS future conferences=https://www.asms.org/conferences/annual-conference/future-annual-conferences" \
 *     [--apply]
 *
 * Without --apply it prints what it would add. A page already collected in
 * the workspace is skipped.
 */
function args(name: string): string[] {
  return process.argv.flatMap((a, i) => (a === `--${name}` ? [process.argv[i + 1]] : []));
}

const WEEKLY_MINUTES = 7 * 24 * 60;

async function main() {
  process.loadEnvFile(".env.local");
  const slug = args("ws")[0];
  const apply = process.argv.includes("--apply");
  const { getConferencePreset } = await import("@/lib/platina/presets");
  const pages = [
    ...args("preset").map((key) => {
      const preset = getConferencePreset(key);
      if (!preset) throw new Error(`unknown preset "${key}"`);
      return { name: preset.name, url: preset.url };
    }),
    ...args("url").map((raw) => {
      const at = raw.indexOf("=");
      return { name: raw.slice(0, at).trim(), url: raw.slice(at + 1).trim() };
    }),
  ];
  if (!slug || pages.length === 0) throw new Error('usage: --ws <slug> (--preset key | --url "Name=https://...")+ [--apply]');

  const { db } = await import("@/db");
  const { workspaces, memberships } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const q = await import("@/db/queries/platina");
  const { assertCompleteGateEvent } = await import("@/lib/platina/gates");
  const { hashGatePayload } = await import("@/lib/platina/hash");
  const { snapshotRunConfig } = await import("@/lib/platina/orchestrator");
  const { inngest } = await import("@/inngest/client");

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.slug, slug));
  if (!ws) throw new Error(`no workspace "${slug}"`);
  const [owner] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.workspaceId, ws.id), eq(memberships.role, "owner")));
  const specs = await q.listScanSpecs(ws.id);
  const config = await q.getWorkspaceConfig(ws.id);
  const runs: string[] = [];

  for (const page of pages) {
    try {
      new URL(page.url);
    } catch {
      console.log(`  ! ${page.name}: not a URL (${page.url})`);
      continue;
    }
    if (specs.some((s) => s.targets.some((t) => t.value === page.url))) {
      console.log(`  = ${page.name}: already collected`);
      continue;
    }
    console.log(`  + ${page.name} — ${page.url}, weekly`);
    if (!apply) continue;

    const specId = await q.insertScanSpec({
      workspaceId: ws.id,
      name: page.name,
      targets: [{ kind: "conference", value: page.url, maxPages: 1 }],
      cadenceMinutes: WEEKLY_MINUTES,
      createdById: owner.userId,
    });
    await q.approveScanSpec(ws.id, specId);
    const event = {
      workspaceId: ws.id,
      gate: "confirm" as const,
      decision: "approved" as const,
      approverId: owner.userId,
      payloadHash: hashGatePayload({ specId }),
      subjectType: "scan_spec",
      subjectId: specId,
    };
    assertCompleteGateEvent(event);
    await q.insertGateEvent(event);
    const runId = await q.createAuditRun({
      workspaceId: ws.id,
      specId,
      trigger: "event",
      idempotencyKey: `approved:${specId}`,
      configSnapshot: snapshotRunConfig(config),
    });
    if (runId) runs.push(runId);
  }

  if (!apply) {
    console.log("\nDry run — nothing written. Re-run with --apply.\n");
    process.exit(0);
  }
  if (runs.length > 0) {
    await inngest.send(runs.map((runId) => ({ name: "platina/audit-run.requested", data: { runId, workspaceId: ws.id } })));
  }
  console.log(`\nStarted ${runs.length} event page run(s).`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

export {};
