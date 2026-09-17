# Platina AI OS for Waters — Slice 5 Task Plan: Evidence-Grounded Solutions

**Date:** 2026-09-17
**Status:** Proposed — authorizes Slice 5 execution only
**Governing plan:** [2026-09-11-platina-waters-realtime-full-suite.md](./2026-09-11-platina-waters-realtime-full-suite.md) (+ 2026-09-15 addendum, R4.2–R4.5)
**Predecessor:** [Slice 4](./2026-09-17-platina-slice-4-findings-validation.md) (done, `018d755`) — the R5.2 eval harness gates R4.3/R4.4.

## Purpose

Convert validated findings into honest, evidence-grounded responses: semantic
retrieval wired into solution drafting as two separately labelled buckets,
the workspace minimum-N consumed instead of a hardcoded one, a similarity
floor with a distinct `insufficient_relevance` state, hybrid lexical search
and reranking measured against the eval baseline, and citation identifiers
validated server-side against workspace-scoped rows.

## Schema changes (one migration)

- `platina_workspace_config` gains `similarity_floor` real default `0.35`
  (exposed in Admin in Slice 10; constant until then).
- `platina_campaigns` gains `use_case` text nullable — one of the five
  Waters use cases; set at direction approval.

## Retrieval pipeline (src/lib/platina)

New order of operations in `retrieve.ts`:

1. Embed the topic through the model router (existing path).
2. Vector candidates: top 20 per plane (version-filtered, R4.1).
3. Lexical candidates: Postgres `tsvector`/`plainto_tsquery` + `ts_rank`,
   top 20 per plane (R4.4 — exact model numbers and method codes).
4. Reciprocal rank fusion of the two rankings per plane (pure `fusion.ts`).
5. Similarity floor: when the best fused evidence score is below the floor,
   the result carries `relevance: "insufficient_relevance"` — distinct from
   `insufficient_baseline` (R4.2; different operator action).
6. Rerank (R4.3): one bounded model-router scoring pass over the fused
   candidates (a single batched call, inside router budget enforcement).
   Router failure → the fused order stands, marked `reranked: false`.
7. Return the two buckets separately, never merged.

- `chunking.ts` (R4.5): `chunkRecord` — one campaign/outcome record is one
  atomic chunk; `chunkProse` — paragraph-boundary splitting with a size cap
  for long declarations. `declareBrandAction` routes long declarations
  through `chunkProse` (each chunk embedded, `chunk_index` ordered).
- Citation validation: `validateCitationIds(workspaceId, brandIds, brainIds)`
  returns the ids that do not exist in this workspace; `approveDirectionAction`
  refuses when any cited id is foreign or fabricated (the hidden form fields
  are client-tamperable — this is the server-side enforcement).

## Solutions UI

- `/solutions/new` is topic-driven: the finding prefills the topic; otherwise
  the operator enters the problem statement. Retrieval runs server-side on
  GET; the page shows the two labelled buckets with scores, the relevance
  state, and the min-N state — each insufficiency state with its own message
  and next action.
- `/solutions` lists campaigns joined to their receipts (severity, urgency,
  expected outcome, use case). Draft solutions gain: edit (plan fields) and
  reject (immutable `rejected` gate event + status `closed`). Approve stays.
- Solutions and approval updates broadcast on the `solutions` scope.

## Test specification

- `chunking.test.ts`: record atomicity; prose splits on paragraph boundaries,
  caps size, never splits mid-record.
- `fusion.test.ts`: RRF ordering, disjoint lists, ties, empty inputs.
- `rerank.test.ts`: scoring pass orders by model scores; router failure
  returns the fused order untouched with `reranked: false`.
- `retrieval` tests: `insufficient_relevance` vs `insufficient_baseline` are
  distinct states with distinct messages; floor boundary.
- Query SQL-shape: lexical queries are workspace-scoped and version-filtered;
  citation validation is workspace-scoped.
- Eval: `PLATINA_EVAL_LIVE=1` run locally records the pre-/post-pipeline
  recall@5 in the commit notes; the harness gates regression.
- E2E smoke stays green.

## Done when

A solution draft cites only workspace-owned, version-current evidence;
below-floor retrieval shows `insufficient_relevance` (never a fabricated
ranking); a tampered citation id is refused; edit/reject/approve all persist
and broadcast; the eval harness shows no regression against the pre-rerank
baseline.

## Explicit non-goals for Slice 5

- No work board, calendar, or claims-tab integration (Slice 6).
- No outcome write-back (Slice 9); record-boundary chunking is ready for it.
- No Admin threshold editing for the similarity floor (Slice 10).
- No prompt-version management UI (Slice 10).
