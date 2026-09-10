ALTER TABLE "pattern_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pattern_runs" FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "pattern_runs_workspace_member_select" ON "pattern_runs";
  DROP POLICY IF EXISTS "pattern_runs_workspace_member_insert" ON "pattern_runs";
  DROP POLICY IF EXISTS "pattern_runs_workspace_member_update" ON "pattern_runs";
  DROP POLICY IF EXISTS "pattern_runs_workspace_member_delete" ON "pattern_runs";
  DROP POLICY IF EXISTS "pattern_runs_service_role_all" ON "pattern_runs";
END $$;

CREATE POLICY "pattern_runs_workspace_member_select"
ON "pattern_runs"
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 
    FROM "memberships" m
    WHERE m."workspace_id" = "pattern_runs"."workspace_id"
      AND m."user_id" = (SELECT auth.uid()::text)
  )
);

CREATE POLICY "pattern_runs_workspace_member_insert"
ON "pattern_runs"
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 
    FROM "memberships" m
    WHERE m."workspace_id" = "pattern_runs"."workspace_id"
      AND m."user_id" = (SELECT auth.uid()::text)
  )
);

CREATE POLICY "pattern_runs_workspace_member_update"
ON "pattern_runs"
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 
    FROM "memberships" m
    WHERE m."workspace_id" = "pattern_runs"."workspace_id"
      AND m."user_id" = (SELECT auth.uid()::text)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 
    FROM "memberships" m
    WHERE m."workspace_id" = "pattern_runs"."workspace_id"
      AND m."user_id" = (SELECT auth.uid()::text)
  )
);

CREATE POLICY "pattern_runs_workspace_member_delete"
ON "pattern_runs"
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 
    FROM "memberships" m
    WHERE m."workspace_id" = "pattern_runs"."workspace_id"
      AND m."user_id" = (SELECT auth.uid()::text)
  )
);

CREATE POLICY "pattern_runs_service_role_all"
ON "pattern_runs"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
