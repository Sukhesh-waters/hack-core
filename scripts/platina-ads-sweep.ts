/**
 * Ads sweep (C8.3 T6.9): Claude-as-operator runs the same scan as the Ads
 * page's Scan now — same plan, same Apify budget gate, same pipeline. Dry run
 * by default.
 *
 *   npm run platina:ads-sweep -- --ws waters-gcc-internal
 *   npm run platina:ads-sweep -- --ws waters-gcc-internal \
 *     --advertiser "Waters=Waters Corporation" --advertiser "Agilent=Agilent Technologies" --apply --inline
 *
 * --advertiser "Brand=LinkedIn name"  the exact advertiser name (repeatable);
 *                                     remembered on the source for next time.
 * --per N          ads per advertiser (1..25, default 25).
 * --only "a,b"     only the companies whose name contains one of these words.
 * --approve-over   start even if the projected cost passes what is left this
 *                  month after the reserve (the owner said so).
 * --sync-only      no scan: re-run the subject pass and the Brain sync on what
 *                  is stored (e.g. after runs the job runner finished).
 * --inline         collect in this process with the code on disk, then run the
 *                  interest pass and the Brain sync here too; without it the
 *                  runs go to the job runner.
 *
 * Actions are recorded under the workspace owner's account (operator for the
 * owner), as with evidence packs.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function args(name: string): string[] {
  return process.argv.flatMap((a, i) =>
    a === `--${name}` && process.argv[i + 1] ? [process.argv[i + 1]] : [],
  );
}

async function main() {
  process.loadEnvFile(".env.local");
  const slug = arg("ws");
  if (!slug)
    throw new Error(
      'usage: --ws <slug> [--advertiser "Brand=Name"]... [--per N] [--approve-over] [--apply] [--inline]',
    );
  const apply = process.argv.includes("--apply");
  const inline = process.argv.includes("--inline");
  const per = arg("per") ? Number(arg("per")) : undefined;

  const { db } = await import("@/db");
  const { memberships, workspaces } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const q = await import("@/db/queries/platina");
  const { prepareAdScan, startAdScan } =
    await import("@/lib/platina/ads-scan-run");
  const { LINKEDIN_AD_PRICE_USD } = await import("@/lib/platina/ads-scan");

  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, slug));
  if (!ws) throw new Error(`no workspace "${slug}"`);
  const brands = await q.listBrands(ws.id);
  const advertisers = new Map<string, string>();
  for (const pair of args("advertiser")) {
    const [brandName, ...rest] = pair.split("=");
    const brand = brands.find(
      (b) => b.name.toLowerCase() === brandName.trim().toLowerCase(),
    );
    if (!brand) throw new Error(`no brand named "${brandName}" in ${slug}`);
    advertisers.set(brand.id, rest.join("=").trim());
  }

  const syncOnly = process.argv.includes("--sync-only");
  if (!syncOnly) {
    const prepared = await prepareAdScan(ws.id, {
      advertisers,
      perAdvertiser: per,
      approveOver: process.argv.includes("--approve-over"),
    });
    if (!prepared) throw new Error("no active client in this workspace");
    const only = (arg("only") ?? "")
      .split(",")
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);
    const plan = only.length
      ? (() => {
          const rows = prepared.plan.rows.filter((r) =>
            only.some((w) => r.name.toLowerCase().includes(w)),
          );
          const maxAds = rows.reduce((n, r) => n + r.maxAds, 0);
          return {
            ...prepared.plan,
            rows,
            maxAds,
            projectedUsd:
              Math.round(maxAds * LINKEDIN_AD_PRICE_USD * 100) / 100,
          };
        })()
      : prepared.plan;
    console.log(`\nAds sweep plan for ${slug} (LinkedIn Ad Library)`);
    for (const r of plan.rows) {
      console.log(
        `  ${r.isClient ? "*" : " "} ${r.name.padEnd(16)} as "${r.advertiser}"  up to ${r.maxAds} ads  ${r.specId ? "(existing source)" : "(new weekly source)"}`,
      );
    }
    console.log(
      `  up to ${plan.maxAds} ads, up to $${plan.projectedUsd.toFixed(2)}; Apify used $${prepared.usedUsd?.toFixed(2) ?? "?"} of $${prepared.capUsd?.toFixed(2) ?? "?"}, spendable after reserve $${plan.spendableUsd?.toFixed(2) ?? "?"}`,
    );
    if (!plan.allowed) {
      console.log(`\nREFUSED: ${plan.reason}`);
      process.exitCode = 1;
      return;
    }
    if (!apply) {
      console.log("\nDry run. Add --apply to start it.");
      return;
    }

    const [owner] = await db
      .select()
      .from(memberships)
      .where(
        and(eq(memberships.workspaceId, ws.id), eq(memberships.role, "owner")),
      );
    if (!owner) throw new Error("workspace has no owner to act for");
    const runs = await startAdScan(ws.id, owner.userId, plan, "operator");
    console.log(`\nStarted ${runs.length} runs.`);

    if (!inline) {
      const { inngest } = await import("@/inngest/client");
      await inngest.send(
        runs.map((r) => ({
          name: "platina/audit-run.requested",
          data: { runId: r.runId, workspaceId: ws.id },
        })),
      );
      console.log("Sent to the job runner. Follow them on the Ads page.");
      return;
    }

    const { executeAuditRunNow } =
      await import("@/inngest/functions/platina/audit-run");
    for (const r of runs) {
      const t0 = Date.now();
      try {
        const out = await executeAuditRunNow(ws.id, r.runId);
        console.log(
          `  ${r.name}: ${JSON.stringify(out).slice(0, 220)} (${Math.round((Date.now() - t0) / 1000)} s)`,
        );
      } catch (e) {
        console.log(
          `  ${r.name}: FAILED ${e instanceof Error ? e.message : e}`,
        );
      }
    }
  }

  // The interest pass gives each ad its subjects; then the Brain sync.
  const client = brands.find(
    (b) => b.kind === "own_brand" && b.status === "active",
  )!;
  const { extractInterestForClient } =
    await import("@/lib/platina/interest-extract");
  const { assignTopics } = await import("@/lib/platina/interest-topics");
  const { syncAdInsights, syncClientInsights } =
    await import("@/lib/platina/market-insight-sync");
  const extracted = await extractInterestForClient(
    {
      getClient: async (w, id) => {
        const b = await q.getBrand(w, id);
        return b
          ? { id: b.id, name: b.name, kind: b.kind, profile: b.profile ?? null }
          : null;
      },
      listCompetitorIds: async (w, id) =>
        (await q.listCompetitorsOf(w, id)).map((b) => b.id),
      listDocs: (w, ids, since) => q.listInterestSourceDocs(w, ids, since),
      assign: (texts, topics) => assignTopics(texts, topics),
      insert: (rows) => q.insertInterestSignals(rows),
      listKnownTopics: async (w, ids, since) => {
        const counts = new Map<string, number>();
        for (const s of await q.listInterestSignals(w, ids, since))
          counts.set(s.topic, (counts.get(s.topic) ?? 0) + 1);
        return [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([t]) => t);
      },
    },
    { workspaceId: ws.id, clientId: client.id },
  );
  console.log(`\nInterest pass: ${JSON.stringify(extracted).slice(0, 300)}`);
  console.log(
    `Brain (interest+pressure): ${JSON.stringify(await syncClientInsights(ws.id, client.id))}`,
  );
  console.log(
    `Brain (ads): ${JSON.stringify(await syncAdInsights(ws.id, client.id))}`,
  );

  const { loadAdsView } = await import("@/lib/platina/ads-load");
  const loaded = await loadAdsView(ws.id);
  if (loaded) {
    console.log("\nSide by side:");
    for (const c of loaded.view.columns) {
      console.log(
        `  ${c.name.padEnd(16)} ${c.ads.length} ads, ${c.active} running, ${c.newThisWeek} new this week, ${c.regionAds} in the Gulf; top: ${c.topTopics.map((t) => `${t.topic} (${t.ads})`).join(", ")}`,
      );
    }
    console.log("\nDetections:");
    for (const d of loaded.view.detections)
      console.log(`  [${d.kind}] ${d.title} — ${d.detail}`);
    if (loaded.view.detections.length === 0)
      console.log("  none passed the thresholds");
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

export {};
