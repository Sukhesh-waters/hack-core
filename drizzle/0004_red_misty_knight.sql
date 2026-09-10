CREATE TYPE "public"."brand_status" AS ENUM('researching', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."idea_status" AS ENUM('new', 'drafted', 'archived');--> statement-breakpoint
CREATE TABLE "brand_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"client_id" text NOT NULL,
	"identity" jsonb,
	"status" "brand_status" DEFAULT 'researching' NOT NULL,
	"error" text,
	"model" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ideas" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"client_id" text NOT NULL,
	"topic" text NOT NULL,
	"hook" text NOT NULL,
	"angle" text,
	"format" text,
	"why_reason" text,
	"citations" jsonb,
	"status" "idea_status" DEFAULT 'new' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "idea_id" text;--> statement-breakpoint
ALTER TABLE "brand_profiles" ADD CONSTRAINT "brand_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_profiles" ADD CONSTRAINT "brand_profiles_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_profiles_workspace_id_idx" ON "brand_profiles" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_profiles_client_unique" ON "brand_profiles" USING btree ("workspace_id","client_id");--> statement-breakpoint
CREATE INDEX "ideas_workspace_id_idx" ON "ideas" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "ideas_client_id_idx" ON "ideas" USING btree ("client_id");--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE no action ON UPDATE no action;