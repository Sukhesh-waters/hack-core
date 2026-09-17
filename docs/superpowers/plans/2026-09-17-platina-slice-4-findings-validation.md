# Platina AI OS for Waters — Slice 4 Task Plan: Findings and Human Validation

**Date:** 2026-09-17
**Status:** Proposed — authorizes Slice 4 execution only
**Governing plan:** [2026-09-11-platina-waters-realtime-full-suite.md](./2026-09-11-platina-waters-realtime-full-suite.md) (+ 2026-09-15 addendum, R5)
**Predecessor:** [Slice 3.5](./2026-09-17-platina-slice-3-5-vertical-proof.md) (done, `97648cf`)

## Purpose

Make the contradiction layer operational at breadth: every resolution state
has a visible, correct path; rulings cover validate / rule-out / dismiss /
supersede with permissions; Brain and Brand content is actually embedded
through the model router (R4.1 version-filtered); the challenger has an
honest "no material objection" output with objection-rate telemetry (R5.1);
and the retrieval evaluation harness exists with a hand-labelled set (R5.2).

## Schema changes (one migration)

- `platina_finding_status` enum gains `dismissed` and `superseded`
  (`ALTER TYPE ... ADD VALUE`). No table changes.

## Behavior

- **Batch-scoped sweep.** `platina/contradict.requested` carrying a
  `workspaceId` processes only that workspace's unprocessed signals; the
  6-hour cron remains the global backstop.
- **Finding review actions** (capability `gate.approve`, note always
  required — the note is the audit trail):
  - `new` → validate → `validated`; dismiss → `dismissed`.
  - `needs_decision` → validate → `validated`; rule out → `refuted`;
    dismiss → `dismissed`.
  - `validated` → supersede → `superseded` (note names the successor).
  - `dismissed` / `refuted` / `superseded` are terminal in V1.
  - One guarded query `transitionFinding` (status-in-from-list guard) makes
    illegal and repeat transitions unrepresentable.
- **Embedding at write time.** Brand declarations and Brain chunks are
  embedded through `routeAI({ kind: "embed" })` at insert. Embed failure
  stores the row with a null embedding (retrieval simply cannot surface it
  semantically) — never a fabricated vector. Retrieval queries filter
  `embedding_model_version = PLATINA_EMBEDDING_MODEL_VERSION` (R4.1).
- **Honest challenger (R5.1).** The challenger may answer with no material
  objection; `parseAttack` maps an empty/`NONE` objection to the canonical
  `NO_MATERIAL_OBJECTION` marker with `confounderStrength: 0`.
- **Objection-rate telemetry (R5.1).** `objectionRate` =
  (contested + refuted) / rounds over the recent window; pure, with
  `objectionCeilingExceeded(rounds, { ceiling: 0.8, minRounds: 10 })`. After
  each workspace batch the sweep computes the rate over the last 20
  transcripts; a breach creates one open operational finding
  (`use_case: "operational"`, severity high, needs_decision) against the
  current prompt version — deduped while one is already open. The Findings
  page shows the rate in a Validation health panel.
- **Retrieval evaluation (R5.2).** `eval-set.ts` holds 30+ hand-labelled
  query → expected-record pairs across exact-string (model numbers, method
  codes) and semantic categories, referencing the CI fixture workspace.
  `eval.ts` runs recall@5 with injected deps. CI runs set-integrity and
  runner-correctness tests against a fake store; live mode (real embeddings
  + DB) runs where `GEMINI_API_KEY`/`DATABASE_URL` exist — same skip pattern
  as the repo's integration tests. This harness gates R4.3/R4.4 in Slice 5.

## UI

- Findings page: status filter tabs (All / Needs decision / New / Validated /
  History), per-state actions, Validation health panel (objection rate,
  window size, ceiling state), provenance drawer unchanged.
- Cockpit decision row already surfaces `needs_decision` (3.5) — unchanged.

## Test specification

- `findings.test.ts`: full transition table (legal and illegal per state),
  verdict validation.
- `objection-rate.test.ts`: rate math, min-rounds floor, ceiling boundary.
- `debate.test.ts`: the no-material-objection parse path.
- `eval.test.ts`: set integrity (≥30 pairs, unique queries, both categories
  present), runner recall correctness on a fake store, live mode skipped
  without env.
- Query SQL-shape: `transitionFinding` guard carries workspace + id + from
  status; transcript window query is workspace-scoped; retrieval queries
  assert the embedding-version filter.
- E2E: smoke stays green; Findings renders the filter tabs.

## Done when

Each signal is processed once; all six finding states have a visible correct
path; rulings are immutable and attributed; new Brain/Brand rows carry real
embeddings tagged with the model version; the objection rate is visible and
alarms as an operational finding; the eval harness runs in CI (structural)
and locally (live). All gates green.

## Explicit non-goals for Slice 4

- No semantic-retrieval wiring into Solutions (Slice 5), no reranking or
  BM25 (R4.3/R4.4 — gated by this slice's eval harness).
- No alert-rule CRUD or delivery (Slice 10); the operational finding is the
  in-app path.
- No work board (Slice 6), no outcome write-back (Slice 9).
