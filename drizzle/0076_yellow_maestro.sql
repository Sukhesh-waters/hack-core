ALTER TABLE "platina_brand_chunks" ADD COLUMN "brand_id" text;--> statement-breakpoint
CREATE INDEX "platina_brand_chunks_brand_idx" ON "platina_brand_chunks" USING btree ("workspace_id","brand_id");