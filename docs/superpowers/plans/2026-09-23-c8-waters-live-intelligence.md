# C8 — Waters live: competitors, ads, opportunities, a learning engine, and the Brain map

Date: 2026-09-23 · Client: Waters (workspace `waters-gcc-internal`) · Builds on:
`2026-09-22-c7-live-operations.md` (why) and `2026-09-23-c7-build-plan.md` (tasks). Where this plan and the C7
build plan disagree on order, this plan wins. C7.0, C7.0g, C7.1 and C7.9 are done (commits 9d8e1c8, d401e7f,
c86f3e6, ce7e979).

## 0. What was asked, and where it lands

| # | The ask | What we build | Slice |
|---|---|---|---|
| A1 | Competitor page analysis is hard to reach. Add a floating button at the bottom of the nav, near Brand Gene, named "Competitors analysis – pattern layer" | A pinned button in the InstaMedia sidebar footer and a "Competitors" entry in the Platina nav, both opening one competitor portal with an "add any competitor URL" box | C8.2 |
| A2 | A three.js page showing every insight as an interactive, connected graph with the insight text | The Brain map: every source, insight, event, suggestion and result as a node, each link explained in a sentence, full text on hover or click, and a "trace" mode | C8.6 |
| A3 | No Meta or LinkedIn Ads API. Scrape real data (Claude runs it), push it into the knowledge the AI uses, and show live scrape results on the page | Ad-library scrapers (LinkedIn and Meta, both through Apify), a "Scan now" button with a live progress panel, a command Claude runs on request, and results feeding the Brain | C8.3 |
| A4 | A campaign suggester over the competitor analysis, with dates, locations and more factors, on its own Opportunities tab: a guide to where sales can grow | Opportunities 2.0: each card shows when, where, why now, who else is there, fit with Waters, the factors behind its rank, a back-scheduled campaign outline and its pipeline state | C8.4 |
| A5 | A new ideation engine built on real-time use cases and Brand DNA. It learns on its own, compacts what it learnt once a month, and every suggestion can be traced | A suggestion ledger, credit assignment from results back to the evidence and features behind each suggestion, and a monthly consolidation job with a "What we learnt this month" digest | C8.5 |
| A6 | The application looks empty. Put in real data for Waters only, make it work, and test it all together | The Waters data fill: run the real collectors now, verify each source, and publish a readiness report per page; then one end-to-end test on real data | C8.0 (first) |

C7.3 (the events radar) keeps its fixed date: the Events page and live mode must work before ARABLAB LIVE on
26 Oct 2026. C7.4 (live briefs) and C7.5 (Studio) follow after C8.

## 1. Why it looks empty: the Waters workspace today

Counted from the database on 23 Sep 2026, filtered to `waters-gcc-internal`:

| Layer | Has data | Empty |
|---|---|---|
| Collection (Plane B) | 238 signal documents (151 LinkedIn posts, 61 competitor-site pages, 10 ad-library, 8 conference, 8 trade press); 301 interest signals; 50 events (21 upcoming, 16 of them without a date); 43 participation proofs | pattern ads: 0 |
| Own site (Plane A) | 582 pages known, 22 of 300 read, 271 queued; 397 own-site passages; 25 knowledge-base passages; 3 own identities | brand standard chunks: 0 |
| Brain (Plane C) | 132 insights; 160 debate transcripts; 229 findings | — |
| Decide and act | 1 plan; 20 InstaMedia ideas; 5 content items | workspace profile: 0; campaigns: 0; creatives: 0; learning events: 0; solution tasks: 0; outcomes: 0 |
| Health | ops board: 6 green, 2 amber | — |

Collection works. Everything after it is empty, because nothing turns the collected data into decisions and
results by itself:

1. **No workspace profile.** Division and region are unset, so pages fall back to generic wording and the
   region-fit factor has nothing to match against.
2. **Nothing has been posted or measured.** The learning loop has had zero results, so rankings follow fixed
   rules ("No confirmed results yet").
3. **Ads are nearly blank.** 10 Meta ad-library documents, no LinkedIn ad library, and no ad store.
4. **Events are thin.** 16 of 21 upcoming events have no date. 4 conference sources fail on every try: ASMS
   future conferences, ASMS annual conference, HPLC 2027 and Pittcon.
5. **Own-site reading is behind.** 271 pages are queued, and the embedding quota holds it back to about 250
   passages a day.
6. **Browser tests can't see real data.** The browser-test sign-in account is not a member of Waters, so those
   tests only ever look at an empty fixture workspace.

Budgets on 23 Sep: Apify $0.96 of $5.00 this month (resets 1 Oct); Firecrawl 0 of 1,000 credits this period
(ends 21 Oct); AI for Waters $5.68 so far this month.

## 2. Three rules that shape the answers

1. **"Force injection" means running the real pipeline now, not typing in rows.** Every row the fill adds comes
   from a page or record fetched through Apify or Firecrawl. Each row keeps its URL, the time it was fetched and
   the run that fetched it (a force run records its seed grant on the run). Nothing is invented. A number the platform did not report shows as "not published" or
   "not measured". The demo generator `src/lib/platina/synthetic.ts` is used only in tests and stays that way.
2. **Scraped ads and competitor pages feed the AI's knowledge, but not Waters' first-party knowledge base.**
   Since C7.0, the knowledge base accepts only Waters' own pages. Scraped data lands in the pattern layer
   (Plane B). The checked insights drawn from it go into the Brain (Plane C), which the planner, Opportunities,
   ideation and Studio all read. So the AI does learn from it; it is simply never filed as "Waters said this".
   Mixing the two would let a competitor's claim be cited as Waters' own proof.
3. **Claude as the operator.** When the owner asks, Claude runs the same scrape commands the product runs and
   reports what they found. Claude's own web research comes in as an **evidence pack**: each item is a URL, a
   quoted sentence and a reason. The importer reads each URL once through Firecrawl and keeps an item only if the
   quote is on the page. Checked items become ordinary Plane B documents with `origin = "operator_pack"`.
   Unchecked items are dropped and listed in the import report.

## 3. Slices

Branches are cut from `feat/c7-9-theme` (the chain so far), one per slice. Each slice follows the C7 build plan
§1.2 definition of done: tests first, typecheck, lint, unit tests, a browser spec, the ops board green, and a
live proof on Waters.

### C8.0 Waters data fill: real data, run now (branch `ops/c8-0-waters-fill`)

**Outcome:** every Platina page for Waters shows real content, or says exactly why it can't yet. A readiness
report proves it, and the ops board keeps checking it.

| ID | Task | Files | Test first | Size |
|---|---|---|---|---|
| F0.1 | **Readiness report.** For each Platina page, it shows the rows the page would show, the age of the newest one, and why it is empty when it is. `--json` output for the journey test. Also runs as a new ops check, "Pages have content" (amber when a main page is empty). | `scripts/readiness.ts` (`npm run platina:readiness`), `src/lib/ops/readiness-pages.ts` (+ test), `ops/collect.ts` | pure view model over counts; an empty page is always reported with a reason | S |
| F0.2 | **Workspace profile.** Set division and region for Waters (decision E1) through the existing profile action, not SQL. | `scripts/workspace-profile.ts` | — | S |
| F0.3 | **Fix the 4 failing conference sources.** Read each last error on Audits and fix the URL, the adapter or the Firecrawl fallback. | `fetch/*`, `presets.ts` | a regression test per cause | S |
| F0.4 | **Conference calendar** (pulled forward from C7.3 T3.1): about 20 checked shows, Gulf first, each with its official URL. Seed approved `conference` specs, then force one read each (Firecrawl, 1 credit each). | `src/lib/platina/conference-calendar.ts`, `scripts/add-events.ts --calendar --seed` | every entry has an https official URL and a region | S |
| F0.5 | **Force run.** `npm run platina:force -- --ws <slug> --flows own-site,competitors,linkedin,conferences [--apply]` runs the chosen collectors now, outside their schedule. Each source gets one run carrying an operator seed grant (`config_snapshot.seedPages`): it passes the workspace daily cap, never the source's own limit; the run then triggers analysis, interest, events and the insight sync as usual. `--inline` runs the collection in the script's process with the code on disk (when the job runner serves an older build). Dry run by default: it prints the planned reads and the projected cost. | `scripts/platina-force.ts`, `src/lib/platina/force-run.ts` (+ test) | a projection over budget refuses; the dry run writes nothing; a source with a run already queued is skipped | M |
| F0.6 | **Evidence pack import.** It reads a JSON pack (URL, quote, why, subject, kind), checks each quote on the page through Firecrawl, stores the checked items as Plane B documents with `origin = "operator_pack"`, and reports what was dropped. | `scripts/import-evidence-pack.ts`, `src/lib/platina/evidence-pack.ts` (+ test) | a quote missing from the page is dropped; a Waters-owned URL is refused here (it belongs in the own site) | M |
| F0.7 | **Own-site catch-up.** Read the 271 queued pages (Firecrawl, about 271 credits), then backfill embeddings over 2-3 days within the quota (the existing C6 backfill). | existing jobs; `platina:force --flows own-site` | — | — |
| F0.8 | **Brand DNA draft for Platina.** One model call over Waters' own-site passages drafts brand-standard lines: product lines, audiences, tone and claims used. Each line cites a passage. **A person confirms each line** before it becomes a brand-standard chunk (the C6 rule that brand chunks mean "confirmed standard"). | **Already built** (found 2026-09-23): Clients -> the client -> "Confirm as brand standard" (`brands/actions.ts confirmBrandStandardAction`) turns the profile read from the client's own pages into brand chunks. Needs a person's click. | — | — |
| F0.9 | **Blocked (E3):** there is no read-only role (owner/admin/member only), and the local dev sign-in reaches the same database. **Test access to real data** (decision E3). Add the local browser-test account as a read-only member of Waters, through a script that can undo it. | `scripts/e2e-member.ts --ws <slug> --add\|--remove` | — | S |
| F0.10 | **Journey test.** Walks Waters' main pages on real data: each renders, none shows an empty state that the readiness report calls a bug, and every visible number has a source link. | `e2e/platina/waters-journey.spec.ts` | the spec itself | M |

**Run order (Claude runs it and reports after each stage):**

- **Stage 1, 24-25 Sep:** F0.1 → F0.2 → F0.3 → F0.4 → F0.5 (own site, competitors, LinkedIn last 30 days,
  conferences) → readiness report.
- **Stage 2, 1 Oct, when Apify resets:** ad libraries through C8.3's scan path, then the readiness report.

Budget for the fill: Firecrawl about 400 credits of 1,000; Apify about $0.45 in September (LinkedIn refresh and
the ad actor check) and about $1.20 on 1 Oct; AI about $2.

**Live proof:** the readiness report shows every main page with real rows, and the journey spec passes on
Waters.

### C7.3 Events: unchanged, hard date (branch `feat/c7-3-events`)

Tasks T3.2-T3.7 as written in the C7 build plan (T3.1 has moved into F0.4). One addition:

- **T3.8** Each event gets the fields that Opportunities 2.0 needs:
  - `city`, `country`, `venue`, and `format` (in person, online or hybrid), each quoted from the page like
    the dates are;
  - `expected_audience`, stored only when the page states it, with the quote.

  `src/lib/platina/event-extract.ts` and the migration shared with T3.2 carry these. The test: a figure not on
  the page is never stored.

Live proof as in the C7 plan: ARABLAB LIVE shows 26-28 Oct 2026, quoted from terrapinn.com, and live mode is
turned on for it on 23 Oct.

### C8.2 Competitors analysis – pattern layer (branch `feat/c8-2-competitors`)

This is C7.2 (T2.1-T2.6) plus the items below. It also pulls forward the run-step recorder from C7.4 (T4.1-T4.2),
because the "read it now" panel needs it.

**What a person sees:**

- **InstaMedia sidebar.** A button pinned to the sidebar footer, always visible below the groups (so it sits
  under Brand DNA & Vault), labelled **"Competitors analysis – pattern layer"**. Collapsed, it shows an icon and
  a tooltip. It opens `/p/[ws]/competitors`.
- **Knowledge Base links.** The KB's "Scraper ops" heading links to the portal. A refused competitor URL offers
  **"Track as competitor"**, which opens the portal with the URL filled in (`?add=`).
- **Platina nav.** "Competitors" under Watch.
- **The portal.** The top of the page has one box that accepts any URL: a site page, a LinkedIn page, a
  LinkedIn or Meta ad-library link, or an event page. It finds the matching competitor (or proposes a new one),
  picks the right scraper and reads the URL now. A live panel shows each step as it happens: "Classified: product
  page, Agilent", "Reading via Firecrawl (1 credit)", "3 findings, 1 event", "2 insights added to the Brain".
- **Competitor cards.** Each shows its changes this week, messaging themes compared with Waters, ads, events,
  share of voice on Waters' topics, and when it was last collected.
- **Pattern layer tab.** Patterns across all competitors:
  - topics rising across the market;
  - formats and hooks that beat each company's own median;
  - **white space**: topics competitors push where Waters is silent, and the reverse;
  - every line with its count, its proof links and the "(public data)" label.

| ID | Task | Files | Test first | Size |
|---|---|---|---|---|
| T2.1-T2.6 | As written in the C7 build plan | — | — | — |
| T4.1-T4.2 | `onStep` hook and run-step recorder (from C7.4), migration for `platina_run_steps` | as in C7 plan | as in C7 plan | M |
| T2.7 | **Pinned footer button** in the InstaMedia sidebar (plain link, no Platina import), plus a nav test that it renders when the sidebar is expanded and when it is collapsed | `src/components/workspace-nav.tsx`, `src/lib/nav.ts` (+ test) | nav test | S |
| T2.8 | **KB links.** The refusal gets a "Track as competitor" link, and the Scraper ops heading links to the portal | `ingest-form.tsx`, `kb/page.tsx` | e2e: a refused thermofisher.com URL links to the portal with `?add=` | S |
| T2.9 | **Read-it-now panel** on the add box, fed by run steps through the `competitors` realtime scope | `competitors/add-panel.tsx`, `competitors/actions.ts` | browser spec: a URL shows steps and then its result without a reload | M |
| T2.10 | **Pattern layer view (pure):** cross-competitor topic momentum, format and hook lift against each company's median, and white space. Min-N 5, each line with proofs | `src/lib/platina/pattern-layer.ts` (+ test) | below min-N a line says "not enough posts yet"; no line mixes planes | M |
| T2.11 | **Re-add from the quarantine.** Run Agilent, Thermo Fisher and Pfizer (as a market source, decision E4) from the C7.0 backup through the add path | `scripts/kb-quarantine.ts --to-competitors` | dry run lists targets; nothing reaches `knowledge_chunks` | S |

**Live proof:** paste `https://www.agilent.com/en/product/...` and within a minute it appears under Agilent with
findings. The pattern tab shows at least 3 topics that pass min-N from the 151 posts.

### C8.3 Ads insight from public ad libraries, with Claude as operator (branch `feat/c8-3-ads`)

This is C7.6 (T6.1-T6.7) plus the items below.

**How the data flows:**

1. **Collect.** The LinkedIn Ad Library and Meta Ad Library are read through Apify for Waters and its 5
   competitors, weekly, plus on demand.
2. **Store.** Ads go to `platina_ads`, with a snapshot per read in `platina_ad_snapshots`.
3. **Follow each new ad.** Its landing page is read once (Firecrawl, capped), and one call classifies its theme.
4. **Compute.** Code works out days running, variants, refresh cadence, countries, and the impression range
   where the library publishes one (LinkedIn does for ads shown in the EU).
5. **Detect.** Code flags competitor pushes, long-running Waters ads, regional gaps and theme shifts.
6. **Feed the Brain.** Each finding becomes a measured insight in the Brain (`pressure:<brand>:<topic>`), so
   the planner, Opportunities and ideation use it.

**What a person sees:**

- **Scan now.** The Ads page (`/p/[ws]/ads`) has a Scan now button. Before starting, it shows the planned
  advertisers, keywords and countries, the projected Apify cost and the money left this month. Nothing runs over
  budget without the owner's approval.
- **Live scan panel.** Queued → running (actor, cost so far) → ads found → new ads → detections. It updates in
  place through the `ads` realtime scope.
- **Side by side.** Waters and its competitors in columns, with the ads new this week. Each ad card shows its
  text, its dates, its EU impression range or "not published", and its landing page.
- **Labels.** Every measure is labelled "activity, not performance". No page ever shows spend, CTR or
  conversions, because no library publishes them.
- **InstaMedia's "Meta Ads Engine" page, for a client with no ad account:** a note, "No ad account connected.
  Public ad-library view for this client →", linking to `/p/[ws]/ads`.

**Claude as operator:** `npm run platina:ads-sweep -- --ws waters-gcc-internal [--advertisers ...] [--countries
AE,SA,QA,KW,OM,BH] [--apply]` goes through the same scan path and budget check as the button. When the owner
says "run an ads sweep", Claude runs it and reports the new ads and detections. Anything Claude finds by web
research (for example a competitor's campaign landing page) comes in as an evidence pack (F0.6).

| ID | Task | Files | Test first | Size |
|---|---|---|---|---|
| T6.1-T6.7 | As written in the C7 build plan | — | — | — |
| T6.8 | **Live scan panel** fed by run steps (the recorder from C8.2) | `ads/scan-panel.tsx` | browser spec: steps appear during a stubbed scan | M |
| T6.9 | **Sweep command** sharing `plan-scans.ts` and the budget gate with the button | `scripts/platina-ads-sweep.ts` | over budget without `--approve-over`: refuses | S |
| T6.10 | **InstaMedia Ads page pointer** for a client with no ad account (link only) | `app/(app)/w/[ws]/ads/page.tsx` | render test | S |
| T6.11 | **Ads to Brain.** Detections become measured insights via `market-insight-sync` with keys `pressure:*` and `adgap:*` | `market-insights.ts` (+ test) | an unchanged detection leaves the insight untouched | S |

**Live proof (after 1 Oct):** the LinkedIn Ad Library shows Waters' and Thermo Fisher's current ads with dates.
At least one regional-gap or push detection has proofs, or the page says that none passed min-N.

### C8.4 Opportunities 2.0: the campaign guide (branch `feat/c8-4-opportunities`)

The Opportunities page stays its own tab under Decide. It is rebuilt as a guide: what to run, where, when, why,
and what it takes.

**Tabs:** Top picks · Calendar (next 180 days) · Map · Competitor moves · Topics · Gaps.

**Each opportunity card shows:**

| Part | Content | Where it comes from |
|---|---|---|
| What | "Exhibit-side campaign for ARABLAB LIVE 2026: PFAS testing in Gulf water labs" | the model phrases the title; the facts under it are computed |
| When | 26-28 Oct 2026 · 33 days left · **start planning by 5 Oct** (the date minus the lead time for the channel mix) | event dates (quoted) and a lead-time table in code |
| Where | Dubai World Trade Centre, UAE · GCC · in person | quoted event fields (T3.8) |
| Why now | Up to 3 evidence lines, each with its proof link and plane label | interest momentum, events, ads and Brain insights |
| Who else is there | "Bruker (3 of its own posts)", "Agilent (exhibitor list)" | participation proofs |
| Fit with Waters | The product lines and passages from Waters' own site that match the topic | Plane A own-site passages, cited |
| Sales angle | Which product line and which buyer role this targets, in one sentence citing the fit passages | one model call, citations checked by code |
| Rank factors | Timing, region fit, topic momentum, competitor pressure, own proof available, past results. Each factor shows its raw value, its source and its weight | code; weights from C8.5 (defaults until then) |
| Confidence | "Enough data", or "Thin: 3 posts" (min-N) | code |
| Campaign outline | Phases counted back from the date: teaser, pre-event outreach, on-site, follow-up, each with a due date | code from lead-time rules; the planner refines it |
| Pipeline state | Found → Planned → Briefed → Running → Measured, and what's missing | plans, briefs and creatives linked to this card |
| Actions | Plan this · Brief in Studio · Watch live · Dismiss (with a reason) · Snooze | — |

**Sales:** no sales number is shown, because none is measured. If Waters logs leads per campaign on Results
(Plane A, typed by a person, with a source), those leads become the reward the learning engine uses. The card
says "sales impact not measured" until then.

| ID | Task | Files | Test first | Size |
|---|---|---|---|---|
| T84.1 | **Factor model (pure).** Computes every factor from stored facts. Score = Σ weight × factor, and "why this is #1" names the top two factors. No model output enters a number | `src/lib/platina/opportunity-factors.ts` (+ test) | fixture: ARABLAB ranks above an undated event; changing a weight re-orders predictably | M |
| T84.2 | **Lead-time and outline (pure).** Lead time by channel, "start planning by" and back-scheduled phases | `src/lib/platina/campaign-outline.ts` (+ test) | an event 10 days out is flagged short notice, with a compressed outline | S |
| T84.3 | **Fit and sales angle.** Retrieves own-site passages for the topic (Plane A only), makes one cited model call, and caches it per opportunity and input hash | `src/lib/platina/opportunity-fit.ts` (+ test) | a citation to a Plane B item is rejected | M |
| T84.4 | **Page:** tabs, cards, the map (reusing `event-map.tsx` from C7.3), calendar and filters. Dismiss and snooze write to the suggestion ledger (C8.5) | `opportunities/page.tsx`, `components/platina/opportunity-card.tsx` | browser spec `e2e/platina/opportunities.spec.ts` | L |
| T84.5 | **Pipeline state.** Links opportunity → plan → brief → creative → result, computed on read | `src/lib/platina/opportunity-pipeline.ts` (+ test) | a planned card shows "Planned", with a link | S |
| T84.6 | **Leads on Results.** A person logs leads per campaign, with a source note (Plane A) | `results/*`, `learning-service.ts` | a lead row requires a campaign and a person | S |

**Live proof:** on Waters, Top picks lists ARABLAB LIVE with its dates, city, Bruker's presence with proof, a
Waters fit passage and a "start planning by" date. Plan this creates a plan anchored to it.

### C8.5 The learning engine: suggestion ledger, credit assignment, monthly consolidation (branch `feat/c8-5-learning-engine`)

C7.8 (public learning lane) is folded in here, because the lane gives the engine data today: Waters' own public
LinkedIn posts, with real public engagement.

**What it does:**

1. **Every suggestion is recorded.** The ledger (`platina_suggestions`) records every opportunity, idea,
   planner phase, brief and draft hook the product proposes, with:
   - its text;
   - its inputs: the ids of the insights, events, passages and patterns it used, each with its plane;
   - its features: topic, channel, format, hook, region, event type, timing;
   - its factor values and the version of the weights used;
   - the model and prompt version.

   What happens to it afterwards goes in `platina_suggestion_events`: shown, opened, accepted, dismissed (with
   a reason), planned, posted, result.
2. **Results flow back.** When a result arrives, code turns it into a reward between 0 and 1. A result is:
   - a Waters creative that beats its own median;
   - leads logged by a person;
   - a confirmed review;
   - in the public lane, a Waters post that beats Waters' median.

   The reward then flows **backwards** along the suggestion's record:
   - to each feature value, updating its Thompson-sampling counts;
   - to each input insight, updating its **trust score** (Beta counts), split by how much that insight weighed
     in retrieval.

   A dismissal with the reason "wrong fact" lowers the trust of the insight named, as in C7.4 T4.6. This is
   credit assignment over a graph you can trace. It works like backpropagation (outcomes adjust the things that
   produced them), but with counts a person can read, not a neural network. It stays within the owner decision
   (feedback loop plus bandit, min-N gated).
3. **Ideas are triggered in real time.** When an insight crosses a threshold (a new dated event in the region, a
   topic passing min-N and rising, a competitor push), the engine drafts up to 3 ideas from:
   - the trigger;
   - Waters' Brand DNA (confirmed brand-standard lines from F0.8, plus own-site passages);
   - learned patterns: features and insights with high trust.

   About 80% of ideas follow the best-learned patterns. About 20% try something new and are labelled so. It is
   capped per day and budget-checked, and every idea goes into the ledger.
4. **Monthly consolidation.** A job on the 1st of each month at 02:00 UTC (decision E5), which can also be run
   by hand from Admin:
   - **Merge.** Near-duplicate Brain insights on the same topic, within one plane, merge into one consolidated
     insight. The originals are superseded, not deleted, and keep their links.
   - **Retire.** Insights past the window, unused and low in trust are archived. This can be undone.
   - **Decay.** Feature and trust counts decay with a 90-day half-life (the existing `decayWeight`), so the
     engine follows change.
   - **Snapshot.** The weights are saved as a version (`platina_learning_snapshots`), so any past suggestion
     can be explained with the weights of its day.
   - **Digest.** A "What we learnt this month" digest lists:
     - patterns that gained or lost weight;
     - suggestions that worked or failed, with their traces;
     - insights that were merged or retired.

     Numbers are computed by code; one model call writes the sentences.
5. **Everything can be traced.** `/p/[ws]/learning` (under Learn) holds:
   - the ledger, with filters;
   - a trace view: inputs → suggestion → decisions → result → credit sent back;
   - monthly digests, compared month to month.

| ID | Task | Files | Test first | Size |
|---|---|---|---|---|
| T85.1 | **Ledger tables and queries** (`platina_suggestions`, `platina_suggestion_events`, `platina_learning_snapshots`, `trust_alpha`/`trust_beta` on Brain chunks), migration | `platina-schema.ts`, `src/db/queries/platina-suggestions.ts` (+ test) | workspace_id in every query's SQL; C7 scoped-tables test extended | M |
| T85.2 | **Recorder.** `recordSuggestion()` is called from Opportunities, the planner, ideation and (later) Studio. Pure input builder; the write is best-effort and never blocks the page | `src/lib/platina/suggestions.ts` (+ test) | same page output with the recorder failing | M |
| T85.3 | **Public lane** (C7.8 T8.1-T8.2): features for Waters' collected posts and ads, stats kept separate from first-party ones, with its own "(public data)" lines | `learning-public.ts`, `opportunity-learning.ts` | public stats never enter first-party stats | M |
| T85.4 | **Credit assignment (pure).** Reward → feature counts and insight trust, split by retrieval weight, min-N gated before any weight changes a ranking | `src/lib/platina/credit.ts` (+ test) | fixture: a worked suggestion raises exactly its inputs' trust; a public-lane reward never touches first-party counts | M |
| T85.5 | **Triggered ideation.** Threshold rules, idea drafts from trigger + Brand DNA + learned patterns, the explore share, a daily cap and a budget check | `src/lib/platina/idea-engine.ts` (+ test), `src/inngest/functions/platina/idea-trigger.ts` | over the cap: no call; each idea cites its trigger and at least one Brand DNA line | M |
| T85.6 | **Monthly consolidation job:** merge, retire, decay, snapshot, digest. Idempotent per month; dry run from Admin shows what it would change | `src/lib/platina/consolidate.ts` (+ test), `src/inngest/functions/platina/consolidate.ts` | merge never crosses planes; a re-run in the same month changes nothing; archived items can be restored | L |
| T85.7 | **Learning page:** ledger, trace view, digests | `app/(platina)/p/[ws]/learning/*` | browser spec | L |
| T85.8 | **Ops.** `ops:check` reports ledger size, last consolidation and both learning lanes; amber if the consolidation is late | `ops/checks.ts` | unit test | S |

**Live proof:**

- The public lane on Waters' posts passes min-N for at least one feature.
- The first consolidation, run by hand, produces a digest with real merges, or says there were none.
- A suggestion that was dismissed as "wrong fact" shows the lowered trust in its trace.

### C8.6 Brain map: every insight, connected, in 3D (branch `feat/c8-6-brain-map`)

This is C7.7 (T7.1-T7.4), widened to the whole chain rather than only the Brain.

- **Nodes:** sources, collected documents (sampled), Brain insights, events, competitors, topics, own-site
  passages (Plane A), suggestions, plans, results and monthly digests.
- **Links:** each has a type and a sentence: came from, about, rests on, suggested, led to, taught, merged into,
  similar to (within a plane only; across planes only when asked, and marked "resembles").
- **Layout:** planes are regions. Plane A sits on the left, Plane B on the right, the Brain in the middle and
  decisions and results in front. Brain nodes are placed by a 3D PCA of their vectors; the rest by a short
  force pass.
- **Reading:** hover shows the insight's full text. A click opens a side panel with the text, source, plane,
  date, trust score and every link as a sentence.
- **Trace mode:** pick a result and the path back to its sources lights up, with the credit each step received.
  This shows the learning engine working.
- **Live:** new nodes pulse in through the `insights`, `events`, `ads` and `competitors` scopes. A time slider
  replays how the graph grew.
- **Access and speed:** search with fly-to, filters by plane, kind and time, a table view, reduced motion, 2D
  on phones, and caps of 2,000 nodes and 6,000 links.
- **Nav:** "Brain map" under Watch, next to Live flow.

| ID | Task | Files | Test first | Size |
|---|---|---|---|---|
| T7.1-T7.4 | As written in the C7 build plan (graph builder, layout, payload route, scene) | — | — | — |
| T86.1 | **Ledger and consolidation nodes and links** in the graph builder | `brain-map/graph.ts` | a suggestion links to exactly its recorded inputs | S |
| T86.2 | **Trace mode (pure path finder** from result to sources, with credit per step) plus the scene highlight | `brain-map/trace.ts` (+ test), scene | the fixture path matches the ledger | M |
| T86.3 | **Link sentences:** one template per link type, no model call | `brain-map/edges.ts` (+ test) | every link type has a sentence | S |

**Live proof:**

- The Brain map for Waters loads under the size budget.
- Searching "ARABLAB" flies to the event, and its panel lists the participants' proofs and the opportunity
  built on it.
- Trace mode on the first logged result shows its path.

## 4. Order and dates (one developer; today is Wed 23 Sep 2026)

| Dates | Work | Ships |
|---|---|---|
| 24-25 Sep | C8.0 stage 1 (F0.1-F0.7, F0.9) | readiness report; profile; conference calendar; own site catching up |
| 28 Sep-9 Oct | C7.3 events (T3.2-T3.8); 1 Oct: C8.0 stage 2 (ad actor check, first ad-library reads) | Events page, map, live mode |
| 12-16 Oct | C8.2 competitors – pattern layer (with the run-step recorder) | InstaMedia footer button, portal, read-it-now panel |
| 19-23 Oct | C8.4 Opportunities 2.0; F0.8 Brand DNA draft; F0.10 journey test | campaign guide; live mode on for ARABLAB (23 Oct) |
| 26-30 Oct | ARABLAB LIVE watched live; C8.3 ads | ads page and sweep command |
| 2-13 Nov | C8.5 learning engine; first consolidation run by hand | ledger, trace, digest |
| 16-27 Nov | C8.6 Brain map | 3D map with trace mode |
| 1 Dec | first scheduled consolidation | December digest |
| Dec | C7.4 live briefs (rest), C7.5 Studio | live panels; Studio |

If the schedule slips, C8.3 and C8.6 move later. C7.3 and ARABLAB live mode never do.

## 5. Budget plan

| Budget | Sep (rest) | Oct | Nov onward (monthly) |
|---|---|---|---|
| Apify ($5/month) | about $0.45 (LinkedIn refresh, ad actor check) → about $1.40 total | about $1.20 fill + about $2.00 weekly ad libraries + about $0.60 ARABLAB live + about $0.60 LinkedIn = about $4.40 | about $3.20 routine; Scan now shows what's left |
| Firecrawl (1,000 per period, to 21 Oct) | about 400 (own site 271, conferences 25, competitor pages 50, evidence packs 50) | about 150 (date follow-ups, landing pages, new competitor pages) | about 200 |
| AI (Waters) | about $2 extra | about $5 extra (sales angles, detections, idea triggers) | about $6 extra (+ digest) |
| Gemini embeddings (about 250 a day) | own-site backfill over 2-3 days | normal | normal (O1, a paid key, removes the limit) |

Apify costs are estimates until the ad actor check (T6.1) measures real cost per ad. The ops board projects
spend hourly, and every paid run checks the budget first.

## 6. Decisions: each has a default, so work starts without waiting

| # | Question | Default if not answered |
|---|---|---|
| E1 | Waters profile: division and region | Division "Waters (incl. BD Biosciences)", region "GCC (Middle East)" |
| E2 | Where the InstaMedia footer button leads | The Platina competitor portal `/p/[ws]/competitors` (one portal, not two) |
| E3 | Browser tests on real Waters data | **Reopened:** there is no read-only role, so the test account would get member (write) access to a live client workspace. Options: a real viewer role first (small slice), or keep checks scripted. Waiting for the owner |
| E4 | Pfizer (from the quarantined passages) | Tracked as a market source (a customer, not a competitor) |
| E5 | Monthly consolidation time | 1st of the month, 02:00 UTC (06:00 Gulf) |

## 7. Risks

| Risk | What's done about it |
|---|---|
| "Force run" slowly turns into typing in data | Every fill row comes from a fetched URL through a run that records its seed grant; the evidence-pack importer drops unchecked quotes; a test fails if any row lacks provenance |
| The LinkedIn Ad Library actor changes or breaks | The actor check runs weekly from `ops:check`; mapper tests run on saved output; the page says "ad library unavailable" instead of showing nothing |
| The learning engine over-fits on little data | Min-N before any weight changes a ranking, the 90-day decay, a 20% explore share and visible weights |
| Consolidation merges the wrong things | Merges stay within a plane, are superseded not deleted, can be undone, and there's a dry run first |
| ARABLAB comes before the portal is polished | C7.3 goes first; C8.2 is cut to the add box and cards if needed |
| Concurrent edits in Cursor | Narrow edits; each PR lists the files it touches; nothing reformatted repo-wide |

## 8. How "test it all together" works

1. `npm run platina:readiness -- --ws <slug>`: page by page, rows, freshness, and why a page is empty. It runs after every
   fill stage and in `ops:check`.
2. `e2e/platina/waters-journey.spec.ts` on real Waters data (after E3): Cockpit → Live flow → Events →
   Competitors → Opportunities → Plan this → Results → Learning → Brain map. Every page renders, every number
   has a source link, and there are no page errors.
3. The ops board stays green, with a new check, "Pages have content".
4. Each slice's live proof is recorded in the progress table below, with the date and what was seen.

## 9. Progress

| Slice | Status | Commit | Live proof |
|---|---|---|---|
| C8.0 stage 1 | **done 2026-09-23** (F0.1-F0.7; F0.8 already existed; F0.9/F0.10 blocked on E3) | 3217379 + follow-up | Readiness: Cockpit, Live flow, Clients, Opportunities, Plan, Audits, Findings OK; Results empty (C8.5), Brand Gene thin (needs a person to confirm the profile). Profile set. 15 calendar shows added, 22+3 conference pages read; events 50 -> 71 (34 upcoming); ARABLAB LIVE now names Bruker, Shimadzu and Thermo Fisher on the exhibitor list. LinkedIn +15 posts, 5 competitor sites, 5 evidence-pack pages kept (2 dropped: SFDA page unreadable, 1 quote fixed and re-read). Own site 40 -> 156 of 300 read (758 passages wait for embeddings: Gemini free quota, O1). Spend today: Firecrawl ~190 credits, Apify ~$0.22. |
| C7.3 | not started (T3.1 moved to F0.4) | | |
| C8.0 stage 2 | not started | | |
| C8.2 | not started | | |
| C8.4 | not started | | |
| C8.3 | not started | | |
| C8.5 | not started | | |
| C8.6 | not started | | |
