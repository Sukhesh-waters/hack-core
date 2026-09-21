CREATE TYPE "public"."platina_brand_kind" AS ENUM('own_brand', 'competitor');--> statement-breakpoint
CREATE TYPE "public"."platina_brand_status" AS ENUM('active', 'paused');--> statement-breakpoint
CREATE TABLE "platina_brands" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" "platina_brand_kind" DEFAULT 'own_brand' NOT NULL,
	"parent_brand_id" text,
	"homepage_url" text,
	"handles" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"region" text,
	"notes" text,
	"status" "platina_brand_status" DEFAULT 'active' NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platina_findings" ADD COLUMN "evidence" jsonb;--> statement-breakpoint
ALTER TABLE "platina_scan_specs" ADD COLUMN "brand_id" text;--> statement-breakpoint
ALTER TABLE "platina_signal_documents" ADD COLUMN "metrics" jsonb;--> statement-breakpoint
ALTER TABLE "platina_workspace_config" ADD COLUMN "daily_actor_call_cap" integer DEFAULT 40 NOT NULL;--> statement-breakpoint
ALTER TABLE "platina_brands" ADD CONSTRAINT "platina_brands_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_brands" ADD CONSTRAINT "platina_brands_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platina_brands_workspace_id_idx" ON "platina_brands" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "platina_brands_parent_idx" ON "platina_brands" USING btree ("parent_brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platina_brands_workspace_name_unique" ON "platina_brands" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE INDEX "platina_scan_specs_brand_id_idx" ON "platina_scan_specs" USING btree ("brand_id");