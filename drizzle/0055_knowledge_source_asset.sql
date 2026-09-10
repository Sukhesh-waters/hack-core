ALTER TABLE "knowledge_sources" ALTER COLUMN "url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "asset_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_sources_asset_id_idx" ON "knowledge_sources" USING btree ("asset_id");