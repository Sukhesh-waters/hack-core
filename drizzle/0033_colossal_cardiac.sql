CREATE TYPE "public"."custom_field_subject" AS ENUM('content', 'idea', 'ticket', 'campaign', 'client');--> statement-breakpoint
CREATE TYPE "public"."custom_field_type" AS ENUM('short_text', 'paragraph', 'date', 'number', 'timestamp', 'labels', 'dropdown', 'checkbox', 'people', 'url');--> statement-breakpoint
CREATE TABLE "custom_field_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"field_id" text NOT NULL,
	"subject_type" "custom_field_subject" NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_field_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" "custom_field_type" NOT NULL,
	"options" jsonb,
	"required" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "custom_fields" jsonb;--> statement-breakpoint
ALTER TABLE "custom_field_assignments" ADD CONSTRAINT "custom_field_assignments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_assignments" ADD CONSTRAINT "custom_field_assignments_field_id_custom_field_definitions_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."custom_field_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_field_assignments_workspace_id_idx" ON "custom_field_assignments" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "custom_field_assignments_subject_idx" ON "custom_field_assignments" USING btree ("workspace_id","subject_type");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_assignments_field_subject_unique" ON "custom_field_assignments" USING btree ("field_id","subject_type");--> statement-breakpoint
CREATE INDEX "custom_field_definitions_workspace_id_idx" ON "custom_field_definitions" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_definitions_workspace_name_unique" ON "custom_field_definitions" USING btree ("workspace_id","name");