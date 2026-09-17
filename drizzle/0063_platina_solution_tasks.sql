CREATE TYPE "public"."platina_event_phase" AS ENUM('pre', 'at', 'post');--> statement-breakpoint
CREATE TYPE "public"."platina_task_status" AS ENUM('todo', 'in_progress', 'blocked', 'review', 'done');--> statement-breakpoint
CREATE TABLE "platina_solution_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"title" text NOT NULL,
	"status" "platina_task_status" DEFAULT 'todo' NOT NULL,
	"assignee_id" text,
	"due_date" timestamp,
	"event_phase" "platina_event_phase",
	"depends_on" text,
	"risk" text,
	"claims_blocked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platina_solution_tasks" ADD CONSTRAINT "platina_solution_tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_solution_tasks" ADD CONSTRAINT "platina_solution_tasks_campaign_id_platina_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."platina_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_solution_tasks" ADD CONSTRAINT "platina_solution_tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platina_solution_tasks_workspace_id_idx" ON "platina_solution_tasks" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "platina_solution_tasks_campaign_id_idx" ON "platina_solution_tasks" USING btree ("campaign_id");