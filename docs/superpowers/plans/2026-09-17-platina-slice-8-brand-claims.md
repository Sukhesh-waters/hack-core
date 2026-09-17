# Platina AI OS for Waters — Slice 8 Task Plan: Brand Drift and Claims Pack

**Date:** 2026-09-17
**Status:** Proposed — authorizes Slice 8 execution only
**Governing plan:** [2026-09-11-platina-waters-realtime-full-suite.md](./2026-09-11-platina-waters-realtime-full-suite.md) (+ 2026-09-15 addendum)
**Predecessor:** [Slice 7](./2026-09-17-platina-slice-7-event-readiness.md) (done, `6b91385`)

## Purpose

Complete declared-standard governance: the brand standard is sourced from
approved, freshness-tracked declarations; claims rules are workspace-owned
instead of hardcoded; copy can be audited against the standard with exact,
traceable violations; and a passing re-audit closes the drift finding.

## Schema changes (one migration)

- `platina_brand_sources` (new): `id`, `workspace_id` FK, `url` nullable
  (pasted text needs none), `title`, `status` (`draft` | `approved`),
  `content_hash`, `last_fetched_at`, `last_changed_at`, `created_by` FK
  users, timestamps. Workspace index.
- `platina_claims_rules` (new): `id`, `workspace_id` FK, `kind`
  (`banned_term` | `regulated_claim`), `term`, `note` nullable, `active`
  boolean default true, `created_by` FK users, `created_at`. Workspace index.
- `platina_brand_chunks` gains `superseded_at` timestamp nullable — a
  re-fetched source supersedes its old chunks; retrieval and display filter
  `superseded_at IS NULL`.

## Behavior

- **Brand sources.** Add (draft) → confirm (writes the `declare` gate event,
  then extracts: URL sources fetch through the Waters adapter — consented
  first-party content, Plane A; pasted text needs no fetch) → chunks are
  split (R4.5 prose rules) and embedded at write time. Re-fetch compares the
  content hash: changed → new chunks inserted, old chunks for that source
  superseded, `last_changed_at` recorded; unchanged → no duplicate chunks,
  only `last_fetched_at`.
- **Daily `platina-brand-refresh`** (cron): approved sources re-fetch through
  the same path; unchanged sources produce nothing.
- **Workspace claims rules.** `claimsGate` and the Admin claims screen read
  active workspace rules; an empty rule set falls back to the default lists
  with honest copy ("default rules — approve workspace rules below"). Rule
  add/remove is `gate.approve`-capable and writes a gate event
  (`subjectType: "claims_rule"`). Changing a rule changes the next audit —
  verified by test.
- **Copy audit (drift + claims).** The Admin claims screen gains "audit
  against the standard": deterministic claims first; then a bounded model
  pass compares the copy with the retrieved (non-superseded) standard chunks
  and lists exact mismatches with the cited standard line. Router failure →
  `not_run` state, claims verdict still shown. Mismatches create a
  `brand_drift` finding. A re-audit form takes a finding id: a clean re-audit
  supersedes the finding with the note "remediation verified by re-audit"
  (the transition table gains `new → superseded` for exactly this).
- **Brand standard summary.** Admin/brand renders the standard grouped by
  source with chunk counts and freshness — business-readable, no model call.

## Test specification

- Rules fallback: empty workspace rules → defaults; workspace rules override;
  archived rules are ignored.
- Refresh idempotency: unchanged hash → zero new chunks; changed hash → new
  chunks + old superseded + retrieval excludes superseded.
- Drift audit: deterministic claims run first; model mismatch list is
  traceable to standard lines; router failure yields `not_run` with the
  claims verdict intact.
- Re-audit closure: clean re-audit with a finding id supersedes it; a
  failing re-audit does not.
- SQL-shape: new queries workspace-scoped; superseded filter present in
  retrieval SQL.
- E2E smoke stays green.

## Done when

Changing an approved rule changes future audits; exact violations trace to
the rule and the standard line; a passing re-audit closes the finding; the
daily refresh produces no duplicate chunks for unchanged sources.

## Explicit non-goals for Slice 8

- No division-level standard reconciliation UI (the extract → author →
  reconcile → confirm loop is single-workspace in V1; cross-division is
  Deferred per R3).
- No asset binary upload — copy audit takes pasted text only.
- No outcome write-back (Slice 9).
