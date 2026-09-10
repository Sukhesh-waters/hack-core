CREATE TYPE "public"."conversation_type" AS ENUM('direct', 'group');--> statement-breakpoint
ALTER TYPE "public"."activity_subject" ADD VALUE 'hub_task';--> statement-breakpoint
ALTER TYPE "public"."activity_subject" ADD VALUE 'hub_message';--> statement-breakpoint
ALTER TYPE "public"."activity_subject" ADD VALUE 'hub_approval';--> statement-breakpoint
ALTER TYPE "public"."activity_subject" ADD VALUE 'hub_reminder';--> statement-breakpoint
ALTER TYPE "public"."doc_kind" ADD VALUE 'auto';--> statement-breakpoint
CREATE TABLE "conversation_participants" (
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"last_read_at" timestamp,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_participants_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"type" "conversation_type" DEFAULT 'direct' NOT NULL,
	"title" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "direct_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"sender_id" text NOT NULL,
	"body" text NOT NULL,
	"attachments" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pattern_ads" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"page_handle" text NOT NULL,
	"source" "ingest_source" DEFAULT 'public' NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"external_id" text,
	"ad_body" text,
	"ad_format" text,
	"target_audience" text,
	"posted_at" timestamp NOT NULL,
	"raw" jsonb,
	"run_id" text,
	"segment" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"client_id" text NOT NULL,
	"recipient_emails" jsonb NOT NULL,
	"cadence" text DEFAULT 'weekly' NOT NULL,
	"last_sent_at" timestamp,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sop_suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"sop_template_id" text,
	"run_id" text,
	"kind" text DEFAULT 'template_improvement' NOT NULL,
	"scoped_run_hash" text,
	"reason" text NOT NULL,
	"suggested_changes" jsonb NOT NULL,
	"applied_at" timestamp,
	"dismissed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD COLUMN "token_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD COLUMN "backfill_cursor" text;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD COLUMN "backfill_completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "hub_approvals" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "hub_messages" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "hub_reminders" ADD COLUMN "notified_at" timestamp;--> statement-breakpoint
ALTER TABLE "hub_reminders" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "hub_tasks" ADD COLUMN "assignee_id" text;--> statement-breakpoint
ALTER TABLE "hub_tasks" ADD COLUMN "due_at" timestamp;--> statement-breakpoint
ALTER TABLE "hub_tasks" ADD COLUMN "completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "hub_tasks" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "combined_from" jsonb;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "source_kind" text DEFAULT 'url' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "doc_id" text;--> statement-breakpoint
ALTER TABLE "sop_run_steps" ADD COLUMN "completes_when" jsonb DEFAULT '{"kind":"manual"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sop_steps" ADD COLUMN "completes_when" jsonb DEFAULT '{"kind":"manual"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "workflow_state_id" text;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pattern_ads" ADD CONSTRAINT "pattern_ads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_suggestions" ADD CONSTRAINT "sop_suggestions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_suggestions" ADD CONSTRAINT "sop_suggestions_sop_template_id_sop_templates_id_fk" FOREIGN KEY ("sop_template_id") REFERENCES "public"."sop_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_suggestions" ADD CONSTRAINT "sop_suggestions_run_id_sop_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sop_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_participants_user_idx" ON "conversation_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "conversations_workspace_id_idx" ON "conversations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "direct_messages_conversation_id_idx" ON "direct_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "direct_messages_created_at_idx" ON "direct_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pattern_ads_workspace_id_idx" ON "pattern_ads" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "report_schedules_workspace_id_idx" ON "report_schedules" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "report_schedules_client_id_idx" ON "report_schedules" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "sop_suggestions_workspace_id_idx" ON "sop_suggestions" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "hub_tasks" ADD CONSTRAINT "hub_tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_doc_id_workspace_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."workspace_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_workflow_state_id_workflow_states_id_fk" FOREIGN KEY ("workflow_state_id") REFERENCES "public"."workflow_states"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "posts_workspace_source_posted_idx" ON "posts" USING btree ("workspace_id","source","posted_at");