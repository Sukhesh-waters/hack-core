CREATE TYPE "public"."sop_run_status" AS ENUM('active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."sop_run_step_status" AS ENUM('blocked', 'ready', 'in_progress', 'done', 'skipped');--> statement-breakpoint
CREATE TABLE "sop_run_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" text NOT NULL,
	"template_step_id" text,
	"position" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"assignee_id" text,
	"assignee_role" "membership_role",
	"due_at" timestamp NOT NULL,
	"status" "sop_run_step_status" DEFAULT 'ready' NOT NULL,
	"gate" "sop_step_gate" DEFAULT 'none' NOT NULL,
	"creates" "sop_step_creates" DEFAULT 'none' NOT NULL,
	"depends_on" text[] DEFAULT '{}'::text[] NOT NULL,
	"linked_type" text,
	"linked_id" text,
	"completed_at" timestamp,
	"completed_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sop_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"template_id" text,
	"client_id" text,
	"name" text NOT NULL,
	"anchor_date" timestamp NOT NULL,
	"status" "sop_run_status" DEFAULT 'active' NOT NULL,
	"started_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "sop_run_steps" ADD CONSTRAINT "sop_run_steps_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_run_steps" ADD CONSTRAINT "sop_run_steps_run_id_sop_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sop_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_run_steps" ADD CONSTRAINT "sop_run_steps_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_run_steps" ADD CONSTRAINT "sop_run_steps_completed_by_id_users_id_fk" FOREIGN KEY ("completed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_runs" ADD CONSTRAINT "sop_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_runs" ADD CONSTRAINT "sop_runs_template_id_sop_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."sop_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_runs" ADD CONSTRAINT "sop_runs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_runs" ADD CONSTRAINT "sop_runs_started_by_id_users_id_fk" FOREIGN KEY ("started_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sop_run_steps_workspace_id_idx" ON "sop_run_steps" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "sop_run_steps_run_id_idx" ON "sop_run_steps" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "sop_run_steps_assignee_idx" ON "sop_run_steps" USING btree ("workspace_id","assignee_id");--> statement-breakpoint
CREATE INDEX "sop_runs_workspace_id_idx" ON "sop_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "sop_runs_status_idx" ON "sop_runs" USING btree ("workspace_id","status");