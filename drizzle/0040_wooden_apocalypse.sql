CREATE TABLE "insights" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"pattern" text NOT NULL,
	"suggestion" text NOT NULL,
	"evidence_pattern_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pattern_run_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_pattern_run_id_pattern_runs_id_fk" FOREIGN KEY ("pattern_run_id") REFERENCES "public"."pattern_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "insights_workspace_id_idx" ON "insights" USING btree ("workspace_id");