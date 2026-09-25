/**
 * Add LinkedIn company-post collection to clients or competitors that already
 * exist (slice C2). Same approval path as onboarding: one confirm gate event
 * per brand, a weekly scan spec, and a first run sent to the job runner.
 *
 *   npx tsx scripts/add-linkedin.ts --ws waters-gcc-internal \
 *     --page "Waters=waters" --page "Thermo Fisher Scientific=thermo-fisher-scientific" [--apply]
 *
 * Without --apply it prints what it would add. A brand that already has a
 * LinkedIn source is skipped. Cost: ~$0.02 per brand per weekly run.
 */
function args(name: string): string[] {
  return process.argv.flatMap((a, i) => (a === `--${name}` ? [process.argv[i + 1]] : []));
}

async function main() {
  process.loadEnvFile(".env.local");
  const slug = args("ws")[0];
  const pairs = args("page").map((raw) => {
    const at = raw.lastIndexOf("=");
    return { name: raw.slice(0, at).trim(), page: raw.slice(at + 1).trim() };
  });
  const apply = process.argv.includes("--apply");
  if (!slug || pairs.length === 0) throw new Error('usage: --ws <slug> --page "Brand=linkedin-slug" [--apply]');

  const { db } = await import("@/db");
  const { workspaces, memberships } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const q = await import("@/db/queries/platina");
  const derive = await import("@/lib/platina/onboard/derive");
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
  const brands = await q.listBrands(ws.id);
  const specs = await q.listScanSpecs(ws.id);
  const config = await q.getWorkspaceConfig(ws.id);
  const runs: string[] = [];

  for (const { name, page } of pairs) {
    const brand = brands.find((b) => b.name.toLowerCase() === name.toLowerCase());
    const company = derive.normalizeLinkedInCompany(page);
    if (!brand || !company) {
      console.log(`  ! ${name}: ${!brand ? "no such client/competitor" : "not a LinkedIn company page"}`);
      continue;
    }
    const value = `linkedin:@${company}`;
    if (specs.some((s) => s.brandId === brand.id && s.targets.some((t) => t.value === value))) {
      console.log(`  = ${brand.name}: already collecting ${value}`);
      continue;
    }
    const [candidate] = derive
      .deriveSources({ homepageUrl: "", handles: { linkedin: company } })
      .filter((c) => c.value === value);
    const [draft] = derive.candidatesToSpecs(brand.name, [candidate], false);
    console.log(`  + ${brand.name} (${brand.kind}): ${draft.name} — ${value}, every ${draft.cadenceMinutes / 1440} days, ${draft.targets[0].maxPages} posts`);
    if (!apply) continue;

    const event = {
      workspaceId: ws.id,
      gate: "confirm" as const,
      decision: "approved" as const,
      approverId: owner.userId,
      payloadHash: hashGatePayload({ brandId: brand.id, sources: [candidate.id], competitors: [] }),
      subjectType: "brand",
      subjectId: brand.id,
    };
    assertCompleteGateEvent(event);
    await q.insertGateEvent(event);
    const specId = await q.insertScanSpec({
      workspaceId: ws.id,
      name: draft.name,
      targets: draft.targets,
      cadenceMinutes: draft.cadenceMinutes,
      createdById: owner.userId,
      brandId: brand.id,
    });
    await q.approveScanSpec(ws.id, specId);
    const runId = await q.createAuditRun({
      workspaceId: ws.id,
      specId,
      trigger: "event",
      idempotencyKey: `first-pass:${specId}`,
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
  console.log(`\nStarted ${runs.length} LinkedIn run(s).`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

export {};
