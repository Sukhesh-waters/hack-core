/**
 * One-time LinkedIn history backfill (campaign intelligence). Flags every
 * LinkedIn posts source in a workspace for ONE wider run (3 months, up to 25
 * posts — the per-target ceiling), then sends those runs through the normal
 * audit path: same page budgets (a company's first-pass allowance, else the
 * daily cap), same storage, and interest/event extraction afterwards. The
 * flag clears itself once a source has collected.
 *
 *   npx tsx scripts/linkedin-backfill.ts --ws waters-gcc-internal \
 *     [--repoint "Bruker=bruker-corporation"] [--lookback 3months] [--apply]
 *
 * Cost: ~$0.002 per post -> ~$0.05 per company. Dry run without --apply.
 */
function args(name: string): string[] {
  return process.argv.flatMap((a, i) => (a === `--${name}` ? [process.argv[i + 1]] : []));
}

const POSTS = 25;

async function main() {
  process.loadEnvFile(".env.local");
  const slug = args("ws")[0];
  const lookback = (args("lookback")[0] ?? "3months") as "3months" | "6months" | "year";
  const apply = process.argv.includes("--apply");
  if (!slug || !["3months", "6months", "year"].includes(lookback)) {
    throw new Error('usage: --ws <slug> [--repoint "Brand=linkedin-slug"] [--lookback 3months|6months|year] [--apply]');
  }

  const { db } = await import("@/db");
  const { workspaces } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const q = await import("@/db/queries/platina");
  const derive = await import("@/lib/platina/onboard/derive");
  const { snapshotRunConfig } = await import("@/lib/platina/orchestrator");
  const { inngest } = await import("@/inngest/client");

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.slug, slug));
  if (!ws) throw new Error(`no workspace "${slug}"`);
  const brands = await q.listBrands(ws.id);
  const repoint = new Map(
    args("repoint").map((raw) => {
      const at = raw.lastIndexOf("=");
      const brand = brands.find((b) => b.name.toLowerCase() === raw.slice(0, at).trim().toLowerCase());
      const company = derive.normalizeLinkedInCompany(raw.slice(at + 1).trim());
      if (!brand || !company) throw new Error(`cannot repoint "${raw}"`);
      return [brand.id, company] as const;
    }),
  );
  const config = await q.getWorkspaceConfig(ws.id);
  const runs: string[] = [];

  for (const spec of await q.listScanSpecs(ws.id)) {
    if (!spec.targets.some((t) => t.value.startsWith("linkedin:"))) continue;
    const company = spec.brandId ? repoint.get(spec.brandId) : undefined;
    const targets = spec.targets.map((t) =>
      t.value.startsWith("linkedin:")
        ? {
            ...t,
            ...(company ? { value: `linkedin:@${company}` } : {}),
            backfill: { lookback, posts: POSTS },
          }
        : t,
    );
    const name = brands.find((b) => b.id === spec.brandId)?.name ?? spec.name;
    console.log(
      `  ${name}: ${targets[0].value}${company ? ` (was ${spec.targets[0].value})` : ""} — ${lookback}, up to ${POSTS} posts`,
    );
    if (!apply) continue;
    await q.updateScanSpecTargets(ws.id, spec.id, targets);
    const runId = await q.createAuditRun({
      workspaceId: ws.id,
      specId: spec.id,
      trigger: "event",
      idempotencyKey: `backfill:${spec.id}:${lookback}:${new Date().toISOString().slice(0, 10)}`,
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
  console.log(`\nStarted ${runs.length} backfill run(s).`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

export {};
