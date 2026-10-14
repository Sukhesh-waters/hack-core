CREATE TABLE "platina_expectations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"n" integer NOT NULL,
	"mean" real NOT NULL,
	"m2" real NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platina_expectations" ADD CONSTRAINT "platina_expectations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platina_expectations_workspace_id_idx" ON "platina_expectations" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platina_expectations_workspace_key_unique" ON "platina_expectations" USING btree ("workspace_id","key");