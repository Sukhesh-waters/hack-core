ALTER TABLE "platina_brands" ADD COLUMN "profile" jsonb;--> statement-breakpoint
ALTER TABLE "platina_brands" ADD COLUMN "profile_sources" jsonb;--> statement-breakpoint
ALTER TABLE "platina_brands" ADD COLUMN "profile_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "platina_brands" ADD COLUMN "profile_error" text;