CREATE TYPE "public"."production_stage" AS ENUM('brief', 'in_progress', 'internal_review', 'revision', 'done');--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "production_stage" "production_stage";--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "revision_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
CREATE INDEX "content_production_stage_idx" ON "content" USING btree ("production_stage");