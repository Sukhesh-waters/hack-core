CREATE TYPE "public"."platina_brand_source_status" AS ENUM('draft', 'approved');--> statement-breakpoint
CREATE TYPE "public"."platina_claims_rule_kind" AS ENUM('banned_term', 'regulated_claim');--> statement-breakpoint
CREATE TABLE "platina_brand_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"url" text,
	"title" text NOT NULL,
	"status" "platina_brand_source_status" DEFAULT 'draft' NOT NULL,
	"content_hash" text,
	"last_fetched_at" timestamp,
	"last_changed_at" timestamp,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platina_claims_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" "platina_claims_rule_kind" NOT NULL,
	"term" text NOT NULL,
	"note" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platina_brand_chunks" ADD COLUMN "superseded_at" timestamp;--> statement-breakpoint
ALTER TABLE "platina_brand_sources" ADD CONSTRAINT "platina_brand_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_brand_sources" ADD CONSTRAINT "platina_brand_sources_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_claims_rules" ADD CONSTRAINT "platina_claims_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_claims_rules" ADD CONSTRAINT "platina_claims_rules_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platina_brand_sources_workspace_id_idx" ON "platina_brand_sources" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "platina_claims_rules_workspace_id_idx" ON "platina_claims_rules" USING btree ("workspace_id");