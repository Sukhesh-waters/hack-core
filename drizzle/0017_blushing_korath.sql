CREATE TYPE "public"."report_send_status" AS ENUM('sent', 'failed');--> statement-breakpoint
CREATE TABLE "report_sends" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"client_id" text NOT NULL,
	"sent_by_user_id" text NOT NULL,
	"recipients" jsonb NOT NULL,
	"audience" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" "report_send_status" NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "report_sends" ADD CONSTRAINT "report_sends_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sends" ADD CONSTRAINT "report_sends_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sends" ADD CONSTRAINT "report_sends_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_sends_workspace_id_idx" ON "report_sends" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "report_sends_client_id_idx" ON "report_sends" USING btree ("client_id");