-- Migration 0045: SOP Suggestions (Slice C2)
-- Adds sop_suggestions table for persistent SOP learning feedback loop

CREATE TABLE IF NOT EXISTS "sop_suggestions" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "sop_template_id" text REFERENCES "sop_templates"("id") ON DELETE cascade,
  "reason" text NOT NULL,
  "suggested_changes" jsonb NOT NULL,
  "applied_at" timestamp,
  "dismissed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "sop_suggestions_workspace_id_idx" ON "sop_suggestions" ("workspace_id");
