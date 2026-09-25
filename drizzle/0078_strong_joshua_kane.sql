CREATE TABLE "platina_interest_signals" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"brand_id" text,
	"document_id" text,
	"topic" text NOT NULL,
	"region" text DEFAULT 'global' NOT NULL,
	"channel" text NOT NULL,
	"metric" text NOT NULL,
	"signal_kind" text NOT NULL,
	"value" real NOT NULL,
	"observed_at" timestamp NOT NULL,
	"collected_at" timestamp DEFAULT now() NOT NULL,
	"source_url" text NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
ALTER TABLE "platina_interest_signals" ADD CONSTRAINT "platina_interest_signals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platina_interest_signals_workspace_id_idx" ON "platina_interest_signals" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "platina_interest_signals_ws_topic_observed_idx" ON "platina_interest_signals" USING btree ("workspace_id","topic","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "platina_interest_signals_measurement_unique" ON "platina_interest_signals" USING btree ("workspace_id","source_url","metric","topic","observed_at");