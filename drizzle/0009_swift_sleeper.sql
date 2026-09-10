CREATE TYPE "public"."harness_cadence" AS ENUM('manual', 'daily', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."pattern_run_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "harness_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"segments" jsonb NOT NULL,
	"max_posts_per_run" integer DEFAULT 30 NOT NULL,
	"cadence" "harness_cadence" DEFAULT 'manual' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"last_run_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pattern_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"harness_rule_id" text NOT NULL,
	"segment" jsonb NOT NULL,
	"status" "pattern_run_status" DEFAULT 'queued' NOT NULL,
	"posts_fetched" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pattern_posts" ADD COLUMN "run_id" text;--> statement-breakpoint
ALTER TABLE "pattern_posts" ADD COLUMN "segment" text;--> statement-breakpoint
ALTER TABLE "harness_rules" ADD CONSTRAINT "harness_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pattern_runs" ADD CONSTRAINT "pattern_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pattern_runs" ADD CONSTRAINT "pattern_runs_harness_rule_id_harness_rules_id_fk" FOREIGN KEY ("harness_rule_id") REFERENCES "public"."harness_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "harness_rules_workspace_id_idx" ON "harness_rules" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "harness_rules_workspace_unique" ON "harness_rules" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "pattern_runs_workspace_id_idx" ON "pattern_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "pattern_runs_rule_id_idx" ON "pattern_runs" USING btree ("harness_rule_id");