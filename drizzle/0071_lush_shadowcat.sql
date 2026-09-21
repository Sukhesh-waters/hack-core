ALTER TABLE "platina_plans" ADD COLUMN "brand_id" text;--> statement-breakpoint
ALTER TABLE "platina_plans" ADD COLUMN "origin" jsonb;--> statement-breakpoint
ALTER TABLE "platina_plans" ADD COLUMN "parent_plan_id" text;--> statement-breakpoint
CREATE INDEX "platina_plans_brand_id_idx" ON "platina_plans" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "platina_plans_parent_plan_id_idx" ON "platina_plans" USING btree ("parent_plan_id");