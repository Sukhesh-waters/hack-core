-- Slice 2 delta: audit runs, run events, workspace profiles, embedding model
-- version (R4.1). Hand-scoped: the generated file also replayed 0056/0057
-- because their meta snapshots were never committed; the dev database already
-- has those applied, so this file contains only the true delta. The 0058
-- snapshot is the complete current schema, so future generates diff cleanly.
CREATE TYPE "public"."platina_run_status" AS ENUM('queued', 'running', 'validating', 'completed', 'degraded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."platina_run_trigger" AS ENUM('manual', 'schedule', 'event');--> statement-breakpoint
CREATE TABLE "platina_workspace_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"division" text,
	"region" text,
	"business_unit" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platina_audit_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"spec_id" text,
	"trigger" "platina_run_trigger" DEFAULT 'manual' NOT NULL,
	"status" "platina_run_status" DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"config_snapshot" jsonb NOT NULL,
	"counters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_reason" text,
	"degraded_reason" text,
	"queued_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "platina_audit_run_events" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"status" "platina_run_status" NOT NULL,
	"message" text,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platina_brand_chunks" ADD COLUMN "embedding_model_version" text DEFAULT 'gemini-embedding-001' NOT NULL;--> statement-breakpoint
ALTER TABLE "platina_brain_chunks" ADD COLUMN "embedding_model_version" text DEFAULT 'gemini-embedding-001' NOT NULL;--> statement-breakpoint
ALTER TABLE "platina_workspace_profiles" ADD CONSTRAINT "platina_workspace_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_audit_runs" ADD CONSTRAINT "platina_audit_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_audit_run_events" ADD CONSTRAINT "platina_audit_run_events_run_id_platina_audit_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."platina_audit_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_audit_run_events" ADD CONSTRAINT "platina_audit_run_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platina_workspace_profiles_workspace_unique" ON "platina_workspace_profiles" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "platina_workspace_profiles_workspace_id_idx" ON "platina_workspace_profiles" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "platina_audit_runs_workspace_id_idx" ON "platina_audit_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "platina_audit_runs_spec_id_idx" ON "platina_audit_runs" USING btree ("spec_id");--> statement-breakpoint
CREATE INDEX "platina_audit_runs_status_idx" ON "platina_audit_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "platina_audit_runs_workspace_idempotency_unique" ON "platina_audit_runs" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "platina_audit_run_events_workspace_id_idx" ON "platina_audit_run_events" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "platina_audit_run_events_run_id_idx" ON "platina_audit_run_events" USING btree ("run_id");
