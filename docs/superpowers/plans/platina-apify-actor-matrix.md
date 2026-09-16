# Platina Apify Actor Feasibility Matrix

**Date:** 2026-09-16
**Slice:** 0, workstream W0.4
**Governing plan:** [2026-09-11-platina-waters-realtime-full-suite.md](./2026-09-11-platina-waters-realtime-full-suite.md) (+ 2026-09-15 addendum, R1)

Every row below records a **real non-production sample run** executed
2026-09-16 through the Apify `run-sync-get-dataset-items` endpoint (the same
call shape as `runActor` in `src/lib/connectors/apify.ts`), plus a header-only
change probe per R1. No token, secret, or PII appears in this document. Sample
runs used ≤ 10 results each; total spend for the evaluation was under $0.01.

Verdict vocabulary: **feasible** (actor produces usable output),
**feasible-with-probe** (actor works AND a cheap change probe applies),
**blocked** (no candidate actor yields usable output — social data is never
substituted).

## Summary

| Source kind | Actor | Probe tier (R1) | Verdict |
|---|---|---|---|
| `competitor_site` | `apify/website-content-crawler` | Conditional GET (ETag + Last-Modified both present) | feasible-with-probe |
| `press_release` | `apify/website-content-crawler` | No ETag/Last-Modified on the sampled newsroom; sitemap without `lastmod`; RSS not verified | feasible |
| `trade_editorial` | `apify/website-content-crawler` | None — HEAD and sitemap both 403 (bot protection) | feasible (adaptive cadence) |
| `conference` | `apify/website-content-crawler` | No ETag/Last-Modified; sitemap without `lastmod` | feasible |
| `ad_library` | `curious_coder/facebook-ads-library-scraper` | None — HEAD 403 (expected); adaptive cadence (6 h start) | feasible (adaptive cadence) |

All five V1 source kinds have a verified feasible actor. Slice 3 is unblocked
on actor coverage. Slice 3.5's "most reliable source kind" is
`competitor_site`: fastest verified probe signal and cleanest output.

## Probe-tier findings (R1 input)

- **Conditional GET works for Agilent product pages** — `ETag` and
  `Last-Modified` headers both present (HEAD 200). This is the one source kind
  where the 5-minute probe cadence can suppress nearly all actor fetches.
- **Agilent newsroom and ASMS** respond 200 but without caching validators;
  sitemaps exist but carry no `lastmod`. Probe options: RSS/Atom (not verified
  in this pass — recorded as an open Slice 3 task) or content-length/date
  heuristics. Until verified, treat as actor-at-cadence or adaptive.
- **chromatographyonline.com** blocks HEAD and sitemap (403, bot protection)
  while the actor's HTTP crawl succeeds — the probe tier does not apply;
  adaptive cadence per R1.
- **Meta Ad Library** blocks HEAD (403, expected for a JS app); no probe
  signal exists. Adaptive cadence (6-hour start) per R1.

## Per-source-kind detail

### `competitor_site`

- **Sample URL:** public Agilent liquid-chromatography product page.
- **Candidate actor(s):** `apify/website-content-crawler` (verified);
  `apify/cheerio-scraper` and `apify/web-scraper` remain untested fallbacks.
- **Probe tier:** conditional GET applies (ETag + Last-Modified present).
- **Sample run:** HTTP 201, 1 item, 40.6 s, cheerio crawler,
  `maxCrawlDepth: 0`.
- **Output keys:** `url`, `crawl`, `metadata`, `screenshotUrl`, `text`,
  `html`, `htmlUrl`, `markdown`, `debug`.
- **Mapped `RawSignalDoc`:** `sourceUrl` ← `url`; `title` ← `metadata.title`;
  `body` ← `markdown` (or `text`); `adapter` ← `"apify"`; `raw` ← item.
- **Cost per 1k results:** actor is free; platform usage only — ~$0.2 per
  1,000 pages with the raw HTTP (cheerio) crawler, $0.5–5 per 1,000 with a
  headless browser (Store pricing, 2026-09-16).
- **Rate limits / constraints:** none observed at this volume.
- **Verdict:** feasible-with-probe.

### `press_release`

- **Sample URL:** public Agilent newsroom page.
- **Candidate actor(s):** `apify/website-content-crawler` (verified).
- **Probe tier:** no ETag/Last-Modified on the sampled page; sitemap present
  without `lastmod`. RSS/Atom discovery not verified — open Slice 3 task.
- **Sample run:** HTTP 201, 1 item, 38.4 s.
- **Output keys:** same crawler shape as above.
- **Mapped `RawSignalDoc`:** same mapping as above.
- **Cost per 1k results:** same platform-usage pricing as above.
- **Rate limits / constraints:** none observed.
- **Verdict:** feasible.

### `trade_editorial`

- **Sample URL:** public Chromatography Online (LCGC) homepage.
- **Candidate actor(s):** `apify/website-content-crawler` (verified).
- **Probe tier:** none — HEAD 403 and sitemap 403 (bot protection). Adaptive
  cadence per R1.
- **Sample run:** HTTP 201, 1 item, 10.4 s.
- **Output keys:** same crawler shape as above.
- **Mapped `RawSignalDoc`:** same mapping as above.
- **Cost per 1k results:** same platform-usage pricing as above.
- **Rate limits / constraints:** the site actively blocks plain HEAD probes;
  actor fetches must stay within its rate tolerance — circuit breaker per the
  governing plan.
- **Verdict:** feasible (adaptive cadence).

### `conference`

- **Sample URL:** public ASMS annual-conference homepage.
- **Candidate actor(s):** `apify/website-content-crawler` (verified).
- **Probe tier:** no ETag/Last-Modified; sitemap without `lastmod`. RSS
  discovery not verified — open Slice 3 task.
- **Sample run:** HTTP 201, 1 item, 7.9 s.
- **Output keys:** same crawler shape as above.
- **Mapped `RawSignalDoc`:** same mapping as above.
- **Cost per 1k results:** same platform-usage pricing as above.
- **Rate limits / constraints:** none observed.
- **Verdict:** feasible.

### `ad_library`

- **Sample URL:** public Meta Ad Library keyword search ("Waters
  Corporation", US, all active ads).
- **Candidate actor(s):** `curious_coder/facebook-ads-library-scraper`
  (verified). A Google Ads Transparency actor remains unevaluated — recorded
  as a Slice 3 option, not a V1 requirement.
- **Probe tier:** none — HEAD 403 (JS app, expected). Adaptive cadence
  (6-hour start) per R1.
- **Sample run:** HTTP 201, 10 items, 9.9 s, residential proxy group.
- **Output keys (first item):** `ad_archive_id`, `collation_count`,
  `collation_id`, `is_active`, `page_id`, `page_name`, `snapshot`,
  `impressions_with_index`, `reach_estimate`, `spend`, `currency`,
  `start_date`, `end_date`, `publisher_platform`, `categories`,
  `total_active_time`, and related fields.
- **Mapped `RawSignalDoc`:** `sourceUrl` ← the library query URL; `title` ←
  `page_name` + `ad_archive_id`; `body` ← `snapshot` text fields; `adapter` ←
  `"apify"`; `raw` ← item.
- **Cost per 1k results:** $0.75 per 1,000 ads, pay-per-event (Store pricing,
  2026-09-16). The actor enforces a minimum charge of 10 results per run —
  cadence planning must batch sources per run.
- **Rate limits / constraints:** requires Apify proxy (residential group used
  in the sample); input contract is `urls: [{ url }]` objects, not strings.
  Actor health at evaluation time: 100% run success, 4.77/5 rating, ~5.5k
  monthly users.
- **Verdict:** feasible (adaptive cadence).

## Cost projection at the approved cadence (R1 two-tier model)

With the probe tier active on `competitor_site` and adaptive cadence on
probe-less kinds, daily actor invocations track observed changes rather than
cadence × source count. At the Store prices above, a 20-source deployment
with typical B2B change frequency (a few changes per source per week) costs
single-digit dollars per month. Without the probe tier, the same deployment
at a flat 5-minute cadence would be ~173,000 invocations per month — the R1
motivation, confirmed by these measurements.

## Open items for Slice 3

- Verify RSS/Atom availability for the press/conference source kinds.
- Evaluate a Google Ads Transparency actor if Google Ads coverage is claimed
  in the release.
- Batch ad-library queries to respect the 10-result minimum charge.
- Re-verify actor pricing and health at Slice 3 start — actor inventory
  changes.

---

*Owner approval of this matrix is part of the Slice 0 done-when gate.*
