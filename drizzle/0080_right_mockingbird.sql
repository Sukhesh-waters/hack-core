ALTER TYPE "public"."platina_brain_status" ADD VALUE 'superseded';--> statement-breakpoint
ALTER TABLE "platina_brain_chunks" ADD COLUMN "insight_key" text;--> statement-breakpoint
CREATE INDEX "platina_brain_chunks_ws_insight_key_idx" ON "platina_brain_chunks" USING btree ("workspace_id","insight_key");