# C7 build plan: task by task, ready for development

Companion to `2026-09-22-c7-live-operations.md`, which holds the why, the findings (F1-F12) and the owner decisions
(D6-D14). This document is the how: branches, tasks, files, tests, migrations, verification and rollout. Every task
names the files it touches and the test that is written **before** the code.

Status: ready to start 2026-09-23. Nothing is built yet.

## 1. How the work flows

### 1.1 Branches and PRs

```
main
 └─ feat/campaign-intelligence      C0-C6 (pushed, PR not yet open)  ── PR #1, merge first
     ├─ fix/c7-0-leaks              C7.0 a-f                         ── PR, small, merge fast
     ├─ chore/next-15               C7.0 g                           ── PR, own branch (D4)
     └─ after Next 15 merges, one branch per slice:
        feat/c7-1-ops-board → feat/c7-9-theme → feat/c7-3-events → feat/c7-2-competitors
        → feat/c7-4-live-briefs → feat/c7-5-studio → feat/c7-6-ads → feat/c7-8-learning-lanes → feat/c7-7-brain-map
```

- One slice = one PR = one reviewable diff. A slice bigger than about 1,500 changed lines is split into parts (a, b).
- Each branch starts from the latest merged state, so migrations never collide.
- The owner's uncommitted edits (fonts, Turbopack removal, Google account linking, reminders) are committed by the
  owner first, or carried untouched; no task edits those hunks.

### 1.2 Definition of done (every PR)

1. **Test first**: each bug gets a failing test before the fix, and each new pure function gets unit tests.
2. **Isolation**: every new query has a test asserting `workspace_id` in the generated SQL (pattern:
   `src/db/queries/platina-learning.test.ts`).
3. **Boundary**: `src/lib/platina/boundary.test.ts` passes; any allowlist change is named in the PR description.
4. `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` all pass (CI).
5. The slice's browser spec passes against a production build (`next build && next start`).
6. From C7.1 on: `npm run ops:check -- --ws waters-gcc-internal --client Waters` is green (amber allowed only with a
   written reason).
7. Verified live on Waters where the slice touches live data, and the result is written into §7 of the C7 plan.
8. CLAUDE.md is updated in the same PR when a rule changes.

### 1.3 Conventions used below

- **Pure first.** Logic lives in pure functions (`src/lib/platina/...`) with injected dependencies, the same way
  `own-site-run.ts` takes `OwnSiteDeps`. Pages and jobs are thin wrappers.
- **Jobs** follow `src/inngest/functions/platina/learning.ts`: event trigger plus a cron safety net, `concurrency` keyed
  on `workspaceId`, `debounce` where bursts happen. Register each one in `src/app/api/inngest/route.ts`.
- **Realtime**: add a scope to `PLATINA_REALTIME_SCOPES` (`src/lib/platina/realtime.ts`), broadcast with
  `broadcastPlatinaSignal`, subscribe through `use-platina-realtime.ts`. Payloads carry only `{ scope, id? }`.
- **Tables** use the `id()` and `workspaceFk()` helpers in `src/db/platina-schema.ts` and join a scoped-tables
  registry (a new `platinaC7ScopedTables`, like `platinaC6ScopedTables`).
- **Migrations** are generated with `npm run db:generate`, reviewed by hand, and applied with `npm run db:migrate`.
  The next free number is 0084. Numbers below are the planned order; the generator's names will differ.
- **Model calls** go through `routeAI` inside `runWithAiCost({ workspaceId, purpose })`, one call per step. No agent
  spawns an agent.

## 2. Migrations (planned order)

| # | Slice | Change |
|---|---|---|
| 0084 | C7.0 | `client_identities` (InstaMedia side: workspace_id, client_id, kind `domain`/`linkedin`/`instagram`/`tiktok`/`youtube`/`x`/`facebook`, value, source `seed`/`confirmed`, added_by, created_at; unique on ws+client+kind+value). **Applied 2026-09-23.** The planned `campaigns` metric change was dropped: no invented rows existed, and the connector can no longer write one. |
| 0085 | C7.1 | `platina_ops_checks` (ws, brand_id, check_key, status, detail, value jsonb, checked_at; index ws+check_key+checked_at). |
| 0086 | C7.2/C7.3 | `platina_brand_kind` gains `market`. `platina_brands.own_identities` jsonb (domains and handles, mirrors the InstaMedia guard for Platina). `platina_events` gains `official_url`, `dates_checked_at`, `live_watch` boolean, `live_from`, `live_to`, `source_plane` (`A`/`B`). |
| 0087 | C7.4 | `platina_run_steps` (ws, run_id, run_kind, seq, step, status, headline, detail jsonb, model, tokens, cost_usd, duration_ms, created_at) and `platina_run_feedback` (ws, run_id, step_seq, verdict `right`/`wrong`, note, target_kind, target_id, confirmed_by, confirmed_at). |
| 0088 | C7.5 | `platina_creative_briefs` (ws, brand_id, origin jsonb `{kind: campaign/phase/event/competitor/ad, ref}`, status, brief jsonb, drafts jsonb, run_id, creative_id, created_by, timestamps). |
| 0089 | C7.6 | `platina_ads` (ws, brand_id, platform, library_id, advertiser, first_seen, last_seen, starts_on, ends_on, active, format, text, landing_url, theme, detail; unique ws+platform+library_id), `platina_ad_snapshots` (ws, ad_id, captured_at, active, impressions_min, impressions_max, countries jsonb, targeting jsonb, source_document_id), `platina_ad_recommendations` (ws, brand_id, kind, title, body, numbers jsonb, proof_ids jsonb, status `open`/`accepted`/`rejected`, decided_by, decided_at, run_id). |
| 0090 | C7.8 | `platina_learning_events.lane` (`first_party`/`public`, default `first_party`). |
| 0091 | C7.7 | `platina_graph_layouts` (ws, node_set_hash, built_at, payload jsonb, node_count, edge_count). |

Each migration ships with its rollback SQL in the PR description. None drops or rewrites existing data except the two
backed-up data operations in C7.0 (T0.1, T0.6).

## 3. Tasks

Sizes: S = up to half a day, M = 1-2 days, L = 3-5 days.

### C7.0 Stop the leaks, branch `fix/c7-0-leaks`

| ID | Task | Files | Test first | Size |
|---|---|---|---|---|
| T0.1 | **Quarantine script.** `--dry-run` (default) lists the third-party sources; `--apply` writes a JSON backup to `backups/2026-09-23-kb-quarantine.json` (git-ignored) and deletes the 5 sources (cascade deletes the 42 chunks). Also cleans the 5 stuck-pending and 3 failed duplicate rows. Keeps Waters' own and BD Biosciences. | `scripts/kb-quarantine.ts` | dry-run output matches the 5 sources found on 22 Sep | S |
| T0.2 | **URL normaliser.** Repairs `https:/`, lower-cases the host, drops `srsltid`, `utm_*`, `trk`, `fbclid`, `gclid`, trailing `#`. | `src/lib/ingest/url.ts` (new, neutral shared) | table of the real Waters URLs in, clean URLs out | S |
| T0.3 | **Ownership guard** (pure). `ownershipOf(url, { own: Identity[], known: {name, domains, handles}[] })` returns `own`, `known_third_party` (with name) or `unknown`. Domain match on the registrable domain plus subdomains; LinkedIn and other social matched by path (`/company/x`, `/showcase/x`). | `src/lib/ingest/ownership.ts` (new) | the 15 Waters URLs: waters.com, `/company/waters`, `/showcase/bdbiosciences` are own; thermofisher.com is Thermo Fisher; `/company/pfizer` is unknown; bd.com is unknown | S |
| T0.4 | **Identities.** `client_identities` table (0084) and queries (`listClientIdentities`, `addClientIdentity`), seed script for Waters (waters.com, linkedin company/waters, linkedin showcase/bdbiosciences). A "Your own sites and pages" list on Brand Gene -> Knowledge with add and remove. | `src/db/schema.ts`, `src/db/queries/client-identities.ts` (+ test), `scripts/seed-identities.ts`, `brand-gene/knowledge-tab.tsx` | query test asserts `workspace_id` and `client_id` | M |
| T0.5 | **Guard on every first-party ingest.** `ingestKnowledgeUrl` (single page and whole site) checks `ownershipOf` before any fetch. `known_third_party` and `unknown` return a message plus a "Watch it as a competitor/market source" link to `/p/[ws]/competitors?add=<url>` (live after C7.2; before that, the message alone). An "It's ours" checkbox adds the identity (source `confirmed`, logged) and continues. Whole-site mode stays on the own domain only. The `/kb` box (`crawl-action.ts`) is rewired to call `ingestKnowledgeUrl`; its own regex scraper is deleted (D6). | `brand-gene/knowledge-actions.ts`, `kb/crawl-action.ts`, `components/kb/live-url-ingester.tsx` | action test: a thermofisher.com URL is refused and nothing is fetched (fetch mock never called); an own URL proceeds | M |
| T0.6 | **Weekly refresh obeys the guard.** `knowledge-refresh` skips (and marks `failed: not an own source`) any source whose URL is no longer own. | `src/inngest/functions/knowledge-refresh.ts` | unit test on the filter | S |
| T0.7 | **Safe fetch.** `safeFetch(url, { timeoutMs, maxBytes, headers })`: http(s) only, DNS lookup (`node:dns/promises`) and refusal of private/loopback/link-local/CGNAT/metadata/IPv6 ULA ranges, manual redirects (up to 5 hops, each re-checked), streaming byte cap. Used by `fetchPage`, `headProbeFetch`, `fetchSitemapText`. | `src/lib/net/safe-fetch.ts` (new, allowlisted as shared infra in the boundary test), `src/lib/knowledge-ingest.ts`, `src/lib/platina/fetch/probe-fetch.ts` | `127.0.0.1`, `10.0.0.1`, `169.254.169.254`, `[::1]`, `0x7f000001`, a public host that redirects to `127.0.0.1`, a 3 MB body | M |
| T0.8 | **Pending means interrupted.** `ingestDisplayStatus` already reports "interrupted"; a sweep in `knowledge-refresh` turns rows older than 3 min into `failed` with "interrupted, try again". URLs pass through T0.2 before `createKnowledgeSource`; a duplicate of a ready source returns "already in the knowledge base". | `src/lib/knowledge-ingest.ts`, `src/db/queries/knowledge.ts` | duplicate URL test; sweep test | S |
| T0.9 | **No invented ads numbers.** `pullMetaCampaignMetrics` returns `{ status: "not_connected" }` or `{ status: "ok", metrics }`; the synthetic branch is deleted. Conversions count only `lead`, `offsite_conversion.*`, `onsite_conversion.lead_grouped`. Token in the `Authorization: Bearer` header. `syncCampaignMetricsAction` writes only on `ok`, else returns "Connect Meta or import a CSV". Ads page shows "not measured" for null. Backup-then-reset script for rows matching the synthetic formula (impressions = round(spend x 125)). | `src/lib/connectors/meta-ads.ts` (+ test), `ads/actions.ts`, `ads/campaign-row.tsx`, `src/db/queries/campaigns.ts`, `scripts/reset-synthetic-ad-metrics.ts` | no token -> nothing written; a failed Graph call -> nothing written; action types mixed -> only leads counted | M |
| T0.10 | **CLAUDE.md** lines from the C7 plan §6 (ownership rule, `/w` safety fixes, no ad-account connections, public learning lane). | `CLAUDE.md` | — | S |

Done when: T0.1 applied on Waters (backup file exists, 25 own passages remain); pasting
`https://www.thermofisher.com/in/en/home.html` into Knowledge is refused; SSRF tests pass; Ads sync on a campaign with
no token writes nothing. Browser spec: `e2e/instamedia/knowledge-guard.spec.ts`.

Order inside the branch: T0.2, T0.3, T0.7 (pure, parallel) -> T0.4 -> T0.5, T0.6, T0.8 -> T0.9 -> T0.1 on live data
last, after review -> T0.10.

### C7.0 g Next 15, branch `chore/next-15`

| ID | Task | Size |
|---|---|---|
| T0.11 | `npx @next/codemod@canary upgrade latest`, then the async request API codemod (`params`, `searchParams`, `cookies()`, `headers()` become async). Every page under `src/app` reads `params` synchronously today, so this is a wide but mechanical diff. | M |
| T0.12 | React 19 and `@types/react` 19; fix type errors (mostly `ref` props and `useFormState` renamed to `useActionState`). Check NextAuth v5 beta, shadcn components, three.js page. | M |
| T0.13 | Caching: `fetch` and GET route handlers are no longer cached by default. Audit route handlers that relied on caching (grep `export async function GET`). | S |
| T0.14 | Full unit and e2e runs; `npm audit` shows no critical. Retest Turbopack dev (`next dev --turbo`) on three async server pages; if the duplicate-React error is gone, record it and let the owner decide whether to switch back. | S |

Done when CI is green, the 5 existing browser specs pass on a production build, and `npm audit --omit=dev` has no
critical. Merge before any C7 page is built.

### C7.1 Ops board, branch `feat/c7-1-ops-board`

| ID | Task | Files | Test first | Size |
|---|---|---|---|---|
| T1.1 | **Checks (pure).** One function per row of the C7 plan table, each `(data, now, thresholds) -> HealthCheck`, reusing `ProbeStatus`. | `src/lib/platina/ops/checks.ts` (+ test) | each check: green, amber and red fixture | M |
| T1.2 | **Collector.** Gathers the data per workspace and client with read-only queries (reuses `summariseOwnSite`, `learningState`, `checkCollection`, `ai_usage` sums, Apify spend from `budget.ts`, Firecrawl credit counter). | `src/lib/platina/ops/collect.ts`, `src/db/queries/platina-ops.ts` (+ test) | query tests for `workspace_id` | M |
| T1.3 | **Runner script** `ops:check`: prints the scorecard, exits 1 on red. Folds the read-only parts of `verify-learning`, `verify-spine`, `verify-scraping` and `events-report` into checks, so there is one command. | `scripts/ops-check.ts`, `package.json` | — | S |
| T1.4 | **Job and storage.** `platina-ops-check` hourly (cheap checks) and 04:30 daily (full); writes `platina_ops_checks`; a check that changes to red fires an in-app alert through the existing alert rules; broadcasts `ops`. | `src/inngest/functions/platina/ops-check.ts`, route registration, migration 0085 | a job run with a failing check writes one red row and one alert | M |
| T1.5 | **Live board.** Admin -> Health shows each flow with status, detail, next step, a 7-day strip and "last checked". Refreshes on `ops`. | `admin/health/page.tsx`, `components/platina/ops-board.tsx` | browser spec `e2e/platina/ops-board.spec.ts` | M |
| T1.6 | **Flow timing map.** Document what triggers each of the 17 Platina jobs; add an event trigger wherever a step only waits for a cron; add timing fields (`queued -> started -> done`) to the ops data. Targets from the C7 plan. | `docs/superpowers/specs/2026-09-23-platina-job-map.md`, job files as needed | per-job trigger test where one is added | M |
| T1.7 | **Nightly browser tests.** GitHub Actions workflow on a schedule and on the `e2e` label: build, start, run Playwright as the dev-bypass user against a seeded test workspace. Needs repository secrets (§6). | `.github/workflows/e2e-nightly.yml`, `e2e/fixtures/` | — | S |
| T1.8 | **Speed budgets.** Record server render time per Platina page (a small wrapper around the page's data loading) and per job duration; show the slowest five on the board. | `src/lib/platina/ops/timing.ts`, `components/platina/page.tsx` | unit test on the percentile maths | S |

Done when `ops:check` on Waters is green after C7.0, and a deliberately failing check turns red on the board and raises
one alert.

### C7.9 Theme, branch `feat/c7-9-theme`

| ID | Task | Files | Test first | Size |
|---|---|---|---|---|
| T9.1 | **Light by default.** `resolveTheme(stored) -> stored ?? "light"`; ThemeProvider's first state `"light"`; the no-flash script adds `.dark` only when stored is `"dark"`; the OS listener is removed. | `src/lib/theme.ts` (+ test), `components/theme-provider.tsx`, `app/layout.tsx` | the three `resolveTheme` tests rewritten: nothing stored -> light, whatever the OS | S |
| T9.2 | **Tokens.** `:root`, `.dark`, `.platina-shell` use the palette: brand `#00A1E0` (197 100% 44%), primary `#0176D3` (207 99% 42%), primary-strong `#0B5CAB`, tint `#EAF5FE`; dark primary `#1B96FF`. Add `--brand` and `--primary-strong` tokens and their Tailwind names. | `src/app/globals.css`, `tailwind.config.ts` | contrast test: a small script computes the token pairs and fails under 4.5:1 | S |
| T9.3 | **Remove hard-coded teal.** The glow keyframes, `gradient-backdrop`, `nav-loading-bar`, `gauge-ring`, `flow-scene` colours, and 63 `teal-*` classes in 7 files become token classes. Client-data defaults (`color-palette-input`, `validation.ts`) stay as they are. | listed files | grep test in CI: no `teal-` class and no teal hex outside the two client-data files | M |
| T9.4 | **Screenshot pass.** A Playwright script visits every route in light, saves screenshots, and runs axe for contrast. Fix the 67 dark-shell colours where they break. | `e2e/theme-sweep.spec.ts` | axe: zero contrast violations on primary buttons and links | M |
| T9.5 | **Grouped nav.** `PLATINA_NAV` becomes groups (Watch, Decide, Make, Learn, plus Clients, Admin and More); the sidebar renders headings; routes that don't exist yet are added by their slices. | `src/lib/platina/nav.ts` (+ `nav.test.ts`), `components/platina/sidebar.tsx` | nav test: every entry resolves to a page file | S |

Done when a fresh browser opens light, axe passes on every route, and the grep test passes.

### C7.3 Events, branch `feat/c7-3-events`

| ID | Task | Files | Test first | Size |
|---|---|---|---|---|
| T3.1 | **Conference calendar** as data: name, official URL, region, topics, why it matters (the tables in the C7 plan). Seed script creates one approved `conference` scan spec per show for a workspace (dry run by default). | `src/lib/platina/conference-calendar.ts`, `scripts/seed-conferences.ts` | every entry has an https official URL and a region | S |
| T3.2 | **Conference pages through Firecrawl**, one page, then the free probe (existing rule). Extraction reuses `eventFromPagePattern` and the grounded model path (quote the date words, code verifies with `quotedIn`). Store `official_url`, `dates_checked_at`. "Dates not announced (checked on ...)" when the page has none. | `src/lib/platina/fetch/firecrawl-web.ts`, `event-extract.ts`, migration 0086 | fixture pages from 3 real shows (ARABLAB, ASMS, WHX Labs) | M |
| T3.3 | **Waters' own events.** The own-site pass tags events and webinars pages; their text goes through the same extraction with `source_plane = "A"`. | `own-site-run.ts`, `event-extract.ts` | own-site fixture with a WEBAF page yields a Plane A event | S |
| T3.4 | **Date follow-up.** An event without a date or place follows its proof post's outbound link once (Firecrawl, one credit, capped per day) and re-extracts. | `src/lib/platina/event-followup.ts` (+ test), `event-extract` job | an undated event with a link gets its dates; without a link it is left for a person | M |
| T3.5 | **Events page** `/p/[ws]/events`: timeline (Gulf first, then by date), a world map (SVG, code-drawn, country dots), filters, each event with dates, city, days left, who is going with proof, topic fit and readiness. Actions: Plan for this event (existing planner anchor), Brief in Studio (link, live after C7.5), Watch live, and "Add the date" for people. | `app/(platina)/p/[ws]/events/page.tsx`, `events/actions.ts`, `components/platina/event-map.tsx` | browser spec `e2e/platina/events.spec.ts` | L |
| T3.6 | **Live mode.** Turning it on sets `live_watch` and a window; a job runs twice a day inside the window: hashtag and competitor posts through Apify (budget checked first), feed on the event page; after `ends_on`, one model call writes a recap. | `src/inngest/functions/platina/event-live.ts`, `src/lib/platina/event-live.ts` (+ test) | a fixture event inside its window schedules scans; outside it, none; over budget, none plus an amber check | M |
| T3.7 | **Alerts.** A new event in the client's region with a competitor participant raises an in-app alert; `events` scope broadcast on every change. | `alerts.ts`, `event-extract` job | unit test on the rule | S |

Live proof before merge: run on Waters; ARABLAB LIVE shows 26-28 Oct 2026 quoted from terrapinn.com; WHX Labs Dubai
shows 26-29 Jan 2027; DUPHAT shows its dates from duphat.ae or "not announced".

### C7.2 Competitors, branch `feat/c7-2-competitors`

| ID | Task | Files | Test first | Size |
|---|---|---|---|---|
| T2.1 | **URL classifier** (pure): site page, press, social profile/post, LinkedIn or Meta ad library, event page; returns the scan-target kind and whether Firecrawl or Apify reads it (F12: LinkedIn is Apify-only). | `src/lib/platina/url-kind.ts` (+ test) | 20 real URLs from Waters' competitors | S |
| T2.2 | **Add a URL.** Server action: classify, match to a competitor or market brand by `own_identities`/homepage (or create a `market` brand, 0086), create an approved scan spec, trigger a first read. Pfizer, Thermo Fisher and Agilent from the quarantine backup are re-added through this path. | `app/(platina)/p/[ws]/competitors/actions.ts` | action test: a thermofisher.com page lands under Thermo Fisher as public | M |
| T2.3 | **"Watch this site"**: list the competitor's site with Firecrawl map (1 credit), the person ticks up to N pages (workspace config, default 10), each becomes a one-page source watched by the probe. No sitemap crawl of content. | `competitors/[id]/watch.tsx`, actions | cap test: N+1 ticked is refused | M |
| T2.4 | **List page** `/p/[ws]/competitors`: per competitor, changes this week, posting themes vs own median, new ads (after C7.6), events, share of voice on the client's topics, last collected. Market sources behind a filter. | `competitors/page.tsx`, `src/lib/platina/competitor-view.ts` (+ test) | view-model tests | M |
| T2.5 | **Detail page** with tabs Timeline, Messaging, Ads, Events, Sources, Brief. The Brief is one model call over the last 30 days of public items, each line citing a proof id (validated by code, like `findCitationProblem`). | `competitors/[id]/page.tsx`, `src/lib/platina/competitor-brief.ts` (+ test) | a brief line citing a non-public or unknown id is rejected | L |
| T2.6 | **Never first-party.** Integration test: a competitor URL through every ingest path never reaches `knowledge_chunks`, `platina_first_party_chunks` or `platina_brand_chunks`. `competitors` realtime scope. | `src/lib/platina/two-layer.test.ts` | the test itself | S |

### C7.4 Live briefs, branch `feat/c7-4-live-briefs`

| ID | Task | Files | Test first | Size |
|---|---|---|---|---|
| T4.1 | **`onStep` hook** on `runOrchestration`, optional, called at context, draft, validate, critic, apply with a small typed payload. Errors inside the hook are swallowed and never change the result. | `src/lib/orchestrator/run.ts` (+ test) | same result with and without the hook; a throwing hook changes nothing | S |
| T4.2 | **Recorder.** `startRun(kind)` returns a `runId` and a `step(...)` writer that inserts into `platina_run_steps` and broadcasts `runs` with the run id. Model tier, tokens and cost come from `ai_usage` rows tagged with the run id through `runWithAiCost`. | `src/lib/platina/run-steps.ts`, `src/db/queries/platina-runs.ts` (+ tests), migration 0087 | query tests; seq ordering | M |
| T4.3 | **Model's one-line reasons.** The planner, Studio and brief prompts ask for a `why` string per decision in their JSON; the zod schemas accept it (optional, 200 chars). Shown as "The model's stated reason", never as hidden reasoning. | `plan/agent.ts`, later Studio | schema test | S |
| T4.4 | **Panel.** `<RunBrief runId>` client component: fetches steps from a membership-checked GET route `/api/platina/runs/[runId]`, re-fetches on the `runs` signal, shows each step with what it read (plane label per item), gates passed or failed, model and cost. Forms that start a run create the `runId` client-side and send it as a hidden field, so the panel can open before the server replies. | `components/platina/run-brief.tsx`, `app/api/platina/runs/[runId]/route.ts` | route test: another workspace's run id returns 404 | M |
| T4.5 | **Wire the planner first**, then event extraction, the insight writer and reviews. The Live flow page gets a "What Platina is doing now" feed of the last 20 steps. | `plan/flow.ts`, jobs, `live/page.tsx` | planner snapshot: saved plan identical with recording on | M |
| T4.6 | **Right/wrong.** Buttons on each step; "Something's wrong" asks which item and why; a confirmed "wrong input" demotes that Brain item through `demote.ts` and writes a learning event. Unconfirmed flags change nothing. | `run-brief.tsx`, `src/lib/platina/run-feedback.ts` (+ test) | a confirmed flag demotes exactly one item | M |

### C7.5 Studio, branch `feat/c7-5-studio` (two PRs: a = brief, b = drafts and visuals)

| ID | Task | Files | Test first | Size |
|---|---|---|---|---|
| T5.1 | **Brief assembler (pure).** Input: origin (campaign, phase, event, competitor move, ad), client profile, own-site passages, interest momentum, proofs, C6 learned patterns and demoted assumptions, C7.8 public patterns. Output: goal, audience, channel, format, keywords A (own-site terms with counts) and B (rising topics with momentum), findings split by plane, proof cards, hypothesis prompt. No model call. | `src/lib/platina/studio/brief.ts` (+ test) | no public item in a Plane A list; keyword counts match the fixture | M |
| T5.2 | **Write-up.** One model call turns the assembled brief into readable prose; every finding must cite an id from the brief (code-checked). Recorded as a live brief (C7.4). | `src/lib/platina/studio/write.ts` (+ test) | uncited sentence rejected | M |
| T5.3 | **Pages** `/p/[ws]/studio` (list of briefs) and `/p/[ws]/studio/[briefId]`; entry links replace "Draft directions" on Opportunities §4, and are added to plan phases, events, competitor changes and ad recommendations. | `app/(platina)/p/[ws]/studio/...`, the four pages | browser spec `e2e/platina/studio.spec.ts` | L |
| T5.4 | **Visuals drawn by code** (React SVG, no new library): campaign flow, topic momentum chart, problem -> proof -> product, event map (reuses `event-map.tsx`), storyboard frames. Export SVG, and PNG through a canvas on the client. | `components/platina/studio/*.tsx` | render tests with fixed data; snapshot of the SVG | L |
| T5.5 | **Drafts.** One call returns three variants by hook type, each with its `why` and the pattern it follows or "trying something new" (C6 explore share). Claims pass `claims-gate.ts` before export. | `src/lib/platina/studio/drafts.ts` (+ test) | a draft with an unapproved claim is blocked | M |
| T5.6 | **Freshness and hand-off.** "New since this brief" when a signal on the brief's topic arrives after it (realtime `insights`/`ads`); "Mark as posted" creates the C6 creative with channel, format, topic, hook, hypothesis and `brief_id`. | `studio/actions.ts`, `learning-service.ts` | creative created with the brief's features | S |

### C7.6 Ads insight, branch `feat/c7-6-ads`

| ID | Task | Files | Test first | Size |
|---|---|---|---|---|
| T6.1 | **Actor check.** Extend `scripts/verify-social-actors.ts` to run the two LinkedIn Ad Library actors against Waters and Thermo Fisher (cost capped at $0.30), record fields returned (EU impressions, countries, targeting). Pick one; record the choice in `platina-apify-actor-matrix.md`. | script, doc | — | S |
| T6.2 | **Source kind** `linkedin_ad_library` in `PlatinaScanTarget` and `planTarget`; mapper to `RawSignalDoc` with the ad's library id, advertiser, dates, text, format, landing URL, impression range, countries, targeting. The Meta `ad_library` mapper gains the same fields. | `src/db/platina-schema.ts`, `fetch/actors.ts` (+ test), fixtures | mapper tests on saved actor output | M |
| T6.3 | **Ad store.** A job step after each ad-library read upserts `platina_ads` and appends `platina_ad_snapshots`; a missing field is null ("not published"). New ads trigger one landing-page read (Firecrawl, capped) and one theme classification call. | `src/lib/platina/ads/store.ts` (+ test), `src/db/queries/platina-ads.ts` (+ test), migration 0089 | re-reading the same ad updates, never duplicates | M |
| T6.4 | **Measures (pure):** days running, active, variants per theme, refresh cadence, EU impression range, country and targeting mix, products pushed; Waters vs each competitor. | `src/lib/platina/ads/measures.ts` (+ test) | proxies never labelled as performance | S |
| T6.5 | **Detectors (pure):** competitor push on a topic (3+ new ads in 7 days), Waters ad running over 45 days, regional gap (competitor ads live in GCC countries, none from Waters), theme shift. Min-N gated. | `src/lib/platina/ads/detect.ts` (+ test) | the fixture push yields exactly one detection | S |
| T6.6 | **Orchestrator job** `platina-ads`: weekly scan plan (advertisers, keywords, countries) from what's rising, projected cost checked against the Apify budget (asks for approval above the limit), runs scans, detectors, one model call per recommendation with proofs, live brief. Broadcasts `ads`. | `src/inngest/functions/platina/ads.ts`, `src/lib/platina/ads/plan-scans.ts` (+ test) | over budget: no scan, one amber check | M |
| T6.7 | **Ads page** `/p/[ws]/ads`: Waters vs competitors side by side, new this week, each ad card (creative text, dates, EU range or "not published"), recommendations with accept/reject, "Brief in Studio", "Log this ad" (C6 creative with `library_ad_id`). | `app/(platina)/p/[ws]/ads/...` | browser spec; "no write path" test: grep that no ads-manager API host is called anywhere in `src/lib/platina` | L |

### C7.8 Learning lanes, branch `feat/c7-8-learning-lanes`

| ID | Task | Files | Test first | Size |
|---|---|---|---|---|
| T8.1 | **Public lane.** Features for Waters' collected posts (topic, format, weekday, hook from text) and ads (run length, EU range); reward = beat own median (posts) or run past own median length (ads). Same `featureStats` with `lane: "public"`. | `src/lib/platina/learning-public.ts` (+ test) | public stats never enter first-party stats; min-N 5 | M |
| T8.2 | **Ranking and lines.** `learnCampaigns` takes both lanes; the public lane gives a smaller weight and its own line "(public data)". The explanation never puts a public and a first-party line in the same sentence. | `opportunity-learning.ts` (+ test) | two-layer test on the rendered lines | S |
| T8.3 | **Bulk review queue** on Results: confirm many drafted reviews in one screen, each still a person's action. | `results/reviews/page.tsx` | browser spec | M |
| T8.4 | `verify-learning` and `ops:check` report both lanes. | scripts, `ops/checks.ts` | — | S |

Live proof: on Waters' 151 collected posts, at least one public value passes min-N and Opportunities shows a
"(public data)" line.

### C7.7 Brain map, branch `feat/c7-7-brain-map` (two PRs: a = data, b = scene)

| ID | Task | Files | Test first | Size |
|---|---|---|---|---|
| T7.1 | **Graph builder (pure).** Nodes and edges from the tables (rests on, came from, similar within plane, about, taught, at), capped at 2,000 nodes and 6,000 edges by recency and degree. Cross-plane similarity only when asked, marked `resembles`. | `src/lib/platina/brain-map/graph.ts` (+ test) | no `supports` edge across planes; caps hold | M |
| T7.2 | **Layout.** 3D PCA of the 768-d vectors (power iteration, pure TS, no library), then a short force pass placing items without vectors near their neighbours; planes offset into regions. Cached in `platina_graph_layouts` by node-set hash; rebuilt nightly and debounced on `insights`/`knowledge`. | `brain-map/layout.ts` (+ test), job `platina-brain-map`, migration 0091 | deterministic output for a fixed seed | M |
| T7.3 | **Payload route** returning ids, positions, kind, plane, short label; text on click through a second route. Budget: 500 KB or less. | `app/api/platina/brain-map/route.ts` | size test on a 2,000-node fixture | S |
| T7.4 | **Scene** (three.js): instanced meshes per kind, line segments, particles along edges, pulses on new items, light canvas with a dark toggle, search and fly-to, side panel, filters, time slider, table view, reduced motion, 2D on phones. Reuses patterns from `flow-scene.tsx`. | `app/(platina)/p/[ws]/brain-map/page.tsx`, `components/platina/brain-map-scene.tsx` | browser spec: loads, search flies, a new insight appears within 5 s | L |

## 4. Schedule (one developer, working days)

| Week | Work | Ships |
|---|---|---|
| 1 | Open the C0-C6 PR; C7.0 a-f; start Next 15 | leaks closed, quarantine applied |
| 2 | Next 15 finished; C7.1 ops board | upgrade merged, board live |
| 3 | C7.9 theme; C7.3 events (part) | light blue theme; conference calendar collecting |
| 4 | C7.3 finished | Events page and live mode, before ARABLAB (26 Oct) |
| 5 | C7.2 competitors | competitor portal |
| 6 | C7.4 live briefs | live panels on planner and jobs |
| 7-8 | C7.5 studio | idea -> brief -> drafts -> Results |
| 9 | C7.6 ads | ads page and orchestrator |
| 10 | C7.8 lanes; C7.7 brain map (data) | public learning lane |
| 11 | C7.7 scene; hardening | Brain map; full ops green |

The one fixed date is ARABLAB LIVE on 26 Oct 2026: the Events page and live mode must be merged by week 4. If the
schedule slips, C7.1 T1.6-T1.8 and C7.9 T9.5 move later, never C7.3.

## 5. Risks and what's done about them

| Risk | Mitigation |
|---|---|
| Next 15 breaks pages in ways tests don't cover | Own branch; production-build browser specs; merge before new pages; the owner can keep working on 14 meanwhile |
| The ownership guard blocks a genuinely own page | "It's ours" confirm adds it in one click and logs it; ops board shows confirmed identities |
| LinkedIn Ad Library actor breaks or changes output | Actor check script run weekly by `ops:check`; mapper tests on saved output; the page says "ad library unavailable" instead of empty |
| Apify $5 runs out mid-month | Orchestrator spends against a per-flow split; amber at 80%; live mode refuses when over |
| Gemini embedding quota slows own site and the Brain map | Stored text is backfilled (C6); map places unembedded items by force layout; O1 still open |
| Three.js scene too heavy on office laptops | Node and edge caps, instancing, a table view, 2D on small screens, first-paint budget on the ops board |
| Concurrent edits in Cursor on the same files | Narrow edits, no repo-wide formatting, each PR lists touched files |

## 6. Setup the owner needs to do (none blocks C7.0)

- **GitHub secrets for nightly browser tests** (T1.7): a test `DATABASE_URL` (separate Supabase branch or project),
  `AUTH_SECRET`, dev-bypass flag. Without them the nightly job is skipped and specs run locally.
- **Open the C0-C6 PR** if the GitHub API is still resetting from this machine:
  https://github.com/Sukhesh-waters/hack-core/compare/main...feat/campaign-intelligence
- **O1**: a paid Gemini key when convenient.

## 7. Rollback

- Each slice is one PR; revert the merge commit.
- Migrations are additive except 0084's nullable metrics (reversible: backfill 0, set not null).
- Data operations T0.1 and T0.9 write backups first; restore scripts read those files (`--restore <file>`).
- Feature flags are not used; a slice is not merged until it is done.
