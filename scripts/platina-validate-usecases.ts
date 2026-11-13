/**
 * Automated Use-Case & Real-Time Operational Validation Runner.
 *
 *   npm run platina:validate-usecases -- [--ws waters-gcc-internal] [--skip-plan-eval] [--skip-ai-critique] [--write docs/validation/2026-11-13-live-usecase-validation-report.md] [--json]
 *
 * Read-only against the database. Executes:
 *  1. Schema & migration readiness (0087–0090)
 *  2. Live workspace data & operational checks across all 12 documented use cases (UC-01..UC-12)
 *  3. Live CORE-3 Planner & Critic evaluation (`PLAN_EVAL_CASES` + `CRITIC_EVAL_SET`)
 *  4. Higher-intelligence quality-tier model adversarial critique (`routeChatWithProvenance`)
 *  5. Outputs a strict, unvarnished validation report + prioritized next-operations queue
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  process.loadEnvFile(".env.local");
  const slug = arg("ws") ?? "waters-gcc-internal";
  const skipPlanEval = process.argv.includes("--skip-plan-eval");
  const skipAiCritique = process.argv.includes("--skip-ai-critique");
  const isJson = process.argv.includes("--json");
  const outPath =
    arg("write") ?? "docs/validation/2026-11-13-live-usecase-validation-report.md";

  const log = (msg: string) => {
    if (!isJson) console.error(`[validate] ${msg}`);
  };

  const { default: postgres } = await import("postgres");
  const { checkBrainMigrations } = await import("@/lib/platina/brain-readiness");
  const { parseBrainModes } = await import("@/lib/platina/brain-modes");
  const { runOpsChecks } = await import("@/lib/ops/collect");
  const {
    evaluateUseCases,
    formatValidationMarkdown,
  } = await import("@/lib/platina/usecase-validation");

  const sql = postgres(process.env.DATABASE_URL!, { max: 4, prepare: false });

  try {
    log(`1/4 Inspecting database schema & live workspace telemetry (${slug})...`);
    const [ws] = await sql<{ id: string; slug: string; name: string }[]>`
      select id, slug, name from workspaces where slug = ${slug}
    `;
    if (!ws) throw new Error(`Workspace "${slug}" not found`);

    const [tables, columns] = await Promise.all([
      sql<{ table_name: string }[]>`
        select table_name from information_schema.tables
        where table_schema = 'public' and table_name like 'platina_%'
      `,
      sql<{ table_name: string; column_name: string }[]>`
        select table_name, column_name from information_schema.columns
        where table_schema = 'public' and table_name like 'platina_%'
      `,
    ]);
    const present = new Set([
      ...tables.map((t) => t.table_name),
      ...columns.map((c) => `${c.table_name}.${c.column_name}`),
    ]);
    const migrationChecks = checkBrainMigrations(present);
    const migrationsReady = migrationChecks.every((c) => c.ok);

    const [
      configRows,
      brandRows,
      fpRows,
      brandChunkRows,
      specRows,
      runRows,
      sigRows,
      trRows,
      findingRows,
      brainRows,
      gradeRows,
      telRows,
    ] = await Promise.all([
      sql<{ brain_modes: unknown; min_baseline_n: number }[]>`
        select brain_modes, min_baseline_n from platina_workspace_config where workspace_id = ${ws.id}
      `,
      sql<{ kind: string; profile: unknown }[]>`
        select kind, profile from platina_brands where workspace_id = ${ws.id} and status = 'active'
      `,
      sql<{ total: number; unembedded: number }[]>`
        select count(*)::int as total,
               count(*) filter (where embedding is null)::int as unembedded
        from platina_first_party_chunks where workspace_id = ${ws.id}
      `,
      sql<{ n: number }[]>`
        select count(*)::int as n from platina_brand_chunks
        where workspace_id = ${ws.id} and superseded_at is null
      `,
      sql<{ n: number }[]>`
        select count(*)::int as n from platina_scan_specs
        where workspace_id = ${ws.id} and status = 'approved' and enabled = true
      `,
      sql<{ total: number; stuck: number; failed24h: number }[]>`
        select count(*)::int as total,
               count(*) filter (where status in ('queued', 'running', 'validating') and coalesce(started_at, queued_at) < now() - interval '1 hour')::int as stuck,
               count(*) filter (where status = 'failed' and queued_at > now() - interval '24 hours')::int as failed24h
        from platina_audit_runs where workspace_id = ${ws.id}
      `,
      sql<{ total: number; skipped: number; ad_reads: number }[]>`
        select count(*)::int as total,
               count(*) filter (where processing_state = 'skipped')::int as skipped,
               count(*) filter (where source_kind = 'ad_library')::int as ad_reads
        from platina_signal_documents where workspace_id = ${ws.id}
      `,
      sql<{ total: number; blinded: number }[]>`
        select count(*)::int as total,
               count(*) filter (where blinded is true)::int as blinded
        from platina_debate_transcripts where workspace_id = ${ws.id}
      `,
      sql<{ n: number }[]>`
        select count(*)::int as n from platina_findings where workspace_id = ${ws.id}
      `,
      sql<{
        active: number;
        superseded: number;
        refuted: number;
        with_falsifier: number;
        due_now: number;
      }[]>`
        select count(*) filter (where status = 'active')::int as active,
               count(*) filter (where status = 'superseded')::int as superseded,
               count(*) filter (where grade_state = 'refuted')::int as refuted,
               count(*) filter (where falsifier is not null)::int as with_falsifier,
               count(*) filter (where falsifier is not null and due_at <= now() and grade_state in ('untested', 'holding', 'insufficient'))::int as due_now
        from platina_brain_chunks where workspace_id = ${ws.id}
      `,
      sql<{ n: number }[]>`
        select count(*)::int as n from platina_insight_grades where workspace_id = ${ws.id}
      `,
      sql<{ n: number }[]>`
        select count(*)::int as n from platina_brain_telemetry
        where workspace_id = ${ws.id} and created_at > now() - interval '7 days'
      `,
    ]);

    const [
      interestRows,
      eventRows,
      partRows,
      planRows,
      creativeRows,
      metricRows,
      reviewRows,
      sugRows,
      sugEventRows,
      outcomeRows,
      opsChecks,
    ] = await Promise.all([
      sql<{ total: number; topics_min_n: number }[]>`
        select count(*)::int as total,
               (select count(*)::int from (
                 select topic from platina_interest_signals
                 where workspace_id = ${ws.id} and signal_kind = 'interest'
                 group by topic having count(*) >= 5
               ) t) as topics_min_n
        from platina_interest_signals where workspace_id = ${ws.id}
      `,
      sql<{ dated_upcoming: number; undated: number }[]>`
        select count(*) filter (where starts_on is not null and coalesce(ends_on, starts_on) >= current_date)::int as dated_upcoming,
               count(*) filter (where starts_on is null)::int as undated
        from platina_events where workspace_id = ${ws.id}
      `,
      sql<{ n: number }[]>`
        select count(*)::int as n from platina_event_participants where workspace_id = ${ws.id}
      `,
      sql<{ total: number; with_test: number; with_trigger: number }[]>`
        select count(*)::int as total,
               count(*) filter (where plan -> 'falsifier' is not null and jsonb_typeof(plan -> 'falsifier') = 'object')::int as with_test,
               count(*) filter (where origin -> 'trigger' is not null and jsonb_typeof(origin -> 'trigger') = 'object')::int as with_trigger
        from platina_plans where workspace_id = ${ws.id}
      `,
      sql<{ n: number }[]>`
        select count(*)::int as n from platina_creatives where workspace_id = ${ws.id}
      `,
      sql<{ n: number }[]>`
        select count(*)::int as n from platina_creative_metrics where workspace_id = ${ws.id}
      `,
      sql<{ n: number }[]>`
        select count(*)::int as n from platina_creative_reviews
        where workspace_id = ${ws.id} and status = 'confirmed'
      `,
      sql<{ n: number }[]>`
        select count(*)::int as n from platina_suggestions where workspace_id = ${ws.id}
      `,
      sql<{ n: number }[]>`
        select count(*)::int as n from platina_suggestion_events where workspace_id = ${ws.id}
      `,
      sql<{ n: number }[]>`
        select count(*)::int as n from platina_outcomes
        where workspace_id = ${ws.id} and synthetic = false
      `,
      runOpsChecks(ws.id, { external: true }),
    ]);

    await sql.end();

    const config = configRows[0];
    const brainModes = parseBrainModes(config?.brain_modes ?? {});
    const ownBrands = brandRows.filter((b) => b.kind === "own_brand");
    const competitors = brandRows.filter((b) => b.kind === "competitor");

    const ownershipCheck = opsChecks.find((c) => c.id === "knowledge_ownership");
    const collectionCheck = opsChecks.find((c) => c.id === "collection_freshness");
    const budgetsCheck = opsChecks.find((c) => c.id === "budgets");

    const lateScanSpecs = Number(collectionCheck?.value?.late ?? 0);
    const thirdPartyLeaks = Number(ownershipCheck?.value?.notOwn ?? 0);
    const apifyFailed = Boolean(budgetsCheck?.detail.includes("Apify: couldn't read"));

    // Disable DB usage logging during synthetic plan eval & AI critique so we write 0 rows
    delete process.env.DATABASE_URL;

    let planEval = null;
    if (!skipPlanEval) {
      log(`2/4 Running CORE-3 live Planner & Critic evaluation (8 synthetic briefs + 4 critic cases)...`);
      const { generateCampaignPlan, critiquePlan } = await import("@/lib/platina/plan/agent");
      const { PLAN_EVAL_CASES, CRITIC_EVAL_SET } = await import("@/lib/platina/plan/eval-set");
      const { runPlanEval } = await import("@/lib/platina/plan/eval");
      planEval = await runPlanEval({
        cases: PLAN_EVAL_CASES,
        generate: (ctx) => generateCampaignPlan(ctx, { tier: "fast" }),
        critique: critiquePlan,
        criticSet: CRITIC_EVAL_SET,
        runs: 1,
      });
    }

    log(`3/4 Scoring all 12 use cases against strict operational realism criteria...`);
    const report = evaluateUseCases({
      workspaceSlug: slug,
      evaluatedAt: new Date(),
      migrationsReady,
      brainModes,
      counts: {
        ownBrands: ownBrands.length,
        competitors: competitors.length,
        clientProfilePresent: ownBrands.some((b) => Boolean(b.profile)),
        firstPartyPassages: fpRows[0]?.total ?? 0,
        unembeddedFirstPartyPassages: fpRows[0]?.unembedded ?? 0,
        thirdPartyLeaksInFirstParty: thirdPartyLeaks,
        approvedBrandChunks: brandChunkRows[0]?.n ?? 0,
        minBaselineN: config?.min_baseline_n ?? 20,
        approvedScanSpecs: specRows[0]?.n ?? 0,
        lateScanSpecs,
        auditRunsTotal: runRows[0]?.total ?? 0,
        stuckAuditRuns: runRows[0]?.stuck ?? 0,
        failedAuditRuns24h: runRows[0]?.failed24h ?? 0,
        signalDocumentsTotal: sigRows[0]?.total ?? 0,
        signalDocumentsSkipped: sigRows[0]?.skipped ?? 0,
        debateTranscriptsTotal: trRows[0]?.total ?? 0,
        blindedTranscripts: trRows[0]?.blinded ?? 0,
        findingsTotal: findingRows[0]?.n ?? 0,
        activeBrainChunks: brainRows[0]?.active ?? 0,
        supersededBrainChunks: brainRows[0]?.superseded ?? 0,
        refutedBrainChunks: brainRows[0]?.refuted ?? 0,
        falsifierBearingChunks: brainRows[0]?.with_falsifier ?? 0,
        dueFalsifierChunks: brainRows[0]?.due_now ?? 0,
        insightGradesTotal: gradeRows[0]?.n ?? 0,
        brainTelemetry7d: telRows[0]?.n ?? 0,
        interestSignalsTotal: interestRows[0]?.total ?? 0,
        topicsPassingMinN: interestRows[0]?.topics_min_n ?? 0,
        datedUpcomingEvents: eventRows[0]?.dated_upcoming ?? 0,
        undatedEvents: eventRows[0]?.undated ?? 0,
        eventParticipantsTotal: partRows[0]?.n ?? 0,
        adLibraryReads: sigRows[0]?.ad_reads ?? 0,
        plansTotal: planRows[0]?.total ?? 0,
        plansWithStatedTest: planRows[0]?.with_test ?? 0,
        planRevisionsWithTrigger: planRows[0]?.with_trigger ?? 0,
        creativesTotal: creativeRows[0]?.n ?? 0,
        metricSnapshotsTotal: metricRows[0]?.n ?? 0,
        confirmedReviewsTotal: reviewRows[0]?.n ?? 0,
        learningMinN: 5,
        suggestionsTotal: sugRows[0]?.n ?? 0,
        suggestionEventsTotal: sugEventRows[0]?.n ?? 0,
        outcomesTotal: outcomeRows[0]?.n ?? 0,
      },
      providers: {
        databaseOk: true,
        firecrawlOk: Boolean(process.env.FIRECRAWL_API_KEY),
        apifyOk: !apifyFailed,
        apifyDetail: apifyFailed ? "HTTP 401 on Apify usage check" : "OK",
        aiRouterOk: Boolean(process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY),
      },
      planEval,
    });

    if (!skipAiCritique) {
      log(`4/4 Running higher-intelligence quality-tier model adversarial critique...`);
      try {
        const { routeChatWithProvenance } = await import("@/lib/ai/router");
        const prompt = [
          "You are an adversarial Principal Systems Architect and B2B SaaS Due-Diligence Auditor.",
          "Below is the live automated validation telemetry and 12-use-case matrix for Platina AI OS (`waters-gcc-internal`).",
          "Do NOT flatter. Provide a strict, realistic critique in 4 concise markdown sections:",
          "### 3.1 Architectural & Epistemic Strengths (What Genuinely Beats Standard RAG Wrappers)",
          "### 3.2 Critical Live Operational Bottlenecks (Cite Exact Numbers Blocking Closed-Loop Proof Today)",
          "### 3.3 Statistical & Commercial Risks (Small-N B2B Reality, Plane B Scraping Fragility, Buyer Objections)",
          "### 3.4 Top 4 Immediate Execution Actions Before the 24 Nov Study Checkpoint",
          "",
          JSON.stringify(
            {
              summary: report.summary,
              planEvalSummary: report.planEvalSummary,
              useCases: report.useCases,
              nextOperations: report.nextOperations,
            },
            null,
            2,
          ),
        ].join("\n");

        let aiRes;
        try {
          aiRes = await routeChatWithProvenance({
            kind: "chat",
            tier: "quality",
            system:
              "You are a rigorous, skeptical Principal Systems Architect and B2B SaaS Due-Diligence Auditor. Cite concrete numbers from the input. Never invent metrics.",
            prompt,
          });
        } catch (firstErr) {
          if (String(firstErr).includes("429")) {
            log(`Provider rate-limit window cooling down after 12 eval calls; waiting 20s and retrying...`);
            await new Promise((r) => setTimeout(r, 20_000));
            aiRes = await routeChatWithProvenance({
              kind: "chat",
              tier: "quality",
              system:
                "You are a rigorous, skeptical Principal Systems Architect and B2B SaaS Due-Diligence Auditor. Cite concrete numbers from the input. Never invent metrics.",
              prompt,
            });
          } else {
            throw firstErr;
          }
        }
        report.aiAdversarialCritique = {
          provider: aiRes.provider,
          model: aiRes.model,
          verdict: aiRes.text.trim(),
        };
      } catch (err) {
        report.aiAdversarialCritique = {
          provider: "unavailable",
          model: "none",
          verdict: `AI critique skipped due to provider error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    const markdown = formatValidationMarkdown(report);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, markdown, "utf8");

    if (isJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`\nPlatina Use-Case & Real-Time Operational Validation (${slug})`);
      console.log(`  Architecture / Code Verified:   ${report.summary.architectureReadinessPct}% (${report.summary.codeVerifiedCount}/${report.summary.totalUseCases})`);
      console.log(`  Live End-to-End Operational:    ${report.summary.liveOperationalReadinessPct}% (${report.summary.operationalCount} operational, ${report.summary.degradedCount} degraded, ${report.summary.dormantCount} dormant, ${report.summary.blockedByDataCount} blocked by data, ${report.summary.failedCount} failed)`);
      console.log(`  Strict Realism Composite Score: ${report.summary.strictCompositeScore}/100`);
      if (report.planEvalSummary.ran) {
        console.log(`  CORE-3 Planner & Critic Eval:   Checks ${report.planEvalSummary.checkPassRatePct}% | Critic ${report.planEvalSummary.criticAgreementPct ?? "n/a"}%`);
      }
      console.log(`\nUse-Case Breakdown:`);
      for (const u of report.useCases) {
        console.log(`  ${u.id} [${u.liveStatus.padEnd(16)}] (${String(u.score).padStart(3)}/100) ${u.title}`);
        if (u.gap) console.log(`         gap: ${u.gap}`);
      }
      console.log(`\nReport written to: ${outPath}\n`);
    }
    process.exit(0);
  } catch (err) {
    await sql.end().catch(() => {});
    throw err;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

export {};
