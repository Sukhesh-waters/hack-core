CREATE TYPE "public"."sop_step_creates" AS ENUM('none', 'task', 'content', 'ticket', 'doc');--> statement-breakpoint
CREATE TYPE "public"."sop_step_gate" AS ENUM('none', 'approval', 'compliance');--> statement-breakpoint
CREATE TABLE "sop_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"template_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"assignee_rule" jsonb DEFAULT '{"kind":"unassigned"}'::jsonb NOT NULL,
	"due_offset_days" integer DEFAULT 0 NOT NULL,
	"gate" "sop_step_gate" DEFAULT 'none' NOT NULL,
	"creates" "sop_step_creates" DEFAULT 'none' NOT NULL,
	"depends_on" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sop_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"work_type_id" text,
	"name" text NOT NULL,
	"description" text,
	"anchor_label" text DEFAULT 'Anchor date' NOT NULL,
	"archived_at" timestamp,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sop_steps" ADD CONSTRAINT "sop_steps_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_steps" ADD CONSTRAINT "sop_steps_template_id_sop_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."sop_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_templates" ADD CONSTRAINT "sop_templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_templates" ADD CONSTRAINT "sop_templates_work_type_id_work_types_id_fk" FOREIGN KEY ("work_type_id") REFERENCES "public"."work_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_templates" ADD CONSTRAINT "sop_templates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sop_steps_workspace_id_idx" ON "sop_steps" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "sop_steps_template_id_idx" ON "sop_steps" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "sop_templates_workspace_id_idx" ON "sop_templates" USING btree ("workspace_id");