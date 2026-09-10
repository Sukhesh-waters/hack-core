-- 0052: Drop stray RLS — cleanup, not a behavior change.
--
-- Audit (scripts/rls-audit.ts, 2026-08-31) confirmed:
--   • App connects as `postgres` role (rolbypassrls = true)
--   • auth.uid() = NULL in this connection context
--   • All 5 policies on pattern_runs target `authenticated`/`service_role` — never evaluated
--   • harness_rules has RLS enabled with 0 policies — also never evaluated
--   • Neither table's queries were being filtered; row counts are genuine
--
-- Isolation model: workspace_id in every query (documented in CLAUDE.md).
-- These RLS artifacts gave false signal of DB-level defense-in-depth that doesn't exist.

-- ── pattern_runs: drop all 5 policies, then disable FORCE + RLS ──

DROP POLICY IF EXISTS "pattern_runs_workspace_member_select" ON "pattern_runs";
DROP POLICY IF EXISTS "pattern_runs_workspace_member_insert" ON "pattern_runs";
DROP POLICY IF EXISTS "pattern_runs_workspace_member_update" ON "pattern_runs";
DROP POLICY IF EXISTS "pattern_runs_workspace_member_delete" ON "pattern_runs";
DROP POLICY IF EXISTS "pattern_runs_service_role_all"        ON "pattern_runs";

ALTER TABLE "pattern_runs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "pattern_runs" DISABLE ROW LEVEL SECURITY;

-- ── harness_rules: disable RLS (already has 0 policies) ──

ALTER TABLE "harness_rules" DISABLE ROW LEVEL SECURITY;
