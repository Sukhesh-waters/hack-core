CREATE TYPE "public"."compliance_verdict" AS ENUM('pending', 'passed', 'flagged');--> statement-breakpoint
CREATE TABLE "schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"client_id" text NOT NULL,
	"content_id" text NOT NULL,
	"scheduled_for" timestamp NOT NULL,
	"reminder_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "compliance_status" "compliance_verdict" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "compliance_report" jsonb;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "schedule_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "schedule_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "schedule_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedule_workspace_id_idx" ON "schedule" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "schedule_scheduled_for_idx" ON "schedule" USING btree ("scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_content_unique" ON "schedule" USING btree ("content_id");