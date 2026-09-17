# Platina AI OS for Waters — Slice 3 Task Plan: Waters Public-Source Audits

**Date:** 2026-09-17
**Status:** Proposed — authorizes Slice 3 execution only
**Governing plan:** [2026-09-11-platina-waters-realtime-full-suite.md](./2026-09-11-platina-waters-realtime-full-suite.md) (+ 2026-09-15 addendum, R1 two-tier scanning)
**Predecessor:** [Slice 2](./2026-09-17-platina-slice-2-event-spine.md) (done, `abb4368`)
**Unblocked by:** [Apify actor feasibility matrix](./platina-apify-actor-matrix.md) — all five source kinds verified with live sample runs.

## Purpose

Replace the Instagram-oriented fetch path with real Waters audit inputs:
operator-chosen sources across the five verified kinds, a header-only change
probe tier (R1) so actor spend tracks observed changes instead of cadence ×
sources, a 5-minute due-spec coordinator, content-hash dedupe, and honest
failure recording as run events.

## Resolved inputs

- Actor mapping (from the matrix, verified 2026-09-16): the four web kinds
  (`competitor_site`, `press_release`, `trade_editorial`, `conference`) →
  `apify/website-content-crawler` (cheerio, `maxCrawlDepth: 0`);
  `ad_library` → `curious_coder/facebook-ads-library-scraper`
  (`urls: [{ url }]`, residential proxy, minimum charge 10 results — batch).
- Probe tier: conditional GET (`ETag`/`If-Modified-Since`) verified working on
  the competitor-site sample; probe-less kinds use adaptive cadence (6 h
  start, tighten toward the configured floor on observed changes, back off
  after consecutive unchanged fetches).
- Manual "Run now" bypasses the probe tier (never approval, rate limits, or
  cost caps).
- The boundary-test exception (`fetch/apify.ts` → `@/lib/connectors/apify`)
  is deleted in this slice — the ratchet shrinks to zero entries.
- The unshipped `"web"` adapter is rejected at runtime and removed from the
  user-selectable target type until the constitution is explicitly updated.

## Schema changes (one migration)

- `platina_scan_specs` gains: `cadence_minutes` int (5/10/15, default 5),
  `enabled` boolean default true, `last_success_at` / `last_failure_at` /
  `last_probe_at` timestamps, `probe_etag` / `probe_last_modified` text,
  `consecutive_unchanged` int default 0, `current_interval_minutes` int
  nullable (adaptive state; null = use cadence), `fetches_day` date nullable
  + `fetches_today` int default 0 (cost cap counters).
- `platina_signal_documents` gains: `content_hash` text, `canonical_url`
  text, `source_kind` text, `processing_state` text default `"unprocessed"`.
  Unique index on (`scan_spec_id`, `content_hash`) — unchanged content
  physically cannot duplicate.

## Modules

- `src/lib/platina/fetch/canonical.ts` (pure): `canonicalizeUrl` (lowercase
  host, strip `utm_*`/tracking params and fragment, normalize trailing
  slash) and `contentHash(canonicalUrl, body)` (sha256).
- `src/lib/platina/fetch/probe.ts`: `probeSource(url, prior, fetchImpl)` —
  HEAD/conditional GET; returns `changed | unchanged | unsupported` with the
  new validators. `fetchImpl` injected for tests.
- `src/lib/platina/fetch/waters.ts`: the Waters adapter —
  `actorForSourceKind`, input builders per kind, output → `RawSignalDoc` with
  `sourceKind`, `canonicalUrl`, `contentHash`; per-target try/catch so one
  bad source cannot sink the batch; failures surface as thrown stage errors
  (recorded as run events), never as fake signal documents.
- `src/lib/platina/fetch/schedule.ts` (pure): `nextDueAt(spec, now)` —
  probed kinds use the configured cadence; probe-less kinds use the adaptive
  interval (`current_interval_minutes` ?? 360, halve toward the cadence floor
  on change, double on unchanged up to 24 h); deterministic jitter from the
  spec id so sources don't thunder-herd. `registerAdapter` rejects the
  `"web"` key until the constitution changes.
- `src/lib/platina/fetch/registry.ts`: `RawSignalDoc` gains optional
  `sourceKind`, `canonicalUrl`, `contentHash`. `runApprovedScan` rejects
  `adapterKey === "web"`.
- `src/db/queries/platina.ts`: `listDueApprovedSpecs(now)` (global cron
  enumeration — reviewed exception, per-record scoping downstream),
  `recordProbeState`, `recordFetchOutcome` (success/failure timestamps,
  adaptive counters, daily cost counters), `countRunsForSpecToday`,
  `insertSignalDocuments` extended for the new columns with
  `onConflictDoNothing` on the hash index (returns inserted count).

## Workers

- `scan-coordinator.ts` (cron `*/5 * * * *`): selects due approved+enabled
  specs, emits one `platina/probe.tick` per spec with a tick-bucketed
  idempotency key. Replaces `signal-scan.ts` (deleted; the old 6-hour
  Instagram cron is gone).
- `probe-tick.ts` (event `platina/probe.tick`): probe tier. Probed kinds:
  conditional GET; unchanged → record probe state, done (no run, no spend).
  Changed → create run (`trigger: "schedule"`, idempotency key
  `schedule:{specId}:{tick}`) and send `platina/audit-run.requested`.
  Probe-less kinds: when the adaptive interval is due AND the daily fetch cap
  is not hit → create the run directly. Cost-cap overflow records a skipped
  run event via a degraded run, visible in run history.
- `audit-run.ts` (Slice 2) unchanged in shape; its fetch stage now goes
  through the Waters adapter and stores hashed/canonical documents.
- `confirmScanAction` now creates the first run immediately
  (`trigger: "event"`) instead of sending the retired `platina/scan.requested`.

## UI (Audits page)

- Create form gains source kind (five kinds) and cadence (5/10/15 min)
  selects; both validated server-side.
- Source rows show: status, cadence, freshness pill (fresh/stale/unknown from
  `last_success_at`), last run time, and the existing actions.
- Copy stays honest: "checked" for probes, "fetched" for actor runs.

## Test specification

- `canonical.test.ts`: tracking-param stripping, host case, fragment,
  trailing slash; hash stability and sensitivity.
- `probe.test.ts`: 304 → unchanged; 200 with new ETag → changed; no
  validators → unsupported; network error → unsupported (never blocks
  fetching).
- `schedule.test.ts`: due/not-due boundaries, adaptive tighten/back-off,
  24 h cap, cadence floor, jitter determinism, daily-cap exhaustion.
- `waters.test.ts`: kind→actor mapping, input shapes (including the
  ad-library `urls: [{url}]` + proxy + count contract), output mapping to
  `RawSignalDoc`, per-target failure isolation.
- `registry.test.ts`: `"web"` rejected; approved-spec gate unchanged.
- `boundary.test.ts`: exception table now empty; the ratchet test asserts
  zero entries and keeps the stale-guard shape.
- `platina.test.ts` (queries): SQL shape for the new spec-state updates and
  the dedupe insert.
- E2E: Audits page renders the new form fields and the run-history region;
  existing route smoke stays green.

## Done when

An approved source runs manually and on cadence; changed content creates
exactly one raw snapshot (second identical fetch inserts zero rows);
unchanged probes cost no actor invocation; failures appear as run events with
reasons; the Instagram connector is no longer imported anywhere under
Platina; all gates green.

## Explicit non-goals for Slice 3

- No findings/contradiction workflow changes (Slice 4).
- No Google Ads Transparency actor (matrix open item; only if claimed).
- No RSS/Atom probe verification beyond recording support flags (matrix open
  item; conditional GET covers V1).
- No changes to InstaMedia's Apify connectors — Platina's adapter is its own.
