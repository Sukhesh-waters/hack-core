CREATE TYPE "public"."decision_outcome" AS ENUM('pending', 'worked', 'did_not_work', 'inconclusive');--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"client_id" text,
	"goal_id" text,
	"title" text NOT NULL,
	"reason" text NOT NULL,
	"evidence_post_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"insight_id" text,
	"expected_outcome" text NOT NULL,
	"review_at" timestamp NOT NULL,
	"outcome" "decision_outcome" DEFAULT 'pending' NOT NULL,
	"outcome_note" text,
	"review_surfaced_at" timestamp,
	"owner_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_goal_id_client_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."client_goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_insight_id_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."insights"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decisions_workspace_id_idx" ON "decisions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "decisions_client_id_idx" ON "decisions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "decisions_review_at_idx" ON "decisions" USING btree ("review_at");