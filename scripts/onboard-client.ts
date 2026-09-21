/**
 * Onboard a real Platina client from the terminal — the same two steps the
 * /p/[ws]/start UI runs, through the same library calls, in the same order:
 *
 *   1. create the client (own_brand)
 *   2. discover sources (derive + HEAD probe + sitemap), propose competitors
 *      (router), then ONE confirm gate event, a scan spec per source, and a
 *      first-pass audit run per spec sent to Inngest.
 *
 *   npx tsx scripts/onboard-client.ts --ws <slug> --name Waters --url https://www.waters.com \
 *     [--region GCC] [--competitor "Thermo Fisher Scientific=https://www.thermofisher.com"]... \
 *     [--suggest] [--ads] [--apply]
 *
 * Without --apply it only PRINTS what the UI would show (sources, preselection,
 * competitor proposals) and writes nothing. With --apply it acts as the
 * workspace owner. Collection itself needs the Inngest dev server
 * (npm run dev:all); without it the runs are recorded as queued and start as
 * soon as it is up — exactly like the UI.
 *
 * Deliberately a harness over the real functions, not a second implementation
 * of the rules: if a step here disagrees with the UI, the UI's action is the
 * source of truth (src/app/(platina)/p/[ws]/start/actions.ts).
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function args(name: string): string[] {
  return process.argv.flatMap((a, i) => (a === `--${name}` ? [process.argv[i + 1]] : []));
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  process.loadEnvFile(".env.local");
  const slug = arg("ws");
  const name = arg("name");
  const url = arg("url");
  if (!slug || !name || !url) throw new Error("usage: --ws <slug> --name <name> --url <homepage> [--apply]");
  const apply = flag("apply");

  const { db } = await import("@/db");
  const { workspaces, memberships } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const q = await import("@/db/queries/platina");
  const derive = await import("@/lib/platina/onboard/derive");
  const discover = await import("@/lib/platina/onboard/discover");
  const { enrichFromSitemap } = await import("@/lib/platina/onboard/sitemap");
  const { fetchSitemapText, headProbeFetch } = await import("@/lib/platina/fetch/probe-fetch");
  const { proposeCompetitors, MAX_COMPETITOR_PROPOSALS } = await import("@/lib/platina/onboard/competitors");
  const { GATE_CAPABILITY, assertCompleteGateEvent } = await import("@/lib/platina/gates");
  const { hashGatePayload } = await import("@/lib/platina/hash");
  const { snapshotRunConfig } = await import("@/lib/platina/orchestrator");
  const { inngest } = await import("@/inngest/client");
  void GATE_CAPABILITY;

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.slug, slug));
  if (!ws) throw new Error(`no workspace "${slug}"`);
  const [owner] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.workspaceId, ws.id), eq(memberships.role, "owner")));
  if (!owner) throw new Error("workspace has no owner to act as");

  const homepageUrl = derive.normalizeHomepage(url);
  if (!homepageUrl) throw new Error(`not a usable website: ${url}`);
  const region = arg("region") ?? null;

  // --- step 1: the client -------------------------------------------------
  const existing = (await q.listBrands(ws.id)).find(
    (b) => b.kind === "own_brand" && b.name.toLowerCase() === name.toLowerCase(),
  );
  let brandId = existing?.id;
  console.log(`\nWorkspace ${ws.slug} · client "${name}" ${existing ? "(exists)" : "(new)"}`);
  if (!brandId && apply) {
    brandId = await q.createBrand({
      workspaceId: ws.id,
      name,
      kind: "own_brand",
      homepageUrl,
      handles: {},
      region,
      createdById: owner.userId,
    });
    console.log(`  created client ${brandId}`);
  }

  // --- step 2: what we'd watch ---------------------------------------------
  const probed = await discover.discoverCandidates(
    derive.deriveSources({ homepageUrl, handles: {}, brandName: name }),
    headProbeFetch,
  );
  const found = await enrichFromSitemap(probed, homepageUrl, fetchSitemapText);
  const sources = found.filter((c) => !c.discovery);
  // --ads also ticks the ad-library source (the UI leaves it for the operator
  // to tick: it bills a 10-result minimum through a residential proxy).
  const picked = sources.filter(
    (c) => discover.preselected(c) || (flag("ads") && c.kind === "ad_library"),
  );
  console.log(`\nSources (${picked.length} preselected of ${sources.length})`);
  for (const c of sources) {
    console.log(`  [${picked.includes(c) ? "x" : " "}] ${c.kind.padEnd(16)} ${c.value}  (${c.maxPages}p, exists=${c.exists ?? "?"})`);
  }

  const given = args("competitor").map((raw) => {
    const [n, u] = raw.split("=");
    return { name: n.trim(), homepageUrl: derive.normalizeHomepage(u ?? "") ?? "" };
  });
  let proposed: { name: string; homepageUrl: string; reason?: string; confidence?: string }[] = [];
  if (flag("suggest")) {
    proposed = await proposeCompetitors({ name, homepageUrl, region });
    console.log(`\nCompetitors proposed by the router (${proposed.length})`);
    for (const p of proposed) console.log(`  ${p.name.padEnd(30)} ${p.homepageUrl}  [${p.confidence}] ${p.reason}`);
  }
  const seen = new Set<string>();
  const competitors = [...given, ...proposed]
    .filter((c) => c.name.length >= 2 && c.homepageUrl && !seen.has(c.homepageUrl) && seen.add(c.homepageUrl))
    .slice(0, MAX_COMPETITOR_PROPOSALS);
  console.log(`\nCompetitors to track (${competitors.length})`);
  for (const c of competitors) console.log(`  ${c.name.padEnd(30)} ${c.homepageUrl}`);

  if (!apply || !brandId) {
    console.log("\nDry run — nothing written. Re-run with --apply to onboard.\n");
    process.exit(0);
  }

  // --- the one approval (mirrors approveClientSourcesAction) ---------------
  const drafts = derive
    .candidatesToSpecs(name, picked, discover.sitemapFound(found))
    .map((spec) => ({ brandId: brandId!, spec }));
  for (const c of competitors) {
    try {
      const competitorId = await q.createBrand({
        workspaceId: ws.id,
        name: c.name,
        kind: "competitor",
        parentBrandId: brandId,
        homepageUrl: c.homepageUrl,
        createdById: owner.userId,
      });
      drafts.push({
        brandId: competitorId,
        spec: {
          name: `${c.name} · website`,
          cadenceMinutes: derive.DEFAULT_CADENCE_MINUTES,
          targets: [{ kind: "competitor_site", value: c.homepageUrl, maxPages: 3 }],
        },
      });
    } catch (error) {
      console.log(`  ! ${c.name}: ${error instanceof Error ? error.message : error}`);
    }
  }

  const event = {
    workspaceId: ws.id,
    gate: "confirm" as const,
    decision: "approved" as const,
    approverId: owner.userId,
    payloadHash: hashGatePayload({
      brandId,
      sources: picked.map((c) => c.id),
      competitors: competitors.map((c) => c.homepageUrl),
    }),
    subjectType: "brand",
    subjectId: brandId,
  };
  assertCompleteGateEvent(event);
  await q.insertGateEvent(event);

  const config = await q.getWorkspaceConfig(ws.id);
  const runs: string[] = [];
  for (const { brandId: ownerBrand, spec } of drafts) {
    const specId = await q.insertScanSpec({
      workspaceId: ws.id,
      name: spec.name,
      targets: spec.targets,
      cadenceMinutes: spec.cadenceMinutes,
      createdById: owner.userId,
      brandId: ownerBrand,
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
    console.log(`  spec ${spec.name} → run ${runId ?? "(duplicate)"}`);
  }
  try {
    await inngest.send(runs.map((runId) => ({ name: "platina/audit-run.requested", data: { runId, workspaceId: ws.id } })));
    console.log(`\nSent ${runs.length} first-pass runs to the job runner.`);
  } catch {
    console.log(`\nJob runner is not up — ${runs.length} runs stay queued until npm run dev:all starts.`);
  }
  console.log(`Open /p/${ws.id}/brands/${brandId}\n`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

export {};
