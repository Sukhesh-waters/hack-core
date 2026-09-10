-- F1 & F3 Meta Ads Engine Migration
ALTER TABLE "connected_accounts" ADD COLUMN IF NOT EXISTS "token_expires_at" timestamp;
ALTER TABLE "connected_accounts" ADD COLUMN IF NOT EXISTS "backfill_cursor" text;
ALTER TABLE "connected_accounts" ADD COLUMN IF NOT EXISTS "backfill_completed_at" timestamp;

CREATE TABLE IF NOT EXISTS "pattern_ads" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
	"page_handle" text NOT NULL,
	"source" "ingest_source" DEFAULT 'public' NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"external_id" text,
	"ad_body" text,
	"ad_format" text,
	"target_audience" text,
	"posted_at" timestamp NOT NULL,
	"raw" jsonb,
	"run_id" text,
	"segment" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "pattern_ads_workspace_id_idx" ON "pattern_ads" ("workspace_id");
