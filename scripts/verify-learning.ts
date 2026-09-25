/**
 * C6 learning loop, verified on real data. Read-only; exit 1 on a failure.
 *
 *   npx tsx scripts/verify-learning.ts --ws waters-gcc-internal --client Waters [--ask "question"]
 *
 * Checks, in the order the loop runs:
 *  1. Own website: pages known and read, passages stored and embedded.
 *  2. The planner receives first-party evidence for a question about the client.
 *  3. Results: creatives, measurements, reviews (drafted / confirmed).
 *  4. Learning: feature stats past the min-N gate, and whether they move the
 *     Opportunities ranking today (the C6 acceptance: a recorded result
 *     changes the next ranking). Below the gate "nothing moves" is correct.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

type Check = { name: string; status: "ok" | "warn" | "fail"; detail: string };

async function main() {
  process.loadEnvFile(".env.local");
  const slug = arg("ws");
  const clientName = arg("client");
  if (!slug || !clientName) throw new Error('usage: --ws <slug> --client <name> [--ask "..."]');

  const { db } = await import("@/db");
  const { workspaces } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const q = await import("@/db/queries/platina");
  const l = await import("@/db/queries/platina-learning");
  const { summariseOwnSite } = await import("@/lib/platina/own-site");
  const { retrieveBaselineEvidence } = await import("@/lib/platina/plan/context");
  const { embedText } = await import("@/lib/platina/embed");
  const { learningState } = await import("@/lib/platina/learning-read");
  const { learningSeed, describeStat } = await import("@/lib/platina/learning");
  const { learnCampaigns } = await import("@/lib/platina/opportunity-learning");
  const { buildCampaigns } = await import("@/lib/platina/opportunities");
  const { BASELINE_DAYS, clientTopics, RECENT_DAYS, topicMomentum } = await import("@/lib/platina/interest");

  const checks: Check[] = [];
  const add = (name: string, status: Check["status"], detail: string) => checks.push({ name, status, detail });

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.slug, slug));
  if (!ws) throw new Error(`no workspace "${slug}"`);
  const client = (await q.listBrands(ws.id)).find(
    (b) => b.kind === "own_brand" && b.name.toLowerCase() === clientName.toLowerCase(),
  );
  if (!client) throw new Error(`no client "${clientName}"`);

  // 1. Own website
  const pages = await l.listOwnSitePages(ws.id, client.id);
  const site = summariseOwnSite(pages);
  const counts = await l.firstPartyChunkCountsQuery(ws.id);
  const passages = counts.filter((c) => c.brandId === client.id && c.kind === "own_site").reduce((s, c) => s + Number(c.chunks), 0);
  const unembedded = (await l.unembeddedFirstPartyChunksQuery(ws.id, 500)).length;
  if (!client.homepageUrl) add("own site", "warn", "the client has no website set");
  else if (site.total === 0) add("own site", "fail", `never listed${client.ownSiteError ? `: ${client.ownSiteError}` : ""}`);
  else if (site.read === 0) add("own site", "fail", `${site.total} pages listed, none read`);
  else add("own site", "ok", `${site.read}/${site.total} pages read, ${site.queued} queued, ${site.failed} failed, ${passages} passages`);
  add("embeddings", unembedded === 0 ? "ok" : "warn", unembedded === 0 ? "every first-party passage embedded" : `${unembedded} passages waiting for an embedding`);

  // 2. Planner gets first-party evidence
  const question = arg("ask") ?? `What does ${client.name} sell?`;
  const config = await q.getWorkspaceConfig(ws.id);
  const embedding = await embedText(question);
  if (!embedding) add("planner evidence", "warn", "embedding unavailable right now; retrieval not checked");
  else {
    const evidence = await retrieveBaselineEvidence({
      workspaceId: ws.id,
      brandId: client.id,
      embedding,
      floor: config?.similarityFloor ?? 0.35,
      newSince: null,
    });
    const planeA = evidence.every((e) => e.plane === "A");
    if (!planeA) add("planner evidence", "fail", "first-party retrieval returned a non-Plane-A item");
    else if (site.read > 0 && evidence.length === 0) add("planner evidence", "fail", `nothing retrieved for "${question}"`);
    else add("planner evidence", "ok", `${evidence.length} first-party passages for "${question}"`);
  }

  // 3. Results
  const creatives = await l.listCreatives(ws.id, client.id);
  const ids = creatives.map((c) => c.id);
  const [metrics, reviews] = await Promise.all([l.listMetricsForCreatives(ws.id, ids), l.listReviews(ws.id, ids)]);
  const confirmed = reviews.filter((r) => r.status === "confirmed");
  add(
    "results",
    creatives.length === 0 ? "warn" : "ok",
    `${creatives.length} creatives, ${metrics.length} measurements, ${reviews.length - confirmed.length} reviews waiting, ${confirmed.length} confirmed`,
  );
  const badVerdict = confirmed.filter((r) => !r.verdict || !r.confirmedAt);
  if (badVerdict.length > 0) add("review integrity", "fail", `${badVerdict.length} confirmed reviews without a verdict or date`);

  // 4. Learning and the ranking
  const now = new Date();
  const state = await learningState(ws.id, client.id, now);
  const ok = state.stats.filter((s) => s.status === "ok");
  add("learning", "ok", `${state.results} confirmed results; ${ok.length} values past min-N (${state.config.minN})`);
  for (const s of ok.slice(0, 6)) console.log(`    ${describeStat(s, state.config.minN)}`);

  const since = new Date(now.getTime() - (RECENT_DAYS + BASELINE_DAYS) * 86_400_000);
  const [competitors, signals, events, participants] = await Promise.all([
    q.listCompetitorsOf(ws.id, client.id),
    q.listClientScopeSignals(ws.id, client.id, since),
    q.listEvents(ws.id),
    q.listWorkspaceEventParticipants(ws.id),
  ]);
  const ruled = buildCampaigns({
    client: { id: client.id, name: client.name, region: client.region ?? null, topics: clientTopics(client.profile ?? null, client.name) },
    competitors: competitors.map((c) => ({ id: c.id, name: c.name })),
    momentum: topicMomentum(signals, now),
    proofOwner: new Map(signals.map((s) => [s.sourceUrl, s.brandId])),
    events: events.map((e) => ({ ...e, participants: participants.filter((p) => p.eventId === e.id) })),
    now,
  });
  const all = [...ruled.events, ...ruled.topics];
  const learned = learnCampaigns(all, {
    stats: state.stats,
    minN: state.config.minN,
    exploreShare: 0,
    seed: learningSeed(ws.id, now, "verify"),
  });
  const moved = learned.filter((c) => c.learned.movement !== "none").length;
  if (ok.length === 0 && moved > 0) add("ranking", "fail", "the ranking moved with no value past min-N");
  else if (ok.length === 0) add("ranking", "ok", `${all.length} campaigns in rule order: nothing past min-N yet, so nothing moves (correct)`);
  else add("ranking", "ok", `${moved} of ${all.length} campaigns moved by confirmed results`);

  const events2 = await l.listLearningEvents(ws.id, 5);
  if (events2.length > 0) console.log(`    latest learning events: ${events2.map((e) => e.kind).join(", ")}`);

  console.log(`\nverify-learning ${slug} / ${client.name}`);
  for (const c of checks) console.log(`  [${c.status.toUpperCase().padEnd(4)}] ${c.name}: ${c.detail}`);
  const failed = checks.filter((c) => c.status === "fail").length;
  console.log(failed === 0 ? "\nOK" : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

export {};
