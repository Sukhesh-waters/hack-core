# Core Spine — design (2026-09-20)

**Status:** proposed, awaiting owner decisions in §3.
**Scope:** the one flow that is the product's value:

```
sign in -> workspace -> add subject (own brand + competitors)
        -> automatic collection (real, continuous, verifiable)
        -> store raw signals
        -> AI insight extraction (own + competitor)
        -> KB (Brain)
        -> ideation + campaign planning grounded in that KB
```

Everything else — SOP, content calendar, studio, tickets, hub — is an add-on
layer that plugs into this spine later. It is not deleted, not touched, and
not in this spec.

---

## 1. What is actually in the repo today

This is not a greenfield. Most of the machinery exists and is tested. The
failures are in a small number of specific places, and they are all in the
seams, not in the components.

### 1.1 The collection pipeline exists and is wired

| Stage | File | State |
|---|---|---|
| 5-min coordinator | `src/inngest/functions/platina/scan-coordinator.ts` | works |
| Header-only probe (ETag / Last-Modified) | `src/inngest/functions/platina/probe-tick.ts`, `src/lib/platina/fetch/probe.ts` | works |
| Adapter registry + approval gate | `src/lib/platina/fetch/registry.ts` | works |
| Apify adapter (registered) | `src/lib/platina/fetch/waters.ts:195` | works |
| Run state machine | `src/lib/platina/orchestrator.ts` | works |
| Signal doc insert + hash dedupe | `src/db/queries/platina.ts` | works |
| AI validation round -> finding + Brain chunk | `src/inngest/functions/platina/contradict-sweep.ts`, `src/lib/platina/debate.ts` | works |
| All 24 functions served | `src/app/api/inngest/route.ts` | works |

So "the scraping does not work" is **not** an un-built pipeline. It is the
seven defects below.

### 1.2 The seven real defects

**D1 — nothing ever fires locally.**
`INNGEST_DEV=1` means the app expects an Inngest dev server on the machine.
`package.json` has no script that starts one, and the README does not mention
it. With `npm run dev` alone the `*/5 * * * *` coordinator never ticks, so
there is no probe, no fetch, no signal, no finding, no Brain chunk. The
product looks dead and gives no reason. This alone explains most of
"literally not functional".

**D2 — collection depth is one page.**
`buildInput()` in `src/lib/platina/fetch/waters.ts:52` sets
`maxCrawlDepth: 0, maxCrawlPages: 1, crawlerType: "cheerio"`. Each approved
target yields exactly one page of static HTML. That is a change detector, not
a data pool. No sitemap seeding, no pagination, no JS-rendered pages.

**D3 — there is no social / post / impression collection in the core flow.**
The only Platina source kinds are `competitor_site | press_release |
trade_editorial | conference | ad_library`. Posts, reels, profiles, comments
and engagement counts exist only on the InstaMedia side
(`src/lib/connectors/apify-actors.ts`, 8 actors), which Platina is forbidden
to import (`src/lib/platina/boundary.test.ts`). So "competitor posts /
impressions analysis" currently has no code path in the core flow at all.

**D4 — the analysis stages are stubs.**
`STAGE_EXECUTORS` in `src/lib/platina/orchestrator.ts:72` maps only
`competitor_scan -> fetch`. `brand_divergence` and `ideation` are recorded as
*skipped, deferred to Slice 8 / Slice 5*. Separately,
`src/inngest/functions/platina/divergence-scan.ts` is a no-op: it lists brand
chunks and returns a count. Nothing analyses them.

**D5 — throughput is capped at 5 documents.**
`contradict-sweep.ts` does `signals.slice(0, 5)` per workspace per
invocation, on a 6-hour cron (plus one event per run). Even with collection
fixed, the insight layer drains at ~5 docs / 6h. A real competitor sweep
produces hundreds.

**D6 — the planner is blind to everything collected.**
`src/lib/platina/plan/context.ts` assembles context from `listPlanLessons()`
only — past plans of this workspace and the note someone wrote about them. It
never reads `platina_brain_chunks`, never reads `platina_findings`, never
reads a signal document. So the "campaign planner that learns" is currently a
loop over its own history, disconnected from the entire collection and
insight pipeline. **This is the biggest single misalignment in the product.**

**D7 — there is no client/project entity in the core flow.**
Platina's tenancy is `workspace_id` plus `platina_workspace_profiles`
(division / region / business_unit). One workspace = one division. There is
no "add a client, we start collecting". `clients` exists only on the
InstaMedia side (`src/db/schema.ts:234`) and Platina cannot import it. So the
step the owner describes — *add project/client -> auto collect* — has no
entity to hang off.

### 1.3 The UX defects

- **Two products, one login.** `/w/[ws]/*` (46 pages: clients, accounts, KB,
  ideation, calendar, studio, SOP) and `/p/[ws]/*` (26 pages: audits,
  findings, solutions, plan). A user must already know which half to use. The
  only bridge is one "Platina" link on `/hub`
  (`src/app/(app)/hub/page.tsx:73`).
- **Onboarding dead-ends.** `workspace/ready` says "Ingestion, Brand DNA and
  the studio come online in the next slices" and drops the user at
  `/w/[ws]/kb` — an empty KB, with no instruction to do the one thing that
  starts the product (add a subject, approve collection).
- **Internal jargon in user-facing copy.** `/p/[ws]/scans` renders
  `eyebrow="S3–S5 · gate 2"` and a button labelled `Gate 2 · confirm fetch`.
  Slice numbers and gate numbers are build vocabulary, not product
  vocabulary.
- **Bare forms.** `scans/page.tsx` is three unstyled inputs. There is no
  "what is happening right now" surface anywhere: no live collection status,
  no last-fetch result, no cost, no per-subject coverage.
- **Silent failure everywhere.** A missing `APIFY_TOKEN`, a dead model id, a
  stopped Inngest — each produces an empty page, not a diagnosis.

---

## 2. Target spine

One surface. One noun. One loop.

```
/p/[ws]/start            first run: name the brand, paste the site + handles
   |
   v
Subject                  own_brand | competitor  (new Platina-owned entity)
   |  auto-derive
   v
Sources                  sitemap / RSS / press / product pages / social handles
   |  operator approves once (one gate, plain language)
   v
Collection               probe -> fetch -> signal documents (+ metrics)
   |
   v
Insight                  validation round -> finding -> Brain chunk (embedded)
   |
   v
Brain (KB)               workspace-scoped, two planes kept separate
   |
   v
Plan                     brief -> planner grounded in Brain + findings + past
                         results -> roadmap -> recorded outcome -> back to Brain
```

**The two-layer rule is preserved and made visible.** Everything collected
from public sources is Plane B (pattern layer). First-party consented data is
Plane A (baseline). The plan context carries them as two separate arrays and
the prompt is forbidden from citing both in one "why this idea". A test
asserts no rationale block contains both plane tags.

**The minimum-N gate stays.** Any direction/magnitude number below
`minBaselineN` renders "insufficient baseline", never a fabricated figure.

---

## 3. Decisions the owner must make before S1 starts

**Decision A — where the spine lives.** The described flow crosses the
Platina/InstaMedia boundary that `boundary.test.ts` enforces.

| Option | What it means | Cost |
|---|---|---|
| **A1 (recommended)** — spine lives entirely in Platina | New `platina_brands` table; `/p` becomes the product; `/w` stays live and untouched as the add-on layer | No boundary change, no deletion. Some duplication of actor-input mapping. |
| A2 — Platina reads InstaMedia `clients` | One client list | Requires amending the `boundary.test.ts` allowlist — a constitution change |
| A3 — merge the two halves | One codebase, one nav | Requires the signed Slice 12 transition matrix. Large. Not now. |

Recommendation: **A1**. It needs no constitution amendment, deletes nothing,
and `/w` keeps working exactly as it does today.

**Decision B — social collection duplication.** Platina may not import
`@/lib/connectors/*`. To collect posts/reels/profile metrics, the actor-input
mapping must be re-expressed inside `src/lib/platina/fetch/`. That is roughly
120 lines of duplicated shape definitions. Either approve the duplication, or
approve extracting a neutral `src/lib/actors/` that both sides import (a
boundary allowlist addition).
Recommendation: **duplicate for now** — consistent with A1, zero constitution
change; extract later if it bites.

**Decision C — collection spend cap.** Real continuous pooling costs Apify
credits. The existing `MAX_FETCHES_PER_DAY = 48` in `fetch/schedule.ts` is
**per scan spec**, not per workspace — with 20 specs that is 960 actor runs a
day, and after S3 each run may crawl up to 25 pages. Proposal: add a
per-workspace daily actor-**call** cap in `platina_workspace_config` (default
40), count pages rather than runs, surface the running count in the UI, and
have the coordinator record `degradedReason` when it refuses. `costCapReached`
is the hook.

**Decision D — AI layer.** Confirmed: Groq + Gemini only for now
(`src/lib/ai/router.ts`). Bedrock stays configured-but-optional; AWS is a
parallel track and no slice below depends on it.

---

## 4. Slices

Each slice is one vertical, ships with tests, and is not done until CI
passes. Order is dependency order.

### S0 — Make the loop provably run and provably visible

*Fixes D1. No new product surface. This is the prerequisite for believing any
later slice works.*

1. `package.json`: add
   `"dev:jobs": "npx inngest-cli@latest dev -u http://localhost:3000/api/inngest"`
   and a `dev:all` that runs both. README gets one paragraph saying the app
   does nothing scheduled without it.
2. New `src/app/(platina)/p/[ws]/admin/health/page.tsx` — a real diagnostic:
   - `APIFY_TOKEN` present? last actor HTTP status + timestamp
   - model router: live 1-token probe per provider, showing the model id that
     answered (this is how a retired model id gets caught in 5 seconds)
   - Inngest: last coordinator tick timestamp
   - DB: round-trip ms
   - per-workspace: approved sources, docs today, findings today, actor calls
     today vs cap
3. New `scripts/smoke-collect.ts` — takes a workspace id, runs one real
   approved scan end-to-end outside Inngest, prints fetched / inserted /
   failures. This is the "is it actually scraping" answer.
4. Tests: the health page renders every degraded state without throwing; the
   smoke script typechecks.

**Done when:** a fresh clone plus `npm run dev:all` shows a health page that
is all green — or tells you exactly which thing is not.

### S1 — Subjects: the client/project entity

*Fixes D7. Assumes Decision A1.*

1. `src/db/platina-schema.ts`: **`platina_brands`** (not `platina_subjects` —
   `platina_gate_events` already uses generic `subject_type` / `subject_id`
   columns for "the row this gate decided on", so a table named `subjects`
   would make `subjectType: "subject"` nonsense). UI label: "Clients".
   - `id, workspace_id, name, kind ("own_brand" | "competitor"),
     parent_brand_id (nullable — the own_brand a competitor competes with),
     homepage_url, handles jsonb ({instagram?, tiktok?, linkedin?, youtube?}),
     region, notes, status ("active"|"paused"), created_by_id, created_at,
     updated_at`
   - index on `workspace_id` and `parent_brand_id`; unique on
     `(workspace_id, lower(name))`
2. `src/db/queries/platina.ts`: `createBrand / listBrands / getBrand /
   updateBrand / listCompetitorsOf` — every one filtered by `workspace_id`,
   asserted in the generated SQL per the query-test convention.
3. `platina_scan_specs` gains a nullable `brand_id` so every source traces to
   a brand. Nullable means existing rows keep working.
4. Migration via `drizzle-kit generate`. Additive only, no drops.

**Tests:** workspace isolation (a subject in ws A is invisible to ws B), SQL
filter assertion, duplicate-name rejection.

### S2 — Auto-derive sources from a subject

*This is the "add project/client -> we start collecting" step.*

1. `src/lib/platina/onboard/derive.ts` — pure, testable, no network. Given
   `{homepageUrl, handles}` it produces candidate targets:
   - `/sitemap.xml`, `/sitemap_index.xml`, `/robots.txt` (sitemap discovery)
   - RSS/Atom autodiscovery paths, `/news`, `/press`, `/newsroom`, `/blog`
   - one `social_profile` target per handle present
   - each candidate carries `kind`, `cadenceMinutes`, and a plain-language
     reason string
2. The discovery probe runs as own code — header-only conditional GET,
   sitemap `lastmod`, RSS/Atom. The constitution explicitly permits this: it
   retrieves no page content. Content fetch still goes through Apify. Reuse
   `src/lib/platina/fetch/probe.ts`; do not add a second HTTP path.
3. Competitor proposal: an AI step takes `{subject name, homepage, region}`
   and proposes up to 8 competitor names + domains, each with a one-line
   reason. **Proposals are drafts.** Nothing is fetched until approved.
4. One approval screen, plain language: "We'll watch these 14 pages for Acme.
   Approve." One button. Not "Gate 2 · confirm fetch".

**Tests:** derive is deterministic for a given input; an unapproved spec still
cannot reach an adapter (`assertApproved` already enforces this — add the
subject-level case).

### S3 — Real collection depth and social/metric coverage

*Fixes D2 and D3.*

1. `waters.ts buildInput()`: replace the fixed `maxCrawlPages: 1` with a
   per-target budget on `PlatinaScanTarget` (`maxPages`, default 1 for a
   change-probe target, up to 25 for a seeded crawl), sitemap-seeded
   `startUrls`, and `crawlerType: "playwright"` for targets flagged
   JS-rendered.
2. New source kinds `social_profile` and `social_posts`, mapped in
   `actorForSourceKind()` to `apify~instagram-scraper`,
   `clockworks~tiktok-scraper` and `apify~instagram-profile-scraper`. Input
   shapes are re-expressed locally per Decision B.
3. `platina_signal_documents` gains `metrics jsonb` —
   `{likes?, comments?, views?, shares?, followers?, postedAt?}` — normalized
   per platform in a pure mapper with fixture tests. This is what makes
   "impressions / engagement analysis" possible at all.
4. Failure discipline is unchanged and non-negotiable: a failed target goes to
   `failures` and never becomes a fake document. If every target fails, the
   run is `failed`, not `degraded-with-nothing`.

**Tests:** fixture-driven mapper tests per actor payload shape (use
`fixtures/`); budget respected; an unknown kind still throws.

### S4 — Throughput

*Fixes D5.*

1. `contradict-sweep`: replace `slice(0, 5)` with a batched fan-out — one
   `platina/signal.analyze` event per unprocessed document, Inngest
   concurrency limited per workspace, bounded by the Decision C daily cap.
2. The 6-hour cron stays as a backstop; the event path becomes primary.
3. Idempotency: `markSignalProcessed` already guards; add a unique
   idempotency key per `(workspaceId, signalId)` so a replay is a no-op.

**Tests:** 200 queued signals drain without duplicate findings; a cap breach
stops dispatch and records the reason on the run.

### S5 — Insight extraction that actually runs

*Fixes D4.*

1. Implement `brand_divergence` as a real stage executor: compare the
   subject's own collected positioning chunks against competitor chunks and
   emit divergence findings with `use_case = "brand_divergence"`. Goes through
   `routeAI` like everything else.
2. Implement `ideation` as a stage executor over the Brain, producing
   candidate directions that each carry their evidence chunk ids.
3. Replace the no-op `divergence-scan.ts` with the scheduled entry point for
   (1), or delete the function and let the run stages own it — do not leave a
   cron that counts rows and returns.
4. Every stage that cannot run records *why* on the run timeline. The existing
   "skipped — deferred to Slice 8" strings go away with the stubs.

**Tests:** stage executor contract tests with a faked router; a stage that
throws marks the run `degraded`, never silently `completed`.

### S6 — Connect the KB to the planner

*Fixes D6. This is the slice that makes the product the thing it claims to
be.*

1. `assemblePlanContext` gains two new sections, both workspace-scoped:
   - `patternEvidence[]` — top-k `platina_brain_chunks` plus open
     `platina_findings` relevant to the brief, retrieved through the existing
     `retrieval.ts` / `rerank.ts` path, each tagged `plane: "B"` with its
     source url and collected-at date
   - `baselineEvidence[]` — Plane A, empty until first-party data is
     connected; reports `insufficient_baseline` rather than a number
2. `ContextState` is a **closed union** — do not add a `cold_start` member.
   Cold start is `context_available` with `coldStart: true` inside the
   context and empty evidence arrays; `insufficient_relevance` stays reserved
   for retrieval below `similarityFloor`. The UI shows which one it got — a
   cold plan is labelled a cold plan.
3. The plan prompt template is amended so each phase rationale cites evidence
   ids from **one** plane. A test asserts no rationale block contains both
   plane tags — the constitution's never-mixed rule, enforced in code.
4. The roadmap view shows, per phase, the evidence behind it, with links to
   the source document and its collection timestamp.

**Tests:** plane-mixing test (the important one); cold-start path;
`insufficient_relevance` path; workspace isolation on retrieval.

### S7 — The UX rebuild of the spine

*Fixes the UX defects. Runs in parallel with S5/S6 once S1–S2 land.*

1. **`/p/[ws]/start`** — first-run flow, three steps, no jargon: brand +
   website + handles -> "here's what we found, here's what we'll watch" ->
   approve. It ends by landing on a live collection view, not an empty page.
2. **`/p/[ws]/subjects`** and `subjects/[id]` — per subject: what we watch,
   when we last saw a change, what we learned, what it cost. This is the
   screen that was missing.
3. **Cockpit rewrite** — above the fold: is collection running, what changed
   in the last 24h, what needs a decision, what plan is live. All of it is
   already queryable; `buildInbox` stays.
4. **Copy pass** — every `S3–S5 · gate 2`, `Gate 2 · confirm fetch` and
   `Slice N` string removed from user-facing text. Build vocabulary stays in
   comments and commit messages.
5. **Empty states that act** — every empty list states the one next action and
   links to it.
6. **Degradation made visible** — the ladder in the constitution (provider
   throttled, Meta down, KB stale) gets a persistent banner component rather
   than silence.
7. **One entry point** — post-login and `workspace/ready` route into
   `/p/[ws]/start` when no subject exists. `/w/*` stays fully reachable and
   unchanged; it is linked as the add-on workspace, not as a second front
   door. The stale "come online in the next slices" copy is replaced.
8. Tailwind/shadcn only; `style={}` only for the dynamic values the
   constitution already carves out.

### S8 — Add-ons (explicitly not now)

SOP, content calendar, studio, tickets, hub, reports. Each becomes a consumer
of the spine after S6 proves the loop. No work in this spec.

---

## 5. Sequencing

```
S0 ──► S1 ──► S2 ──► S3 ──► S4 ──► S5 ──► S6
                      └──────────► S7 (UI, parallel from here)
```

S0 first and alone — until the loop is observable, every later slice is
guesswork. S6 is the payoff slice; S7 is what makes it feel like a product.

## 6. Invariants every slice must hold

- `workspace_id` filter on every query, asserted in the generated SQL.
- Plane A and Plane B never mixed in one rationale.
- No number below `minBaselineN` — "insufficient baseline" instead.
- No agent spawns an agent.
- A failed fetch never becomes a document.
- Nothing is fetched without an approved scope.
- `boundary.test.ts` stays green; the exception table stays at zero.
- Deletions still require the signed Slice 12 matrix. This spec deletes
  nothing.
