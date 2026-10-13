-- Reverses drizzle/0087_groovy_justice.sql exactly (B0 — metacognitive Brain).
-- Additive-only migration, so this additive-only down: drop the two new
-- tables and the columns added to existing tables. Nothing here ever drops
-- a row of pre-existing data — see plan §4, §11.4.

DROP TABLE IF EXISTS "platina_brain_state_log";
DROP TABLE IF EXISTS "platina_brain_telemetry";

ALTER TABLE "platina_debate_transcripts" DROP COLUMN IF EXISTS "proposer_provider";
ALTER TABLE "platina_debate_transcripts" DROP COLUMN IF EXISTS "proposer_model";
ALTER TABLE "platina_debate_transcripts" DROP COLUMN IF EXISTS "challenger_provider";
ALTER TABLE "platina_debate_transcripts" DROP COLUMN IF EXISTS "challenger_model";
ALTER TABLE "platina_debate_transcripts" DROP COLUMN IF EXISTS "prompt_version";
ALTER TABLE "platina_debate_transcripts" DROP COLUMN IF EXISTS "blinded";
ALTER TABLE "platina_debate_transcripts" DROP COLUMN IF EXISTS "objected";

ALTER TABLE "platina_signal_documents" DROP COLUMN IF EXISTS "skip_cause";

ALTER TABLE "platina_workspace_config" DROP COLUMN IF EXISTS "brain_modes";
ALTER TABLE "platina_workspace_config" DROP COLUMN IF EXISTS "surprise_floor";
ALTER TABLE "platina_workspace_config" DROP COLUMN IF EXISTS "surprise_audit_share";
ALTER TABLE "platina_workspace_config" DROP COLUMN IF EXISTS "derived_context_share";
