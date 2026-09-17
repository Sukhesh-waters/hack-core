# Platina AI OS for Waters — Slice 2 Task Plan: Durable Audit Runs and Live Event Spine

**Date:** 2026-09-17
**Status:** Proposed — authorizes Slice 2 execution only
**Governing plan:** [2026-09-11-platina-waters-realtime-full-suite.md](./2026-09-11-platina-waters-realtime-full-suite.md) (+ 2026-09-15 addendum)
**Predecessors:** [Slice 0](./2026-09-16-platina-slice-0-baseline-and-contract.md) (done, `70947e8`), [Slice 1](./2026-09-17-platina-slice-1-shell.md) (done, `890a37b`)

## Purpose

Create the shared workflow foundation every later slice builds on: durable
audit runs with an append-only event timeline, the workspace profile
(division/region per the W0.8 ADR), the Platina Realtime spine with an opaque
topic token and polling fallback, and a run orchestrator that snapshots the
configured analysis sequence onto each run. Includes addendum items R4.1
(embedding model version — must land before vectors exist) and R3 (Cockpit
scope header, unblocked by the profile table).

## Schema changes (one migration)

New tables:

- `platina_workspace_profiles` — unique `workspace_id` FK; `division`,
  `region` (text, nullable until filled), `business_unit` (nullable);
  timestamps. One workspace = one division × region (W0.8 ADR).
- `platina_audit_runs` — `id`, `workspace_id` FK, `spec_id` (nullable, refs
  scan spec), `trigger` (`manual` | `schedule` | `event`), `status`
  (`queued` | `running` | `validating` | `completed` | `degraded` | `failed`),
  `idempotency_key` (unique per workspace), `config_snapshot` jsonb (analysis
  sequence, prompt version, thresholds at creation — later config edits cannot
  rewrite history), `counters` jsonb, `error_reason` / `degraded_reason`
  nullable, `queued_at`/`started_at`/`finished_at`. Indexes on
  `workspace_id`, `spec_id`, `status`.
- `platina_audit_run_events` — append-only run timeline: `id`, `run_id` FK,
  `workspace_id` FK (isolation on every table), `status`, `message`,
  `payload` jsonb nullable, `created_at`. Indexes on `workspace_id`, `run_id`.

Column additions (R4.1):

- `platina_brand_chunks.embedding_model_version` text not null default
  `"gemini-embedding-001"` (the router's current embedding model).
- `platina_brain_chunks.embedding_model_version` — same.

Every new table carries `workspace_id` non-null + indexed, per the
constitution; query tests assert the filter in generated SQL.

## Modules

- `src/lib/platina/run-status.ts` (pure): the state machine
  (`queued → running → validating → completed|degraded|failed`), terminal
  states, `canTransition`, `isTerminal`, freshness helper
  (`fresh" | "stale" | "degraded"` from last-success timestamps). No I/O.
- `src/lib/platina/realtime.ts` (server): `PlatinaRealtimeScope` (`audits`,
  `findings`, `solutions`, `outcomes`, `alerts`); `platinaTopicToken(
  workspaceId)` — HMAC-SHA256 over the workspace id with the server-only
  `PLATINA_REALTIME_SECRET`, returning `null` when the secret is absent;
  `platinaChannelName(token)` → `platina:<token>:live`;
  `broadcastPlatinaSignal(workspaceId, scope)` — signal-only payload, REST
  broadcast AFTER commit, fire-and-forget (Realtime outage never fails a
  write). The raw workspace id never names a channel.
- `src/app/(platina)/p/[ws]/use-platina-realtime.ts` (client): subscribes to
  the opaque topic handed down by the membership-checked layout; on signal →
  `router.refresh()` (authenticated server refetch); 20 s polling fallback
  always active; reports `live | reconnecting | polling` honestly.
- `src/lib/platina/orchestrator.ts`: `snapshotRunConfig(config)` freezes
  analysis sequence + prompt version + thresholds; `executeAuditRun` walks
  the snapshotted stages with bounded transitions, one run-event write +
  broadcast per transition, idempotent per run id (a terminal run is a
  no-op), failure marks `failed` with reason, partial stage failure marks
  `degraded` without erasing successful stages.

## Wiring

- New Inngest function `platina-audit-run` on event
  `platina/audit-run.requested`: loads the run workspace-scoped, verifies it
  is non-terminal, executes the snapshot stages. Slice 2 stages:
  `fetch` (existing approved-spec registry fetch + signal insert — the real
  current behavior) and `validate` (marks the batch for the existing
  contradiction sweep; finding creation is Slice 4). Registered in
  `src/app/api/inngest/route.ts`.
- `runAuditNowAction` server action (capability `gate.confirm`): creates the
  run (queued, idempotency key, config snapshot), sends the Inngest event,
  broadcasts `audits`. Wired to a "Run now" control on approved sources in
  Audits. Does not bypass approval — only approved specs can run.
- Layout derives the topic token server-side (membership already checked) and
  mounts the live provider; header shows the connection state pill
  (`Live` / `Reconnecting` / `Polling`) — truthful because the hook reports
  the real transport state. When the secret is absent the pill reads
  `Polling` and nothing pretends otherwise.
- Cockpit gains an "Audit activity" section listing recent runs with status
  and timestamps; Audits gains run history per workspace. Both live-invalidate.
- Admin gains the division/region/business-unit form (`gate.approve`-guarded);
  the sidebar shows `division · region` once set (R3).
- `.env.example` gains `PLATINA_REALTIME_SECRET` (documented, optional —
  absence degrades to polling).

## Test specification

- `src/db/queries/platina.test.ts`: SQL-shape assertions for every new query
  (workspace filter present in generated SQL; run-events insert carries
  workspace_id; profile upsert keyed on workspace_id).
- `src/lib/platina/run-status.test.ts`: legal/illegal transitions, terminal
  lock, freshness boundaries.
- `src/lib/platina/realtime.test.ts`: token is opaque (contains no workspace
  id), deterministic per workspace, distinct across workspaces, null without
  the secret; channel name format; broadcast is a no-op without env and never
  throws.
- `src/lib/platina/orchestrator.test.ts`: snapshot freezes config;
  stage-order execution; terminal no-op; degraded vs failed paths; idempotent
  re-entry.
- Boundary test must stay green (no new import families).
- E2E: extend `e2e/platina/smoke.spec.ts` — Audits page shows the run-history
  region; a second test opens two pages (two tabs), triggers nothing, and
  asserts both render the same run history (convergence by construction;
  full two-tab live convergence is verified manually with Inngest dev
  running, recorded in the PR notes).

## Done when

A run can be created from an approved audit source, moves through
`queued → running → validating → completed` (or `degraded`/`failed` with
reasons) with every transition persisted and broadcast after commit; two
browser tabs converge without refresh (Realtime when the secret is set,
polling otherwise); the Cockpit header shows division · region once the
profile is set; all gates green.

## Explicit non-goals for Slice 2

- No cadence coordinator, probe tier, dedupe hashing, or new adapters
  (Slice 3).
- No findings workflow changes (Slice 4), no solution contract changes
  (Slice 5).
- No drop of `sop_run_id` or alert-action enum migration (separately
  approved step after W0.3's report).
- No changes to `/w` Realtime modules; Platina gets its own files.
