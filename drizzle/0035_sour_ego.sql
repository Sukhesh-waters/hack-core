CREATE TYPE "public"."workflow_state_category" AS ENUM('todo', 'doing', 'done');--> statement-breakpoint
CREATE TABLE "work_types" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_states" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"category" "workflow_state_category" NOT NULL,
	"color_key" text DEFAULT 'slate' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"wip_limit" integer,
	"legacy_stage" "production_stage",
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_transitions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"from_state_id" text,
	"to_state_id" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"validators" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"post_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"work_type_id" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "workflow_state_id" text;--> statement-breakpoint
ALTER TABLE "work_types" ADD CONSTRAINT "work_types_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_states" ADD CONSTRAINT "workflow_states_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_states" ADD CONSTRAINT "workflow_states_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_from_state_id_workflow_states_id_fk" FOREIGN KEY ("from_state_id") REFERENCES "public"."workflow_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_to_state_id_workflow_states_id_fk" FOREIGN KEY ("to_state_id") REFERENCES "public"."workflow_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_work_type_id_work_types_id_fk" FOREIGN KEY ("work_type_id") REFERENCES "public"."work_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_types_workspace_id_idx" ON "work_types" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_types_workspace_key_unique" ON "work_types" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE INDEX "workflow_states_workspace_id_idx" ON "workflow_states" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workflow_states_workflow_id_idx" ON "workflow_states" USING btree ("workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_states_workflow_key_unique" ON "workflow_states" USING btree ("workflow_id","key");--> statement-breakpoint
CREATE INDEX "workflow_transitions_workspace_id_idx" ON "workflow_transitions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workflow_transitions_workflow_id_idx" ON "workflow_transitions" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_transitions_from_state_idx" ON "workflow_transitions" USING btree ("from_state_id");--> statement-breakpoint
CREATE INDEX "workflows_workspace_id_idx" ON "workflows" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workflows_work_type_id_idx" ON "workflows" USING btree ("work_type_id");--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_workflow_state_id_workflow_states_id_fk" FOREIGN KEY ("workflow_state_id") REFERENCES "public"."workflow_states"("id") ON DELETE no action ON UPDATE no action;