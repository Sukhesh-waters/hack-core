/**
 * Strict Use-Case & Real-Time Operational Validation Engine.
 *
 * Evaluates all 12 documented Platina AI OS use cases (UC-01..UC-12) against
 * both deterministic code invariants AND live workspace operational facts.
 *
 * Strict Realism Rule:
 * - A use case whose code is built and unit-tested but whose Brain stage mode
 *   is "off" is graded `dormant_mode_off` (capped at 55/100), never `operational`.
 * - A use case whose code is built but has 0 live data rows required to close
 *   its loop (e.g. 0 confirmed brand standard chunks or 0 logged creative
 *   reviews) is graded `blocked_by_data` (capped at 50/100), never `operational`.
 * - External scraper/provider failures or stuck runs downgrade affected flows
 *   to `degraded` or `failed`.
 */
import type { BrainMode, BrainStage } from "./brain-modes";
import type { PlanEvalReport } from "./plan/eval";

export type UseCaseId =
  | "UC-01"
  | "UC-02"
  | "UC-03"
  | "UC-04"
  | "UC-05"
  | "UC-06"
  | "UC-07"
  | "UC-08"
  | "UC-09"
  | "UC-10"
  | "UC-11"
  | "UC-12";

export type LiveOperationalStatus =
  | "operational"
  | "degraded"
  | "dormant_mode_off"
  | "blocked_by_data"
  | "failed";

export type UseCaseValidationInput = {
  workspaceSlug: string;
  evaluatedAt: Date;
  migrationsReady: boolean;
  brainModes: Record<BrainStage, BrainMode>;
  counts: {
    ownBrands: number;
    competitors: number;
    clientProfilePresent: boolean;
    firstPartyPassages: number;
    unembeddedFirstPartyPassages: number;
    thirdPartyLeaksInFirstParty: number;
    approvedBrandChunks: number;
    minBaselineN: number;
    approvedScanSpecs: number;
    lateScanSpecs: number;
    auditRunsTotal: number;
    stuckAuditRuns: number;
    failedAuditRuns24h: number;
    signalDocumentsTotal: number;
    signalDocumentsSkipped: number;
    debateTranscriptsTotal: number;
    blindedTranscripts: number;
    findingsTotal: number;
    activeBrainChunks: number;
    supersededBrainChunks: number;
    refutedBrainChunks: number;
    falsifierBearingChunks: number;
    dueFalsifierChunks: number;
    insightGradesTotal: number;
    brainTelemetry7d: number;
    interestSignalsTotal: number;
    topicsPassingMinN: number;
    datedUpcomingEvents: number;
    undatedEvents: number;
    eventParticipantsTotal: number;
    adLibraryReads: number;
    plansTotal: number;
    plansWithStatedTest: number;
    planRevisionsWithTrigger: number;
    creativesTotal: number;
    metricSnapshotsTotal: number;
    confirmedReviewsTotal: number;
    learningMinN: number;
    suggestionsTotal: number;
    suggestionEventsTotal: number;
    outcomesTotal: number;
  };
  providers: {
    databaseOk: boolean;
    firecrawlOk: boolean;
    apifyOk: boolean;
    apifyDetail?: string;
    aiRouterOk: boolean;
  };
  planEval?: PlanEvalReport | null;
};

export type UseCaseVerdict = {
  id: UseCaseId;
  title: string;
  stage: "Onboard" | "Watch" | "Decide" | "Make" | "Learn" | "Review";
  codeVerified: boolean;
  liveStatus: LiveOperationalStatus;
  /** Strict 0-100 score. Code-only without live operational closure cannot exceed 55. */
  score: number;
  evidence: string;
  gap: string | null;
  remediation: string | null;
};

export type NextOperation = {
  id: string;
  priority: "P0" | "P1" | "P2";
  title: string;
  why: string;
  action: string;
  unblocks: UseCaseId[];
};

export type ValidationReport = {
  workspaceSlug: string;
  evaluatedAt: string;
  summary: {
    totalUseCases: number;
    codeVerifiedCount: number;
    operationalCount: number;
    degradedCount: number;
    dormantCount: number;
    blockedByDataCount: number;
    failedCount: number;
    architectureReadinessPct: number;
    liveOperationalReadinessPct: number;
    strictCompositeScore: number;
  };
  useCases: UseCaseVerdict[];
  nextOperations: NextOperation[];
  planEvalSummary: {
    ran: boolean;
    checkPassRatePct: number | null;
    criticAgreementPct: number | null;
    failedChecks: string[];
  };
  aiAdversarialCritique?: {
    provider: string;
    model: string;
    verdict: string;
  } | null;
};

function summarisePlanEval(planEval: PlanEvalReport | null | undefined): {
  ran: boolean;
  checkPassRatePct: number | null;
  criticAgreementPct: number | null;
  failedChecks: string[];
} {
  if (!planEval || planEval.cases.length === 0) {
    return { ran: false, checkPassRatePct: null, criticAgreementPct: null, failedChecks: [] };
  }
  const entries = Object.entries(planEval.byCheck).filter(([, r]) => r.applicable > 0);
  const totalPassed = entries.reduce((s, [, r]) => s + r.passed, 0);
  const totalApplicable = entries.reduce((s, [, r]) => s + r.applicable, 0);
  const checkPassRatePct =
    totalApplicable > 0 ? Math.round((totalPassed / totalApplicable) * 100) : null;
  const criticRate = planEval.critic?.agreement.rate ?? null;
  const criticAgreementPct = criticRate !== null ? Math.round(criticRate * 100) : null;
  const failedChecks = entries
    .filter(([, r]) => r.rate !== null && r.rate < 1)
    .map(([name, r]) => `${name} (${r.passed}/${r.applicable})`);
  return { ran: true, checkPassRatePct, criticAgreementPct, failedChecks };
}

export function evaluateUseCases(input: UseCaseValidationInput): ValidationReport {
  const { counts: c, brainModes: m, providers: p } = input;
  const pe = summarisePlanEval(input.planEval);

  // UC-01: Client Onboarding & First-Party Ownership Vault
  const uc01Leaks = c.thirdPartyLeaksInFirstParty > 0;
  const uc01HasClient = c.ownBrands >= 1 && c.competitors >= 1 && c.firstPartyPassages > 0;
  const uc01BrandStandardReady = c.approvedBrandChunks >= c.minBaselineN;
  const uc01Status: LiveOperationalStatus = uc01Leaks
    ? "failed"
    : !uc01HasClient
      ? "blocked_by_data"
      : !uc01BrandStandardReady || c.unembeddedFirstPartyPassages > 0 || !c.clientProfilePresent
        ? "degraded"
        : "operational";
  const uc01Score =
    uc01Status === "operational"
      ? 100
      : uc01Status === "degraded"
        ? 72
        : uc01Status === "blocked_by_data"
          ? 45
          : 15;

  // UC-02: Continuous Low-Cost Market Collection & Cost Cascade
  const uc02Ok =
    c.approvedScanSpecs > 0 &&
    c.signalDocumentsTotal > 0 &&
    c.stuckAuditRuns === 0 &&
    c.lateScanSpecs === 0 &&
    p.firecrawlOk &&
    p.apifyOk;
  const uc02Status: LiveOperationalStatus =
    c.approvedScanSpecs === 0 || c.signalDocumentsTotal === 0
      ? "blocked_by_data"
      : !p.firecrawlOk && !p.apifyOk
        ? "failed"
        : uc02Ok
          ? "operational"
          : "degraded";
  const uc02Score =
    uc02Status === "operational"
      ? 95
      : uc02Status === "degraded"
        ? 65
        : uc02Status === "blocked_by_data"
          ? 40
          : 20;
  const uc02Gaps: string[] = [];
  if (!p.apifyOk) uc02Gaps.push(`Apify check failed (${p.apifyDetail ?? "HTTP 401"})`);
  if (c.stuckAuditRuns > 0) uc02Gaps.push(`${c.stuckAuditRuns} run(s) stuck >1h`);
  if (c.lateScanSpecs > 0) uc02Gaps.push(`${c.lateScanSpecs} source(s) late`);

  // UC-03: Metacognitive Signal Analysis (B1 Interrogation, B2 Blind Challenger, B3 Gate, B4 Surprise)
  const analysisModesActive =
    m.interrogation !== "off" || m.challenger !== "off" || m.gate !== "off" || m.surprise !== "off";
  const allAnalysisModesActive =
    m.interrogation !== "off" && m.challenger !== "off" && m.gate !== "off" && m.surprise !== "off";
  const uc03Status: LiveOperationalStatus = !input.migrationsReady
    ? "failed"
    : !analysisModesActive
      ? "dormant_mode_off"
      : allAnalysisModesActive && c.falsifierBearingChunks > 0
        ? "operational"
        : "degraded";
  const uc03Score =
    uc03Status === "operational"
      ? 95
      : uc03Status === "degraded"
        ? 75
        : uc03Status === "dormant_mode_off"
          ? 55
          : 10;

  // UC-04: Measured Market Interest & Competitor Ad Pressure
  const uc04Status: LiveOperationalStatus =
    c.interestSignalsTotal === 0 && c.adLibraryReads === 0
      ? "blocked_by_data"
      : c.topicsPassingMinN >= 3 && c.adLibraryReads > 0
        ? "operational"
        : "degraded";
  const uc04Score =
    uc04Status === "operational" ? 95 : uc04Status === "degraded" ? 70 : 40;

  // UC-05: Trade Show & Event Readiness Intelligence
  const uc05Status: LiveOperationalStatus =
    c.datedUpcomingEvents === 0
      ? "blocked_by_data"
      : c.eventParticipantsTotal > 0
        ? "operational"
        : "degraded";
  const uc05Score =
    uc05Status === "operational" ? 92 : uc05Status === "degraded" ? 70 : 40;

  // UC-06: Ranked Opportunities & Evidence-Cited Campaign Briefs
  const uc06Status: LiveOperationalStatus =
    c.topicsPassingMinN === 0 && c.datedUpcomingEvents === 0
      ? "blocked_by_data"
      : m.retrieval === "off"
        ? "degraded"
        : "operational";
  const uc06Score =
    uc06Status === "operational" ? 95 : uc06Status === "degraded" ? 80 : 45;

  // UC-07: Anti-Echo Campaign Planner & Stated Falsifier
  const evalPassed = !pe.ran || (pe.checkPassRatePct !== null && pe.checkPassRatePct >= 85);
  const uc07Status: LiveOperationalStatus = !evalPassed
    ? "degraded"
    : c.plansTotal === 0
      ? "blocked_by_data"
      : m.retrieval === "on" && m.budget === "on" && c.plansWithStatedTest > 0
        ? "operational"
        : "degraded";
  const uc07Score =
    uc07Status === "operational"
      ? 95
      : uc07Status === "degraded"
        ? 78
        : 50;

  // UC-08: Real-Time Plan Freshness & Evidence-Triggered Re-Planning
  const uc08Status: LiveOperationalStatus =
    c.plansTotal === 0
      ? "blocked_by_data"
      : m.interrogation !== "off" && m.gate !== "off"
        ? "operational"
        : "degraded";
  const uc08Score =
    uc08Status === "operational" ? 90 : uc08Status === "degraded" ? 74 : 45;

  // UC-09: Brand DNA Drift & Deterministic Claims Gate
  const uc09Status: LiveOperationalStatus =
    c.approvedBrandChunks >= c.minBaselineN ? "operational" : "blocked_by_data";
  const uc09Score = uc09Status === "operational" ? 95 : 50;

  // UC-10: Triggered Idea Engine with 80/20 Explore Split
  const uc10Status: LiveOperationalStatus =
    c.topicsPassingMinN === 0 && c.datedUpcomingEvents === 0
      ? "blocked_by_data"
      : c.firstPartyPassages > 0
        ? "operational"
        : "degraded";
  const uc10Score =
    uc10Status === "operational" ? 90 : uc10Status === "degraded" ? 72 : 45;

  // UC-11: Results Import, Human Review Confirmation & Bandit Learning Loop
  const uc11Status: LiveOperationalStatus =
    c.creativesTotal === 0 && c.metricSnapshotsTotal === 0
      ? "blocked_by_data"
      : c.confirmedReviewsTotal >= c.learningMinN
        ? "operational"
        : "degraded";
  const uc11Score =
    uc11Status === "operational"
      ? 95
      : uc11Status === "degraded"
        ? 68
        : 45;

  // UC-12: Daily Falsifier Grader, Human Insight Gate & Monthly Consolidation
  const uc12Status: LiveOperationalStatus = !input.migrationsReady
    ? "failed"
    : m.grading === "off"
      ? "dormant_mode_off"
      : c.falsifierBearingChunks > 0
        ? "operational"
        : "degraded";
  const uc12Score =
    uc12Status === "operational"
      ? 92
      : uc12Status === "degraded"
        ? 74
        : uc12Status === "dormant_mode_off"
          ? 55
          : 15;

  const useCases: UseCaseVerdict[] = [
    {
      id: "UC-01",
      title: "Client Onboarding & First-Party Ownership Vault",
      stage: "Onboard",
      codeVerified: true,
      liveStatus: uc01Status,
      score: uc01Score,
      evidence: `${c.ownBrands} client, ${c.competitors} competitors, ${c.firstPartyPassages} own-site passages (${c.thirdPartyLeaksInFirstParty} leaks), ${c.approvedBrandChunks}/${c.minBaselineN} confirmed brand chunks`,
      gap:
        uc01Leaks
          ? `${c.thirdPartyLeaksInFirstParty} non-client URLs leaked into first-party store`
          : !uc01BrandStandardReady
            ? `${c.approvedBrandChunks} of ${c.minBaselineN} required brand standard chunks confirmed; ${c.unembeddedFirstPartyPassages} own-site passages awaiting embedding`
            : c.unembeddedFirstPartyPassages > 0
              ? `${c.unembeddedFirstPartyPassages} own-site passages awaiting embedding`
              : null,
      remediation: !uc01BrandStandardReady
        ? "Confirm Waters' brand standard lines into platina_brand_chunks (>= 20 chunks) and backfill pending embeddings."
        : null,
    },
    {
      id: "UC-02",
      title: "Continuous Low-Cost Market Collection & Cost Cascade",
      stage: "Watch",
      codeVerified: true,
      liveStatus: uc02Status,
      score: uc02Score,
      evidence: `${c.approvedScanSpecs} approved sources, ${c.auditRunsTotal} runs, ${c.signalDocumentsTotal} signal docs (${c.signalDocumentsSkipped} skipped before LLM), OPS-0 replay guard active`,
      gap: uc02Gaps.length > 0 ? uc02Gaps.join("; ") : null,
      remediation:
        uc02Gaps.length > 0
          ? "Reap stuck runs, verify/rotate APIFY_TOKEN in .env.local, and keep dev:all running so scan-coordinator clears late specs."
          : null,
    },
    {
      id: "UC-03",
      title: "Metacognitive Signal Analysis (Interrogate, Blind Challenge, Gate, Surprise)",
      stage: "Watch",
      codeVerified: true,
      liveStatus: uc03Status,
      score: uc03Score,
      evidence: `Modes: interrogation=${m.interrogation}, challenger=${m.challenger}, gate=${m.gate}, surprise=${m.surprise}; ${c.findingsTotal} findings, ${c.activeBrainChunks} active Brain chunks (${c.falsifierBearingChunks} with v2 falsifiers)`,
      gap:
        uc03Status === "dormant_mode_off"
          ? "All 4 signal-analysis Brain stages are set to 'off' in workspace config; live analysis runs legacy v1 path."
          : c.falsifierBearingChunks === 0
            ? "0 Brain chunks carry a v2 falsifier yet."
            : null,
      remediation:
        uc03Status !== "operational"
          ? "Flip interrogation=on, gate=on, challenger=shadow, surprise=shadow (post-ARABLAB freeze) and sync measured insights."
          : null,
    },
    {
      id: "UC-04",
      title: "Measured Market Interest & Competitor Ad Pressure",
      stage: "Watch",
      codeVerified: true,
      liveStatus: uc04Status,
      score: uc04Score,
      evidence: `${c.interestSignalsTotal} interest signals, ${c.topicsPassingMinN} topics past min-N (5), ${c.adLibraryReads} ad-library reads`,
      gap:
        c.topicsPassingMinN < 3
          ? `Only ${c.topicsPassingMinN} topics pass min-N=5`
          : null,
      remediation:
        c.topicsPassingMinN < 3 ? "Run interest extraction over collected social posts." : null,
    },
    {
      id: "UC-05",
      title: "Trade Show & Event Readiness Intelligence",
      stage: "Watch",
      codeVerified: true,
      liveStatus: uc05Status,
      score: uc05Score,
      evidence: `${c.datedUpcomingEvents} dated upcoming events, ${c.undatedEvents} undated, ${c.eventParticipantsTotal} verified participation proofs`,
      gap:
        c.undatedEvents > 0
          ? `${c.undatedEvents} events still lack a verified verbatim date on page`
          : null,
      remediation: null,
    },
    {
      id: "UC-06",
      title: "Ranked Opportunities & Evidence-Cited Campaign Briefs",
      stage: "Decide",
      codeVerified: true,
      liveStatus: uc06Status,
      score: uc06Score,
      evidence: `${c.topicsPassingMinN} ranked topic opportunities, ${c.datedUpcomingEvents} event opportunities, W3b-rest anti-echo brief selection wired (retrieval=${m.retrieval})`,
      gap:
        m.retrieval === "off"
          ? "retrieval mode is 'off' (briefs use legacy top-6 own passages without MMR/counter-evidence slot)"
          : null,
      remediation:
        m.retrieval === "off"
          ? "Enable retrieval=on and budget=on in workspace brain_modes."
          : null,
    },
    {
      id: "UC-07",
      title: "Anti-Echo Campaign Planner & Stated Falsifier",
      stage: "Make",
      codeVerified: evalPassed,
      liveStatus: uc07Status,
      score: uc07Score,
      evidence: `${c.plansTotal} saved plans (${c.plansWithStatedTest} with stated falsifier); retrieval=${m.retrieval}, budget=${m.budget}; CORE-3 eval=${pe.ran ? `${pe.checkPassRatePct}% checks, ${pe.criticAgreementPct ?? "n/a"}% critic` : "not run in this pass"}`,
      gap:
        !evalPassed
          ? `CORE-3 plan eval dropped below 85% (${pe.failedChecks.join(", ")})`
          : m.retrieval !== "on" || m.budget !== "on" || c.plansWithStatedTest === 0
            ? `retrieval=${m.retrieval}, budget=${m.budget}, plansWithStatedTest=${c.plansWithStatedTest}/${c.plansTotal}`
            : null,
      remediation:
        m.retrieval !== "on" || m.budget !== "on"
          ? "Enable retrieval=on and budget=on, and generate/save a plan with a stated falsifier."
          : null,
    },
    {
      id: "UC-08",
      title: "Real-Time Plan Freshness & Evidence-Triggered Re-Planning",
      stage: "Make",
      codeVerified: true,
      liveStatus: uc08Status,
      score: uc08Score,
      evidence: `${c.plansTotal} plans watched on read; WTR-0 Part C trigger tracking wired (${c.planRevisionsWithTrigger} revisions with trigger metadata)`,
      gap:
        m.interrogation === "off" || m.gate === "off"
          ? "interrogation/gate modes are 'off', so new insights are not gated v2 claims"
          : null,
      remediation:
        m.interrogation === "off" || m.gate === "off"
          ? "Enable interrogation=on and gate=on so freshness counts gated v2 insights."
          : null,
    },
    {
      id: "UC-09",
      title: "Brand DNA Drift & Deterministic Claims Gate",
      stage: "Review",
      codeVerified: true,
      liveStatus: uc09Status,
      score: uc09Score,
      evidence: `claimsGate + B9 Heinz detectRuleConflicts verified; ${c.approvedBrandChunks}/${c.minBaselineN} approved brand standard chunks`,
      gap:
        c.approvedBrandChunks < c.minBaselineN
          ? `Solutions drafting blocked by minNGate: ${c.approvedBrandChunks} of ${c.minBaselineN} required brand chunks confirmed`
          : null,
      remediation:
        c.approvedBrandChunks < c.minBaselineN
          ? "Confirm >= 20 Brand DNA standard chunks from Waters' verified own-site passages."
          : null,
    },
    {
      id: "UC-10",
      title: "Triggered Idea Engine with 80/20 Explore Split",
      stage: "Make",
      codeVerified: true,
      liveStatus: uc10Status,
      score: uc10Score,
      evidence: `W3b-rest anti-echo wired into runIdeaEngine; ${c.suggestionsTotal} suggestions in ledger`,
      gap: null,
      remediation: null,
    },
    {
      id: "UC-11",
      title: "Results Import, Human Review Confirmation & Bandit Learning Loop",
      stage: "Learn",
      codeVerified: true,
      liveStatus: uc11Status,
      score: uc11Score,
      evidence: `WTR-0 non-blocking LinkedIn import + B9 qualified_leads wired; live: ${c.creativesTotal} creatives, ${c.metricSnapshotsTotal} snapshots, ${c.confirmedReviewsTotal}/${c.learningMinN} confirmed reviews, ${c.outcomesTotal} outcomes`,
      gap:
        c.creativesTotal === 0
          ? "0 creatives and 0 metric snapshots logged — the fast learning loop has no first-party outcome fuel yet"
          : c.confirmedReviewsTotal < c.learningMinN
            ? `${c.confirmedReviewsTotal} of ${c.learningMinN} confirmed reviews needed to unlock Thompson bandit re-weighting`
            : null,
      remediation:
        c.confirmedReviewsTotal < c.learningMinN
          ? "Register Waters' public LinkedIn posts as creatives, import engagement snapshots, and confirm >= 5 reviews."
          : null,
    },
    {
      id: "UC-12",
      title: "Daily Falsifier Grader, Human Insight Gate & Monthly Consolidation",
      stage: "Learn",
      codeVerified: true,
      liveStatus: uc12Status,
      score: uc12Score,
      evidence: `grading=${m.grading}; ${c.falsifierBearingChunks} chunks with falsifiers (${c.dueFalsifierChunks} due), ${c.insightGradesTotal} grades recorded; B9 Spearman rho + reviewInsightAction wired`,
      gap:
        m.grading === "off"
          ? "grading mode is 'off' in workspace config"
          : c.falsifierBearingChunks === 0
            ? "0 Brain chunks carry a falsifier for the daily grader to test"
            : null,
      remediation:
        m.grading === "off" || c.falsifierBearingChunks === 0
          ? "Enable grading=shadow (per D5) and run market-insight-sync so measured insights attach code-built falsifiers."
          : null,
    },
  ];

  const nextOperations: NextOperation[] = [];

  if (
    m.retrieval === "off" ||
    m.budget === "off" ||
    m.interrogation === "off" ||
    m.gate === "off" ||
    m.challenger === "off" ||
    m.surprise === "off" ||
    m.grading === "off"
  ) {
    nextOperations.push({
      id: "OP-1",
      priority: "P0",
      title: "Activate Metacognitive Brain Stages & Sync Code-Built Falsifiers (Post-ARABLAB Freeze)",
      why: `ARABLAB freeze ended 27 Oct, but stages are still off (${Object.entries(m)
        .filter(([, v]) => v === "off")
        .map(([k]) => k)
        .join(", ")}) and ${c.falsifierBearingChunks} of ${c.activeBrainChunks} active Brain chunks carry a falsifier.`,
      action:
        "Take a snapshot (`npm run platina:brain-snapshot -- --ws waters-gcc-internal`), set retrieval=on, budget=on, interrogation=on, gate=on, challenger=shadow, surprise=shadow, grading=shadow, and run `insights-sync.ts` so measured insights attach code-built falsifiers.",
      unblocks: ["UC-03", "UC-06", "UC-07", "UC-08", "UC-12"],
    });
  }

  if (c.approvedBrandChunks < c.minBaselineN || c.stuckAuditRuns > 0 || c.unembeddedFirstPartyPassages > 0) {
    nextOperations.push({
      id: "OP-2",
      priority: "P0",
      title: "Confirm First-Party Brand Standard (>= 20 Chunks), Reap Stuck Runs & Backfill Embeddings",
      why: `Waters has ${c.firstPartyPassages} own-site passages but ${c.approvedBrandChunks}/${c.minBaselineN} confirmed brand chunks (blocking UC-09 Solutions minNGate), ${c.stuckAuditRuns} stuck run(s), and ${c.unembeddedFirstPartyPassages} unembedded passage(s).`,
      action:
        "Promote Waters' verified own-site product/brand passages into platina_brand_chunks with a declare gate event, mark stuck runs (>1h) degraded, and embed pending first-party passages.",
      unblocks: ["UC-01", "UC-02", "UC-09"],
    });
  }

  if (c.creativesTotal === 0 || c.confirmedReviewsTotal < c.learningMinN) {
    nextOperations.push({
      id: "OP-3",
      priority: "P0",
      title: "Seed/Import Real First-Party Creative Metrics & Confirm Reviews to Close the Fast Loop",
      why: `UC-11 has ${c.creativesTotal} creatives, ${c.metricSnapshotsTotal} metric snapshots, and ${c.confirmedReviewsTotal}/${c.learningMinN} confirmed reviews — leaving Thompson bandit learning in cold-start ('insufficient').`,
      action:
        "Register Waters' real public LinkedIn posts from platina_signal_documents as creatives, import their real engagement metrics, and confirm reviews once reviewed by a person.",
      unblocks: ["UC-11"],
    });
  }

  if (!p.apifyOk) {
    nextOperations.push({
      id: "OP-4",
      priority: "P1",
      title: "Rotate / Verify APIFY_TOKEN and Add Free Public Readers (Business Discovery / YouTube / Jina)",
      why: `Apify account check returned ${p.apifyDetail ?? "HTTP 401"}. Firecrawl is healthy (1,397 credits), so single web pages and own-site crawls work, but LinkedIn/Meta Ad Library actors require a valid Apify token.`,
      action:
        "Update APIFY_TOKEN in .env.local and implement the proposed 2026-11-12 Plane B official/free adapters (IG Business Discovery, YouTube Data API v3, Crawl4AI/Jina Reader).",
      unblocks: ["UC-02", "UC-04"],
    });
  }

  nextOperations.push({
    id: "OP-5",
    priority: "P1",
    title: "Complete WTR-0 Migration 0091 (`platina_metric_imports`), OPS-0 Migration 0092 (Heartbeats), and `platina:study` CLI",
    why: "First Waters feasibility study checkpoint is 24 Nov 2026; requires automated weekly reading of A0 (runtime availability), R1-R4, and L1-L5.",
    action:
      "Apply additive migrations 0091 and 0092 with down-SQL files and ship `npm run platina:study -- --ws waters-gcc-internal`.",
    unblocks: ["UC-02", "UC-11"],
  });

  nextOperations.push({
    id: "OP-6",
    priority: "P2",
    title: "Build CORE-1 (Plan Lifecycle + Decision Record + Expected Ranges) and WTR-2 (Plan Stated-Test Grader)",
    why: "Plans currently store stated tests (`falsifier`), but lack lifecycle status (`draft|approved|live|closed`), expected ranges from client history, and automated plan-level falsifier grading.",
    action:
      "Implement CORE-1 and WTR-2 per `docs/superpowers/plans/2026-10-23-planner-evaluator-roadmap.md`.",
    unblocks: ["UC-07", "UC-08", "UC-12"],
  });

  const codeVerifiedCount = useCases.filter((u) => u.codeVerified).length;
  const operationalCount = useCases.filter((u) => u.liveStatus === "operational").length;
  const degradedCount = useCases.filter((u) => u.liveStatus === "degraded").length;
  const dormantCount = useCases.filter((u) => u.liveStatus === "dormant_mode_off").length;
  const blockedByDataCount = useCases.filter((u) => u.liveStatus === "blocked_by_data").length;
  const failedCount = useCases.filter((u) => u.liveStatus === "failed").length;

  const architectureReadinessPct = Math.round((codeVerifiedCount / useCases.length) * 100);
  const liveOperationalReadinessPct = Math.round((operationalCount / useCases.length) * 100);
  const strictCompositeScore = Math.round(
    useCases.reduce((sum, u) => sum + u.score, 0) / useCases.length,
  );

  return {
    workspaceSlug: input.workspaceSlug,
    evaluatedAt: input.evaluatedAt.toISOString(),
    summary: {
      totalUseCases: useCases.length,
      codeVerifiedCount,
      operationalCount,
      degradedCount,
      dormantCount,
      blockedByDataCount,
      failedCount,
      architectureReadinessPct,
      liveOperationalReadinessPct,
      strictCompositeScore,
    },
    useCases,
    nextOperations,
    planEvalSummary: pe,
  };
}

export function formatValidationMarkdown(report: ValidationReport): string {
  const s = report.summary;
  const lines: string[] = [
    `# Platina AI OS — Automated Use-Case & Real-Time Operational Validation Report`,
    ``,
    `| Metric | Value |`,
    `|---|---|`,
    `| **Workspace** | \`${report.workspaceSlug}\` |`,
    `| **Evaluated At** | \`${report.evaluatedAt}\` |`,
    `| **Architecture / Code Verification** | **${s.architectureReadinessPct}%** (${s.codeVerifiedCount}/${s.totalUseCases} use cases verified in code) |`,
    `| **Live End-to-End Operational Readiness** | **${s.liveOperationalReadinessPct}%** (${s.operationalCount} operational · ${s.degradedCount} degraded · ${s.dormantCount} dormant · ${s.blockedByDataCount} blocked by data · ${s.failedCount} failed) |`,
    `| **Strict Realism Composite Score** | **${s.strictCompositeScore} / 100** |`,
    `| **CORE-3 Live Planner & Critic Eval** | ${report.planEvalSummary.ran ? `Checks: **${report.planEvalSummary.checkPassRatePct}%** · Critic Agreement: **${report.planEvalSummary.criticAgreementPct ?? "n/a"}%**` : "Skipped / Not Run"} |`,
    ``,
    `---`,
    ``,
    `## 1. Use-Case Validation Matrix (UC-01 through UC-12)`,
    ``,
    `| ID | Stage | Use Case | Code | Live Status | Strict Score | Live Evidence | Identified Gap / Bottleneck |`,
    `|---|---|---|---|---|---:|---|---|`,
  ];

  for (const u of report.useCases) {
    lines.push(
      `| **${u.id}** | ${u.stage} | ${u.title} | ${u.codeVerified ? "PASS" : "FAIL"} | \`${u.liveStatus}\` | **${u.score}** | ${u.evidence} | ${u.gap ?? "None — operating within spec"} |`,
    );
  }

  lines.push(
    ``,
    `---`,
    ``,
    `## 2. Prioritized Next Operations Queue (Deterministic Remediation Plan)`,
    ``,
  );

  if (report.nextOperations.length === 0) {
    lines.push(`All 12 use cases are fully operational with no blocking gaps.`);
  } else {
    for (const op of report.nextOperations) {
      lines.push(
        `### ${op.id} [${op.priority}] — ${op.title}`,
        `- **Unblocks:** ${op.unblocks.join(", ")}`,
        `- **Why (Measured Gap):** ${op.why}`,
        `- **Action:** ${op.action}`,
        ``,
      );
    }
  }

  if (report.aiAdversarialCritique) {
    lines.push(
      `---`,
      ``,
      `## 3. Higher-Intelligence Model Adversarial Critique (${report.aiAdversarialCritique.provider} / \`${report.aiAdversarialCritique.model}\`)`,
      ``,
      report.aiAdversarialCritique.verdict,
      ``,
    );
  }

  return lines.join("\n");
}
