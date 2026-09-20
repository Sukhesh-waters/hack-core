CREATE TABLE "platina_plan_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"verdict" text NOT NULL,
	"note" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platina_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"title" text NOT NULL,
	"brief" text NOT NULL,
	"plan" jsonb NOT NULL,
	"critique" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lessons_used" integer DEFAULT 0 NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platina_plan_feedback" ADD CONSTRAINT "platina_plan_feedback_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_plan_feedback" ADD CONSTRAINT "platina_plan_feedback_plan_id_platina_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."platina_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_plan_feedback" ADD CONSTRAINT "platina_plan_feedback_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_plans" ADD CONSTRAINT "platina_plans_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_plans" ADD CONSTRAINT "platina_plans_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platina_plan_feedback_workspace_id_idx" ON "platina_plan_feedback" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platina_plan_feedback_plan_id_idx" ON "platina_plan_feedback" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "platina_plans_workspace_id_idx" ON "platina_plans" USING btree ("workspace_id");