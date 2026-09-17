# Platina AI OS for Waters — Slice 7 Task Plan: Conference and Event Readiness

**Date:** 2026-09-17
**Status:** Proposed — authorizes Slice 7 execution only
**Governing plan:** [2026-09-11-platina-waters-realtime-full-suite.md](./2026-09-11-platina-waters-realtime-full-suite.md) (+ 2026-09-15 addendum)
**Predecessor:** [Slice 6](./2026-09-17-platina-slice-6-execution.md) (done, `c38f7a7`) — board, calendar tab, and the pre/at/post template already exist; this slice completes the event pathway.

## Purpose

One event runs from source audit through an approved, exported execution
packet with due outcome review. Slice 6 built the board and the calendar;
Slice 7 adds event setup, conference source presets, event-scoped finding
filters, and an honest readiness computation with missing-work gaps.

## Work items

- **Event setup.** The new-solution form gains an event anchor (date + label);
  `use_case = event_readiness` requires the anchor (refused honestly
  otherwise). `editSolutionAction` can set/move the anchor on a draft.
  Materializing the template (Slice 6) keys off the anchor.
- **Conference source presets** (`src/lib/platina/presets.ts`): a small
  constant list of well-known public conference sources (ASMS, Pittcon, HPLC,
  analytica, ACS) as `conference`-kind targets. The Audits form gains an
  optional preset select; choosing one prefills name/target/kind server-side.
  Presets are conveniences, not bypasses: the scope approval gate is
  unchanged, and the probe/fetch path is identical to a manual URL.
- **Finding filters.** The Findings page gains a use-case filter
  (`competitor_change`, `event_readiness`, `operational`) alongside the
  status tabs. Findings carry `use_case` already; the sweep maps the spec's
  source kind to the finding's use case (conference sources →
  `event_readiness`, else `competitor_change`).
- **Readiness summary** (`src/lib/platina/readiness.ts`, pure): days to the
  anchor, per-phase task completion, missing phases, overdue tasks, claims
  state — rendered as a panel on the solution Summary tab. Missing work is
  listed plainly; no score is fabricated.

## Test specification

- `readiness.test.ts`: days-to-event math, phase completion, missing-phase
  detection, overdue detection, post-event state, no-anchor behavior.
- `presets.test.ts`: presets are valid http(s) URLs of kind `conference`,
  unique keys.
- Sweep mapping test: conference source kind → `event_readiness` use case.
- E2E smoke stays green (fixture detail route renders the readiness panel
  empty state honestly — the fixture campaign has no anchor).

## Done when

An operator can add a conference source from a preset, approve its scope,
see event findings filtered, set an event anchor, materialize the template,
read the readiness panel's gaps, and export the packet — all gates green.

## Explicit non-goals for Slice 7

- No alert delivery for event windows (Slice 10); readiness gaps surface in
  the page, not as notifications.
- No changes to the task template contents.
- No new schema — this slice is application-layer only.
