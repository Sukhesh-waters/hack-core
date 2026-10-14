/**
 * Platina AI OS schema — parallel to InstaMedia.
 * All tables prefixed platina_. Isolation is workspace_id on every table.
 * Plane B (signal documents) has NO embedding column by construction.
 */
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users, workspaces } from "./schema";
// B0 (metacognitive Brain): type-only import — brain-modes.ts is a pure,
// DB-free module, so this cannot become a circular import.
import type { BrainModes } from "@/lib/platina/brain-modes";
// B1: type-only import — falsifier-metrics.ts is pure/DB-free (same reasoning).
import type { FalsifierClaim } from "@/lib/platina/falsifier-metrics";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const workspaceFk = () =>
  text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" });

export const platinaAgreementState = pgEnum("platina_agreement_state", [
  "agreed",
  "qualified",
  "contested",
  "refuted",
]);

export const platinaGateNumber = pgEnum("platina_gate_number", [
  "declare",
  "confirm",
  "approve",
  "publish",
]);

export const platinaGateDecision = pgEnum("platina_gate_decision", [
  "approved",
  "rejected",
]);

export const platinaScanStatus = pgEnum("platina_scan_status", [
  "draft",
  "approved",
  "running",
  "done",
  "failed",
]);

export const platinaReceiptOutcome = pgEnum("platina_receipt_outcome", [
  "pending",
  "worked",
  "did_not_work",
  "inconclusive",
]);

export const platinaCampaignStatus = pgEnum("platina_campaign_status", [
  "draft",
  "planned",
  "active",
  "closed",
]);

export const platinaAlertSeverity = pgEnum("platina_alert_severity", [
  "info",
  "warning",
  "critical",
]);

export const platinaBrainStatus = pgEnum("platina_brain_status", [
  "active",
  "demoted",
  // A measured market insight replaced by a newer measurement (C5): kept for
  // history, excluded from retrieval like a demoted chunk.
  "superseded",
  // Retired by the monthly consolidation (C8.5): past its window, unused and
  // low in trust. Excluded from retrieval; restorable from the Learning page.
  "archived",
]);

export const platinaRunTrigger = pgEnum("platina_run_trigger", [
  "manual",
  "schedule",
  "event",
]);

export const platinaRunStatus = pgEnum("platina_run_status", [
  "queued",
  "running",
  "validating",
  "completed",
  "degraded",
  "failed",
]);

export const platinaFindingStatus = pgEnum("platina_finding_status", [
  "new",
  "needs_decision",
  "validated",
  "refuted",
  "dismissed",
  "superseded",
]);

export const platinaTaskStatus = pgEnum("platina_task_status", [
  "todo",
  "in_progress",
  "blocked",
  "review",
  "done",
]);

export const platinaEventPhase = pgEnum("platina_event_phase", [
  "pre",
  "at",
  "post",
]);

export const platinaBrandSourceStatus = pgEnum("platina_brand_source_status", [
  "draft",
  "approved",
]);

export const platinaClaimsRuleKind = pgEnum("platina_claims_rule_kind", [
  "banned_term",
  "regulated_claim",
]);

/** The router's current embedding model — bump only with an explicit
 *  re-embed backfill (R4.1). Mixed versions in one index are meaningless. */
export const PLATINA_EMBEDDING_MODEL_VERSION = "gemini-embedding-001";

export type PlatinaScanTarget = {
  kind:
    | "competitor_site"
    | "press_release"
    | "conference"
    | "trade_editorial"
    | "ad_library"
    | "social_profile"
    | "social_posts";
  /** URL, or "<platform>:@handle" for social kinds (e.g. "instagram:@acme"). */
  value: string;
  // "web" (own-code adapter) is deliberately not a selectable value until the
  // constitution is updated; the runtime registry rejects it too.
  adapter?: "apify";
  /** Pages/posts to collect per run. Default 1, hard ceiling MAX_PAGES_CEILING. */
  maxPages?: number;
  /** Render JavaScript (playwright, ~5-10x cost). Opt-in per source. */
  renderJs?: boolean;
  /** Seed the crawl from the site sitemap instead of one start URL. */
  seedFromSitemap?: boolean;
  /**
   * The pages the site picker chose last time (jsonb — no migration), reused
   * for PICKED_PAGES_TTL_DAYS so a re-collection does not pay to map the site
   * again. Written by the audit run, never by a person.
   */
  pickedPages?: string[];
  /** ISO time `pickedPages` was chosen. */
  pickedAt?: string;
  /**
   * One-time wider collection for a social posts source (C5 backfill): the
   * next run reaches back `lookback` for up to `posts` posts, under the
   * normal page budgets. Cleared by the audit run once it has collected.
   */
  backfill?: { lookback: "3months" | "6months" | "year"; posts: number };
};

/** Per-platform engagement numbers. An absent key means "not measured" — never 0. */
export type PlatinaSignalMetrics = {
  likes?: number;
  comments?: number;
  views?: number;
  shares?: number;
  followers?: number;
  /** ISO timestamp the post was published. */
  postedAt?: string;
};

export type PlatinaFindingEvidence = {
  brandChunkIds: string[];
  brainChunkIds: string[];
};

/**
 * What we understand about a client from its own public pages (first-party,
 * derived). Context for planning — never evidence to cite.
 */
export type ClientProfile = {
  summary: string;
  offers: string[];
  audience: string;
  tone: string;
  keywords: string[];
  /** Notable claims the client makes about itself. */
  claims: string[];
};

export type PlatinaBrandHandles = {
  instagram?: string;
  tiktok?: string;
  linkedin?: string;
  youtube?: string;
};

export type PlatinaPromptTemplates = {
  proposer?: string;
  challenger?: string;
  ideation?: string;
};

export type PlatinaAnalysisStep =
  | "competitor_scan"
  | "brand_divergence"
  | "ideation"
  | "claims_screen";

export type PlatinaAlertCondition = {
  field: string;
  op: "gt" | "lt" | "eq" | "gte" | "lte";
  value: number | string;
};

export type PlatinaAlertAction = {
  kind: "hub_message" | "ticket" | "email";
  body?: string;
};

// ---------------------------------------------------------------------------
// Plane A — declared + first-party (embedded, citable as evidence)
// ---------------------------------------------------------------------------

export const platinaBrandChunks = pgTable(
  "platina_brand_chunks",
  {
    id: id(),
    workspaceId: workspaceFk(),
    // The client this standard describes. Nullable: workspace-wide brand text
    // predates clients and keeps working (R3).
    brandId: text("brand_id"),
    sourceUrl: text("source_url"),
    title: text("title"),
    content: text("content").notNull(),
    chunkIndex: integer("chunk_index").notNull().default(0),
    embedding: vector("embedding", { dimensions: 768 }),
    embeddingModelVersion: text("embedding_model_version")
      .notNull()
      .default(PLATINA_EMBEDDING_MODEL_VERSION),
    // A re-fetched brand source supersedes its old chunks; retrieval and
    // display filter on this being null.
    supersededAt: timestamp("superseded_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_brand_chunks_workspace_id_idx").on(
      table.workspaceId,
    ),
    brandIdx: index("platina_brand_chunks_brand_idx").on(
      table.workspaceId,
      table.brandId,
    ),
  }),
);

export const platinaOutcomes = pgTable(
  "platina_outcomes",
  {
    id: id(),
    workspaceId: workspaceFk(),
    campaignId: text("campaign_id"),
    receiptId: text("receipt_id"),
    leads: integer("leads").notNull().default(0),
    qualifiedLeads: integer("qualified_leads").notNull().default(0),
    conversionRate: real("conversion_rate"),
    pipelineContribution: real("pipeline_contribution"),
    qualityScore: real("quality_score"),
    // Synthetic rows are demo data, never evidence (A4): excluded from
    // write-back, min-N baselines, and retrieval by construction.
    synthetic: boolean("synthetic").notNull().default(false),
    source: text("source"),
    recordedAt: timestamp("recorded_at", { mode: "date" }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_outcomes_workspace_id_idx").on(
      table.workspaceId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Plane B — raw market signal. NO embedding column. Not citable.
// ---------------------------------------------------------------------------

export const platinaSignalDocuments = pgTable(
  "platina_signal_documents",
  {
    id: id(),
    workspaceId: workspaceFk(),
    scanSpecId: text("scan_spec_id"),
    sourceUrl: text("source_url").notNull(),
    canonicalUrl: text("canonical_url"),
    sourceKind: text("source_kind"),
    contentHash: text("content_hash"),
    processingState: text("processing_state").notNull().default("unprocessed"),
    // Why analysis passed this document over (low-value page, no new move).
    // A skipped document is never deleted and never silent.
    skipReason: text("skip_reason"),
    // B0 (metacognitive Brain): the same skip, machine-readable, so a replay
    // (plan §11.3) can select "surprise" or "untestable" skips by cause
    // without parsing the human skip_reason text.
    skipCause: text("skip_cause").$type<BrainSkipCause>(),
    // When an analysis worker claimed this document. A claim older than the
    // stale window (worker died / job runner restarted) is reclaimable.
    processingStartedAt: timestamp("processing_started_at", { mode: "date" }),
    title: text("title"),
    body: text("body").notNull(),
    fetchedAt: timestamp("fetched_at", { mode: "date" }).notNull().defaultNow(),
    adapter: text("adapter").notNull().default("apify"),
    raw: jsonb("raw"),
    // Engagement numbers for social documents. Plane B: still never embedded.
    metrics: jsonb("metrics").$type<PlatinaSignalMetrics>(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_signal_documents_workspace_id_idx").on(
      table.workspaceId,
    ),
    // Dedupe is physical: unchanged content cannot insert twice for a spec.
    specHashUnique: uniqueIndex(
      "platina_signal_documents_spec_hash_unique",
    ).on(table.scanSpecId, table.contentHash),
    // "What did this page look like last time?" — the previous-version lookup
    // that turns a changed page into a finding about the change (R1).
    canonicalHistoryIdx: index(
      "platina_signal_documents_ws_canonical_fetched_idx",
    ).on(table.workspaceId, table.canonicalUrl, table.fetchedAt),
  }),
);

// ---------------------------------------------------------------------------
// Debate transcripts — stored unembedded, linked by ID
// ---------------------------------------------------------------------------

export const platinaDebateTranscripts = pgTable(
  "platina_debate_transcripts",
  {
    id: id(),
    workspaceId: workspaceFk(),
    signalIds: jsonb("signal_ids").$type<string[]>().notNull().default([]),
    proposerClaim: text("proposer_claim").notNull(),
    challengerAttack: text("challenger_attack").notNull(),
    score: real("score").notNull(),
    state: platinaAgreementState("state").notNull(),
    strongestObjection: text("strongest_objection"),
    humanRuling: text("human_ruling"),
    // B0 (metacognitive Brain): provenance for the agreement-by-model metric
    // and the blind-challenger A/B (B2). Nullable: every transcript written
    // before this slice has none of these, and that is "not measured", not 0.
    proposerProvider: text("proposer_provider"),
    proposerModel: text("proposer_model"),
    challengerProvider: text("challenger_provider"),
    challengerModel: text("challenger_model"),
    promptVersion: text("prompt_version"),
    blinded: boolean("blinded"),
    objected: boolean("objected"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_debate_transcripts_workspace_id_idx").on(
      table.workspaceId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Brain telemetry + undo journal (B0 — metacognitive Brain). Both
// append-only: no update/delete query is exported for either.
// ---------------------------------------------------------------------------

/** Stage "analysis"'s skip causes, machine-readable next to the human `skip_reason`. */
export type BrainSkipCause =
  | "low_value"
  | "own_brand"
  | "nothing_new"
  | "surprise"
  | "untestable"
  | "gate";

/**
 * B1 (metacognitive Brain) — what kind of insight a Brain chunk is.
 * `null` (the column's default for every pre-B1 row) means "legacy": written
 * before this slice, by code that never declared a kind. `claim` and `fact`
 * come from the interrogation schema (src/lib/platina/interrogation.ts);
 * `measured` is a code-built insight (market-insight-writer.ts);
 * `compacted` is reserved for monthly consolidation (not written by B1).
 */
export type BrainChunkKind = "claim" | "measured" | "fact" | "compacted";

/** The claim's own asserted direction (not the falsifier's trigger direction — see interrogation.ts chunkDirectionFor). `none` for facts and legacy rows. */
export type BrainChunkDirection = "up" | "down" | "none";

/**
 * Where a Brain chunk's falsifier stands: `untested` (default — window not
 * elapsed, or no falsifier at all, e.g. a fact), `holding` (tested, effect
 * weak), `promoted` (tested, held up), `refuted` (tested, triggered) or
 * `insufficient` (B1: the interrogation itself failed validation — see
 * analysis-writes.ts). Only B5's grader ever moves a row out of `untested`.
 */
export type BrainChunkGradeState = "untested" | "holding" | "promoted" | "refuted" | "insufficient";

/**
 * One funnel event per stage decision: "this document/claim/chunk stopped
 * (or passed) here, for this reason." Read by `brainFunnelCountsQuery` into
 * the Brain quality card (plan §8). Kept 120 days; the monthly consolidation
 * job prunes it via `pruneBrainTelemetryQuery`.
 */
export const platinaBrainTelemetry = pgTable(
  "platina_brain_telemetry",
  {
    id: id(),
    workspaceId: workspaceFk(),
    stage: text("stage").notNull(),
    decision: text("decision").notNull(),
    subjectId: text("subject_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    promptVersion: text("prompt_version"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_brain_telemetry_workspace_id_idx").on(
      table.workspaceId,
    ),
    stageIdx: index("platina_brain_telemetry_ws_stage_created_idx").on(
      table.workspaceId,
      table.stage,
      table.createdAt,
    ),
  }),
);

/**
 * The undo journal (plan §11.2): every status/confidence/agreement_state
 * change a new stage makes to a Brain chunk, written in the same
 * transaction as the change itself by `setBrainState()` — the only writer.
 * Kept forever: it is small, and it is the audit trail.
 */
export const platinaBrainStateLog = pgTable(
  "platina_brain_state_log",
  {
    id: id(),
    workspaceId: workspaceFk(),
    brainChunkId: text("brain_chunk_id").notNull(),
    field: text("field").notNull(),
    fromValue: jsonb("from_value"),
    toValue: jsonb("to_value"),
    // The stage + prompt_version or script name that made the change, e.g.
    // "grading", "undo:<run id>", "scripts/platina-brain-undo.ts".
    cause: text("cause").notNull(),
    gradeId: text("grade_id"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_brain_state_log_workspace_id_idx").on(
      table.workspaceId,
    ),
    chunkIdx: index("platina_brain_state_log_ws_chunk_idx").on(
      table.workspaceId,
      table.brainChunkId,
    ),
    causeIdx: index("platina_brain_state_log_ws_cause_created_idx").on(
      table.workspaceId,
      table.cause,
      table.createdAt,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Plane C — Brain, derived (embedded, citable as hypothesis only)
// ---------------------------------------------------------------------------

export const platinaBrainChunks = pgTable(
  "platina_brain_chunks",
  {
    id: id(),
    workspaceId: workspaceFk(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 768 }),
    embeddingModelVersion: text("embedding_model_version")
      .notNull()
      .default(PLATINA_EMBEDDING_MODEL_VERSION),
    confidence: real("confidence").notNull(),
    agreementState: platinaAgreementState("agreement_state").notNull(),
    sourceSignalIds: jsonb("source_signal_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    absorbedChunkIds: jsonb("absorbed_chunk_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    generation: integer("generation").notNull().default(0),
    transcriptId: text("transcript_id"),
    // R5.3 refutation memory: a measured outcome that contradicted this
    // hypothesis. The record is retained, floored, and excluded from
    // retrieval — never deleted.
    demotedByReceiptId: text("demoted_by_receipt_id"),
    lastRetrievedAt: timestamp("last_retrieved_at", { mode: "date" }),
    status: platinaBrainStatus("status").notNull().default("active"),
    /**
     * Set on measured market insights (interest, pressure, events — C5):
     * "interest:<clientId>:<topic>", "event:<eventKey>". One ACTIVE chunk per
     * key; a changed measurement supersedes the old one. Null for debate
     * claims.
     */
    insightKey: text("insight_key"),
    // B1 (metacognitive Brain) — all nullable/defaulted, so every row and
    // every caller written before this slice is untouched (plan §4, 0088).
    kind: text("kind").$type<BrainChunkKind>(),
    /** The "how" — why the claim follows from its evidence. Null for legacy rows. */
    mechanism: text("mechanism"),
    /** Validated `why` ids, e.g. "sig:<docId>#e3". Null for legacy rows. */
    evidenceRefs: jsonb("evidence_refs").$type<string[]>(),
    /** Required for kind=claim; null for fact/measured-without-a-fitting-metric/legacy. */
    falsifier: jsonb("falsifier").$type<FalsifierClaim>(),
    /** e.g. "brand:<name>|topic:pfas analysis" — falsifierMetrics.subjectKeyFor(). */
    subjectKey: text("subject_key"),
    direction: text("direction").$type<BrainChunkDirection>(),
    gradeState: text("grade_state").$type<BrainChunkGradeState>().notNull().default("untested"),
    /** created + the falsifier's window_days. Null when there is no falsifier to test. */
    dueAt: timestamp("due_at", { mode: "date" }),
    /** The prompt version that produced this chunk, e.g. "analysis-v2". Null for legacy. */
    promptVersion: text("prompt_version"),
    /** e.g. "interrogation-v1", "insight-writer-v2". Null for legacy — the marker B0's §11.2 archive-by-writer tooling keys on. */
    writtenBy: text("written_by"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_brain_chunks_workspace_id_idx").on(
      table.workspaceId,
    ),
    insightKeyIdx: index("platina_brain_chunks_ws_insight_key_idx").on(
      table.workspaceId,
      table.insightKey,
    ),
    // B1: the daily grader's read path (plan §4, §12 "indexes for every new read path").
    gradeStateIdx: index("platina_brain_chunks_ws_grade_state_due_idx").on(
      table.workspaceId,
      table.gradeState,
      table.dueAt,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Gates — append-only. No update/delete query is exported.
// ---------------------------------------------------------------------------

export const platinaGateEvents = pgTable(
  "platina_gate_events",
  {
    id: id(),
    workspaceId: workspaceFk(),
    gate: platinaGateNumber("gate").notNull(),
    decision: platinaGateDecision("decision").notNull(),
    approverId: text("approver_id")
      .notNull()
      .references(() => users.id),
    payloadHash: text("payload_hash").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_gate_events_workspace_id_idx").on(
      table.workspaceId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Scan specs — many per workspace (unlike harness_rules)
// ---------------------------------------------------------------------------

export const platinaScanSpecs = pgTable(
  "platina_scan_specs",
  {
    id: id(),
    workspaceId: workspaceFk(),
    name: text("name").notNull(),
    targets: jsonb("targets").$type<PlatinaScanTarget[]>().notNull().default([]),
    cadenceMinutes: integer("cadence_minutes").notNull().default(5),
    enabled: boolean("enabled").notNull().default(true),
    status: platinaScanStatus("status").notNull().default("draft"),
    lastRunAt: timestamp("last_run_at", { mode: "date" }),
    lastSuccessAt: timestamp("last_success_at", { mode: "date" }),
    lastFailureAt: timestamp("last_failure_at", { mode: "date" }),
    lastProbeAt: timestamp("last_probe_at", { mode: "date" }),
    probeEtag: text("probe_etag"),
    probeLastModified: text("probe_last_modified"),
    consecutiveUnchanged: integer("consecutive_unchanged").notNull().default(0),
    currentIntervalMinutes: integer("current_interval_minutes"),
    fetchesDay: text("fetches_day"),
    // Pages returned today (not runs), so a 25-page crawl counts as 25.
    fetchesToday: integer("fetches_today").notNull().default(0),
    // Nullable by design: specs created before brands existed keep working.
    brandId: text("brand_id"),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_scan_specs_workspace_id_idx").on(
      table.workspaceId,
    ),
    brandIdx: index("platina_scan_specs_brand_id_idx").on(table.brandId),
  }),
);

// ---------------------------------------------------------------------------
// Receipts — Gate 3 decision + slow-loop grading
// ---------------------------------------------------------------------------

export const platinaReceipts = pgTable(
  "platina_receipts",
  {
    id: id(),
    workspaceId: workspaceFk(),
    title: text("title").notNull(),
    hypothesis: text("hypothesis").notNull(),
    expectedOutcome: text("expected_outcome").notNull(),
    evidenceBrandIds: jsonb("evidence_brand_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    evidenceBrainIds: jsonb("evidence_brain_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    reviewAt: timestamp("review_at", { mode: "date" }).notNull(),
    // Recommendation-contract carriers (Slice 3.5): the decision record holds
    // what the operator approved, not just that they approved.
    findingId: text("finding_id"),
    severity: text("severity"),
    urgency: text("urgency"),
    strongestUncertainty: text("strongest_uncertainty"),
    measurementMethod: text("measurement_method"),
    outcome: platinaReceiptOutcome("outcome").notNull().default("pending"),
    outcomeNote: text("outcome_note"),
    reviewSurfacedAt: timestamp("review_surfaced_at", { mode: "date" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_receipts_workspace_id_idx").on(
      table.workspaceId,
    ),
    reviewIdx: index("platina_receipts_review_at_idx").on(table.reviewAt),
  }),
);

// ---------------------------------------------------------------------------
// Campaigns — event-anchored plans
// ---------------------------------------------------------------------------

export const platinaCampaigns = pgTable(
  "platina_campaigns",
  {
    id: id(),
    workspaceId: workspaceFk(),
    receiptId: text("receipt_id"),
    title: text("title").notNull(),
    durationDays: integer("duration_days"),
    geography: text("geography"),
    budget: real("budget"),
    channelMix: jsonb("channel_mix").$type<string[]>().notNull().default([]),
    eventAnchor: timestamp("event_anchor", { mode: "date" }),
    eventLabel: text("event_label"),
    audience: text("audience"),
    contentPlan: text("content_plan"),
    // One of the five Waters use cases; set at direction approval (Slice 5).
    useCase: text("use_case"),
    sopRunId: text("sop_run_id"),
    status: platinaCampaignStatus("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_campaigns_workspace_id_idx").on(
      table.workspaceId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Workspace config — externalized thresholds, prompts, sequence
// ---------------------------------------------------------------------------

export const platinaWorkspaceConfig = pgTable(
  "platina_workspace_config",
  {
    id: id(),
    workspaceId: workspaceFk(),
    minBaselineN: integer("min_baseline_n").notNull().default(20),
    contestedFloor: real("contested_floor").notNull().default(0.4),
    qualifiedFloor: real("qualified_floor").notNull().default(0.7),
    // R4.2 — below this fused similarity, retrieval answers
    // "insufficient_relevance" instead of ranking noise. Slice 10 exposes it.
    similarityFloor: real("similarity_floor").notNull().default(0.35),
    // Workspace-wide spend control: pages collected per UTC day across all sources.
    dailyActorCallCap: integer("daily_actor_call_cap").notNull().default(40),
    // One-time pages per client, spent before the daily cap applies (R7).
    firstPassPageAllowance: integer("first_pass_page_allowance")
      .notNull()
      .default(150),
    // C6: own-site pages read per UTC day, and the total kept per client.
    ownSiteDailyPages: integer("own_site_daily_pages").notNull().default(50),
    ownSiteMaxPages: integer("own_site_max_pages").notNull().default(300),
    // C6 learning loop: results per feature value before it moves a ranking,
    // share of suggestions kept for trying something new, days of numbers
    // before a review opens, and how fast old results fade.
    learningMinN: integer("learning_min_n").notNull().default(5),
    learningExploreShare: real("learning_explore_share").notNull().default(0.2),
    reviewAfterDays: integer("review_after_days").notNull().default(7),
    learningHalfLifeDays: integer("learning_half_life_days").notNull().default(90),
    compactionStaleDays: integer("compaction_stale_days").notNull().default(90),
    compactionNearDupes: integer("compaction_near_dupes").notNull().default(3),
    compactionCosine: real("compaction_cosine").notNull().default(0.92),
    analysisSequence: jsonb("analysis_sequence")
      .$type<PlatinaAnalysisStep[]>()
      .notNull()
      .default(["competitor_scan", "brand_divergence", "ideation"]),
    promptTemplates: jsonb("prompt_templates")
      .$type<PlatinaPromptTemplates>()
      .notNull()
      .default({}),
    promptVersion: integer("prompt_version").notNull().default(1),
    // B0 (metacognitive Brain): per-stage mode map (off|shadow|on; a missing
    // key reads as off — see src/lib/platina/brain-modes.ts).
    brainModes: jsonb("brain_modes").$type<BrainModes>().notNull().default({}),
    // B0: surprise filter floor (standard deviations) and audit sample share
    // (B4), and the Brain's share of the retrieval evidence budget (B6/B7).
    surpriseFloor: real("surprise_floor").notNull().default(1.0),
    surpriseAuditShare: real("surprise_audit_share").notNull().default(0.1),
    derivedContextShare: real("derived_context_share").notNull().default(0.4),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceUnique: uniqueIndex("platina_workspace_config_workspace_unique").on(
      table.workspaceId,
    ),
    workspaceIdx: index("platina_workspace_config_workspace_id_idx").on(
      table.workspaceId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Alert rules — condition → severity → actions
// ---------------------------------------------------------------------------

export const platinaAlertRules = pgTable(
  "platina_alert_rules",
  {
    id: id(),
    workspaceId: workspaceFk(),
    name: text("name").notNull(),
    // What the rule evaluates: latest outcome metrics, open findings awaiting
    // a decision, pending approvals, or failed runs in the last 24 h.
    source: text("source").notNull().default("outcome"),
    conditions: jsonb("conditions")
      .$type<PlatinaAlertCondition[]>()
      .notNull()
      .default([]),
    severity: platinaAlertSeverity("severity").notNull().default("warning"),
    actions: jsonb("actions").$type<PlatinaAlertAction[]>().notNull().default([]),
    enabled: boolean("enabled").notNull().default(true),
    lastRunAt: timestamp("last_run_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_alert_rules_workspace_id_idx").on(
      table.workspaceId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Workspace profile — one workspace = one division × region (W0.8 ADR).
// Metadata on the same workspace_id, never a second tenant key.
// ---------------------------------------------------------------------------

export const platinaWorkspaceProfiles = pgTable(
  "platina_workspace_profiles",
  {
    id: id(),
    workspaceId: workspaceFk(),
    division: text("division"),
    region: text("region"),
    businessUnit: text("business_unit"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceUnique: uniqueIndex(
      "platina_workspace_profiles_workspace_unique",
    ).on(table.workspaceId),
    workspaceIdx: index("platina_workspace_profiles_workspace_id_idx").on(
      table.workspaceId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Audit runs — durable run lifecycle + append-only timeline
// ---------------------------------------------------------------------------

export type PlatinaRunConfigSnapshot = {
  analysisSequence: PlatinaAnalysisStep[];
  promptVersion: number;
  minBaselineN: number;
  contestedFloor: number;
  qualifiedFloor: number;
  /**
   * C8.0 force run: pages an operator granted this one run beyond the
   * workspace daily cap (scripts/platina-force.ts). Absent on every other run.
   */
  seedPages?: number;
};

export const platinaAuditRuns = pgTable(
  "platina_audit_runs",
  {
    id: id(),
    workspaceId: workspaceFk(),
    specId: text("spec_id"),
    trigger: platinaRunTrigger("trigger").notNull().default("manual"),
    status: platinaRunStatus("status").notNull().default("queued"),
    idempotencyKey: text("idempotency_key").notNull(),
    configSnapshot: jsonb("config_snapshot")
      .$type<PlatinaRunConfigSnapshot>()
      .notNull(),
    counters: jsonb("counters")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    errorReason: text("error_reason"),
    degradedReason: text("degraded_reason"),
    queuedAt: timestamp("queued_at", { mode: "date" }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { mode: "date" }),
    finishedAt: timestamp("finished_at", { mode: "date" }),
  },
  (table) => ({
    workspaceIdx: index("platina_audit_runs_workspace_id_idx").on(
      table.workspaceId,
    ),
    specIdx: index("platina_audit_runs_spec_id_idx").on(table.specId),
    statusIdx: index("platina_audit_runs_status_idx").on(table.status),
    idempotencyUnique: uniqueIndex(
      "platina_audit_runs_workspace_idempotency_unique",
    ).on(table.workspaceId, table.idempotencyKey),
  }),
);

export const platinaAuditRunEvents = pgTable(
  "platina_audit_run_events",
  {
    id: id(),
    runId: text("run_id")
      .notNull()
      .references(() => platinaAuditRuns.id, { onDelete: "cascade" }),
    workspaceId: workspaceFk(),
    status: platinaRunStatus("status").notNull(),
    message: text("message"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_audit_run_events_workspace_id_idx").on(
      table.workspaceId,
    ),
    runIdx: index("platina_audit_run_events_run_id_idx").on(table.runId),
  }),
);

// ---------------------------------------------------------------------------
// Findings — user-facing, governed output of the contradiction layer.
// agreed → new (+ Brain chunk); contested → needs_decision (no Brain chunk);
// refuted → transcript only. Rulings are immutable and attributed.
// ---------------------------------------------------------------------------

export const platinaFindings = pgTable(
  "platina_findings",
  {
    id: id(),
    workspaceId: workspaceFk(),
    signalDocumentId: text("signal_document_id"),
    transcriptId: text("transcript_id"),
    brainChunkId: text("brain_chunk_id"),
    useCase: text("use_case").notNull().default("competitor_change"),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    strongestObjection: text("strongest_objection"),
    severity: text("severity").notNull().default("medium"),
    // Chunk ids behind a brand_divergence finding, kept as two separate lists.
    evidence: jsonb("evidence").$type<PlatinaFindingEvidence>(),
    status: platinaFindingStatus("status").notNull().default("new"),
    humanRuling: text("human_ruling"),
    ruledBy: text("ruled_by").references(() => users.id),
    ruledAt: timestamp("ruled_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_findings_workspace_id_idx").on(
      table.workspaceId,
    ),
    signalIdx: index("platina_findings_signal_document_id_idx").on(
      table.signalDocumentId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Solution tasks — the workspace-local work board (Slice 6)
// ---------------------------------------------------------------------------

export const platinaSolutionTasks = pgTable(
  "platina_solution_tasks",
  {
    id: id(),
    workspaceId: workspaceFk(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => platinaCampaigns.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: platinaTaskStatus("status").notNull().default("todo"),
    assigneeId: text("assignee_id").references(() => users.id),
    dueDate: timestamp("due_date", { mode: "date" }),
    eventPhase: platinaEventPhase("event_phase"),
    dependsOn: text("depends_on"),
    risk: text("risk"),
    claimsBlocked: boolean("claims_blocked").notNull().default(false),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_solution_tasks_workspace_id_idx").on(
      table.workspaceId,
    ),
    campaignIdx: index("platina_solution_tasks_campaign_id_idx").on(
      table.campaignId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Brand sources — declared, approved, freshness-tracked standard origins
// (Slice 8). URL sources fetch through the Waters adapter as consented
// first-party content (Plane A); pasted text needs no fetch.
// ---------------------------------------------------------------------------

export const platinaBrandSources = pgTable(
  "platina_brand_sources",
  {
    id: id(),
    workspaceId: workspaceFk(),
    url: text("url"),
    title: text("title").notNull(),
    status: platinaBrandSourceStatus("status").notNull().default("draft"),
    contentHash: text("content_hash"),
    lastFetchedAt: timestamp("last_fetched_at", { mode: "date" }),
    lastChangedAt: timestamp("last_changed_at", { mode: "date" }),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_brand_sources_workspace_id_idx").on(
      table.workspaceId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Claims rules — workspace-owned banned/regulated lists (Slice 8). An empty
// active set falls back to the documented defaults with honest copy.
// ---------------------------------------------------------------------------

export const platinaClaimsRules = pgTable(
  "platina_claims_rules",
  {
    id: id(),
    workspaceId: workspaceFk(),
    kind: platinaClaimsRuleKind("kind").notNull(),
    term: text("term").notNull(),
    note: text("note"),
    active: boolean("active").notNull().default(true),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_claims_rules_workspace_id_idx").on(
      table.workspaceId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Outcome imports — consented first-party results with provenance (Slice 9)
// ---------------------------------------------------------------------------

export const platinaOutcomeImports = pgTable(
  "platina_outcome_imports",
  {
    id: id(),
    workspaceId: workspaceFk(),
    source: text("source").notNull().default("csv-paste"),
    fileHash: text("file_hash").notNull(),
    status: text("status").notNull().default("completed"),
    rowCount: integer("row_count").notNull().default(0),
    insertedCount: integer("inserted_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    errors: jsonb("errors").$type<string[]>().notNull().default([]),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_outcome_imports_workspace_id_idx").on(
      table.workspaceId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Alert deliveries — every alert is sent, suppressed, or failed with a
// recorded reason (Slice 10). V1 routes in_app only.
// ---------------------------------------------------------------------------

export const platinaAlertDeliveries = pgTable(
  "platina_alert_deliveries",
  {
    id: id(),
    workspaceId: workspaceFk(),
    ruleId: text("rule_id")
      .notNull()
      .references(() => platinaAlertRules.id, { onDelete: "cascade" }),
    severity: platinaAlertSeverity("severity").notNull().default("warning"),
    route: text("route").notNull().default("in_app"),
    status: text("status").notNull().default("sent"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_alert_deliveries_workspace_id_idx").on(
      table.workspaceId,
    ),
    ruleIdx: index("platina_alert_deliveries_rule_id_idx").on(table.ruleId),
  }),
);

// ---------------------------------------------------------------------------
// Campaign planner (owner decision 2026-09-20): brief -> phased plan -> logged
// result -> lessons that shape the next plan. Plain SQL rows, no embeddings.
// ---------------------------------------------------------------------------

export type PlanPhase = {
  id: string;
  name: string;
  startDay: number;
  endDay: number;
  channel: string;
  message: string;
  /** Ids from PlanDoc.evidence this phase rests on — one plane only (two-layer rule). */
  evidenceIds?: string[];
};

/** A frozen copy of the evidence a plan saw, so the roadmap survives chunk demotion. */
export type PlanEvidenceSnapshot = {
  id: string;
  plane: "A" | "B";
  content: string;
  sourceUrl: string | null;
  collectedAt: string | null;
  confidence: number | null;
};

/** The situation that started a plan — shown on the roadmap so it is never anonymous. */
export type PlanOrigin = {
  kind: "brief" | "finding" | "event" | "client" | "revision";
  /** Finding id, parent plan id, or event name, depending on kind. */
  refId?: string;
  label: string;
  /** Days from today to a fixed date the plan must land on (events). */
  anchorDay?: number;
};

export type PlanDoc = {
  /** One sentence on what changed versus the plan this one revises. */
  revisionNote?: string;
  summary: string;
  totalDays: number;
  phases: PlanPhase[];
  /** True when no collected evidence and no logged results informed the plan. */
  coldStart?: boolean;
  /** Why the evidence list is what it is — lets the roadmap explain an ungrounded plan. */
  evidenceStatus?: "matched" | "none_relevant" | "empty_brain" | "no_client_evidence";
  evidence?: PlanEvidenceSnapshot[];
};

export const PLAN_VERDICTS = ["worked", "mixed", "failed"] as const;
export type PlanVerdict = (typeof PLAN_VERDICTS)[number];

export const platinaPlans = pgTable(
  "platina_plans",
  {
    id: id(),
    workspaceId: workspaceFk(),
    title: text("title").notNull(),
    brief: text("brief").notNull(),
    plan: jsonb("plan").$type<PlanDoc>().notNull(),
    // Independent Critic findings shown beside the roadmap; empty = passed.
    critique: jsonb("critique").$type<string[]>().notNull().default([]),
    // How many logged results informed this plan (0 = cold start).
    lessonsUsed: integer("lessons_used").notNull().default(0),
    // The client this plan is for (null = workspace-wide). Scopes the evidence
    // the planner sees to that client and its competitors.
    brandId: text("brand_id"),
    origin: jsonb("origin").$type<PlanOrigin>(),
    // The plan this one revises: a live re-plan when new evidence arrives.
    parentPlanId: text("parent_plan_id"),
    createdById: text("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_plans_workspace_id_idx").on(table.workspaceId),
    brandIdx: index("platina_plans_brand_id_idx").on(table.brandId),
    parentIdx: index("platina_plans_parent_plan_id_idx").on(table.parentPlanId),
  }),
);

// One verdict per plan (upserted): the latest thing you learned about it.
export const platinaPlanFeedback = pgTable(
  "platina_plan_feedback",
  {
    id: id(),
    workspaceId: workspaceFk(),
    planId: text("plan_id")
      .notNull()
      .references(() => platinaPlans.id, { onDelete: "cascade" }),
    verdict: text("verdict").$type<PlanVerdict>().notNull(),
    note: text("note"),
    createdById: text("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_plan_feedback_workspace_id_idx").on(
      table.workspaceId,
    ),
    planIdx: uniqueIndex("platina_plan_feedback_plan_id_idx").on(table.planId),
  }),
);

// ---------------------------------------------------------------------------
// Brands — the client/project entity the whole spine hangs off (core spine S1).
// "own_brand" is shown as a Client in the UI; competitors point at their
// own_brand via parent_brand_id (plain text, not a self-FK: a self-referencing
// cascade on a table that also cascades from workspaces is a delete path
// nobody has reasoned about — the relationship is enforced in the query layer).
// ---------------------------------------------------------------------------

export const platinaBrandKind = pgEnum("platina_brand_kind", [
  "own_brand",
  "competitor",
]);

export const platinaBrandStatus = pgEnum("platina_brand_status", [
  "active",
  "paused",
]);

export const platinaBrands = pgTable(
  "platina_brands",
  {
    id: id(),
    workspaceId: workspaceFk(),
    name: text("name").notNull(),
    kind: platinaBrandKind("kind").notNull().default("own_brand"),
    parentBrandId: text("parent_brand_id"),
    homepageUrl: text("homepage_url"),
    handles: jsonb("handles").$type<PlatinaBrandHandles>().notNull().default({}),
    region: text("region"),
    notes: text("notes"),
    // Derived from the client's own scraped pages (own_brand only). The error
    // is kept so a failed analysis is visible, never silently empty.
    profile: jsonb("profile").$type<ClientProfile>(),
    profileSources: jsonb("profile_sources").$type<string[]>(),
    profileUpdatedAt: timestamp("profile_updated_at", { mode: "date" }),
    profileError: text("profile_error"),
    // Pages already spent from this client one-time first-pass allowance (R7).
    firstPassPagesUsed: integer("first_pass_pages_used").notNull().default(0),
    // C6: when the client's own site was last listed (map), and why it failed.
    ownSiteMappedAt: timestamp("own_site_mapped_at", { mode: "date" }),
    ownSiteError: text("own_site_error"),
    status: platinaBrandStatus("status").notNull().default("active"),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_brands_workspace_id_idx").on(table.workspaceId),
    parentIdx: index("platina_brands_parent_idx").on(table.parentBrandId),
    nameUnique: uniqueIndex("platina_brands_workspace_name_unique").on(
      table.workspaceId,
      sql`lower(${table.name})`,
    ),
  }),
);

export const platinaWorkspaceScopedTables = {
  platinaBrands,
  platinaPlans,
  platinaPlanFeedback,
  platinaBrandChunks,
  platinaOutcomes,
  platinaSignalDocuments,
  platinaDebateTranscripts,
  platinaBrainTelemetry,
  platinaBrainStateLog,
  platinaBrainChunks,
  platinaGateEvents,
  platinaScanSpecs,
  platinaReceipts,
  platinaCampaigns,
  platinaWorkspaceConfig,
  platinaAlertRules,
  platinaWorkspaceProfiles,
  platinaAuditRuns,
  platinaAuditRunEvents,
  platinaFindings,
  platinaSolutionTasks,
  platinaBrandSources,
  platinaClaimsRules,
  platinaOutcomeImports,
  platinaAlertDeliveries,
} as const;
// C6 tables are declared further down this file; they join the registry in
// platinaC6ScopedTables (a const can't reference a later declaration).

// ---------------------------------------------------------------------------
// Interest signals (campaign intelligence C3) — numbers, not prose. Plane B.
// ---------------------------------------------------------------------------

/**
 * One measured signal of audience interest (or competitor pressure) for a
 * topic: "Thermo Fisher's post about GLP-1 QC got 687 reactions on
 * 2026-09-03", "Agilent is running 12 LinkedIn ads about GC in AE". Every row
 * carries its proof URL. Momentum and ranking are computed from these rows by
 * pure functions (lib/platina/interest.ts) — a model maps text to a topic,
 * never produces a number. Public data only (Plane B): never embedded, never
 * mixed with the client's own results.
 */
export const platinaInterestSignals = pgTable(
  "platina_interest_signals",
  {
    id: id(),
    workspaceId: workspaceFk(),
    /** Whose signal: the client or one of its competitors. */
    brandId: text("brand_id"),
    /** The document it was read from, when there is one. */
    documentId: text("document_id"),
    /** A topic from the client's own topic list (profile offers/keywords). */
    topic: text("topic").notNull(),
    /** ISO country, or "global" when the source does not say. */
    region: text("region").notNull().default("global"),
    /** linkedin | meta_ads | linkedin_ads | search | web | event */
    channel: text("channel").notNull(),
    /**
     * engagement (reactions+comments+shares) | reactions | comments | shares |
     * active_ads | ad_days_running | search_interest
     */
    metric: text("metric").notNull(),
    /** "interest" (audience) or "pressure" (competitor spend/activity). */
    signalKind: text("signal_kind").notNull(),
    value: real("value").notNull(),
    /** When the thing measured happened (post date, trend point). */
    observedAt: timestamp("observed_at", { mode: "date" }).notNull(),
    collectedAt: timestamp("collected_at", { mode: "date" }).notNull().defaultNow(),
    sourceUrl: text("source_url").notNull(),
    detail: jsonb("detail"),
  },
  (table) => ({
    workspaceIdx: index("platina_interest_signals_workspace_id_idx").on(table.workspaceId),
    topicIdx: index("platina_interest_signals_ws_topic_observed_idx").on(
      table.workspaceId,
      table.topic,
      table.observedAt,
    ),
    // Re-reading the same post re-measures it: one row per source/metric/day.
    measurementUnique: uniqueIndex("platina_interest_signals_measurement_unique").on(
      table.workspaceId,
      table.sourceUrl,
      table.metric,
      table.topic,
      table.observedAt,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Events (campaign intelligence C4)
// ---------------------------------------------------------------------------

/**
 * Where the market gathers: conferences, trade fairs, workshops, webinars,
 * read from event pages and from companies' own posts. Dates are parsed from
 * words that are on the page (lib/platina/events.ts), never produced by a
 * model. Public data (Plane B): never embedded, never mixed with the
 * client's own results.
 */
export const platinaEvents = pgTable(
  "platina_events",
  {
    id: id(),
    workspaceId: workspaceFk(),
    /** "arablab-2026" — lib/platina/events.ts eventKey. */
    eventKey: text("event_key").notNull(),
    name: text("name").notNull(),
    /** in_person | online */
    format: text("format").notNull().default("in_person"),
    startsOn: date("starts_on", { mode: "string" }),
    endsOn: date("ends_on", { mode: "string" }),
    /** The words the dates were read from, as written on the source. */
    dateText: text("date_text"),
    location: text("location"),
    /** ISO country, when the location says. */
    country: text("country"),
    /** The page or post the event was read from — the proof. */
    sourceUrl: text("source_url").notNull(),
    documentId: text("document_id"),
    firstSeenAt: timestamp("first_seen_at", { mode: "date" }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { mode: "date" }).notNull().defaultNow(),
    detail: jsonb("detail"),
  },
  (table) => ({
    workspaceIdx: index("platina_events_workspace_id_idx").on(table.workspaceId),
    startsIdx: index("platina_events_ws_starts_idx").on(table.workspaceId, table.startsOn),
    keyUnique: uniqueIndex("platina_events_ws_key_unique").on(table.workspaceId, table.eventKey),
  }),
);

/**
 * "Is a competitor at this event?" — one row per proof: its name on the
 * exhibitor list, on the event page, or its own post announcing it.
 */
export const platinaEventParticipants = pgTable(
  "platina_event_participants",
  {
    id: id(),
    workspaceId: workspaceFk(),
    eventId: text("event_id")
      .notNull()
      .references(() => platinaEvents.id, { onDelete: "cascade" }),
    brandId: text("brand_id").notNull(),
    /** listed_exhibitor | mentioned_on_event_page | announced_in_post */
    evidence: text("evidence").notNull(),
    sourceUrl: text("source_url").notNull(),
    /** The page or post the proof was read from (scopes insights to a client). */
    documentId: text("document_id"),
    excerpt: text("excerpt"),
    observedAt: timestamp("observed_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_event_participants_workspace_id_idx").on(table.workspaceId),
    eventIdx: index("platina_event_participants_event_idx").on(table.eventId),
    proofUnique: uniqueIndex("platina_event_participants_proof_unique").on(
      table.workspaceId,
      table.eventId,
      table.brandId,
      table.sourceUrl,
    ),
  }),
);

// ---------------------------------------------------------------------------
// C6 — own website (Plane A) and the learning loop (owner decision 2026-09-22)
// ---------------------------------------------------------------------------

/** queued -> read | failed | skipped; "gone" = no longer in the site map. */
export const OWN_SITE_PAGE_STATUSES = ["queued", "read", "failed", "skipped", "gone"] as const;
export type OwnSitePageStatus = (typeof OWN_SITE_PAGE_STATUSES)[number];

/**
 * One page of a client's OWN website. Consented first-party (Plane A): read
 * through Firecrawl, chunked into platina_first_party_chunks. A header-only
 * probe (sitemap lastmod / ETag / Last-Modified) decides re-reads, so an
 * unchanged page never spends a credit.
 */
export const platinaOwnSitePages = pgTable(
  "platina_own_site_pages",
  {
    id: id(),
    workspaceId: workspaceFk(),
    brandId: text("brand_id").notNull(),
    url: text("url").notNull(),
    title: text("title"),
    /** Read order: higher first (products/applications before the rest). */
    priority: real("priority").notNull().default(0),
    status: text("status").$type<OwnSitePageStatus>().notNull().default("queued"),
    contentHash: text("content_hash"),
    /** Change-probe validators, stored as the server sent them. */
    sitemapLastmod: text("sitemap_lastmod"),
    etag: text("etag"),
    lastModified: text("last_modified"),
    /** Set by the probe when a validator moved; the reader picks these first. */
    changeDetectedAt: timestamp("change_detected_at", { mode: "date" }),
    chunkCount: integer("chunk_count").notNull().default(0),
    error: text("error"),
    lastReadAt: timestamp("last_read_at", { mode: "date" }),
    lastCheckedAt: timestamp("last_checked_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_own_site_pages_workspace_id_idx").on(table.workspaceId),
    pageUnique: uniqueIndex("platina_own_site_pages_unique").on(
      table.workspaceId,
      table.brandId,
      table.url,
    ),
  }),
);

export const FIRST_PARTY_CHUNK_KINDS = ["own_site", "lesson"] as const;
export type FirstPartyChunkKind = (typeof FIRST_PARTY_CHUNK_KINDS)[number];

/**
 * Plane A knowledge that is NOT the declared brand standard: the client's own
 * website pages and confirmed lessons from its own results. Embedded and
 * citable as first-party evidence. Kept apart from platina_brand_chunks on
 * purpose: a client's chunks there mean "confirmed standard" (R3/O3), and a
 * crawled page must never switch that on by itself.
 */
export const platinaFirstPartyChunks = pgTable(
  "platina_first_party_chunks",
  {
    id: id(),
    workspaceId: workspaceFk(),
    brandId: text("brand_id"),
    kind: text("kind").$type<FirstPartyChunkKind>().notNull(),
    /** Own-site page id or review id this chunk came from. */
    sourceRef: text("source_ref").notNull(),
    sourceUrl: text("source_url"),
    title: text("title"),
    content: text("content").notNull(),
    chunkIndex: integer("chunk_index").notNull().default(0),
    embedding: vector("embedding", { dimensions: 768 }),
    embeddingModelVersion: text("embedding_model_version")
      .notNull()
      .default(PLATINA_EMBEDDING_MODEL_VERSION),
    supersededAt: timestamp("superseded_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_first_party_chunks_workspace_id_idx").on(table.workspaceId),
    sourceIdx: index("platina_first_party_chunks_source_idx").on(
      table.workspaceId,
      table.sourceRef,
    ),
    brandIdx: index("platina_first_party_chunks_brand_idx").on(
      table.workspaceId,
      table.brandId,
      table.kind,
    ),
  }),
);

export const CREATIVE_STATUSES = ["draft", "live", "ended"] as const;
export type CreativeStatus = (typeof CREATIVE_STATUSES)[number];

/**
 * One posted piece of work, the unit the learning loop learns about. The
 * descriptors (channel, format, topic, hook type, posted time) are the
 * features results are credited to; the links (plan phase, opportunity) are
 * how a result is traced back to the evidence it rested on.
 */
export const platinaCreatives = pgTable(
  "platina_creatives",
  {
    id: id(),
    workspaceId: workspaceFk(),
    brandId: text("brand_id"),
    planId: text("plan_id").references(() => platinaPlans.id, { onDelete: "set null" }),
    phaseId: text("phase_id"),
    /** "topic:<name>" or "event:<name>": the opportunity it answered. */
    opportunityKey: text("opportunity_key"),
    title: text("title").notNull(),
    channel: text("channel").notNull(),
    format: text("format").notNull(),
    topic: text("topic"),
    hookType: text("hook_type"),
    cta: text("cta"),
    url: text("url"),
    /** Post id on the platform, for connected-account matching. */
    externalId: text("external_id"),
    /** What we expect and why, in one line. Required: a result is read against it. */
    hypothesis: text("hypothesis").notNull(),
    postedAt: timestamp("posted_at", { mode: "date" }),
    status: text("status").$type<CreativeStatus>().notNull().default("live"),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_creatives_workspace_id_idx").on(table.workspaceId),
    planIdx: index("platina_creatives_plan_idx").on(table.workspaceId, table.planId),
    brandIdx: index("platina_creatives_brand_idx").on(table.workspaceId, table.brandId),
  }),
);

/**
 * A snapshot of a creative's numbers at one moment. Snapshots accumulate and
 * are never overwritten, so growth over time is visible. A metric the source
 * did not give is null, never 0.
 */
export const platinaCreativeMetrics = pgTable(
  "platina_creative_metrics",
  {
    id: id(),
    workspaceId: workspaceFk(),
    creativeId: text("creative_id")
      .notNull()
      .references(() => platinaCreatives.id, { onDelete: "cascade" }),
    capturedAt: timestamp("captured_at", { mode: "date" }).notNull(),
    impressions: integer("impressions"),
    reach: integer("reach"),
    clicks: integer("clicks"),
    engagements: integer("engagements"),
    saves: integer("saves"),
    shares: integer("shares"),
    videoViews: integer("video_views"),
    leads: integer("leads"),
    spend: real("spend"),
    /** manual | csv | connector:<name> */
    source: text("source").notNull().default("manual"),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_creative_metrics_workspace_id_idx").on(table.workspaceId),
    creativeIdx: index("platina_creative_metrics_creative_idx").on(
      table.creativeId,
      table.capturedAt,
    ),
    snapshotUnique: uniqueIndex("platina_creative_metrics_snapshot_unique").on(
      table.workspaceId,
      table.creativeId,
      table.capturedAt,
      table.source,
    ),
  }),
);

export const REVIEW_VERDICTS = ["worked", "mixed", "failed"] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];
export const REVIEW_FACTORS = ["topic", "hook", "format", "timing", "audience", "channel"] as const;
export type ReviewFactor = (typeof REVIEW_FACTORS)[number];
export type ReviewEffect = "helped" | "hurt" | "neutral";

/** Numbers the code computed for a review. The model never writes these. */
export type ReviewFacts = {
  snapshots: number;
  days: number;
  impressions: number | null;
  engagementRate: number | null;
  medianEngagementRate: number | null;
  /** engagementRate / medianEngagementRate; null below min-N. */
  index: number | null;
  baselineN: number;
  leads: number | null;
  beatMedian: boolean | null;
};

export type ReviewWhy = { factor: ReviewFactor; effect: ReviewEffect; reason: string };

/**
 * What / why / how for one creative. Drafted by the model from the computed
 * facts; only a CONFIRMED review becomes a lesson and moves the learning. The
 * system never learns from its own unreviewed guesses.
 */
export const platinaCreativeReviews = pgTable(
  "platina_creative_reviews",
  {
    id: id(),
    workspaceId: workspaceFk(),
    creativeId: text("creative_id")
      .notNull()
      .references(() => platinaCreatives.id, { onDelete: "cascade" }),
    status: text("status").$type<"draft" | "confirmed">().notNull().default("draft"),
    verdict: text("verdict").$type<ReviewVerdict>(),
    facts: jsonb("facts").$type<ReviewFacts>().notNull(),
    what: text("what"),
    why: jsonb("why").$type<ReviewWhy[]>().notNull().default([]),
    how: text("how"),
    keep: text("keep"),
    /** model | human: who wrote the current text. */
    draftedBy: text("drafted_by").notNull().default("model"),
    draftError: text("draft_error"),
    confirmedById: text("confirmed_by_id").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_creative_reviews_workspace_id_idx").on(table.workspaceId),
    creativeUnique: uniqueIndex("platina_creative_reviews_creative_unique").on(table.creativeId),
  }),
);

/**
 * Audit log of everything the loop changed and why: a demoted or promoted
 * Brain hypothesis (backtracking), a stored lesson. "Why did this drop?" is
 * always answerable from here.
 */
export const platinaLearningEvents = pgTable(
  "platina_learning_events",
  {
    id: id(),
    workspaceId: workspaceFk(),
    brandId: text("brand_id"),
    /** demote | promote | lesson */
    kind: text("kind").notNull(),
    /** The review that caused it. */
    reviewId: text("review_id"),
    /** Brain chunk id, first-party chunk id, ... */
    targetRef: text("target_ref"),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_learning_events_workspace_id_idx").on(table.workspaceId),
    reviewIdx: index("platina_learning_events_review_idx").on(table.workspaceId, table.reviewId),
  }),
);

export const platinaC6ScopedTables = {
  platinaOwnSitePages,
  platinaFirstPartyChunks,
  platinaCreatives,
  platinaCreativeMetrics,
  platinaCreativeReviews,
  platinaLearningEvents,
} as const;

// ---------------------------------------------------------------------------
// C7.1 ops board: one row per check per run, kept for the 7-day history.
// Written by the ops job (lib/ops), read by Admin -> Health.
// ---------------------------------------------------------------------------

export const platinaOpsChecks = pgTable(
  "platina_ops_checks",
  {
    id: id(),
    workspaceId: workspaceFk(),
    /** lib/ops/checks.ts check id: knowledge_ownership, own_site, budgets, ... */
    checkId: text("check_id").notNull(),
    label: text("label").notNull(),
    /** ok | degraded | down | not_configured */
    status: text("status").notNull(),
    detail: text("detail").notNull(),
    remedy: text("remedy"),
    value: jsonb("value").$type<Record<string, number | string | null>>(),
    /** One id per run, so a board shows one consistent set. */
    runId: text("run_id").notNull(),
    checkedAt: timestamp("checked_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_ops_checks_workspace_id_idx").on(table.workspaceId),
    historyIdx: index("platina_ops_checks_ws_check_at_idx").on(table.workspaceId, table.checkId, table.checkedAt),
  }),
);

export const platinaC7ScopedTables = {
  platinaOpsChecks,
} as const;

// ---------------------------------------------------------------------------
// C8.5 learning engine: every suggestion the product makes, what people did
// with it, and the monthly consolidation. The ledger is the source of truth:
// trust and feature weights are computed from it (with a half-life), so any
// suggestion can be traced from its inputs to the credit it sent back.
// ---------------------------------------------------------------------------

export const SUGGESTION_KINDS = ["opportunity", "brief", "idea"] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

/** One input a suggestion used, with its plane and how much it weighed. */
export type SuggestionInput = {
  /** "brain:<chunkId>", "doc:<signalDocId>", "own:<firstPartyChunkId>", "event:<id>", "pattern:<feature>:<value>" */
  ref: string;
  plane: "A" | "B" | "C";
  label: string;
  url?: string | null;
  /** Share of the suggestion this input carried; the inputs of one suggestion sum to 1. */
  weight: number;
};

export type SuggestionFeatures = Partial<Record<"topic" | "channel" | "region" | "event" | "timing" | "format" | "hook" | "trigger", string | null>>;

export const platinaSuggestions = pgTable(
  "platina_suggestions",
  {
    id: id(),
    workspaceId: workspaceFk(),
    /** The client it was made for. */
    brandId: text("brand_id"),
    kind: text("kind").$type<SuggestionKind>().notNull(),
    /** What it is about: "event:<key>", "topic:<name>", "trigger:<key>". */
    subjectKey: text("subject_key").notNull(),
    /** Hash of the inputs: the same inputs never record the same suggestion twice. */
    inputHash: text("input_hash").notNull(),
    title: text("title").notNull(),
    body: jsonb("body").$type<Record<string, unknown>>().notNull().default({}),
    inputs: jsonb("inputs").$type<SuggestionInput[]>().notNull().default([]),
    features: jsonb("features").$type<SuggestionFeatures>().notNull().default({}),
    factors: jsonb("factors").$type<Record<string, number | string>>().notNull().default({}),
    /** "rules" or "learning:<YYYY-MM>" (the snapshot whose weights ranked it). */
    weightsVersion: text("weights_version").notNull().default("rules"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    /** Tried something new on purpose (the explore share), labelled so on the page. */
    explore: boolean("explore").notNull().default(false),
    /** open | accepted | planned | dismissed */
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_suggestions_workspace_id_idx").on(table.workspaceId),
    subjectIdx: index("platina_suggestions_ws_subject_idx").on(table.workspaceId, table.subjectKey),
    recordedUnique: uniqueIndex("platina_suggestions_recorded_unique").on(
      table.workspaceId,
      table.kind,
      table.subjectKey,
      table.inputHash,
    ),
  }),
);

export const SUGGESTION_EVENT_KINDS = ["shown", "opened", "accepted", "planned", "dismissed", "result"] as const;
export type SuggestionEventKind = (typeof SUGGESTION_EVENT_KINDS)[number];
export const DISMISS_REASONS = ["not_relevant", "wrong_fact", "already_doing", "bad_timing"] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];

export const platinaSuggestionEvents = pgTable(
  "platina_suggestion_events",
  {
    id: id(),
    workspaceId: workspaceFk(),
    suggestionId: text("suggestion_id")
      .notNull()
      .references(() => platinaSuggestions.id, { onDelete: "cascade" }),
    kind: text("kind").$type<SuggestionEventKind>().notNull(),
    /** A dismissal's reason; "wrong_fact" names the input in `detail.ref`. */
    reason: text("reason"),
    /** 0..1 for a result (worked 1, mixed 0.5, failed 0); null for decisions. */
    reward: real("reward"),
    /** UTC day, so "shown" is counted once a day. */
    day: text("day").notNull(),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_suggestion_events_workspace_id_idx").on(table.workspaceId),
    suggestionIdx: index("platina_suggestion_events_suggestion_idx").on(table.workspaceId, table.suggestionId),
    oncePerDay: uniqueIndex("platina_suggestion_events_once_per_day").on(table.suggestionId, table.kind, table.day),
  }),
);

/** The monthly consolidation: what it changed and the weights of that month. */
export const platinaLearningSnapshots = pgTable(
  "platina_learning_snapshots",
  {
    id: id(),
    workspaceId: workspaceFk(),
    /** "YYYY-MM" */
    month: text("month").notNull(),
    weights: jsonb("weights").$type<Record<string, unknown>>().notNull().default({}),
    digest: jsonb("digest").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_learning_snapshots_workspace_id_idx").on(table.workspaceId),
    monthUnique: uniqueIndex("platina_learning_snapshots_month_unique").on(table.workspaceId, table.month),
  }),
);

export const platinaC8ScopedTables = {
  platinaSuggestions,
  platinaSuggestionEvents,
  platinaLearningSnapshots,
} as const;
