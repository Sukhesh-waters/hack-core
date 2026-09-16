# Platina Route and Use-Case Inventory

**Date:** 2026-09-16
**Slice:** 0, workstream W0.1
**Governing plan:** [2026-09-11-platina-waters-realtime-full-suite.md](./2026-09-11-platina-waters-realtime-full-suite.md) (+ 2026-09-15 addendum)
**Task plan:** [2026-09-16-platina-slice-0-baseline-and-contract.md](./2026-09-16-platina-slice-0-baseline-and-contract.md)

Every row below was verified against the cited file on 2026-09-16. Status
vocabulary: **Live** (behaves as the target product requires), **Partial**
(exists but does not meet the target contract), **Gap** (target requires it,
nothing exists), **Deferred** (explicitly postponed with a recorded reason),
**Refused** (must never ship in Platina).

## Routes and shell surfaces

| Route / surface | Verified current behavior | Target (transition table) | Status |
|---|---|---|---|
| `/p/[ws]` (`src/app/(platina)/p/[ws]/page.tsx`) | Five count tiles (scan specs, brain insights, receipts, campaigns, gate events); copy reads "InstaMedia stays at `/w/{ws}`"; eyebrow "S2 · cockpit"; cannot start, monitor, or inspect work | Cockpit (rebuilt Slice 1, completed Slice 11) | Partial |
| `/p/[ws]/brand` (`src/app/(platina)/p/[ws]/brand/page.tsx`) | Declare-standard textarea (gate `declare` via `declareBrandAction`); lists Plane A chunks; "N Gate 1 events written"; eyebrow "S1 · gate 1" | `/admin/brand` | Partial |
| `/p/[ws]/scans` (`src/app/(platina)/p/[ws]/scans/page.tsx`) | Creates draft spec with one target, `kind` hardcoded `competitor_site`; "Gate 2 · confirm fetch" approves and sends `platina/scan.requested`; no run status or `lastRunAt` lifecycle; eyebrow "S3–S5 · gate 2" | `/audits` | Partial |
| `/p/[ws]/brain` (`src/app/(platina)/p/[ws]/brain/page.tsx`) | Lists active Brain chunks exposing `gen`, `agreementState`, `confidence`, `status`; eyebrow "S6–S7 · plane C" | `/findings` (+ hidden technical provenance) | Partial |
| `/p/[ws]/ideation` (`src/app/(platina)/p/[ws]/ideation/page.tsx`) | Two-bucket list; `minNGate(chunks, 1)` hardcodes min-N of 1; `draftProposals` is deterministic — no model call, no semantic retrieval; Gate 3 approval writes receipt + campaign with hardcoded `proposeCampaignDetail` values; eyebrow "S8–S10 · gate 3" | `/solutions/new` | Partial |
| `/p/[ws]/campaigns` (`src/app/(platina)/p/[ws]/campaigns/page.tsx`) | Campaign list; "Gate 4 · approve to ship" writes a gate event only — no campaign state change, no executable work; eyebrow "S10–S11 · gate 4" | `/solutions` | Partial |
| `/p/[ws]/claims` (`src/app/(platina)/p/[ws]/claims/page.tsx`) | Deterministic screen via `enforceClaims` with hardcoded banned/regulated lists; disconnected from the Brand Gene and final approval | Solution Claims tab + `/admin/claims` | Partial |
| `/p/[ws]/receipts` (`src/app/(platina)/p/[ws]/receipts/page.tsx`) | Receipt list; grading writes `worked` / `did_not_work` / `inconclusive`; no write-back to first-party evidence, no demotion of contradicted hypotheses; eyebrow "S9 · S12" | `/outcomes` + solution Decision history | Partial |
| `/p/[ws]/config` (`src/app/(platina)/p/[ws]/config/page.tsx`) | Threshold form (`minBaselineN`, `contestedFloor`, `qualifiedFloor`) gated by `gate.approve`; saved values are not consumed by the runtime paths they govern (contradiction uses `CONTESTED_FLOOR`/`QUALIFIED_FLOOR` constants in `src/lib/platina/contradiction.ts`; ideation hardcodes 1); eyebrow "SOP harness" | `/admin` | Partial |
| Sidebar "Open InstaMedia" link (`src/components/platina/sidebar.tsx`) | Links to `/w/[ws]/overview` from every Platina page | Removed in Slice 1 | Refused |
| `/p/[ws]/audits`, `/findings`, `/solutions`, `/outcomes`, `/admin/*` | Do not exist | Registered by Slice 1 shell | Gap |
| Realtime / live invalidation | No Platina Realtime subscriber, status grammar, or polling fallback exists | Slice 2 event spine | Gap |
| Audit run lifecycle (`platina_audit_runs`, run events) | No run table; scan status/`lastRunAt` not maintained through the job lifecycle | Slice 2 schema + orchestrator | Gap |
| Cross-division executive rollup | Not present; one workspace = one division × region | Deferred per R3 — a future read-only cross-workspace executive view requires its own owner-approved contract covering authorization, aggregation rules, and minimum sample suppression | Deferred |
| `platina_campaigns.sop_run_id` bridge (`src/db/platina-schema.ts`) | Column exists; no application code reads or writes it (verified 2026-09-16) | Archived — never read/written/executed; W0.3 inspects rows; drop migration follows separately | Refused |
| Alert actions `hub_message` / `ticket` / `email` (`src/db/platina-schema.ts`) | Type allows the three archived kinds; `alert-sweep` evaluates but never delivers; `src/lib/platina/alerts.test.ts` fixtures still use the archived kinds | Archived — V1 routes `in_app` only; enum migration is a later slice | Refused |

## Background functions

The eight Platina Inngest functions registered in
`src/app/api/inngest/route.ts`:

| Function (`src/inngest/functions/platina/`) | Trigger | Current behavior | Moves workflow? |
|---|---|---|---|
| `signal-scan.ts` | cron `0 */6 * * *` + `platina/scan.requested` | Fetches approved specs through the registered `apify` adapter (which invokes an Instagram-post connector — see the W0.2 exception) and inserts signal documents; no run status, no dedupe hash | Partially |
| `contradict-sweep.ts` | cron `30 */6 * * *` + `platina/contradict.requested` | Re-reads up to 5 unresolved signals per workspace, runs one contradiction round, writes transcript + Brain chunk; contested/refuted are counted, not routed | Partially |
| `brain-maintenance.ts` | cron `0 4 * * 1` | Compacts stale gen-0 groups into gen-1 records | Yes |
| `receipt-review.ts` | cron `0 9 * * *` | Counts due receipts per workspace | No |
| `outcome-ingest.ts` | cron `0 2 * * *` | Counts outcome rows per workspace | No |
| `alert-sweep.ts` | cron `0 * * * *` | Evaluates rules against latest outcome with hardcoded `minN: 5`; counts matches; delivers nothing | No |
| `event-window.ts` | cron `0 6 * * *` | Counts campaigns inside the event window | No |
| `divergence-scan.ts` | cron `0 5 * * 1` | Counts brand chunks per workspace | No |

## Outbound network surface

Every network call reachable from `/p` code, verified 2026-09-16:

- Apify `run-sync-get-dataset-items` endpoint — reached transitively via
  `@/lib/connectors/apify` from `src/lib/platina/fetch/apify.ts`.
- Model router providers (Groq / Gemini / Bedrock) via `src/lib/ai/router.ts`.
- Inngest event sends via `src/inngest/client.ts`.
- The Supabase Postgres connection (`DATABASE_URL`).

No Waters production, test, QA, CRM, marketing-automation, DAM, CMS, email,
ad, or event system endpoint or credential exists in `/p` code. Confirmed: no
write path to any Waters system.

## Reviewed exception: global enumerations

`listApprovedScanSpecs()` and `listActiveAlertRules()` in
`src/db/queries/platina.ts` are deliberately global enumerations for cron
fan-out (per-record workspace scoping happens downstream in the per-workspace
step). Recorded, not changed — Slice 0 changes no behavior. Both must gain
workspace-scoped audit-run writes when Slice 2 lands the run schema.

---

*Owner review of this inventory is part of the Slice 0 done-when gate.*
