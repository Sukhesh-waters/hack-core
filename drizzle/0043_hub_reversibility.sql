-- Migration 0043: Hub Reversibility (Slice B3)
-- Adds assignee_id, due_at, completed_at, archived_at to hub_tasks
-- Adds archived_at to hub_approvals, hub_messages, hub_reminders

ALTER TABLE "hub_approvals" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;
ALTER TABLE "hub_messages" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;
ALTER TABLE "hub_tasks" ADD COLUMN IF NOT EXISTS "assignee_id" text REFERENCES "users"("id") ON DELETE set null;
ALTER TABLE "hub_tasks" ADD COLUMN IF NOT EXISTS "due_at" timestamp;
ALTER TABLE "hub_tasks" ADD COLUMN IF NOT EXISTS "completed_at" timestamp;
ALTER TABLE "hub_tasks" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;
ALTER TABLE "hub_reminders" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;
