# Platina AI OS for Waters — Slice 9 Task Plan: Outcomes and Slow-Loop Verification

**Date:** 2026-09-17
**Status:** Proposed — authorizes Slice 9 execution only
**Governing plan:** [2026-09-11-platina-waters-realtime-full-suite.md](./2026-09-11-platina-waters-realtime-full-suite.md) (+ 2026-09-15 addendum, R5.3)
**Predecessor:** [Slice 8](./2026-09-17-platina-slice-8-brand-claims.md) (done, `66242b3`)

## Purpose

Make "effective solution" measurable rather than rhetorical. A recorded,
consented result changes the related receipt, the first-party evidence layer,
conflicting derived hypotheses, and the next recommendation — exactly once.

## Schema changes (one migration)

- `platina_outcome_imports` (new): `id`, `workspace_id` FK, `source` text,
  `file_hash` text, `status` text (`completed` | `failed`), `row_count`,
  `inserted_count`, `skipped_count`, `errors` jsonb, `created_by` FK users,
  `created_at`. Workspace index.
- `platina_brain_chunks` gains `demoted_by_receipt_id` text nullable (R5.3
  refutation memory: the link to the measured evidence that contradicted the
  hypothesis).

## Modules

- `src/lib/platina/outcomes.ts` (pure):
  - `parseOutcomeCsv(text)` — header-validated CSV (`leads, qualified_leads,
    conversion_rate, pipeline_contribution, quality_score?, campaign_id?,
    receipt_id?, recorded_at?`), per-row errors with line numbers, never a
    partial silent parse.
  - `outcomeRowHash(row)` — sha256 over the normalized row for dedupe
    against existing rows.
  - `leadQualityScore(row)` — documented heuristic: 0.5 × qualified ratio +
    0.3 × conversion rate (capped) + 0.2 × pipeline signal (capped at
    $100k). Labelled a heuristic in copy; never shown below min-N.
- `src/lib/platina/writeback.ts`: `gradingWriteback(receipt, outcome)` —
  pure decision: worked → evidence chunk content + no demotions;
  did_not_work → evidence chunk + the receipt's linked hypotheses demoted
  (confidence floored, excluded from retrieval by the existing
  `status = active` filter, retained with `demoted_by_receipt_id`); 
  inconclusive → evidence chunk marked as such, no demotion.

## Behavior

- **Import** (`importOutcomesAction`, capability `gate.approve` — members
  cannot import authoritative outcomes per the Slice 10 policy): validate
  schema, link to campaign/receipt, dedupe by row hash against existing
  outcome rows, insert with `source` and import id, record the import row
  with counts and errors. Synthetic stays false — this is consented
  first-party data.
- **Grading write-back** in `gradeReceiptAction` (guarded pending → graded,
  so it runs exactly once): the measured verdict becomes a Plane A chunk
  (record-boundary, R4.5; `outcome://<receiptId>` source ref; embedded at
  write time). `did_not_work` additionally demotes the receipt's linked
  Brain chunks with the receipt link (R5.3).
- **Min-N on aggregates**: the Outcomes page shows aggregate lead-quality
  stats only when first-party (non-synthetic) outcomes meet the workspace
  minimum; otherwise the honest insufficient-baseline state. Individual rows
  always list.
- **Due reviews**: the review queue orders overdue-first with an overdue
  badge.
- Broadcasts on the `outcomes` scope for import and grading.

## Test specification

- `outcomes.test.ts`: CSV parse (valid, bad header, bad rows with line
  numbers), row-hash dedupe stability, lead-quality formula boundaries,
  min-N gating.
- `writeback.test.ts`: worked/did_not_work/inconclusive decisions, exactly-once
  guard, demotion floors confidence and retains the record.
- SQL-shape: import and outcome queries workspace-scoped; synthetic excluded
  from first-party reads.
- E2E smoke stays green.

## Done when

A recorded result changes the related receipt, the evidence layer, the
conflicting hypotheses, and the next retrieval exactly once; synthetic demo
rows never enter any of them; aggregates below min-N show the honest state.

## Explicit non-goals for Slice 9

- No direct Waters connector (a future read-only connector needs its own
  owner-approved contract).
- No alert rules (Slice 10), no Cockpit composition changes (Slice 11).
- No CSV upload file — pasted CSV is V1 (no binary asset pipeline).
