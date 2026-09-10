CREATE TYPE "public"."activity_subject" AS ENUM('content', 'idea', 'ticket', 'campaign', 'doc', 'client');--> statement-breakpoint
CREATE TABLE "activity" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"subject_type" "activity_subject" NOT NULL,
	"subject_id" text NOT NULL,
	"actor_id" text,
	"verb" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_workspace_id_idx" ON "activity" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "activity_subject_idx" ON "activity" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "activity_created_at_idx" ON "activity" USING btree ("created_at");