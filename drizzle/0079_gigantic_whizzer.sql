CREATE TABLE "platina_event_participants" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"event_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"evidence" text NOT NULL,
	"source_url" text NOT NULL,
	"excerpt" text,
	"observed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platina_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"event_key" text NOT NULL,
	"name" text NOT NULL,
	"format" text DEFAULT 'in_person' NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"date_text" text,
	"location" text,
	"country" text,
	"source_url" text NOT NULL,
	"document_id" text,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
ALTER TABLE "platina_event_participants" ADD CONSTRAINT "platina_event_participants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_event_participants" ADD CONSTRAINT "platina_event_participants_event_id_platina_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."platina_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_events" ADD CONSTRAINT "platina_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platina_event_participants_workspace_id_idx" ON "platina_event_participants" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "platina_event_participants_event_idx" ON "platina_event_participants" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platina_event_participants_proof_unique" ON "platina_event_participants" USING btree ("workspace_id","event_id","brand_id","source_url");--> statement-breakpoint
CREATE INDEX "platina_events_workspace_id_idx" ON "platina_events" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "platina_events_ws_starts_idx" ON "platina_events" USING btree ("workspace_id","starts_on");--> statement-breakpoint
CREATE UNIQUE INDEX "platina_events_ws_key_unique" ON "platina_events" USING btree ("workspace_id","event_key");