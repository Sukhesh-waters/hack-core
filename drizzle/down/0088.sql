-- Reverses drizzle/0088_chemical_proteus.sql exactly (B1 — interrogation
-- schema + falsifier). Additive-only migration, so this additive-only down:
-- drop the index and the ten new nullable/defaulted columns on
-- platina_brain_chunks. Nothing here ever drops a row of pre-existing data
-- or any other table — see plan §4, §11.1 L4, §11.4.

DROP INDEX IF EXISTS "platina_brain_chunks_ws_grade_state_due_idx";

ALTER TABLE "platina_brain_chunks" DROP COLUMN IF EXISTS "kind";
ALTER TABLE "platina_brain_chunks" DROP COLUMN IF EXISTS "mechanism";
ALTER TABLE "platina_brain_chunks" DROP COLUMN IF EXISTS "evidence_refs";
ALTER TABLE "platina_brain_chunks" DROP COLUMN IF EXISTS "falsifier";
ALTER TABLE "platina_brain_chunks" DROP COLUMN IF EXISTS "subject_key";
ALTER TABLE "platina_brain_chunks" DROP COLUMN IF EXISTS "direction";
ALTER TABLE "platina_brain_chunks" DROP COLUMN IF EXISTS "grade_state";
ALTER TABLE "platina_brain_chunks" DROP COLUMN IF EXISTS "due_at";
ALTER TABLE "platina_brain_chunks" DROP COLUMN IF EXISTS "prompt_version";
ALTER TABLE "platina_brain_chunks" DROP COLUMN IF EXISTS "written_by";
