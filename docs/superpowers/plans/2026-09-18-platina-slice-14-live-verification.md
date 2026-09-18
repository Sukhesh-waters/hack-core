# Platina AI OS for Waters — Slice 14 Task Plan: Live Verification and Convergence

**Date:** 2026-09-18
**Status:** Owner-approved 2026-09-18 (scope: all; Realtime secret authorized)
**Governing plan:** [2026-09-11-platina-waters-realtime-full-suite.md](./2026-09-11-platina-waters-realtime-full-suite.md) (+ 2026-09-15 addendum)
**Predecessor:** [Slice 13](./2026-09-17-platina-slice-13-hardening.md) (done, `a1f999d`)

## Purpose

Close the gap between "built and tested" and "proven live," and remove the
simplifications that accumulated across slices. Owner-approved scope: all of
it — live pipeline proof, Realtime live, orchestrator honesty, alert breadth,
cleanup, eval re-run.

## Work items

1. **Orchestrator honesty.** The `brand_divergence`, `ideation`, and
   `claims_screen` analysis stages never execute in a run — they are separate
   product surfaces that already exist (Slice 8 copy audit, Slice 5 drafting,
   Slice 6 claims gate). The Admin analysis-sequence checkboxes wrote config
   that changed nothing — a fake control. The section becomes a read-only
   pipeline statement; `saveConfigAction` stops accepting sequence edits.
2. **Alert breadth.** `platina_alert_rules` gains a `source` column
   (`outcome` | `finding` | `approval` | `run`, default `outcome`). The sweep
   evaluates each rule against its source's record: latest outcome metrics
   (existing), open needs-decision findings count, pending receipts count,
   failed/degraded runs in the last 24 h. Delivery ledger and 24 h
   suppression are unchanged.
3. **Cleanup.** Drop the vestigial `cadence` text column (unused since
   `cadence_minutes` landed in Slice 3). Fix the Cockpit "Approvals recorded"
   tile to link to Admin (the config history ledger) instead of Outcomes.
4. **Live pipeline proof.** Inngest dev + Next dev: one real run on the
   fixture workspace from an approved competitor source through fetch,
   contradiction, and a persisted finding. The trace is recorded as
   `docs/superpowers/plans/2026-09-18-slice-14-live-trace.md`.
5. **Realtime convergence.** With `PLATINA_REALTIME_SECRET` set (local,
   gitignored), a Playwright two-tab test: a run triggered in tab A appears
   in tab B without refresh.
6. **Live eval re-run** in a clean child environment.
7. **Legacy notices** (Slice 12 step 2, non-destructive): each legacy route
   gains the "Moved to…" notice linking its replacement. No redirects, no
   deletions — those still wait for the signed matrix.

## Done when

The pipeline trace exists with real rows at every step; two tabs converge
without refresh; the Admin surface contains no control that writes config
without changing behavior; alert rules cover all four sources; the eval
passes clean; all gates green.

## Explicit non-goals for Slice 14

- No deletions and no redirects (checkpoint B sign-off on the matrix first).
- No Vercel project changes (the runbook documents them for the owner).
