/**
 * Force run (C8.0 F0.5): collect a workspace's approved sources NOW, outside
 * their schedule, through the real pipeline. Dry run by default.
 *
 *   npm run platina:force -- --ws waters-gcc-internal --flows conferences,competitors [--apply]
 *   npm run platina:force -- --ws waters-gcc-internal --own-site 60 --client Waters [--apply]
 *
 * --flows   client, competitors, linkedin, conferences, ads (comma list) or "all".
 * --own-site N   also read up to N queued pages of the client's own site
 *                (first-party, Firecrawl ~1 credit each); needs --client.
 * --only "a,b"  only the sources whose name contains one of these words.
 * --retry   allow a second seed run today for these sources.
 * --inline  run each source's collection in this process, one after another,
 *           with the code on disk (use when the job runner serves an older
 *           build). Follow-on jobs (analysis, interest, events) still go to
 *           the job runner.
 *
 * Each source gets one audit run carrying an operator seed grant
 * (config_snapshot.seedPages): it may pass the workspace daily cap, never the
 * source's own daily limit. Runs queue in the job runner (2 at a time), and
 * each one triggers the usual analysis, interest, events and insight jobs.
 * The plan is refused if it would eat into the reserve on Apify or Firecrawl
 * (real balances, read from both accounts). One run per source per day
 * (idempotent), so re-running --apply the same day adds nothing.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  process.loadEnvFile(".env.local");
  const slug = arg("ws");
  const flowsArg = arg("flows");
  const ownSiteReads = Number(arg("own-site") ?? 0);
  const clientName = arg("client");
  const apply = process.argv.includes("--apply");
  const inline = process.argv.includes("--inline");
  if (!slug || (!flowsArg && !ownSiteReads)) {
    throw new Error("usage: --ws <slug> (--flows a,b | --own-site N --client <name>) [--apply]");
  }
  if (ownSiteReads > 0 && !clientName) throw new Error("--own-site needs --client <name>");

  const { db } = await import("@/db");
  const { workspaces } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const q = await import("@/db/queries/platina");
  const { specPagesRemaining } = await import("@/lib/platina/fetch/schedule");
  const { FORCE_FLOWS, planForceRun, RESERVE } = await import("@/lib/platina/force-run");
  const { snapshotRunConfig } = await import("@/lib/platina/orchestrator");
  const { readAccountUsage } = await import("@/lib/ops/collect");
  const { openRunSpecIdsQuery } = await import("@/db/queries/ops");

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.slug, slug));
  if (!ws) throw new Error(`no workspace "${slug}"`);

  const flows =
    flowsArg === "all"
      ? [...FORCE_FLOWS]
      : (flowsArg ?? "")
          .split(",")
          .map((f) => f.trim())
          .filter(Boolean);
  const unknown = flows.filter((f) => !(FORCE_FLOWS as readonly string[]).includes(f));
  if (unknown.length > 0) throw new Error(`unknown flow(s): ${unknown.join(", ")} (use ${FORCE_FLOWS.join(", ")})`);

  const [allSpecs, brands, config, account, open] = await Promise.all([
    q.listScanSpecs(ws.id),
    q.listBrands(ws.id),
    q.getWorkspaceConfig(ws.id),
    readAccountUsage(),
    openRunSpecIdsQuery(ws.id),
  ]);
  // A source with a run already waiting or running is left to that run.
  const busy = new Set(open.map((r) => r.specId));
  // --only "ASMS,HPLC": just the sources whose name contains one of these words.
  const only = (arg("only") ?? "")
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  const specs = allSpecs.filter(
    (s) => !busy.has(s.id) && (only.length === 0 || only.some((w) => s.name.toLowerCase().includes(w))),
  );
  for (const s of allSpecs.filter((x) => busy.has(x.id))) console.log(`  ~ ${s.name}: a run is already queued or running`);
  const kindOf = new Map(brands.map((b) => [b.id, b.kind]));
  const left = (name: string): number | null => {
    const r = account.find((a) => a.name === name);
    if (!r || "error" in r || r.cap === null) return null;
    return r.remaining ?? r.cap - r.used;
  };
  const remaining = { apifyUsd: left("Apify"), firecrawlCredits: left("Firecrawl") };
  // The own-site pages come out of the same Firecrawl balance.
  const firecrawlForSources =
    remaining.firecrawlCredits === null ? null : remaining.firecrawlCredits - ownSiteReads;

  const plan = planForceRun({
    specs: specs.map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      enabled: s.enabled,
      brandKind: s.brandId ? (kindOf.get(s.brandId) ?? null) : null,
      targets: s.targets,
      specRemaining: specPagesRemaining(s),
    })),
    flows: flows as (typeof FORCE_FLOWS)[number][],
    remaining: { apifyUsd: remaining.apifyUsd, firecrawlCredits: firecrawlForSources },
  });

  const money = (n: number | null) => (n === null ? "unknown" : `$${n.toFixed(2)}`);
  console.log(`force run ${slug}  (flows: ${flows.join(", ") || "none"}${ownSiteReads ? `; own site: ${ownSiteReads} pages` : ""})`);
  console.log(
    `balances: Apify ${money(remaining.apifyUsd)} left, Firecrawl ${remaining.firecrawlCredits ?? "unknown"} credits left (reserve kept: $${RESERVE.apifyUsd}, ${RESERVE.firecrawlCredits} credits)\n`,
  );
  for (const item of plan.items) {
    const cost = [item.firecrawlCredits ? `${item.firecrawlCredits} credits` : "", item.apifyUsd ? `~$${item.apifyUsd.toFixed(3)}` : ""]
      .filter(Boolean)
      .join(", ");
    console.log(`  + [${item.flow.padEnd(11)}] ${item.name.padEnd(48)} up to ${String(item.seedPages).padStart(2)} pages  ${cost}`);
  }
  for (const s of plan.skipped) console.log(`  - ${s.name}: ${s.reason}`);
  if (ownSiteReads > 0) console.log(`  + [own site   ] ${clientName}: up to ${ownSiteReads} queued pages  ${ownSiteReads} credits`);
  console.log(
    `\nprojected (estimates): ${plan.totals.pages} pages, ${plan.totals.firecrawlCredits + ownSiteReads} Firecrawl credits, ~$${plan.totals.apifyUsd.toFixed(2)} Apify`,
  );
  if (plan.refusal) {
    console.log(`\nREFUSED: ${plan.refusal}`);
    process.exit(1);
  }
  if (!apply) {
    console.log("\nDry run — nothing written. Re-run with --apply.");
    process.exit(0);
  }

  const { inngest } = await import("@/inngest/client");
  const today = new Date().toISOString().slice(0, 10);
  const runs: { runId: string; name: string }[] = [];
  const retry = process.argv.includes("--retry");
  for (const item of plan.items) {
    // One seed run per source per day; --retry allows one more (e.g. after a
    // job runner on an older build degraded the first one).
    const runId = await q.createAuditRun({
      workspaceId: ws.id,
      specId: item.specId,
      trigger: "manual",
      idempotencyKey: `seed:${today}:${item.specId}${retry ? ":retry" : ""}`,
      configSnapshot: { ...snapshotRunConfig(config), seedPages: item.seedPages },
    });
    if (runId) runs.push({ runId, name: item.name });
    else console.log(`  = ${item.name}: already force-run today${retry ? " (and retried)" : " (--retry allows one more)"}`);
  }
  if (inline) {
    const { executeAuditRunNow } = await import("@/inngest/functions/platina/audit-run");
    for (const [i, run] of runs.entries()) {
      const started = Date.now();
      const took = () => `${((Date.now() - started) / 1000).toFixed(0)}s`;
      try {
        const outcome = await executeAuditRunNow(ws.id, run.runId);
        console.log(`  [${i + 1}/${runs.length}] ${run.name} (${took()}): ${JSON.stringify(outcome).slice(0, 200)}`);
      } catch (error) {
        console.log(`  [${i + 1}/${runs.length}] ${run.name} (${took()}) failed: ${error instanceof Error ? error.message : error}`);
      }
    }
    console.log(`\nRan ${runs.length} run(s) in this process. Check: npm run platina:readiness -- --ws ${slug}`);
  } else {
    if (runs.length > 0) {
      await inngest.send(
        runs.map((r) => ({ name: "platina/audit-run.requested" as const, data: { runId: r.runId, workspaceId: ws.id } })),
      );
    }
    console.log(`\nQueued ${runs.length} run(s). Follow them on Audits, or: npm run platina:readiness -- --ws ${slug}`);
  }

  if (ownSiteReads > 0) {
    const client = brands.find((b) => b.kind === "own_brand" && b.name.toLowerCase() === clientName!.toLowerCase());
    if (!client) throw new Error(`no client "${clientName}"`);
    const { ownSiteDeps } = await import("@/lib/platina/own-site-deps");
    const { runOwnSitePass } = await import("@/lib/platina/own-site-run");
    // Firecrawl answers 429 after ~10 quick reads on this plan: read in passes,
    // wait a minute after a limit, stop when the grant is spent or nothing moves.
    const started = Date.now();
    let left = ownSiteReads;
    let totalRead = 0;
    for (let pass = 1; left > 0 && pass <= 40; pass += 1) {
      const result = await runOwnSitePass(ownSiteDeps, { workspaceId: ws.id, brandId: client.id, grantReads: left });
      totalRead += result.status === "done" ? result.read : 0;
      left -= result.status === "done" ? result.read + result.failed : left;
      const summary = result.status === "done" ? `read ${result.read}, failed ${result.failed}, waiting ${result.deferred}` : result.status;
      console.log(`  own site pass ${pass}: ${summary} (${totalRead} read, ${left} to go)`);
      if (result.status !== "done" || (result.read === 0 && !result.rateLimited)) break;
      if (result.rateLimited) await new Promise((r) => setTimeout(r, 65_000));
    }
    console.log(`own site: ${totalRead} pages read in ${((Date.now() - started) / 60_000).toFixed(1)} min`);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

export {};
