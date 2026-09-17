CREATE TABLE "platina_outcome_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"source" text DEFAULT 'csv-paste' NOT NULL,
	"file_hash" text NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"inserted_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platina_brain_chunks" ADD COLUMN "demoted_by_receipt_id" text;--> statement-breakpoint
ALTER TABLE "platina_outcome_imports" ADD CONSTRAINT "platina_outcome_imports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_outcome_imports" ADD CONSTRAINT "platina_outcome_imports_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platina_outcome_imports_workspace_id_idx" ON "platina_outcome_imports" USING btree ("workspace_id");