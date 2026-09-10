CREATE TABLE "plan_view_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"scope" text DEFAULT 'all' NOT NULL,
	"scope_client_id" text,
	"scope_user_id" text,
	"grouping" text DEFAULT 'none' NOT NULL,
	"hidden_columns" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_view_preferences" ADD CONSTRAINT "plan_view_preferences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_view_preferences" ADD CONSTRAINT "plan_view_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_view_preferences" ADD CONSTRAINT "plan_view_preferences_scope_client_id_clients_id_fk" FOREIGN KEY ("scope_client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_view_preferences" ADD CONSTRAINT "plan_view_preferences_scope_user_id_users_id_fk" FOREIGN KEY ("scope_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_view_preferences_user_workspace_unique" ON "plan_view_preferences" USING btree ("workspace_id","user_id");