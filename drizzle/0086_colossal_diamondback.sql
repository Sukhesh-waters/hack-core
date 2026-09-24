ALTER TYPE "public"."platina_brain_status" ADD VALUE 'archived';--> statement-breakpoint
CREATE TABLE "platina_learning_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"month" text NOT NULL,
	"weights" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"digest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platina_suggestion_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"suggestion_id" text NOT NULL,
	"kind" text NOT NULL,
	"reason" text,
	"reward" real,
	"day" text NOT NULL,
	"actor_id" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platina_suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"brand_id" text,
	"kind" text NOT NULL,
	"subject_key" text NOT NULL,
	"input_hash" text NOT NULL,
	"title" text NOT NULL,
	"body" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"factors" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"weights_version" text DEFAULT 'rules' NOT NULL,
	"model" text,
	"prompt_version" text,
	"explore" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platina_learning_snapshots" ADD CONSTRAINT "platina_learning_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_suggestion_events" ADD CONSTRAINT "platina_suggestion_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_suggestion_events" ADD CONSTRAINT "platina_suggestion_events_suggestion_id_platina_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."platina_suggestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_suggestion_events" ADD CONSTRAINT "platina_suggestion_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_suggestions" ADD CONSTRAINT "platina_suggestions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platina_learning_snapshots_workspace_id_idx" ON "platina_learning_snapshots" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platina_learning_snapshots_month_unique" ON "platina_learning_snapshots" USING btree ("workspace_id","month");--> statement-breakpoint
CREATE INDEX "platina_suggestion_events_workspace_id_idx" ON "platina_suggestion_events" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "platina_suggestion_events_suggestion_idx" ON "platina_suggestion_events" USING btree ("workspace_id","suggestion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platina_suggestion_events_once_per_day" ON "platina_suggestion_events" USING btree ("suggestion_id","kind","day");--> statement-breakpoint
CREATE INDEX "platina_suggestions_workspace_id_idx" ON "platina_suggestions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "platina_suggestions_ws_subject_idx" ON "platina_suggestions" USING btree ("workspace_id","subject_key");--> statement-breakpoint
CREATE UNIQUE INDEX "platina_suggestions_recorded_unique" ON "platina_suggestions" USING btree ("workspace_id","kind","subject_key","input_hash");