CREATE TYPE "public"."client_goal_status" AS ENUM('active', 'achieved', 'abandoned');--> statement-breakpoint
CREATE TABLE "client_goals" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"client_id" text NOT NULL,
	"title" text NOT NULL,
	"hypothesis" text,
	"metric" text NOT NULL,
	"target_window_start" timestamp NOT NULL,
	"target_window_end" timestamp NOT NULL,
	"status" "client_goal_status" DEFAULT 'active' NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_goals" ADD CONSTRAINT "client_goals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_goals" ADD CONSTRAINT "client_goals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_goals" ADD CONSTRAINT "client_goals_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_goals_workspace_id_idx" ON "client_goals" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "client_goals_client_id_idx" ON "client_goals" USING btree ("client_id");