ALTER TABLE "platina_brain_chunks" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "platina_brain_chunks" ADD COLUMN "mechanism" text;--> statement-breakpoint
ALTER TABLE "platina_brain_chunks" ADD COLUMN "evidence_refs" jsonb;--> statement-breakpoint
ALTER TABLE "platina_brain_chunks" ADD COLUMN "falsifier" jsonb;--> statement-breakpoint
ALTER TABLE "platina_brain_chunks" ADD COLUMN "subject_key" text;--> statement-breakpoint
ALTER TABLE "platina_brain_chunks" ADD COLUMN "direction" text;--> statement-breakpoint
ALTER TABLE "platina_brain_chunks" ADD COLUMN "grade_state" text DEFAULT 'untested' NOT NULL;--> statement-breakpoint
ALTER TABLE "platina_brain_chunks" ADD COLUMN "due_at" timestamp;--> statement-breakpoint
ALTER TABLE "platina_brain_chunks" ADD COLUMN "prompt_version" text;--> statement-breakpoint
ALTER TABLE "platina_brain_chunks" ADD COLUMN "written_by" text;--> statement-breakpoint
CREATE INDEX "platina_brain_chunks_ws_grade_state_due_idx" ON "platina_brain_chunks" USING btree ("workspace_id","grade_state","due_at");