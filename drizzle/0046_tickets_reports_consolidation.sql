-- G2 & G4 Architecture Consolidation Migration
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "workflow_state_id" text REFERENCES "workflow_states"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "posts_workspace_source_posted_idx" ON "posts" ("workspace_id", "source", "posted_at");

CREATE TABLE IF NOT EXISTS "report_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
	"client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
	"recipient_emails" jsonb NOT NULL,
	"cadence" text DEFAULT 'weekly' NOT NULL,
	"last_sent_at" timestamp,
	"created_by_id" text NOT NULL REFERENCES "users"("id"),
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "report_schedules_workspace_id_idx" ON "report_schedules" ("workspace_id");
CREATE INDEX IF NOT EXISTS "report_schedules_client_id_idx" ON "report_schedules" ("client_id");
