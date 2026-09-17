ALTER TABLE "platina_scan_specs" ADD COLUMN "cadence_minutes" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "platina_scan_specs" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "platina_scan_specs" ADD COLUMN "last_success_at" timestamp;--> statement-breakpoint
ALTER TABLE "platina_scan_specs" ADD COLUMN "last_failure_at" timestamp;--> statement-breakpoint
ALTER TABLE "platina_scan_specs" ADD COLUMN "last_probe_at" timestamp;--> statement-breakpoint
ALTER TABLE "platina_scan_specs" ADD COLUMN "probe_etag" text;--> statement-breakpoint
ALTER TABLE "platina_scan_specs" ADD COLUMN "probe_last_modified" text;--> statement-breakpoint
ALTER TABLE "platina_scan_specs" ADD COLUMN "consecutive_unchanged" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "platina_scan_specs" ADD COLUMN "current_interval_minutes" integer;--> statement-breakpoint
ALTER TABLE "platina_scan_specs" ADD COLUMN "fetches_day" text;--> statement-breakpoint
ALTER TABLE "platina_scan_specs" ADD COLUMN "fetches_today" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "platina_signal_documents" ADD COLUMN "canonical_url" text;--> statement-breakpoint
ALTER TABLE "platina_signal_documents" ADD COLUMN "source_kind" text;--> statement-breakpoint
ALTER TABLE "platina_signal_documents" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "platina_signal_documents" ADD COLUMN "processing_state" text DEFAULT 'unprocessed' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "platina_signal_documents_spec_hash_unique" ON "platina_signal_documents" USING btree ("scan_spec_id","content_hash");