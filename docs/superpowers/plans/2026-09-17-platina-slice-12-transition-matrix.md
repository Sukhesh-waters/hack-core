# Platina Route Transition Matrix — Owner Checkpoint B Review

**Date:** 2026-09-17
**Slice:** 12 — manual feature-elimination checkpoint
**Governing plan:** [2026-09-11-platina-waters-realtime-full-suite.md](./2026-09-11-platina-waters-realtime-full-suite.md) (transition policy: demonstrate old → demonstrate new → parity → decision → notice → redirect → delete only after E2E green + checkpoint B)

**Nothing in this document deletes anything.** Each row is a decision the
owner signs. Deletions land only after the signed decision, the redirect, and
green E2E.

## How to review

For each route: open the old route and its replacement side by side
(`npm run dev`, workspace `/p/<id>`), confirm the replacement carries the
same data, then record **keep / merge / redirect / remove** with date and
approver.

## Route matrix

| Legacy route | Old behavior | Replacement (verified) | Parity notes | Decision |
|---|---|---|---|---|
| `/p/[ws]/brand` | Declare-standard textarea; Plane A chunk list; gate-1 count | `/p/[ws]/admin/brand` — direct declare + sourced, freshness-tracked standard | Replacement is a superset (adds sources, summary, freshness). Old page's declare form writes the same table. | ☐ keep ☐ merge ☐ redirect ☐ remove — date: ____ approver: ____ |
| `/p/[ws]/scans` | Draft spec create; gate-2 confirm; spec list | `/p/[ws]/audits` — kind/cadence/presets, freshness, run history, Run now | Replacement is a superset. Same actions write the same tables. | ☐ keep ☐ merge ☐ redirect ☐ remove — date: ____ approver: ____ |
| `/p/[ws]/brain` | Brain chunk list with gen/confidence/status | `/p/[ws]/findings` — governed findings + provenance drawer | Findings carry the operator-facing content; raw Brain rows remain visible in the provenance drawer. No direct chunk list survives by design — confirm this is acceptable. | ☐ keep ☐ merge ☐ redirect ☐ remove — date: ____ approver: ____ |
| `/p/[ws]/ideation` | Two-bucket proposals; gate-3 approve | `/p/[ws]/solutions/new` — topic-driven retrieval, min-N from config, relevance floor, full contract | Replacement is a superset and stricter (citation validation). | ☐ keep ☐ merge ☐ redirect ☐ remove — date: ____ approver: ____ |
| `/p/[ws]/campaigns` | Campaign list; gate-4 publish (event only) | `/p/[ws]/solutions` + `/p/[ws]/solutions/[id]` — contract display, edit, reject, gated publish, export | Replacement changes publish semantics (now gated on blockers/claims and transitions state). Verify one draft side by side. | ☐ keep ☐ merge ☐ redirect ☐ remove — date: ____ approver: ____ |
| `/p/[ws]/claims` | Hardcoded claims screen | `/p/[ws]/admin/claims` — workspace rules + copy audit with drift | Replacement is a superset (rules CRUD + drift audit). | ☐ keep ☐ merge ☐ redirect ☐ remove — date: ____ approver: ____ |
| `/p/[ws]/receipts` | Receipt list; grading | `/p/[ws]/outcomes` — import, min-N aggregates, overdue-first queue, write-back | Replacement is a superset. Grading now writes back to evidence and demotes contradicted hypotheses — verify one grading side by side. | ☐ keep ☐ merge ☐ redirect ☐ remove — date: ____ approver: ____ |
| `/p/[ws]/config` | Threshold form | `/p/[ws]/admin` — thresholds + profile + sequence + prompts + alerts + history | Replacement is a superset. | ☐ keep ☐ merge ☐ redirect ☐ remove — date: ____ approver: ____ |

## Archived bridges (from Slice 0 W0.3 — both empty, zero rows)

| Bridge | State | Decision |
|---|---|---|
| `platina_campaigns.sop_run_id` | Column exists, no code reads or writes it, zero rows | ☐ drop column (separate migration) ☐ keep — date: ____ approver: ____ |
| Alert actions `hub_message` / `ticket` / `email` | Enum values exist; never executed; zero rules use them | ☐ migrate enum to `in_app` ☐ keep — date: ____ approver: ____ |

## Sign-off

- [ ] I have compared each route pair above and recorded a decision per row.
- [ ] I understand deletions happen only after redirects and green E2E.
- [ ] Owner checkpoint B approved for the rows marked remove.

**Owner:** ____________  **Date:** ____________
