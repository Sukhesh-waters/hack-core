/**
 * A client's own website into first-party knowledge (C6 L1), run by hand.
 *
 *   npx tsx scripts/own-site.ts --ws waters-gcc-internal --client Waters [--reads 10] [--remap] [--ask "question"]
 *
 * Runs the same pass the daily job runs (same code: lib/platina/own-site-run
 * with the production deps), limited to --reads page reads (default 10, ~1
 * Firecrawl credit each; listing the site is 1 more). Then prints the page
 * counts and, with --ask, the first-party passages the planner would get for
 * that question.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  process.loadEnvFile(".env.local");
  const slug = arg("ws");
  const clientName = arg("client");
  if (!slug || !clientName) throw new Error('usage: --ws <slug> --client <name> [--reads N] [--remap] [--ask "..."]');
  const reads = Number(arg("reads") ?? 10);

  const { db } = await import("@/db");
  const { workspaces } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const q = await import("@/db/queries/platina");
  const learning = await import("@/db/queries/platina-learning");
  const { ownSiteDeps } = await import("@/lib/platina/own-site-deps");
  const { runOwnSitePass } = await import("@/lib/platina/own-site-run");
  const { summariseOwnSite } = await import("@/lib/platina/own-site");
  const { retrieveBaselineEvidence } = await import("@/lib/platina/plan/context");
  const { embedText } = await import("@/lib/platina/embed");

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.slug, slug));
  if (!ws) throw new Error(`no workspace "${slug}"`);
  const client = (await q.listBrands(ws.id)).find(
    (b) => b.kind === "own_brand" && b.name.toLowerCase() === clientName.toLowerCase(),
  );
  if (!client) throw new Error(`no client "${clientName}"`);
  console.log(`${client.name}: ${client.homepageUrl ?? "no website set"}`);

  const started = Date.now();
  const result = await runOwnSitePass(ownSiteDeps, {
    workspaceId: ws.id,
    brandId: client.id,
    forceRemap: process.argv.includes("--remap"),
    maxReads: reads,
  });
  console.log(`pass (${((Date.now() - started) / 1000).toFixed(1)}s):`, result);

  const pages = await learning.listOwnSitePages(ws.id, client.id);
  console.log("pages:", summariseOwnSite(pages));
  for (const p of pages.filter((x) => x.status === "failed").slice(0, 5)) {
    console.log(`  failed ${p.url}: ${p.error}`);
  }
  console.log("top of the reading order:");
  for (const p of pages.slice(0, 12)) {
    console.log(`  [${p.status}] ${p.priority.toFixed(1)} ${p.url}${p.chunkCount ? ` (${p.chunkCount} passages)` : ""}`);
  }

  const question = arg("ask");
  if (question) {
    const config = await q.getWorkspaceConfig(ws.id);
    const evidence = await retrieveBaselineEvidence({
      workspaceId: ws.id,
      brandId: client.id,
      embedding: await embedText(question),
      floor: config?.similarityFloor ?? 0.35,
      newSince: null,
    });
    console.log(`\nfirst-party evidence for "${question}": ${evidence.length}`);
    for (const e of evidence) {
      console.log(`  - ${e.content.replace(/\s+/g, " ").slice(0, 160)}\n    ${e.sourceUrl}`);
    }
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

export {};
