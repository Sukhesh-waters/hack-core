CREATE TYPE "public"."platina_agreement_state" AS ENUM('agreed', 'qualified', 'contested', 'refuted');
--> statement-breakpoint
CREATE TYPE "public"."platina_gate_number" AS ENUM('declare', 'confirm', 'approve', 'publish');
--> statement-breakpoint
CREATE TYPE "public"."platina_gate_decision" AS ENUM('approved', 'rejected');
--> statement-breakpoint
CREATE TYPE "public"."platina_scan_status" AS ENUM('draft', 'approved', 'running', 'done', 'failed');
--> statement-breakpoint
CREATE TYPE "public"."platina_receipt_outcome" AS ENUM('pending', 'worked', 'did_not_work', 'inconclusive');
--> statement-breakpoint
CREATE TYPE "public"."platina_campaign_status" AS ENUM('draft', 'planned', 'active', 'closed');
--> statement-breakpoint
CREATE TYPE "public"."platina_alert_severity" AS ENUM('info', 'warning', 'critical');
--> statement-breakpoint
CREATE TYPE "public"."platina_brain_status" AS ENUM('active', 'demoted');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platina_brand_chunks" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "source_url" text,
  "title" text,
  "content" text NOT NULL,
  "chunk_index" integer DEFAULT 0 NOT NULL,
  "embedding" vector(768),
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platina_brand_chunks_workspace_id_idx" ON "platina_brand_chunks" ("workspace_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platina_outcomes" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "campaign_id" text,
  "receipt_id" text,
  "leads" integer DEFAULT 0 NOT NULL,
  "qualified_leads" integer DEFAULT 0 NOT NULL,
  "conversion_rate" real,
  "pipeline_contribution" real,
  "quality_score" real,
  "recorded_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platina_outcomes_workspace_id_idx" ON "platina_outcomes" ("workspace_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platina_signal_documents" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "scan_spec_id" text,
  "source_url" text NOT NULL,
  "title" text,
  "body" text NOT NULL,
  "fetched_at" timestamp DEFAULT now() NOT NULL,
  "adapter" text DEFAULT 'apify' NOT NULL,
  "raw" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platina_signal_documents_workspace_id_idx" ON "platina_signal_documents" ("workspace_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platina_debate_transcripts" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "signal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "proposer_claim" text NOT NULL,
  "challenger_attack" text NOT NULL,
  "score" real NOT NULL,
  "state" "platina_agreement_state" NOT NULL,
  "strongest_objection" text,
  "human_ruling" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platina_debate_transcripts_workspace_id_idx" ON "platina_debate_transcripts" ("workspace_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platina_brain_chunks" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "content" text NOT NULL,
  "embedding" vector(768),
  "confidence" real NOT NULL,
  "agreement_state" "platina_agreement_state" NOT NULL,
  "source_signal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "absorbed_chunk_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "generation" integer DEFAULT 0 NOT NULL,
  "transcript_id" text,
  "last_retrieved_at" timestamp,
  "status" "platina_brain_status" DEFAULT 'active' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platina_brain_chunks_workspace_id_idx" ON "platina_brain_chunks" ("workspace_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platina_gate_events" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "gate" "platina_gate_number" NOT NULL,
  "decision" "platina_gate_decision" NOT NULL,
  "approver_id" text NOT NULL REFERENCES "users"("id"),
  "payload_hash" text NOT NULL,
  "subject_type" text NOT NULL,
  "subject_id" text NOT NULL,
  "reason" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platina_gate_events_workspace_id_idx" ON "platina_gate_events" ("workspace_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platina_scan_specs" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "targets" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "cadence" text DEFAULT 'weekly' NOT NULL,
  "status" "platina_scan_status" DEFAULT 'draft' NOT NULL,
  "last_run_at" timestamp,
  "created_by_id" text NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platina_scan_specs_workspace_id_idx" ON "platina_scan_specs" ("workspace_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platina_receipts" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "hypothesis" text NOT NULL,
  "expected_outcome" text NOT NULL,
  "evidence_brand_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "evidence_brain_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "review_at" timestamp NOT NULL,
  "outcome" "platina_receipt_outcome" DEFAULT 'pending' NOT NULL,
  "outcome_note" text,
  "review_surfaced_at" timestamp,
  "owner_id" text NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platina_receipts_workspace_id_idx" ON "platina_receipts" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platina_receipts_review_at_idx" ON "platina_receipts" ("review_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platina_campaigns" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "receipt_id" text,
  "title" text NOT NULL,
  "duration_days" integer,
  "geography" text,
  "budget" real,
  "channel_mix" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "event_anchor" timestamp,
  "event_label" text,
  "audience" text,
  "content_plan" text,
  "sop_run_id" text,
  "status" "platina_campaign_status" DEFAULT 'draft' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platina_campaigns_workspace_id_idx" ON "platina_campaigns" ("workspace_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platina_workspace_config" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "min_baseline_n" integer DEFAULT 20 NOT NULL,
  "contested_floor" real DEFAULT 0.4 NOT NULL,
  "qualified_floor" real DEFAULT 0.7 NOT NULL,
  "compaction_stale_days" integer DEFAULT 90 NOT NULL,
  "compaction_near_dupes" integer DEFAULT 3 NOT NULL,
  "compaction_cosine" real DEFAULT 0.92 NOT NULL,
  "analysis_sequence" jsonb DEFAULT '["competitor_scan","brand_divergence","ideation"]'::jsonb NOT NULL,
  "prompt_templates" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "prompt_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platina_workspace_config_workspace_unique" ON "platina_workspace_config" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platina_workspace_config_workspace_id_idx" ON "platina_workspace_config" ("workspace_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platina_alert_rules" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "severity" "platina_alert_severity" DEFAULT 'warning' NOT NULL,
  "actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "last_run_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platina_alert_rules_workspace_id_idx" ON "platina_alert_rules" ("workspace_id");
