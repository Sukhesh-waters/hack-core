CREATE TYPE "public"."platina_finding_status" AS ENUM('new', 'needs_decision', 'validated', 'refuted');--> statement-breakpoint
CREATE TABLE "platina_findings" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"signal_document_id" text,
	"transcript_id" text,
	"brain_chunk_id" text,
	"use_case" text DEFAULT 'competitor_change' NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"strongest_objection" text,
	"severity" text DEFAULT 'medium' NOT NULL,
	"status" "platina_finding_status" DEFAULT 'new' NOT NULL,
	"human_ruling" text,
	"ruled_by" text,
	"ruled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platina_outcomes" ADD COLUMN "synthetic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "platina_outcomes" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "platina_receipts" ADD COLUMN "finding_id" text;--> statement-breakpoint
ALTER TABLE "platina_receipts" ADD COLUMN "severity" text;--> statement-breakpoint
ALTER TABLE "platina_receipts" ADD COLUMN "urgency" text;--> statement-breakpoint
ALTER TABLE "platina_receipts" ADD COLUMN "strongest_uncertainty" text;--> statement-breakpoint
ALTER TABLE "platina_receipts" ADD COLUMN "measurement_method" text;--> statement-breakpoint
ALTER TABLE "platina_findings" ADD CONSTRAINT "platina_findings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_findings" ADD CONSTRAINT "platina_findings_ruled_by_users_id_fk" FOREIGN KEY ("ruled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platina_findings_workspace_id_idx" ON "platina_findings" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "platina_findings_signal_document_id_idx" ON "platina_findings" USING btree ("signal_document_id");