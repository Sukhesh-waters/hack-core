-- Reverses drizzle/0089_platina_insight_grades.sql exactly (B5 — falsifier
-- grading + refutation memory). Additive-only migration, so this
-- additive-only down: drop the new table (and its indexes/FK go with it) and
-- the one new nullable column on platina_brain_chunks. Nothing here ever
-- drops a row of pre-existing data or any other table — see plan §4, §11.1
-- L4, §11.4. Grades are append-only and meant to be kept forever (plan §12
-- retention); this file exists for a migration/deploy failure (L4), not for
-- routine use.

DROP TABLE IF EXISTS "platina_insight_grades";

ALTER TABLE "platina_brain_chunks" DROP COLUMN IF EXISTS "refuted_by_grade_id";
