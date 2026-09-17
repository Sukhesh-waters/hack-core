# Platina AI OS for Waters — Slice 1 Task Plan: Blue/White Shell and Information Architecture

**Date:** 2026-09-17
**Status:** Proposed — authorizes Slice 1 execution only
**Governing plan:** [2026-09-11-platina-waters-realtime-full-suite.md](./2026-09-11-platina-waters-realtime-full-suite.md) (+ 2026-09-15 addendum)
**Predecessor:** [Slice 0 task plan](./2026-09-16-platina-slice-0-baseline-and-contract.md) (executed, gates green at `70947e8`)

## Purpose

Deliver the full-shell redesign with honest functionality only: executive
blue/white visual system, outcome-oriented navigation (Cockpit, Audits,
Findings, Solutions, Outcomes, Admin), existing real data mapped into the new
destinations, old routes left reachable for comparison. No fake KPI, no
enabled control that performs no work, no live badge before Slice 2 lands the
Realtime spine.

## Resolved constraints (from the governing plan and Slice 0)

- Business language per the [copy glossary](./platina-copy-glossary.md); no
  S1–S12, Plane A/B/C, Gate 1–4, generation, or confidence jargon in primary
  copy. Technical terms live in expandable provenance panels.
- The Cockpit header shows the workspace name only in Slice 1; division and
  region land with the Slice 2 profile migration (R3 amendment).
- Old routes stay reachable and unchanged; transition notices and redirects
  are per-route decisions at their transition slices, deletions wait for
  Owner checkpoint B.
- The dependency-boundary test (`src/lib/platina/boundary.test.ts`) must stay
  green; new code uses only allowlisted imports.
- No static inline styles; semantic Tailwind tokens only (the
  theme-migration test enforces this).

## Visual system implementation

- Add a `.platina-shell` token scope in `src/app/globals.css` that redefines
  the semantic tokens (`--primary`, `--ring`, `--accent`, etc.) to the Waters
  blue palette for `/p` only. InstaMedia's teal identity under `/w` is
  untouched.
  - Primary: Waters blue `#005EB8` (HSL `211 100% 36%`).
  - Accent/secondary: pale blue surfaces.
  - Text: navy/slate (existing foreground tokens already slate-navy).
  - Green/amber/red remain reserved for operational status.
  - The scope forces the light executive theme inside `/p` even when the OS
    prefers dark (the owner-approved design is blue + white).
- Shell layout: left sidebar (workspace name, six destinations, freshness
  footer) + executive header (breadcrumbs, page title slot, "data as of"
  timestamp from the query that rendered the page).

## Route map and data mapping

New routes (new files; old routes untouched):

| New route | Maps data from | Actions wired (existing server actions) |
|---|---|---|
| `/p/[ws]` (Cockpit, rebuilt) | scan specs, brain chunks, receipts, campaigns, gate events | none (read + links only) |
| `/p/[ws]/audits` | scan specs | `createScanSpecAction`, `confirmScanAction` |
| `/p/[ws]/findings` | brain chunks (hypotheses) with expandable provenance | none |
| `/p/[ws]/solutions` | campaigns | `publishCampaignAction` ("Ready for external execution") |
| `/p/[ws]/solutions/new` | brand + brain buckets, support/min-N gates | `approveDirectionAction` ("Direction approved") |
| `/p/[ws]/outcomes` | receipts + outcomes | `gradeReceiptAction` |
| `/p/[ws]/admin` | workspace config | `saveConfig` (moved, still `gate.approve`-guarded) |
| `/p/[ws]/admin/brand` | brand chunks + declare events | `declareBrandAction` ("Brand standard confirmed") |
| `/p/[ws]/admin/claims` | claims screening tool | `enforceClaims` (deterministic, hardcoded lists — Admin rules land in Slice 8) |

`src/app/(platina)/p/[ws]/actions.ts` gains `revalidatePath` calls for the new
route paths alongside the old ones. No action logic changes.

Navigation (`src/lib/platina/nav.ts`): six primary destinations. Old routes
are removed from nav but remain reachable by URL. `nav.test.ts` updated.

## Honesty rules for this slice

- Cockpit counts are real DB counts; freshness timestamps come from real
  `createdAt` values; the header shows "data as of" the render — no live
  indicator until Slice 2.
- Empty states name the exact setup action (e.g. "Define an audit source in
  Audits to start observing").
- Claims page copy states the rules are workspace defaults pending Admin
  configuration (Slice 8), not a hidden hardcode.
- Buttons only where a server action exists and is wired.

## Test specification

- Update `e2e/fixtures/platina.ts` `PLATINA_ROUTES` to the nine new routes
  with their h1s; keep a second table for the nine legacy routes and assert
  both render (comparison availability).
- Update `src/lib/platina/nav.test.ts` for the six-destination structure.
- Boundary test stays green (no new import families).
- Gates: `npm run typecheck && npm run lint && npm test && npm run build` plus
  `npm run test:e2e`.

## Done when

Every primary route renders in the Waters visual system, all navigation
works, old data remains reachable on both new and legacy routes, no button
pretends to perform an unwired action, and all gates are green.

**Owner checkpoint A** then approves: visual direction, wording, route map,
and old-to-new feature mapping.

## Explicit non-goals for Slice 1

- No schema changes, no migrations.
- No Realtime/polling wiring (Slice 2).
- No new server actions, no changes to existing action logic beyond
  revalidate paths.
- No route deletions, redirects, or "Moved to…" notices.
- No changes under `/w` or to InstaMedia theming.
