# Phase 4 — Compliance + Calendar (W6)

> **Ships:** Approve → schedule → remind. Full path idea → generate → comply →
> approve → schedule → reminder runs unbroken.

## Constitution constraints in play
- Compliance agent gets **1 retry max**, and it never spawns another agent —
  the retry is a plain second function call from the same orchestrator.
- `workspace_id` on every new table (`schedule`), enforced by the existing
  `workspaceScopedTables` schema test.
- Inngest for scheduled work — not Celery, not ad-hoc cron.
- Degradation: no `INNGEST_*` keys → reminder function is registered but the
  app runs fine without the Inngest dev server; email send failures are
  logged per-row, never crash the sweep.

## Tasks

### 1. Schema
- `complianceVerdict` pgEnum: `pending | passed | flagged`.
- `content` gains `complianceStatus` (default `pending`) and
  `complianceReport` jsonb (`ComplianceViolation[]`).
- New `schedule` table: id, workspace_id, client_id, content_id (unique —
  one slot per content), scheduled_for, reminder_sent_at, created_at.
- Generate + apply migration 0005.

### 2. Compliance agent — `src/lib/ai/compliance-agent.ts` (TDD)
- `checkCompliance({ draft, identity })` → `{ verdict: "pass" | "fail",
  violations: [{ rule, excerpt, why }] }` via `routeAI` (quality tier, JSON).
- `enforceCompliance({ draft, identity })` orchestration:
  check → on fail, ONE `refineDraft` call using violations as feedback →
  re-check → return `{ draft, verdict, violations, retried }`.
  Second failure stays `flagged` — humans decide, the agent stops.

### 3. Server actions
- `runComplianceAction` (studio): enforceCompliance, persist updated body +
  complianceStatus/report; on pass, move `draft → review`.
- `approveAction` (approvals): `review → approved`, only if compliance passed.
- `scheduleAction` (approvals/calendar): `approved → scheduled` + insert
  schedule row with a future `scheduled_for`.

### 4. Screens
- Studio `[contentId]`: compliance side panel — verdict badge, violation list,
  "Run compliance" button.
- `/w/[ws]/approvals`: queue of `review` + `approved` content, approve +
  schedule (datetime picker) inline.
- `/w/[ws]/calendar`: month grid of scheduled slots; nav entries for both.

### 5. Inngest reminders
- `inngest` dependency; client in `src/inngest/client.ts`;
  `src/app/api/inngest/route.ts` serve handler.
- `content-reminder` cron function (every 15 min): schedule rows due within
  24h with `reminder_sent_at IS NULL` → send email via existing `resend`
  client → stamp `reminder_sent_at`. Pure query helper is unit-tested;
  the cron wrapper stays thin.

## Done =
`npm test` green (including new agent/orchestration/query tests), migration
applied to Supabase, full approve → schedule path clickable in the UI.
