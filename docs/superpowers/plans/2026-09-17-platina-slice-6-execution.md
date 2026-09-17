# Platina AI OS for Waters — Slice 6 Task Plan: Slim Execution Workspace

**Date:** 2026-09-17
**Status:** Proposed — authorizes Slice 6 execution only
**Governing plan:** [2026-09-11-platina-waters-realtime-full-suite.md](./2026-09-11-platina-waters-realtime-full-suite.md) (+ 2026-09-15 addendum)
**Contract:** [Slice 0 W0.5 action-packet contract](./2026-09-16-platina-slice-0-baseline-and-contract.md) — implemented here exactly as written.
**Predecessor:** [Slice 5](./2026-09-17-platina-slice-5-solutions.md) (done, `36de9c4`)

## Purpose

Give an approved direction a Waters-native place to become work: a work
board, an event-anchored calendar, claims review integrated into the
solution, a final-approval gate that cannot pass with open blockers, and the
exportable action packet. Nothing publishes, schedules, emails, or mutates
any Waters system.

## Schema changes (one migration)

- `platina_solution_tasks` (new): `id`, `workspace_id` FK, `campaign_id` FK
  → `platina_campaigns` (cascade), `title`, `status` enum
  (`todo` | `in_progress` | `blocked` | `review` | `done`), `assignee_id`
  nullable FK users, `due_date` nullable, `event_phase` nullable
  (`pre` | `at` | `post`), `depends_on` nullable (self-reference by id),
  `risk` nullable, `claims_blocked` boolean default false, timestamps.
  Indexes on `workspace_id`, `campaign_id`.
- No enum changes elsewhere.

## Capability

- Add `platina.task.edit` to the capability matrix: owner/admin/member all
  hold it (members work assigned tasks per the Slice 10 role policy; the
  matrix is designed to grow). Final approval and rejection remain
  `gate.publish` / `gate.approve`.

## Modules

- `src/lib/platina/tasks.ts` (pure): board columns, legal status moves
  (forward/backward/free — a task may move anywhere except out of `done`
  without a note is NOT restricted in V1; keep moves free-form but recorded),
  the event task template (`eventTaskTemplate(anchor)` → pre/at/post tasks
  with due-date offsets), and `blockersFor(tasks)` — open claims-blocked or
  incomplete required work.
- `src/lib/platina/export/packet.ts`: `buildActionPacket(...)` → the W0.5
  contract object, exactly the field table (packetVersion 1.0.0, split
  evidence buckets, `syntheticDataExcluded: true` attestation, provenance by
  id only — never raw public content). `packet.schema.json`: the
  machine-readable JSON Schema at the recorded location.
- Claims gate (`src/lib/platina/claims-gate.ts`): deterministic
  `enforceClaims` over the solution's content plan + task titles; a
  deterministic failure blocks final approval unless a named-approver
  exception gate event (`subjectType: "claims_exception"`) exists for the
  campaign.

## Actions (all workspace-scoped, capability-gated, broadcasting)

- `addTaskAction`, `moveTaskAction`, `updateTaskAction` (assignee, due date,
  risk, phase) — `platina.task.edit`.
- `materializeEventTasksAction` — creates the pre/at/post template set for an
  event-anchored solution; idempotent per campaign (existing template tasks
  are detected, not duplicated).
- `publishCampaignAction` (retool of the Slice 1 stub): refuses while claims
  violations lack an exception or blocking tasks are open; on pass, writes
  the `publish` gate event AND transitions the campaign `draft → planned`
  (the audit finding "publish recorded an event but changed no state" ends
  here).
- `claimsExceptionAction` — named-approver exception with required reason
  (`gate.publish` capability).

## Pages

- `/p/[ws]/solutions/[campaignId]` — the solution detail with tabs:
  Summary (contract from the receipt), Work board (five columns, add/move/
  edit), Calendar (event anchor + tasks grouped pre/at/post, date-ordered),
  Claims (deterministic screen over plan + tasks, violations, exception
  form), Decision history (gate events + receipt), Export (packet JSON
  download + printable HTML view link).
- `/p/[ws]/solutions/[campaignId]/export` — printable, self-contained HTML
  (zero external requests, `@media print`, browser Save-as-PDF faithful).
- `/p/[ws]/solutions/[campaignId]/packet.json` — route handler returning the
  versioned JSON with a download content-disposition.
- Solutions index links each campaign to its detail page.

## Test specification

- `tasks.test.ts`: template offsets, blocker detection, board columns.
- `claims-gate.test.ts`: violation blocks; exception passes; clean passes.
- `packet.test.ts`: the built packet validates against `packet.schema.json`;
  the two evidence buckets never merge; synthetic-labelled rows are refused
  from `approvedEvidenceRefs`; no raw public body appears anywhere in the
  packet (provenance by id only).
- Query SQL-shape: task queries workspace-scoped; board moves guarded.
- E2E: `scripts/seed-platina-fixture.ts` (Platina-owned, idempotent) seeds a
  brand chunk + finding-linked receipt + draft campaign + tasks into the
  e2e-fixture workspace; smoke spec gains the solution detail route.

## Done when

An approved direction can be planned, assigned, claims-checked, approved for
external execution (only with blockers closed), and exported as both the
printable view and the versioned JSON packet — entirely under `/p`, with zero
writes to any Waters system. All gates green.

## Explicit non-goals for Slice 6

- No event source presets or readiness scoring (Slice 7).
- No workspace-configured claims rules (Slice 8 — the screen states the
  default lists honestly).
- No outcome import (Slice 9), no alert rules (Slice 10).
- No real PDF service — the printable view plus browser Save-as-PDF is V1.
