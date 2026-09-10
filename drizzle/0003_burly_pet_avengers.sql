CREATE TYPE "public"."connection_status" AS ENUM('connected', 'error', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."connector_provider" AS ENUM('meta');--> statement-breakpoint
CREATE TABLE "connected_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"client_id" text NOT NULL,
	"provider" "connector_provider" DEFAULT 'meta' NOT NULL,
	"ig_user_id" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"status" "connection_status" DEFAULT 'connected' NOT NULL,
	"last_pull_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pattern_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"page_handle" text NOT NULL,
	"source" "ingest_source" DEFAULT 'public' NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"external_id" text,
	"caption" text,
	"format" text,
	"posted_at" timestamp NOT NULL,
	"likes" integer,
	"comments" integer,
	"raw" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pattern_posts" ADD CONSTRAINT "pattern_posts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connected_accounts_workspace_id_idx" ON "connected_accounts" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connected_accounts_client_provider_unique" ON "connected_accounts" USING btree ("workspace_id","client_id","provider");--> statement-breakpoint
CREATE INDEX "pattern_posts_workspace_id_idx" ON "pattern_posts" USING btree ("workspace_id");