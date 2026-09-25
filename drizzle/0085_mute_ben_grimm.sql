CREATE TABLE "platina_ops_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"check_id" text NOT NULL,
	"label" text NOT NULL,
	"status" text NOT NULL,
	"detail" text NOT NULL,
	"remedy" text,
	"value" jsonb,
	"run_id" text NOT NULL,
	"checked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platina_ops_checks" ADD CONSTRAINT "platina_ops_checks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platina_ops_checks_workspace_id_idx" ON "platina_ops_checks" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "platina_ops_checks_ws_check_at_idx" ON "platina_ops_checks" USING btree ("workspace_id","check_id","checked_at");