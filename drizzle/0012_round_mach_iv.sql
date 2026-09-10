CREATE TYPE "public"."hub_approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."hub_message_kind" AS ENUM('system', 'text', 'approval');--> statement-breakpoint
CREATE TYPE "public"."hub_priority" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TABLE "hub_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"title" text NOT NULL,
	"requested_by_id" text NOT NULL,
	"status" "hub_approval_status" DEFAULT 'pending' NOT NULL,
	"decided_by_id" text,
	"decided_at" timestamp,
	"content_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hub_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" "hub_message_kind" DEFAULT 'text' NOT NULL,
	"author_id" text,
	"body" text,
	"approval_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hub_reminders" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"title" text NOT NULL,
	"due_at" timestamp NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hub_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"title" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"priority" "hub_priority" DEFAULT 'medium' NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hub_approvals" ADD CONSTRAINT "hub_approvals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_approvals" ADD CONSTRAINT "hub_approvals_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_approvals" ADD CONSTRAINT "hub_approvals_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_approvals" ADD CONSTRAINT "hub_approvals_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_messages" ADD CONSTRAINT "hub_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_messages" ADD CONSTRAINT "hub_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_messages" ADD CONSTRAINT "hub_messages_approval_id_hub_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."hub_approvals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_reminders" ADD CONSTRAINT "hub_reminders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_reminders" ADD CONSTRAINT "hub_reminders_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_tasks" ADD CONSTRAINT "hub_tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_tasks" ADD CONSTRAINT "hub_tasks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hub_approvals_workspace_id_idx" ON "hub_approvals" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "hub_messages_workspace_id_idx" ON "hub_messages" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "hub_messages_created_at_idx" ON "hub_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "hub_reminders_workspace_id_idx" ON "hub_reminders" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "hub_reminders_due_at_idx" ON "hub_reminders" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "hub_tasks_workspace_id_idx" ON "hub_tasks" USING btree ("workspace_id");