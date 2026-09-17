/**
 * Platina AI OS schema — parallel to InstaMedia.
 * All tables prefixed platina_. Isolation is workspace_id on every table.
 * Plane B (signal documents) has NO embedding column by construction.
 */
import {
  boolean,
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
import { users, workspaces } from "./schema";

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

/** The router's current embedding model — bump only with an explicit
 *  re-embed backfill (R4.1). Mixed versions in one index are meaningless. */
export const PLATINA_EMBEDDING_MODEL_VERSION = "gemini-embedding-001";

export type PlatinaScanTarget = {
  kind: "competitor_site" | "press_release" | "conference" | "trade_editorial" | "ad_library";
  value: string;
  // "web" (own-code adapter) is deliberately not a selectable value until the
  // constitution is updated; the runtime registry rejects it too.
  adapter?: "apify";
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
    sourceUrl: text("source_url"),
    title: text("title"),
    content: text("content").notNull(),
    chunkIndex: integer("chunk_index").notNull().default(0),
    embedding: vector("embedding", { dimensions: 768 }),
    embeddingModelVersion: text("embedding_model_version")
      .notNull()
      .default(PLATINA_EMBEDDING_MODEL_VERSION),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_brand_chunks_workspace_id_idx").on(
      table.workspaceId,
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
    title: text("title"),
    body: text("body").notNull(),
    fetchedAt: timestamp("fetched_at", { mode: "date" }).notNull().defaultNow(),
    adapter: text("adapter").notNull().default("apify"),
    raw: jsonb("raw"),
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
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_debate_transcripts_workspace_id_idx").on(
      table.workspaceId,
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
    lastRetrievedAt: timestamp("last_retrieved_at", { mode: "date" }),
    status: platinaBrainStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("platina_brain_chunks_workspace_id_idx").on(
      table.workspaceId,
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
    cadence: text("cadence").notNull().default("weekly"),
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
    fetchesToday: integer("fetches_today").notNull().default(0),
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

export const platinaWorkspaceScopedTables = {
  platinaBrandChunks,
  platinaOutcomes,
  platinaSignalDocuments,
  platinaDebateTranscripts,
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
} as const;
