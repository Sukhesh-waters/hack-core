ALTER TABLE "hub_tasks" ADD COLUMN IF NOT EXISTS "origin_run_step_id" text REFERENCES "sop_run_steps"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hub_tasks_origin_run_step_id_idx" ON "hub_tasks" ("origin_run_step_id");
