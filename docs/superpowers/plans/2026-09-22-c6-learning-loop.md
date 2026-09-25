# C6 — Learning loop: results teach the next decision

Status: **approved 2026-09-22 (D1-D5 as recommended); L1-L7 built, see §5**. Builds on C0-C5
(`2026-09-21-campaign-intelligence.md`). Acceptance for C6 is unchanged: *a
recorded result changes the next ranking* — this plan makes that concrete and
extends it to ideas, creatives and plans.

## 1. The loop

```
 idea / opportunity ──> plan (phases cite evidence ids) ──> creative (posted)
        ^                                                        │
        │                                              metrics (manual / CSV /
        │                                               connected account)
        │                                                        │
   re-weighted ranking <── learning engine <── review: what / why / how
   + planner lessons        (per-feature          (numbers by code, model
   + demoted assumptions     posterior, min-N,     drafts, human confirms
     (backtrack)             decay, explore)       -> lesson)
```

Every arrow is real time: saving a metric emits `platina/learning.updated`,
the engine recomputes, realtime broadcasts, open pages refresh (existing
realtime scopes), and the Live flow page shows a burst on the Results ->
Learning -> Opportunities path, plus a reverse burst for a backtrack.

## 2. What exists and is reused

| Piece | Where | Used for |
|---|---|---|
| Plan verdicts (`worked/mixed/failed` + note) | `platina_plan_feedback`, `plan/context.ts` `listPlanLessons` | stays; verdict becomes one input, no longer the only one |
| Phase -> evidence ids | `PlanPhase.evidenceIds` | backtracking: a result is traced to the insights it rested on |
| Receipt write-back + demotion | `writeback.ts`, `demote.ts` | reused for demoting Brain hypotheses a result contradicts |
| Outcomes + CSV import (leads) | `platina_outcomes`, `outcomes.ts` | stays; campaign-level leads feed the reward |
| Opportunity ranking (rules, computed on read) | `opportunities.ts` | gets a learned adjustment, shown as its own line |
| Engagement index vs own median, min-N | `engagement.ts`, `interest.ts` | same maths for our own creatives |

## 3. Slices

### L0 — Security (partly done today)
- **Done:** `npm audit fix` (no majors): Auth.js 0.41.3 / next-auth beta.32
  (3 critical auth advisories incl. OAuth state/PKCE cookie binding), undici,
  nanoid, brace-expansion. Tests 2448 green, typecheck clean.
- **Left:** `next` (critical; no patched 14.x exists, 14.2.35 is the last) and
  its bundled postcss; `glob` CLI (dev-only, CLI not used). Fix = Next 15
  upgrade — see decision D4.

### L1 — Waters' own website -> first-party layer (Plane A)
- New source kind `own_site` on the client: map the site (Firecrawl `/v2/map`,
  1 credit), filter with the existing `pickSitePages` rules (same site incl.
  subdomains, one language, one version per page, drop SKU/shop/PDF/careers/
  legal), read every remaining page, one `platina_brand_sources` row per page,
  chunks into `platina_brand_chunks` with `brand_id` (Plane A, embedded,
  citable).
- "All pages" within budget: first pass reads up to a cap (default 200 pages,
  concurrency 2), priority order = products/applications/solutions ->
  newsroom/blog -> about/ESG -> rest; the rest continue on following days.
  Afterwards a **header-only change probe** (sitemap lastmod / ETag, free,
  allowed as own code) decides which pages to re-read; only changed pages spend
  credits.
- Page-level status on the client page: read / queued / changed / failed.
- Test: filter + priority + budget pure tests; boundary test; live proof =
  "what does Waters sell for PFAS testing?" retrieves Waters' own page.

### L2 — Creative tracking (the manual ledger)
New tables (migration 0080, workspace_id on every row, query tests assert it):
- `platina_creatives`: one row per posted piece. Links: `plan_id` +
  `phase_id`, `opportunity_key` (topic or event), `brand_id`; descriptors the
  engine learns over: `channel`, `format` (single image / carousel / video /
  document / text / event booth...), `topic`, `hook_type` (question / stat /
  proof / story / offer), `cta`, `posted_at`, `url`, `hypothesis` (what we
  expect and why — one line, required).
- `platina_creative_metrics`: snapshots, not overwrites: `captured_at`,
  `impressions`, `reach`, `clicks`, `engagements`, `saves`, `shares`,
  `video_views`, `leads`, `spend`, `source` (`manual` / `csv` / `connector:*`).
  A missing metric is null, never 0 (same rule as R4).
- UI: new **Results** page (`/p/[ws]/results`) — list of creatives with their
  latest numbers vs. the client's own median, "Add creative" (prefilled from a
  plan phase or an opportunity), "Add numbers" (manual form, and CSV paste with
  line-numbered errors — reuses the outcomes parser style). Plan roadmap
  phases show their creatives and results inline.

### L3 — Connected accounts (adapter registry)
- `src/lib/platina/metrics/registry.ts`: adapters return metric snapshots for
  creatives matched by URL/post id. Adapter 1 = **LinkedIn page-analytics CSV
  export** (Waters is LinkedIn-first; LinkedIn's organic-analytics API needs
  Community Management API approval, which we do not have). Adapter 2 = Meta
  Graph insights via the existing `connected_accounts` token — needs D3.
- A daily Inngest job pulls from every connected adapter; a failure is flagged
  on the page, and the manual form remains the fallback (degradation ladder).

### L4 — Review: what / why / how
When a creative has ≥ 7 days of numbers (configurable), a review opens:
1. **What happened** — computed by code: index vs own median, vs the plan's
   expectation, vs the same topic/format last time. The model never writes a
   number.
2. **Why** — which assumption carried it: topic, hook, format, timing,
   audience, channel. The model drafts ranked hypotheses from the numbers + the
   creative's stated hypothesis + the evidence its phase cited.
3. **How** — what to change next time; **What to keep**.
4. Owner/team confirms or edits. **Only a confirmed review becomes a lesson**
   (Plane A chunk, embedded, citable) — same rule as the brand standard (O3):
   the model does not teach itself from its own unreviewed guesses.
One model call per review through the router (no agent spawns an agent).

### L5 — Learning engine (pure, tested)
- Reward per creative = engagement index vs the client's own median post
  (leads weighted in when recorded). Per feature value (topic, channel, format,
  hook type, weekday/time band) a posterior (Beta-Bernoulli on "beat own
  median", with decay: 90-day half-life so it keeps up with the market).
- **Min-N gate:** a feature value with fewer than N results (workspace config,
  default 5) shows "not enough results yet" and has no effect on ranking.
- **Explore vs exploit:** ranking uses Thompson sampling with a configurable
  explore share (default 20%); an explored item is labelled "trying something
  new" so no one mistakes it for a recommendation from evidence.
- **Backtracking:** a confirmed "didn't work" traces creative -> phase ->
  `evidenceIds` -> Brain hypotheses and demotes them (existing `demote.ts`),
  and records which assumption failed. A confirmed "worked" raises their
  confidence (capped). Every change is logged with its cause, so "why did this
  drop?" is always answerable.
- Output is computed on read (like C5) plus a small `platina_learning_events`
  audit log; no hidden state.

### L6 — Wire into decisions (real time)
- **Opportunities:** each campaign/topic gets a "Your results" line (Plane A:
  "carousel posts on mass spectrometry beat your median 4 of 5 times") and a
  rank adjustment. Proof lines stay separate per plane (two-layer rule).
- **Planner:** context gets confirmed lessons + feature stats that pass min-N;
  the critic checks that a plan does not repeat a demoted assumption.
- **Creative drafting:** avoids demoted directions, prefers winning formats.
- Realtime event + Live flow paths as in §1.

### L7 — Verify
- `scripts/verify-learning.ts` (read-only): recorded results -> features ->
  ranking change, exit 1 on failure.
- Acceptance tests: (a) a recorded result changes the next ranking; (b) below
  min-N nothing moves; (c) a failed result demotes exactly the evidence its
  phase cited; (d) an unconfirmed review changes nothing; (e) workspace
  isolation on every new query.
- Browser test: add creative -> add numbers -> review -> Opportunities order
  changes.

Order: L0 (rest) -> L1 -> L2 -> L4 -> L5 -> L6 -> L3 -> L7. L3 last because it
depends on D3 and on what accounts Waters actually connects.

## 4. Owner decisions

- **D1 — "RL" wording in CLAUDE.md.** It says the planner is "a feedback loop,
  not RL". L5 is a bandit (Thompson sampling) over the workspace's own
  recorded results: a small, explainable form of reinforcement learning. Deep
  RL is not viable: Waters produces tens of posts a month, not thousands.
  Proposal: amend the line to "feedback loop + bandit re-weighting over the
  workspace's own recorded results, min-N gated". Yes/no.
- **D2 — Firecrawl for a multi-page crawl of the client's own site.** CLAUDE.md
  limits Firecrawl to one page and keeps multi-page crawls on Apify. The own
  site is first-party (Plane A), and InstaMedia's site ingest already does it
  with Firecrawl. Budget: ~1 credit/page; a 200-page first pass is 20% of the
  1,000/month plan, then only changed pages. Alternative: Apify website crawler
  (spends from the $5/month Apify cap). Recommend Firecrawl + amend CLAUDE.md.
- **D3 — Connected accounts in Platina.** `@/lib/connectors` is forbidden to
  Platina by the boundary test. Options: (a) allowlist a read-only metrics call
  as shared infra, like Firecrawl; (b) Platina's own Meta adapter reading the
  shared `connected_accounts` token. Recommend (a). Also: which accounts will
  Waters actually connect (LinkedIn page admin export? Meta?).
- **D4 — Next.js 14 -> 15.** The only way to clear the remaining critical
  advisories; CLAUDE.md locks "Next.js 14". Several advisories don't apply here
  (Windows-hosted RCE: we deploy on Vercel; next/image is not used), but others
  (Server Actions DoS, RSC cache poisoning, middleware redirects) do.
  Recommend a separate branch/slice right after L1, before any client demo.
- **D5 — Reward definition.** Default "beat own median engagement", leads
  count more when recorded. Confirm, or name the metric Waters cares about
  most (e.g. demo requests).

## 5. Progress (2026-09-22)

| Slice | Status | Proof |
|---|---|---|
| L0 | npm audit fix done (Auth.js criticals); **Next 14 -> 15 not started** (own branch, after C6 is committed) | 2,537 unit tests green |
| L1 | built; live on Waters | 998 links mapped, 300 kept (cap), 17 read so far = 241 passages; planner gets 6 first-party passages for "What does Waters sell?" |
| L2 | built | Results page, log creative (from plan phase / opportunity), manual numbers, sheet import (Platina or LinkedIn export) |
| L3 | built, **unproven live** | read-only `lib/connectors/metrics-read.ts` (Instagram); no connected account exists in any workspace |
| L4 | built | facts by code, model draft, human confirm; lesson -> first-party chunk; backtracking with reviewer ticks |
| L5 | built | Beta posterior per feature, 90-day half-life, min-N 5, seeded Thompson sampling, 20% explore |
| L6 | built | Opportunities re-ranked with a separate "Your results" line; planner gets lessons (Plane A) + learned patterns; live flow has the loop |
| L7 | built | `scripts/verify-learning.ts` OK on Waters; browser test results-loop passes |

Migrations 0082 (6 tables + learning config) and 0083 (brand own-site fields) applied.

**Deviation from §3 L1:** own-site pages are stored in a new `platina_first_party_chunks` table
(with `platina_own_site_pages`), not `platina_brand_sources` / `platina_brand_chunks`. A client's
brand chunks mean "confirmed brand standard" (R3/O3) and switch on competitor divergence checks;
a crawled page must never do that on its own. Confirmed lessons (L4) share the new table.

Found live and fixed: (1) waters.com links show no locale on the homepage, and a large German
application-note archive outvoted English: locale now prefers English; (2) Firecrawl 429 now defers
reads instead of failing pages; (3) Gemini embedding quota (429) made pages fail after their credit
was spent: text is now stored and embedded later by a batched backfill.

**Binding limit:** Gemini free-tier embeddings. All 300 Waters pages is about 3,600 passages; the
free quota ran out after about 250 today. Reading continues at 50 pages/day and the backfill catches
up, but a paid Gemini key (open decision O1) makes "all pages" take days, not weeks.
