# Platina AI OS for Waters — Slice 3.5 Task Plan: Thin Vertical Proof

**Date:** 2026-09-17
**Status:** Proposed — authorizes Slice 3.5 execution only
**Governing plan:** [2026-09-11-platina-waters-realtime-full-suite.md](./2026-09-11-platina-waters-realtime-full-suite.md) (+ 2026-09-15 addendum, R2)
**Predecessor:** [Slice 3](./2026-09-17-platina-slice-3-waters-audits.md) (done, `2f680bd`)

## Purpose (R2)

Prove one narrow vertical path end to end before breadth: a single competitor
change traced in a browser from scheduled scan through finding, human ruling,
approved solution, and graded receipt — every step persisted through the
production schema. No mocked data path, no parallel prototype tables.

Deliberately minimal scope (R2, amended by A4):

- One use case: competitor and market change.
- One source kind: `competitor_site` (most reliable per the actor matrix).
- One finding path: `agreed` and `contested` only. Qualified, dismissed, and
  superseded are Slice 4.
- One solution with the full recommendation contract, no work board.
- One receipt, graded against clearly labelled seeded synthetic outcome data.
  Synthetic rows are structurally excluded from evidence write-back, min-N
  baselines, and retrieval (A4) — the flag lands now, the write-back consumer
  lands in Slice 9 and must refuse synthetic rows.

## Schema changes (one migration)

- `platina_findings` (new): `id`, `workspace_id` FK, `signal_document_id`,
  `transcript_id`, `brain_chunk_id` (all nullable links), `use_case` text
  default `competitor_change`, `title`, `summary`, `strongest_objection`
  nullable, `severity` text default `medium`, `status` enum
  (`new` | `needs_decision` | `validated` | `refuted`), `human_ruling`
  nullable, `ruled_by` nullable FK users, `ruled_at` nullable, timestamps.
  Workspace index; signal index.
- `platina_receipts` gains (recommendation contract carriers): `finding_id`
  nullable, `severity` text nullable, `urgency` text nullable,
  `strongest_uncertainty` nullable, `measurement_method` nullable.
- `platina_outcomes` gains `synthetic` boolean not null default false and
  `source` text nullable. Synthetic = demo data, never evidence.

## Behavior changes

- `contradict-sweep` processes only `processing_state = "unprocessed"`
  signal documents (the current blind re-read ends), marks each processed
  after its round, and creates findings: `agreed` → finding `new` + Brain
  chunk (existing); `contested` → finding `needs_decision`, no Brain chunk;
  `refuted` → transcript only (existing).
- `ruleFindingAction` (capability `gate.approve`): `needs_decision` →
  `validated` | `refuted` with a required ruling note. Guarded at the query
  level — a ruled finding cannot be re-ruled in 3.5 (supersede is Slice 4).
  Immutable and attributed (`ruled_by`, `ruled_at`).
- Findings page: findings list with status, severity, summary, strongest
  objection, expandable provenance (signal/transcript/brain ids), and the
  ruling form on `needs_decision`. Derived-hypothesis list remains below as
  provenance context.
- Solutions/new: accepts `?findingId=` — prefills title and hypothesis from
  the finding and carries the finding link onto the receipt. The approval
  form gains the full recommendation contract fields: severity, urgency,
  strongest uncertainty, expected outcome, measurement method, review date.
- Outcomes page: synthetic rows are labelled "Synthetic demo data — not
  evidence" and visually separated.
- Cockpit decision row gains "Findings awaiting a decision" with a working
  link.
- `scripts/platina-seed-synthetic-outcome.ts`: idempotent, strictly additive,
  inserts one clearly labelled synthetic outcome for a workspace (optionally
  linked to a receipt id passed as argv[2]). Marked `synthetic: true`,
  `source: "synthetic-demo"`.

## Test specification

- Finding lifecycle unit tests: agreed/contested/refuted mapping from
  `resolve()` states; ruling guard (only `needs_decision` is rulable);
  ruling attributes and persists.
- Query SQL-shape tests: findings queries workspace-scoped; unprocessed-only
  signal query asserts `processing_state` filter; synthetic-excluding outcome
  query asserts `synthetic = false`.
- Boundary test stays green.
- E2E: existing smoke stays green (Findings h1 unchanged). The full browser
  trace is the manual acceptance journey A, recorded in the commit/PR notes.

## Done when

A competitor change can be traced: approved source → run → signal document →
contradiction transcript → finding → (if contested) human ruling → approved
solution carrying the full contract → receipt → graded verdict — with every
row workspace-scoped and every transition persisted. Synthetic demo data is
labelled and excluded from any evidence path.

## Explicit non-goals for Slice 3.5

- No qualified/dismissed/superseded finding states, no review queue filters
  (Slice 4).
- No semantic retrieval wiring (Slice 5), no work board (Slice 6).
- No outcome import pipeline or write-back consumer (Slice 9) — only the
  synthetic flag and the exclusion contract it must honor.
- No alert rules UI (Slice 10).
