/**
 * Seeds a clearly labelled "[Demo]" client, competitor, collected evidence and
 * plans so every Platina flow can be tested by hand without waiting for real
 * collection or spending on Apify.
 *
 *   npx tsx scripts/seed-manual-test.ts [--ws <workspaceId>] [--user <userId>]
 *   npx tsx scripts/seed-manual-test.ts --clean [--ws <workspaceId>]
 *
 * Defaults to the first workspace and user in the database (this is a dev
 * tool — it reads .env.local). Everything is fictional (`.example` domains) and
 * every row is prefixed "[Demo]" so it is obvious and removable. Source specs
 * are left as DRAFT: they can never be fetched, so nothing is spent.
 *
 * The plan is created BEFORE the evidence on purpose: the plan page then shows
 * "5 new signals since this plan" and you can test the re-plan flow. Two
 * signals are left unprocessed so the analysis job (npm run dev:jobs) has real
 * work to do when the sweep runs.
 */

const TAG = "[Demo]";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  process.loadEnvFile(".env.local");
  const { db } = await import("@/db");
  const { users, workspaces } = await import("@/db/schema");
  const {
    platinaBrainChunks,
    platinaBrandChunks,
    platinaBrands,
    platinaFindings,
    platinaPlans,
    platinaScanSpecs,
    platinaSignalDocuments,
  } = await import("@/db/platina-schema");
  const { and, eq, inArray, like } = await import("drizzle-orm");
  const q = await import("@/db/queries/platina");
  const { embedText } = await import("@/lib/platina/embed");
  const { canonicalizeUrl, contentHash } = await import("@/lib/platina/fetch/canonical");

  const wsId = arg("ws") ?? (await db.select({ id: workspaces.id }).from(workspaces).limit(1))[0]?.id;
  if (!wsId) throw new Error("no workspace found");

  // ---------------------------------------------------------------- clean
  async function clean() {
    const brands = await db
      .select({ id: platinaBrands.id })
      .from(platinaBrands)
      .where(and(eq(platinaBrands.workspaceId, wsId), like(platinaBrands.name, `${TAG}%`)));
    const brandIds = brands.map((b) => b.id);
    const specs = brandIds.length
      ? await db
          .select({ id: platinaScanSpecs.id })
          .from(platinaScanSpecs)
          .where(and(eq(platinaScanSpecs.workspaceId, wsId), inArray(platinaScanSpecs.brandId, brandIds)))
      : [];
    const specIds = specs.map((s) => s.id);
    if (specIds.length) {
      const docs = await db
        .select({ id: platinaSignalDocuments.id })
        .from(platinaSignalDocuments)
        .where(and(eq(platinaSignalDocuments.workspaceId, wsId), inArray(platinaSignalDocuments.scanSpecId, specIds)));
      const docIds = docs.map((d) => d.id);
      if (docIds.length) {
        await db.delete(platinaFindings).where(and(eq(platinaFindings.workspaceId, wsId), inArray(platinaFindings.signalDocumentId, docIds)));
        await db.delete(platinaSignalDocuments).where(and(eq(platinaSignalDocuments.workspaceId, wsId), inArray(platinaSignalDocuments.id, docIds)));
      }
      await db.delete(platinaScanSpecs).where(and(eq(platinaScanSpecs.workspaceId, wsId), inArray(platinaScanSpecs.id, specIds)));
    }
    await db.delete(platinaBrainChunks).where(and(eq(platinaBrainChunks.workspaceId, wsId), like(platinaBrainChunks.content, `${TAG}%`)));
    await db.delete(platinaBrandChunks).where(and(eq(platinaBrandChunks.workspaceId, wsId), like(platinaBrandChunks.content, `${TAG}%`)));
    // Plans cascade their feedback; demo plans are found by title prefix.
    await db.delete(platinaPlans).where(and(eq(platinaPlans.workspaceId, wsId), like(platinaPlans.title, `${TAG}%`)));
    if (brandIds.length) {
      await db.delete(platinaBrands).where(and(eq(platinaBrands.workspaceId, wsId), inArray(platinaBrands.id, brandIds)));
    }
    console.log(`cleaned demo data from workspace ${wsId}`);
  }

  await clean(); // idempotent: re-running reseeds from scratch
  if (process.argv.includes("--clean")) return;

  const userId = arg("user") ?? (await db.select({ id: users.id }).from(users).limit(1))[0]?.id;
  if (!userId) throw new Error("no user found");

  // --------------------------------------------------------------- client
  const clientId = await q.createBrand({
    workspaceId: wsId,
    name: `${TAG} Northwind Coffee`,
    homepageUrl: "https://northwind-coffee.example",
    handles: { instagram: "northwindcoffee" },
    region: "United Kingdom",
    createdById: userId,
  });
  const rivalId = await q.createBrand({
    workspaceId: wsId,
    name: `${TAG} Bluebird Roasters`,
    kind: "competitor",
    parentBrandId: clientId,
    homepageUrl: "https://bluebird-roasters.example",
    createdById: userId,
  });
  await q.insertScanSpec({
    workspaceId: wsId,
    name: `${TAG} Northwind · website`,
    targets: [{ kind: "competitor_site", value: "https://northwind-coffee.example", maxPages: 5 }],
    createdById: userId,
    brandId: clientId,
  });
  const rivalSpec = await q.insertScanSpec({
    workspaceId: wsId,
    name: `${TAG} Bluebird · news`,
    targets: [{ kind: "press_release", value: "https://bluebird-roasters.example/news", maxPages: 3 }],
    createdById: userId,
    brandId: rivalId,
  });

  // --------------------------------------------- declared brand standard (Plane A)
  const standard = [
    `${TAG} Northwind Coffee speaks plainly, never overpromises, and leads with the farmer's story.`,
    `${TAG} Northwind competes on freshness and transparency. It does not run giveaways or discount-led promotions.`,
  ];
  for (const [i, content] of standard.entries()) {
    await q.insertBrandChunk({
      workspaceId: wsId,
      content,
      title: "Brand standard",
      chunkIndex: i,
      embedding: (await embedText(content)) ?? undefined,
    });
  }

  // ------------------- a past plan with a recorded result (feeds the lessons)
  const past = await q.insertPlan({
    workspaceId: wsId,
    title: `${TAG} Spring email push`,
    brief: `${TAG} Spring promo for existing subscribers.`,
    plan: {
      summary: "A short email drip to the existing list, with a referral kicker.",
      totalDays: 21,
      coldStart: true,
      phases: [
        { id: "p1", name: "Warm the list", startDay: 1, endDay: 7, channel: "Email", message: "Tell the farmer's story to subscribers." },
        { id: "p2", name: "Referral kicker", startDay: 8, endDay: 21, channel: "Email", message: "Invite subscribers to share a free bag." },
      ],
    },
    critique: [],
    lessonsUsed: 0,
    createdById: userId,
    brandId: clientId,
    origin: { kind: "client", label: "Campaign for Northwind Coffee" },
  });
  await q.upsertPlanFeedback({
    workspaceId: wsId,
    planId: past,
    verdict: "worked",
    note: "Email converted well; the referral offer drove most of the growth.",
    createdById: userId,
  });

  // The plan the real-time flow is tested on — created BEFORE the evidence.
  const livePlan = await q.insertPlan({
    workspaceId: wsId,
    title: `${TAG} Northwind holiday campaign`,
    brief: `${TAG} Holiday campaign for Northwind Coffee.\nGoal: grow subscriptions among home baristas in the UK.`,
    plan: {
      summary: "Build audience early, then convert with a subscription offer before the holidays.",
      totalDays: 42,
      coldStart: true,
      evidenceStatus: "empty_brain",
      phases: [
        { id: "p1", name: "Tell the farmer's story", startDay: 1, endDay: 14, channel: "Social", message: "Share the farm and roasting story." },
        { id: "p2", name: "Subscription offer", startDay: 15, endDay: 42, channel: "Email", message: "Offer a subscription to engaged followers." },
      ],
    },
    critique: [],
    lessonsUsed: 1,
    createdById: userId,
    brandId: clientId,
    origin: { kind: "client", label: "Campaign for Northwind Coffee" },
  });
  // Evidence must be strictly newer than the plan.
  await new Promise((r) => setTimeout(r, 1200));

  // ------------------------------------------- collected signals (Plane B)
  const signals = [
    { title: "Bluebird: 48-hour roast guarantee", body: `Bluebird Roasters launches a 'Roast Within 48 Hours' guarantee: every bag ships within 48 hours of roasting, with a freshness date printed on the front.`, path: "roast-48h", process: true },
    { title: "Bluebird: $18 subscription", body: `Bluebird Roasters announces a subscription tier at $18 a month with free shipping and a skip-anytime policy, aimed at home baristas.`, path: "subscription", process: true },
    { title: "Bluebird: tasting series", body: `Bluebird Roasters partners with three local cafés for a 'Taste the Farm' tasting series over four weekends in October.`, path: "tasting-series", process: true },
    { title: "Bluebird: grinder giveaway", body: `Bluebird Roasters is running an Instagram giveaway for an espresso grinder; entry requires following and tagging two friends.`, path: "giveaway", process: true },
    { title: "Bluebird: compostable packaging", body: `Bluebird Roasters publishes a sustainability report committing to compostable packaging across all products by next spring.`, path: "sustainability", process: true },
    { title: "Bluebird: Winter Ember teaser", body: `Bluebird Roasters teases a limited holiday blend, 'Winter Ember', with a pre-order waitlist opening next week.`, path: "winter-ember", process: false },
    { title: "Bluebird: 15% starter discount", body: `Bluebird Roasters cuts prices 15% on its starter subscription for the first three months.`, path: "starter-discount", process: false },
  ];
  await q.insertSignalDocuments(
    wsId,
    rivalSpec,
    signals.map((s) => {
      const url = `https://bluebird-roasters.example/news/${s.path}`;
      const canonical = canonicalizeUrl(url);
      return {
        sourceUrl: "https://bluebird-roasters.example/news",
        canonicalUrl: canonical,
        sourceKind: "press_release",
        title: `${TAG} ${s.title}`,
        body: s.body,
        adapter: "apify",
        contentHash: contentHash(canonical, s.body),
      };
    }),
  );
  const docs = await db
    .select({ id: platinaSignalDocuments.id, title: platinaSignalDocuments.title })
    .from(platinaSignalDocuments)
    .where(and(eq(platinaSignalDocuments.workspaceId, wsId), eq(platinaSignalDocuments.scanSpecId, rivalSpec)));
  const docByTitle = new Map(docs.map((d) => [d.title, d.id]));

  // The five validated signals become Brain chunks; two stay unprocessed.
  const findingFor = new Set(["Bluebird: 48-hour roast guarantee", "Bluebird: $18 subscription", "Bluebird: grinder giveaway"]);
  for (const s of signals.filter((x) => x.process)) {
    const docId = docByTitle.get(`${TAG} ${s.title}`)!;
    await q.markSignalProcessed(wsId, docId);
    const content = `${TAG} ${s.body}`;
    const brainId = await q.insertBrainChunk({
      workspaceId: wsId,
      content,
      confidence: 0.82,
      agreementState: "agreed",
      sourceSignalIds: [docId],
      generation: 0,
      embedding: (await embedText(content)) ?? undefined,
    });
    if (findingFor.has(s.title)) {
      await q.insertFinding({
        workspaceId: wsId,
        signalDocumentId: docId,
        brainChunkId: brainId,
        useCase: "competitor_change",
        title: `${TAG} ${s.title}`,
        summary: s.body,
        strongestObjection: "Only one source; the claim is not independently confirmed.",
        status: s.title.includes("giveaway") ? "needs_decision" : "new",
      });
    }
  }

  console.log(`
Seeded workspace ${wsId}
  client:        ${clientId}   (${TAG} Northwind Coffee)
  competitor:    ${rivalId}
  live plan:     ${livePlan}   -> /p/${wsId}/plan/${livePlan}
  5 validated signals + 3 findings + 2 unprocessed documents

Open:  /p/${wsId}/brands/${clientId}
       /p/${wsId}/plan/${livePlan}   (should say "5 new validated signals ... Worth re-planning")
Remove: npx tsx scripts/seed-manual-test.ts --clean --ws ${wsId}
`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

export {};
