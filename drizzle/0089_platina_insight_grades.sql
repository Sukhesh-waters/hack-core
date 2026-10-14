CREATE TABLE "platina_insight_grades" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"brain_chunk_id" text NOT NULL,
	"metric" text NOT NULL,
	"scale_version" integer NOT NULL,
	"window_days" integer NOT NULL,
	"threshold" real NOT NULL,
	"direction" text NOT NULL,
	"measured_value" real,
	"n" integer NOT NULL,
	"verdict" text NOT NULL,
	"plane" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platina_brain_chunks" ADD COLUMN "refuted_by_grade_id" text;--> statement-breakpoint
ALTER TABLE "platina_insight_grades" ADD CONSTRAINT "platina_insight_grades_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platina_insight_grades_workspace_id_idx" ON "platina_insight_grades" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "platina_insight_grades_ws_chunk_idx" ON "platina_insight_grades" USING btree ("workspace_id","brain_chunk_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platina_insight_grades_once_unique" ON "platina_insight_grades" USING btree ("brain_chunk_id","window_days","metric");