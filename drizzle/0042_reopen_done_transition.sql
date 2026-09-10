-- Custom SQL migration file, put your code below! --

-- P0 (counterattack-12): done is a lane, not a sink.
-- New workspaces get the "Reopen" edge from DEFAULT_CONTENT_TRANSITIONS;
-- this backfills every already-seeded default content workflow. Guarded by
-- NOT EXISTS on ANY outbound transition from done, so a workspace that
-- already authored its own exit from done keeps its customisation.
INSERT INTO "workflow_transitions" ("id", "workspace_id", "workflow_id", "from_state_id", "to_state_id", "name", "position")
SELECT
  gen_random_uuid()::text,
  w."workspace_id",
  w."id",
  sd."id",
  si."id",
  'Reopen',
  COALESCE((SELECT MAX(t."position") + 1 FROM "workflow_transitions" t WHERE t."workflow_id" = w."id"), 0)
FROM "workflows" w
INNER JOIN "work_types" wt ON wt."id" = w."work_type_id"
INNER JOIN "workflow_states" sd ON sd."workflow_id" = w."id" AND sd."key" = 'done' AND sd."archived_at" IS NULL
INNER JOIN "workflow_states" si ON si."workflow_id" = w."id" AND si."key" = 'in_progress' AND si."archived_at" IS NULL
WHERE wt."key" = 'content'
  AND w."is_default" = true
  AND NOT EXISTS (
    SELECT 1 FROM "workflow_transitions" t
    WHERE t."workflow_id" = w."id" AND t."from_state_id" = sd."id"
  );
