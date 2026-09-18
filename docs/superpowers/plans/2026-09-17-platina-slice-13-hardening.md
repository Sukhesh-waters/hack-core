# Platina AI OS for Waters — Slice 13 Task Plan: Hardening and Vercel Release

**Date:** 2026-09-17
**Status:** Proposed — authorizes Slice 13 execution only
**Governing plan:** [2026-09-11-platina-waters-realtime-full-suite.md](./2026-09-11-platina-waters-realtime-full-suite.md) (+ 2026-09-15 addendum)
**Predecessor:** [Slice 12](./2026-09-17-platina-slice-12-transition-matrix.md) (checkpoint artifact — no code)

## Purpose

Make the full suite client-facing and supportable: accessibility on the new
shell, isolation and concurrency proof, the no-external-writes guarantee
enforced mechanically, and a release runbook.

## Work items

- **Accessibility**: aria-labels on the icon-only board move buttons; the
  shell is semantic (nav/main/table/label) — verified by review.
- **Cross-workspace isolation integration test**
  (`src/db/queries/platina.isolation.integration.test.ts`, gated on
  `INTEGRATION_DB=1` per repo convention): seed two workspaces, assert
  workspace A's Platina queries return none of workspace B's rows.
- **Concurrency guards**: SQL-shape assertions that `recordReceiptOutcome`
  carries the `outcome = 'pending'` guard and `createAuditRun` carries the
  idempotency conflict target.
- **No external writes, mechanically**: a new boundary-test case scans every
  walked Platina file for `https://` literals and asserts the allowlist
  (`api.apify.com` only; Supabase/Inngest hosts come from env, never
  literals).
- **E2E**: the header transport pill renders (`Polling` without the secret).
- **Release runbook** (`docs/superpowers/plans/platina-release-runbook.md`):
  environment variables, migration order, rollout/rollback, observability.

## Done when

All quality gates pass, the isolation test proves cross-workspace denial on a
live database, the boundary test proves no Platina code can call an external
host other than the Apify platform API, and the runbook is complete.

## Explicit non-goals for Slice 13

- No deletions (Owner checkpoint B).
- No Vercel project changes — the runbook documents them for the owner.
