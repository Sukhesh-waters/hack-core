CREATE TABLE "platina_brain_state_log" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"brain_chunk_id" text NOT NULL,
	"field" text NOT NULL,
	"from_value" jsonb,
	"to_value" jsonb,
	"cause" text NOT NULL,
	"grade_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platina_brain_telemetry" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"stage" text NOT NULL,
	"decision" text NOT NULL,
	"subject_id" text,
	"detail" jsonb,
	"prompt_version" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platina_debate_transcripts" ADD COLUMN "proposer_provider" text;--> statement-breakpoint
ALTER TABLE "platina_debate_transcripts" ADD COLUMN "proposer_model" text;--> statement-breakpoint
ALTER TABLE "platina_debate_transcripts" ADD COLUMN "challenger_provider" text;--> statement-breakpoint
ALTER TABLE "platina_debate_transcripts" ADD COLUMN "challenger_model" text;--> statement-breakpoint
ALTER TABLE "platina_debate_transcripts" ADD COLUMN "prompt_version" text;--> statement-breakpoint
ALTER TABLE "platina_debate_transcripts" ADD COLUMN "blinded" boolean;--> statement-breakpoint
ALTER TABLE "platina_debate_transcripts" ADD COLUMN "objected" boolean;--> statement-breakpoint
ALTER TABLE "platina_signal_documents" ADD COLUMN "skip_cause" text;--> statement-breakpoint
ALTER TABLE "platina_workspace_config" ADD COLUMN "brain_modes" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "platina_workspace_config" ADD COLUMN "surprise_floor" real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "platina_workspace_config" ADD COLUMN "surprise_audit_share" real DEFAULT 0.1 NOT NULL;--> statement-breakpoint
ALTER TABLE "platina_workspace_config" ADD COLUMN "derived_context_share" real DEFAULT 0.4 NOT NULL;--> statement-breakpoint
ALTER TABLE "platina_brain_state_log" ADD CONSTRAINT "platina_brain_state_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platina_brain_telemetry" ADD CONSTRAINT "platina_brain_telemetry_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platina_brain_state_log_workspace_id_idx" ON "platina_brain_state_log" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "platina_brain_state_log_ws_chunk_idx" ON "platina_brain_state_log" USING btree ("workspace_id","brain_chunk_id");--> statement-breakpoint
CREATE INDEX "platina_brain_state_log_ws_cause_created_idx" ON "platina_brain_state_log" USING btree ("workspace_id","cause","created_at");--> statement-breakpoint
CREATE INDEX "platina_brain_telemetry_workspace_id_idx" ON "platina_brain_telemetry" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "platina_brain_telemetry_ws_stage_created_idx" ON "platina_brain_telemetry" USING btree ("workspace_id","stage","created_at");