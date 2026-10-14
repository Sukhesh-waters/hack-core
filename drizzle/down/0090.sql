-- Reverses drizzle/0090_closed_madrox.sql exactly (B4 — surprise filter,
-- wired in W3a). Additive-only migration, so this additive-only down: drop
-- the one new table (its indexes and FK go with it). Nothing here ever
-- drops a row of pre-existing data or any other table — see plan §4, §11.1
-- L4, §11.4. Expectations are a derived table (never the source of truth —
-- plan §11.1 L3 rebuilds them from signal-document history), so dropping it
-- loses nothing that cannot be recomputed; this file exists for a
-- migration/deploy failure (L4), not for routine use.

DROP TABLE IF EXISTS "platina_expectations";
