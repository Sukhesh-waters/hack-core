# Platina AI OS for Waters — Slice 11 Task Plan: Cockpit Completion

**Date:** 2026-09-17
**Status:** Proposed — authorizes Slice 11 execution only
**Governing plan:** [2026-09-11-platina-waters-realtime-full-suite.md](./2026-09-11-platina-waters-realtime-full-suite.md) (+ 2026-09-15 addendum)
**Predecessor:** [Slice 10](./2026-09-17-platina-slice-10-admin-alerts.md) (done, `e95d37c`)

## Purpose

Make the Cockpit the trustworthy executive entry point: the highest-priority
item is identifiable in one glance and reachable in two clicks, with no stale
or unsupported KPI.

## Work items

- **Priority inbox** (`src/lib/platina/inbox.ts`, pure + tested): composes the
  decision queue from real rows — findings needing a decision (severity-ordered),
  overdue/due receipts, draft audit scopes, draft solutions blocked on final
  approval — ordered by severity → overdue → freshness. Each item deep-links
  to its action surface.
- **Source health**: per-source freshness from real run/probe timestamps
  (fresh / stale / no data / failing from the last run outcome), reusing
  `freshnessState`. No invented provider telemetry: run health is derived
  from audit-run outcomes, which is what actually executes.
- **Live activity timeline**: gate events + audit-run events + alert
  deliveries merged into one recent-activity list, newest first, each entry
  linking to its surface.
- The existing health row, decision row, and portfolio stay; the Cockpit
  gains the inbox above the fold.

## Test specification

- `inbox.test.ts`: ordering (severity, overdue before due, fresh last),
  empty state, deep-link targets, caps.
- Existing gates stay green; e2e smoke unchanged (Cockpit h1 unchanged).

## Done when

An executive can identify the highest-priority issue and reach the correct
action in two clicks; every number and row on the Cockpit traces to a real
workspace-scoped query.

## Explicit non-goals for Slice 11

- No new data sources; the Cockpit composes what exists.
- No cross-workspace views (Deferred per R3).
