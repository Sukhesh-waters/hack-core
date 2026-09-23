# C7: live operations (fix, watch, decide, make, run, learn)

Status: **owner decisions answered 2026-09-22 (§6); plan final, build starts with C7.0.** Builds on C0-C6
(`2026-09-21-campaign-intelligence.md`, `2026-09-22-c6-learning-loop.md`).

The owner's asks, and the slice that answers each:

| Ask | Slice |
|---|---|
| Bug fixes and optimisation driven by the flows and the operational tests we built | C7.0, C7.1 |
| Competitor analysis gets its own page; competitor URLs must stop landing in the first-party knowledge base | C7.0, C7.2 |
| Live, in-person campaigns worldwide (events relevant to Waters) | C7.3 |
| Show the AI's operating brief live on the pages, so people can check it | C7.4 |
| A real connection from ideation to a creative studio: keywords, analysis brief, diagrams | C7.5 |
| Ads insight for LinkedIn, Meta and others under one orchestrator that steers the scrapers (no account connections) | C7.6 |
| A separate 3D page showing how insights, keywords and vectors connect and move | C7.7 |
| The learning loop learns from what we can actually see, and the core flows run in real time | C7.8, C7.1 |
| Light theme by default; teal becomes a mild blue like the Salesforce logo | C7.9 |

## 0. What I checked (live, read-only, 2026-09-22)

| # | Finding | Evidence | Severity |
|---|---|---|---|
| F1 | **Other companies' pages are in Waters' first-party knowledge base.** Of 67 passages, 25 are Waters' own: waters.com 3, LinkedIn /company/waters 11, and BD Biosciences 11 (part of Waters since the combination closed on 9 Feb 2026). **42 are third-party:** Agilent LinkedIn 11, Thermo Fisher LinkedIn 14, thermofisher.com 3, Pfizer LinkedIn 14. All are embedded, so similarity search returns them. | `knowledge_sources` / `knowledge_chunks` in `waters-gcc-internal`, added 21-22 Sep. No ingest path checks whose page it is. The "whole site" option would crawl a competitor's site into first-party through Firecrawl. `knowledge-refresh` re-reads these pages every 7 days. | **Critical**: breaks the two-layer rule |
| F2 | **The Ads "Sync metrics" button invents numbers.** With no Meta token, or when the call fails or returns nothing, it makes up spend from the budget pace, impressions = spend x 125, clicks 2.4%, conversions 6.5%, and saves them as real. A paused campaign keeps "spending". Real data counts every Meta action type as a conversion. The token is sent in the URL. | `src/lib/connectors/meta-ads.ts:57-95`, called from `/w/[ws]/ads/actions.ts` | **Critical** |
| F3 | **Any pasted URL is fetched from our server with no address check (SSRF).** Affected: (1) the `/kb` URL box, which also has no timeout or size cap, strips HTML with regexes, stores no embeddings and uses the old "InstaMediaBot" user agent (a second, weaker copy of the Knowledge ingest); (2) `readPage` direct fetch; (3) the Platina header probe, which follows redirects to any host. | `src/app/(app)/w/[ws]/kb/crawl-action.ts`, `src/lib/knowledge-ingest.ts`, `src/lib/platina/fetch/probe-fetch.ts` | High |
| F4 | **Ingest is unreliable, so people retry.** The Waters homepage was submitted 7 times in two days before one attempt worked. 5 rows are stuck "pending" since 20-21 Sep and 3 failed. One was saved as `https:/www.waters.com`, and the `srsltid` and `trk` parameters create duplicates. | same tables | Medium |
| F5 | **Events come from one kind of source.** 25 are known: 8 upcoming, 1 in the Gulf (ARABLAB LIVE), 10 with no date. **All 25** proofs are LinkedIn posts. There is no conference calendar, no Waters events page and no date follow-up. | `scripts/events-report.ts` | Gap |
| F6 | **The learning loop has nothing to learn from.** It has 0 creatives and 0 results, so rankings correctly stay in rule order. On the own site, 17 of 300 pages are read. The Gemini free embedding quota is the limit (O1). | `scripts/verify-learning.ts` (OK) | Gap |
| F7 | **Nothing connects ideas to creative.** Opportunities §4 "Creative ideas" links to Solutions (text directions only). No brief, no keywords with numbers, no proof and no visuals. Platina has no studio. | `opportunities/page.tsx:372-395` | Gap |
| F8 | **AI work is invisible while it runs.** The planner runs context -> draft -> check -> review -> save in one call, and the page sees only the result. `runOrchestration` has no step hook. | `src/lib/orchestrator/run.ts` | Gap |
| F9 | **Theme and colour.** With no saved choice the app follows the OS and falls back to dark. InstaMedia is teal #0D9488, and white text on teal is 3.74:1, below the 4.5:1 AA minimum. Platina uses Waters blue #005EB8, a client's colour, as the product colour. Teal is also hard-coded: 63 classes in 7 files, 4 UI files with hex values, and the 3D scene. | `src/lib/theme.ts`, `globals.css` | UX |
| F10 | **The operational tests are all run by hand.** That covers 5 `verify-*` scripts, the events report, smoke-collect and 5 browser specs. CI runs lint, typecheck, unit tests and build only. | `.github/workflows/ci.yml` | Gap |
| F11 | **Security carried over from C6.** Next 14 critical advisories need Next 15 (D4, approved). | C6 plan §L0 | Critical |
| F12 | **Firecrawl refuses linkedin.com** (live 403, `UNSUPPORTED_HOSTS`), so everything on LinkedIn, including its Ad Library, has to come through Apify. | `src/lib/scrape/firecrawl.ts:32` | Constraint |

Not attached: the other LLM's ads suggestion. It isn't needed now that ads come from public libraries (D9), but I'll
reconcile it if it's pasted. The design reference (`InstaMedia AI Prototype.dc.html`) is at a Mac path that isn't on
this machine. The owner's uncommitted edits stay untouched: fonts in `globals.css`, Turbopack removed, Google account
linking, reminders.

## 1. The loop this builds

```
 WATCH                     UNDERSTAND         DECIDE                 MAKE             RUN            MEASURE          LEARN
 own site (A) ──────────┐
 competitors (B) ───────┤   analysis,        opportunities          studio brief     posts, ads     results (A),     reviews, bandit (A)
 events (B) ────────────┼─> Brain (C),  ───> + events ──> plan ───> drafts, visuals ─> (run by the ─> ad libraries ──> public patterns (B)
 ad libraries (B) ──────┤   keywords                                                  team)          (B)
 social posts (B) ──────┘                                                                                    │
        ^                                                                                                   │
        └──── orchestrator: what to watch next, within the Apify + Firecrawl budgets  <─────────────────────┘

 Across every step:  live brief (what the AI read, did and concluded; people mark it right or wrong)
                     ops board (each flow healthy, fresh, in budget; a red check raises an alert)
```

Real time here means: each step fires the next through an event, a cron remains only as the safety net, and pages
update through the existing signal-only realtime channel. How often social and ads data can be read is set by the
budgets in §5.

## 2. Rules every slice keeps

- **Two layers never mix.** A = first-party (own site, own results, confirmed lessons). B = public (competitors,
  customers, events, ad libraries, social posts, including Waters' own public posts and ads). C = Brain hypotheses.
  A third party's page never enters A. Pages, briefs and the 3D map keep the layers visibly apart.
- **No logging in to ad accounts (D9).** Ads insight comes from public ad libraries only.
- `workspace_id` on every new table and query, asserted in query tests.
- No agent spawns an agent. Orchestrators are Inngest functions (code) that make single model calls through the router.
- Min-N gate, and no invented numbers: missing is null and shown as "not measured" or "not published".
- Degradation ladder: a failed source is retried and flagged, a quota hit queues work for a backfill, and stale data is
  flagged.
- A person confirms before anything teaches the system or spends above a budget limit.
- The Platina/InstaMedia boundary holds, and the allowlist grows only by owner decision.
- Every slice is merged only once three things hold: a failing test existed first for each bug, CI is green, and
  `ops:check` is green on Waters (from C7.1 on).

## 3. Slices

### C7.0 Stop the leaks (first)

- **a. Quarantine (D6).** Back up the 5 third-party sources (42 passages) to JSON, remove them from Waters'
  first-party knowledge base, and re-add each as a public source: Thermo Fisher and Agilent as competitors (C7.2),
  Pfizer as a market/customer source. BD Biosciences' 11 passages stay first-party.
- **b. Ownership guard** on every first-party URL ingest: the Brand Gene -> Knowledge single page and whole site,
  and the `/kb` box. One shared function, `ownershipOf(url, client, competitors)`, decides:
  - It accepts only the client's own domains and handles.
  - Anything else stops with a message such as "This looks like Thermo Fisher's page. Add it under Competitors", plus a
    button that carries the URL over.
  - "It's ours" is allowed, but it asks for confirmation, adds the domain or handle to the client's own list, and logs it.

  Waters' own list starts with waters.com, LinkedIn /company/waters and LinkedIn /showcase/bdbiosciences. BD's other
  businesses (bd.com as a whole) are not Waters. Unit tests run on the 15 real Waters URLs.
- **c. One ingest path.** The `/kb` crawl action is replaced by the Firecrawl-based Knowledge ingest, so one guard and
  one set of limits cover every path.
- **d. Safe fetch.** `safeFetch(url)` covers every server-side fetch of a user-supplied URL (`readPage` direct, the
  header probe, the own-site probe):
  - It allows http(s) only.
  - It resolves DNS and refuses private, loopback, link-local and metadata addresses.
  - It re-checks every redirect hop, times out after 10 s and stops at 2 MB.

  Tests cover `127.0.0.1`, `10.x`, `169.254.169.254`, `[::1]` and a redirect to a private host.
- **e. URL hygiene.**
  - Normalise before saving: repair `https:/`, and drop `srsltid`, `utm_*`, `trk`, `fbclid` and `gclid`.
  - De-duplicate per client.
  - Mark a "pending" ingest older than 3 minutes as failed, with the reason shown, so nobody retries blindly.
  - Clean the 5 stuck rows.
- **f. No invented ads numbers** (InstaMedia's `/w` Ads page, D6).
  - `pullMetaCampaignMetrics` returns "not reported" and never synthesises.
  - Conversions count only lead and conversion action types.
  - The token moves to the Authorization header.
  - Existing rows that match the synthetic formula are reset to "not measured" after a backup. This needs nullable
    metric columns on `campaigns`.
- **g. Next 15 (D4).** This goes on its own branch, `chore/next-15`:
  - The codemod converts async `params`/`searchParams`, which every page here reads synchronously.
  - React 19, and a check that NextAuth beta still works.
  - Check the new caching defaults: `fetch` and GET handlers are no longer cached.
  - Full unit and e2e runs, then retest Turbopack dev, since the duplicate-React problem may be gone in 15.

  Merge it before new pages, so each new page is written once, in the 15 style.

Acceptance:
- Waters' first-party store holds only Waters' own passages (25).
- Pasting thermofisher.com into Knowledge is refused, with the Competitors link.
- The SSRF tests pass.
- Ads sync never writes a number Meta did not report.
- `npm audit` shows no critical.

### C7.1 Ops board: the checks run themselves

- **One runner**, `npm run ops:check -- --ws <slug> --client <name>`. It is read-only, prints a scorecard and exits 1
  on red. Each check is a pure function over data, with unit tests. It builds on `src/lib/platina/health.ts`
  (existing statuses ok / degraded / down / not_configured).

| Flow | Check | Red when |
|---|---|---|
| Knowledge | every first-party passage comes from an own domain or handle | any third-party passage (F1 can't come back) |
| Own site | read / queued / failed, last read | queue > 0 and nothing read in 48 h |
| Embeddings | backlog, 429s in 24 h | backlog > 500, or growing 3 days running |
| Collection | due vs run per source, last success | any source 2x overdue |
| Events | upcoming in the client's region, share without dates | none upcoming in region for 60 days |
| Ads | last scan per advertiser and library | a watched advertiser not scanned in 14 days |
| Learning | results, values past min-N, public vs first-party kept apart | ranking moved below min-N, or public data in a first-party posterior |
| Planner | first-party evidence for a standard question | 0 passages |
| Providers | each model tier and embeddings answer | a tier down with no fallback |
| Budgets | Apify spend vs $5, Firecrawl credits, AI cost (`ai_usage`) | projected monthly overrun (amber at 80%) |
| Jobs | Inngest failures in 24 h, stuck runs | anything stuck > 1 h |

- **Live board.**
  - Checks run hourly (the cheap ones) and daily (the full set) as an Inngest job, writing into `platina_ops_checks`.
  - Admin -> Health becomes a live board: green, amber or red per flow, with 7 days of history.
  - A check that turns red raises an in-app alert through the existing alert rules; in-app is the only live route.
- **Core flow timings**, measured on Waters and shown on the board. The first job is to map what triggers every Platina
  Inngest job (17 files today) and how long each step waits for the next. Where a step waits for a clock, it gets
  chained to the event that should trigger it.

| Flow | Target |
|---|---|
| A result recorded -> ranking changed | ≤ 1 min |
| New event extracted -> Events page and alert | ≤ 15 min |
| Own-site page changed -> new first-party passages | ≤ 24 h |
| Competitor post or ad -> insight visible | one collection cycle (daily for posts, weekly for ad libraries, within budget) |

- **Browser tests in CI**: a nightly Playwright job on a production build (`next build && next start`) as the dev-bypass
  user runs the 5 existing specs plus one per new page. The `e2e` PR label runs it on demand.
- **Speed budgets**: record server render time per Platina page and duration per job (p50/p95), and show the slowest
  five. Budgets: a warm page < 1.5 s, Opportunities < 2 s, Brain map first paint < 2 s.

Acceptance:
- `ops:check` on Waters today reports F1 red; after C7.0 it is green.
- A job made to fail in a test turns its row red and raises one alert.

### C7.2 Competitors page (Plane B, its own portal)

`/p/[ws]/competitors` and `/p/[ws]/competitors/[id]`, per client, in the nav next to Clients.

- **List.** Each competitor shows:
  - what changed this week (findings);
  - what it posts about, and how that does against its own median;
  - new ads (C7.6) and its events (C7.3);
  - share of voice on the client's topics, and when it was last collected.
- **Detail tabs.**
  - Timeline: every change, with its proof link.
  - Messaging: themes rising and falling.
  - Ads.
  - Events.
  - Sources: what we watch, status, last read, cost.
  - Brief: the last 30 days summarised from public sources only, every line linked, with its live brief (C7.4).
- **Add a URL.** Paste any URL and it is classified as a site page, press/news, a social profile or post, an ad-library
  page or an event page. It then becomes a public source of that kind:
  - Site and press pages are read through Firecrawl, one page (allowed).
  - LinkedIn, social and ad libraries go through Apify (F12).
  - "Watch this site" means the person picks up to N pages from a list. There is no competitor sitemap crawl (rule).
    Each picked page is watched by the free header probe and re-read only when it changes.

  Status updates live (new realtime scope `competitors`).
- **Other third parties.** Customers such as Pfizer, partners and industry bodies get the same treatment as "Market
  sources", through a filter on the same page.
- **Never.** Competitor content is never embedded as first-party, never cited as first-party and never used in Brand
  DNA; it is always labelled "public". An integration test proves a competitor URL cannot reach a first-party table.
- **Suggested, only if you want it.** Waters now includes Waters Biosciences and Waters Advanced Diagnostics (ex-BD), so
  flow cytometry and diagnostics competitors could be watched too: Cytek, Beckman Coulter, Bio-Rad, Miltenyi Biotec.

Acceptance: paste a thermofisher.com product page and it shows under Thermo Fisher within a minute, labelled public,
with a summary. Knowledge refuses the same URL. The planner cites it only in the public list.

### C7.3 Live events worldwide (in-person campaign radar)

- **Sources.** All are public except Waters' own:
  1. **Waters' events and webinars pages** give first-party events ("where Waters will be"). Extraction is added to the
     own-site pass that already reads those pages. Known today: WEBAF, Malta, 13-14 Oct 2026, and the Waters Inform
     User Meeting, Lisbon, 12-15 Apr 2027.
  2. **The conference calendar below** (D13, checked). Each official page is a `conference` source read through
     Firecrawl: one credit when it changes, and the probe is free. Dates below come from web listings as of 22 Sep 2026.
     The system re-reads each from the official page and keeps it only with a quote (existing rule).
  3. **Competitors' events pages**, one page each, plus their LinkedIn posts (existing; this is how the SCIEX summit
     and the Shimadzu and Bruker shows were found).
- **Fill the gaps.** An event without a date or place follows its post's link to the official page, once. If there is
  no link, a person can add the date on the page.

**Gulf and Middle East first**

| Show | When | Where | Why it matters | Official page |
|---|---|---|---|---|
| Saudi International MedLab Expo | 20-22 Sep 2026 (ends today) | Riyadh | clinical lab (Advanced Diagnostics) | to find (listings only) |
| ARABLAB LIVE 2026 | 26-28 Oct 2026 | Dubai World Trade Centre | the region's largest lab and analytical show | terrapinn.com/exhibition/arablab-live |
| Global Health Exhibition 2026 | 26-29 Oct 2026 | Riyadh, Malham | healthcare, diagnostics | globalhealthsaudi.org |
| CPHI Middle East 2026 (with BIO Middle East) | 14-16 Dec 2026 | Riyadh, Malham | pharma QC, biotech | cphi.com/middle-east |
| WHX Labs Dubai 2027 (formerly Medlab ME) | 26-29 Jan 2027 | Dubai World Trade Centre | clinical lab | worldhealthexpo.com/events/labs/dubai |
| DUPHAT | to confirm (listings disagree) | Dubai World Trade Centre | pharma | duphat.ae |

**Worldwide**

| Show | When | Where | Why it matters |
|---|---|---|---|
| CPHI Worldwide 2026 | 6-8 Oct 2026 | Milan | pharma |
| analytica China 2026 | 16-18 Nov 2026 | Shanghai | lab and analytical |
| SLAS2027 | 30 Jan-3 Feb 2027 | San Diego | lab automation |
| Pittcon 2027 | 24-28 Apr 2027 | Pittsburgh | analytical chemistry |
| SLAS Europe 2027 | 25-27 May 2027 | Hamburg | lab automation |
| CYTO 2027 | 5-9 Jun 2027 | Helsinki | flow cytometry (Waters Biosciences) |
| ASMS 2027 | 6-10 Jun 2027 | Houston | mass spectrometry |
| BIO 2027 | 7-10 Jun 2027 | Philadelphia | biotech |
| ACHEMA 2027 | 14-18 Jun 2027 | Frankfurt | process and lab |
| HPLC 2027 | 20-24 Jun 2027 | Innsbruck | chromatography |
| ADLM 2027 | 25-29 Jul 2027 | Chicago | clinical lab, diagnostics |
| AOAC 2027 | 27 Aug-1 Sep 2027 | Toronto | food and analytical methods |
| JASIS 2027 | Sep 2027, to confirm | Makuhari Messe, Chiba | analytical instruments |
| MSACL 2027 | 26 Sep-1 Oct 2027 | Montreal | clinical mass spectrometry |
| BCEIA 2027 | autumn 2027, to confirm | Beijing | instrumental analysis |

Watch for the next edition: ISC (2026 was Prague, 6-10 Sep; next 2028), analytica Munich (2028), IMSC (2028).

- **Events page, `/p/[ws]/events`.** Today events show only inside Opportunities. The new page has a world map and a
  timeline, Gulf first. Each event shows:
  - dates, city, days left;
  - who is going (Waters and competitors, each with proof);
  - its fit to the client's topics (momentum) and readiness (Slice 7).

  Actions: **Plan for this event** (the planner, anchored on the event date, already supported), **Brief in Studio**
  (C7.5) and **Watch live**.
- **Live mode during an event** (off by default, turned on per event, paid from the Apify budget):
  - From start to end, watch the event hashtag and competitors' posts twice a day.
  - The event page shows a live feed.
  - Afterwards a recap is written automatically (posts, engagement, who got attention).
- **Real time.** A new or changed event updates the page through the `events` scope. An in-app alert fires when a
  competitor announces a show in the client's region.

Acceptance: every show above shows either its next dates, each with a quote from its page, or "dates not announced
(checked on <date>)". The Gulf sorts first. A test event inside its live window shows posts within one collection cycle.

### C7.4 Live briefs: show the AI's working, let people check it

- **Shared infra (small, no behaviour change).** `runOrchestration` gets an optional `onStep` hook, called when:
  - context is assembled;
  - the proposal is drafted;
  - it is validated or refused;
  - the critic gives its verdict;
  - it is applied.

  A test proves the results are identical with and without the hook.
- **Storage.** `platina_run_steps` holds workspace, run, kind, step, status, headline, detail, timing and cost. The
  detail records:
  - what was read (ids, plane, titles);
  - which gates passed or failed (min-N, similarity floor, citation check);
  - model tier and provider, tokens, cost and duration.
- **Written by**: the planner, Studio drafts, reviews, competitor briefs, event extraction, the insight writer, ads
  recommendations, and the collection orchestrator ("why I'm watching this next").
- **On the page.** A "How this was made" panel fills in step by step while the run is going. Example: *Read 6 passages
  from waters.com (first-party) · 2 lessons · drafted 5 phases · every phase cites evidence ✓ · reviewer flagged 1
  issue*. It updates through the new `runs` scope. Signals only: the panel re-fetches, and content never crosses the
  broadcast channel (existing rule). The Live flow page gets a "What Platina is doing now" feed.
- **What it is.** A record written by code, plus the model's own one-line reason for each decision, requested in its
  JSON. It is *not* the model's hidden reasoning: not every provider exposes that, and it can't be checked. What can be
  checked is what the model read and what it concluded, and that is what the brief shows, with links.
- **People check it.** Each brief has **Looks right** and **Something's wrong** (which step, plus a note). A confirmed
  "wrong input" demotes that evidence the same way a failed review does (C6). An unconfirmed flag changes nothing.

Acceptance:
- Start a plan: each step appears within 2 s of happening.
- The saved plan is identical to today's (snapshot test).
- A confirmed "wrong input" demotes exactly that item.

### C7.5 Studio: from idea to creative, with the analysis on screen

- **Pages.** `/p/[ws]/studio` and `/p/[ws]/studio/[briefId]`, in Platina (D7). Entry points replace today's "Draft
  directions" links:
  - Opportunities: each campaign.
  - Plan phase: **Make the creative**.
  - Events: **Brief for this event**.
  - Competitors and Ads: **Answer this**.
- **The brief.** It is stored in `platina_creative_briefs`, assembled by code from data, then written up in one model
  call. It contains:
  - Goal, audience, channel, format.
  - **Keywords**, in two lists: the words the client's own site uses (A), and the words rising in the market (B), each
    with its momentum number.
  - **Analysis brief**: 3-5 findings, each with its proof link, with first-party and public findings in separate lists.
  - **Proof cards**: the pages, posts, ads and events behind it, with the page's preview image when it has one.
  - **What works**: first-party results (C6, past min-N) and public patterns (C7.8), labelled separately, plus the
    demoted assumptions to avoid.
  - **Hypothesis** (required; it goes to Results).
- **Visual brief, drawn by code** (no image model, D8):
  - a campaign flow diagram (event -> posts -> follow-up);
  - a topic momentum chart;
  - a "problem -> proof -> product" diagram;
  - an event map;
  - storyboard frames as text (shot, on-screen words, visual).

  Everything exports as SVG or PNG.
- **Drafts.** Three variants by hook type (question, stat, proof, story, offer). Each is labelled with the pattern it
  follows, or "trying something new" (the C6 explore share). Product claims pass the existing claims check before
  export.
- **Live.** The brief panel (C7.4) runs while drafting. When new evidence lands on the same topic (say a competitor
  launches ads on it), the page shows "new since this brief" and offers a refresh.
- **Out.** Copy or export. **Mark as posted** creates the Results creative (C6) with the brief's features and
  hypothesis filled in.

Acceptance:
- One click from an Opportunities campaign opens a brief with keywords, 3 or more proof links, a diagram and 3 drafts.
- Mark as posted shows the creative in Results with its hypothesis.
- No public item appears in a first-party list.

### C7.6 Ads insight from public ad libraries (no account connections, D9)

Nothing logs in to Waters' ad accounts. Everything is scraped from public ad libraries for **Waters and its
competitors**, labelled public (Plane B).

- **Sources**:
  - **LinkedIn Ad Library**, the main one since Waters is LinkedIn-first. It goes through Apify (F12). This needs a new
    source kind, `linkedin_ad_library`. Pick the actor with `scripts/verify-social-actors.ts` against Waters' page first;
    the two candidates on Apify publish impressions and targeting.
  - **Meta Ad Library**: the existing Apify actor.
  - **Google Ads Transparency Center**: only if an Apify actor passes the same check.
  - **Ad landing pages**: each new ad's destination is read once through Firecrawl (a competitor's or Waters' own site
    page, both allowed) to see which product and offer it pushes.
  - **Paste an ad link** to track one specific ad now (the manual path).
- **What the libraries publish**, which sets expectations:

| Data | LinkedIn Ad Library | Meta Ad Library |
|---|---|---|
| Creative, text, format, advertiser, payer, run dates | every ad | every ad |
| Impressions (ranges) and split by country | ads shown in the EU/EEA only | EU reach only (and political ads) |
| Targeting (job, seniority, industry, location, language) | EU/EEA only | age, gender, location, EU only |
| Clicks, spend, leads, CTR | never | never (spend ranges for political ads only) |

  Waters' GCC-only ads will show creative and dates but no impressions. Those fields say "not published", never 0.
- **Derived measures.** These are labelled proxies and never called performance:
  - days running, and whether the ad is still active;
  - variants per theme and refresh cadence;
  - EU impression range and country mix;
  - targeting mix;
  - products pushed (from landing pages);
  - message theme (one model call per new ad, from its text).
- **Waters vs competitors** on the same public measures: ads live, new this week, topics, formats, run length, EU
  impression ranges, countries and targeting. The comparison is fair because both sides come from the same source.
- **The orchestrator** is an Inngest job: code, one model call per recommendation, no agent spawns an agent.
  1. It plans the week's scans (which advertisers, keywords and countries), driven by what's rising, with a reason and a
     projected cost. It runs within the Apify budget and asks for approval above a set limit.
  2. After each scan it detects changes. Examples: a competitor launched 3 ads on PFAS; a Waters ad has run for 45
     days and may need a refresh; there are no Waters ads in KSA or the UAE while competitors run 4.
  3. It writes recommendations for Waters' ad team, with numbers, proof links and a live brief (C7.4). The team applies
     them in its own ads manager. Accept and reject are both recorded.
  4. It offers **Brief in Studio** to answer a competitor push (C7.5).
- **Results link.** **Log this ad** creates a Results creative (C6) linked to its library entry. If the team has
  first-party numbers they enter them by hand. The library proxies show beside them, labelled public, and never feed
  "Your results".
- **Page**: `/p/[ws]/ads` shows Waters and competitors side by side, ads live, new this week, and recommendations. New
  tables: `platina_ads` (one row per public ad), `platina_ad_snapshots` (per scan: active, impression range, countries,
  targeting), `platina_ad_recommendations`. New realtime scope: `ads`.

Acceptance:
- A scan of Waters and Thermo Fisher on LinkedIn stores their ads with run dates. EU ads show impression ranges; the
  others show "not published".
- A fixture where a competitor launches 3 ads on one topic gives exactly one recommendation, with its proofs.
- No code path logs in to an ad account.

### C7.7 Brain map (separate 3D page, live)

`/p/[ws]/brain-map`, next to Live flow. Live flow shows the pipeline; the Brain map shows the knowledge itself.

- **Nodes.** Waters today has 110 Brain insights, 241 first-party passages, 221 interest signals, 164 findings, 25
  events and 1 plan, plus ads from C7.6. The map draws:
  - keywords and topics (the hubs);
  - insights, first-party passages (grouped by page), public signals and ads, findings;
  - events, competitors, plans and phases, creatives, lessons.
- **Edges**:
  - **rests on**: a plan phase to its evidence;
  - **came from**: a signal to the insight made from it;
  - **similar**: the 5 nearest neighbours by vector, within the same plane (only insights and first-party passages
    have vectors today);
  - **about**: an item to its keyword;
  - **taught**: a review to the insight it promoted (green) or demoted (red);
  - **at**: a competitor to an event.
- **Layers visible.** Each plane has its own region and colour: A in the primary blue, B in amber, C in violet, and
  keywords in the logo blue. Cross-plane similarity edges are off by default. When turned on they are dashed and read
  "resembles", never "supports" (unit test on the edge builder).
- **Layout and motion.**
  - Positions come from the vectors, projected to 3D so similar things sit close, plus a light force pass for items
    without vectors. They are computed on the server and cached per workspace.
  - Drawing uses three.js (already installed): instanced meshes for thousands of points at 60 fps, line segments for
    edges, and particles moving along the edges.
  - A new insight flies in as a pulse (realtime scopes `insights`, `knowledge`, `results`, `events`, `ads`).
  - The canvas is light by default, matching the theme, with a dark-canvas toggle for presenting.
- **Use.**
  - Search a keyword and the camera flies to it.
  - Click a node for a side panel: text, source link, plane, confidence, connections, and why it is here.
  - Filter by plane, type and date. A time slider replays how the Brain grew.
  - Accessibility: keyboard navigation, reduced-motion mode and a table view. Phones get 2D.
- **Limits.** At most 2,000 nodes and 6,000 edges drawn. The payload stays at 500 KB or less (ids, positions, short
  labels; text loads on click). First paint < 2 s.

Acceptance: the Waters map loads within those limits, and a newly written insight appears within 5 s of its signal.

### C7.8 Learn from what we can see

With no account connections, most of what can be measured is public. So learning runs in two separate lanes.

- **Public patterns (Plane B, new).** The same maths as C6 (a posterior per feature value, min-N 5, 90-day decay) runs
  over:
  - Waters' own public posts: engagement index against Waters' own median, which the interest engine already computes;
  - Waters' ads: run-length proxy and EU impression ranges;
  - each competitor, the same way.

  It shows as its own labelled line, for example "Waters' carousel posts beat its own median 4 of 5 times (public
  data)", and gives a small ranking nudge on that line, the same way C6's does. It never enters the first-party
  posterior or the same explanation as first-party lines, and a unit test proves it.
- **First-party results (C6).** The team logs creatives and the numbers they have. If a Waters page admin can export
  LinkedIn page analytics, the existing import turns 12 months of posts into results in one step. This is optional and
  nothing waits on it.
- **Bulk review queue**: one screen to confirm many drafted reviews.
- **Own site**: continues at 50 pages a day. With a paid Gemini key (O1), its ~3,600 passages embed in days, not weeks.

Acceptance: public-pattern values pass min-N on Waters' collected posts and show "(public data)" lines; the first-party
"Your results" stays separate; `verify-learning` reports both lanes.

### C7.9 Light by default, mild blue like the Salesforce logo (D11)

- **Default light.** A saved choice still wins; otherwise the app is light, and the OS setting no longer switches it.
  This changes `resolveTheme`, the ThemeProvider's first state, the no-flash script and their tests. Dark stays
  available in the menu.
- **Palette.** The Salesforce logo blue is #00A1E0. White text on it is 2.93:1, too faint for buttons and body text, so
  it becomes the brand colour and a deeper blue from the same family carries buttons and links. Salesforce does the
  same: its logo blue is kept for brand moments and its buttons use a deeper blue. One palette serves both shells, so
  the product stops wearing a client's colour; Waters blue appears only in Waters' own creative previews.

| Token | Light | Dark | Use |
|---|---|---|---|
| brand (logo blue) | **#00A1E0**, hsl 197 100% 44% | same (6.10:1 on slate-900) | logo, highlights, charts, progress, active marks, keyword hubs in 3D. Not for text on white |
| primary | **#0176D3**, hsl 207 99% 42%. White text 4.63:1, passes AA | **#1B96FF**, hsl 208 100% 55%. Dark text 5.83:1, passes | buttons, links, focus ring, active nav |
| primary-strong | **#0B5CAB**, hsl 210 88% 36%. 6.70:1 on white, 6.06:1 on the tint | — | links on tinted panels, hover |
| tint | **#EAF5FE** | slate-800 | section backgrounds, selected rows |

  Green stays for success and "worked", because there it carries meaning.
- **Where teal lives.**
  - Tokens (`:root`, `.dark`, `.platina-shell`).
  - 4 UI files with hex values: the `globals.css` glow, `gradient-backdrop`, `nav-loading-bar`, `gauge-ring`.
  - The 3D scene colours in `flow-scene.tsx`.
  - 63 teal classes in 7 files, mostly the Sprint pages.

  Two default brand swatches (`color-palette-input`, `validation.ts`) are client data defaults, so each is decided on
  its own.
- **Screenshot pass before flipping the default.** Parts of /w were written for a dark shell: 67 hard-coded dark-shell
  colours to check, 27 in /w pages and 40 on the landing page. Take a Playwright screenshot of every route in light, fix
  what breaks, then flip.
- **Nav grouped by the loop**, because 16 flat items is too many:
  - Watch: Live flow, Brain map, Competitors, Events, Ads.
  - Decide: Opportunities, Plan.
  - Make: Studio.
  - Learn: Results.
  - Clients and Admin stay as they are; the older pages go under More.
- Built on the owner's font edit in `globals.css`.

Acceptance: a fresh browser opens light. An automated contrast check (axe) passes on primary buttons and links on every
route. No teal remains outside client data.

## 4. Order

| # | Slice | Size | Why here |
|---|---|---|---|
| 1 | C7.0 a-f | S | leaks and invented numbers first |
| 2 | C7.0 g, Next 15 | M, own branch | last critical advisory; new pages are then written once |
| 3 | C7.1 ops board | M | catches regressions in everything after it |
| 4 | C7.9 theme | M | independent and visible; its screenshot pass also exercises every route |
| 5 | C7.3 events | M | ARABLAB LIVE (26-28 Oct) and the Global Health Exhibition (26-29 Oct) are about a month away |
| 6 | C7.2 competitors | M | needs the C7.0 guard |
| 7 | C7.4 live briefs | M | used by 7.2, 7.3, 7.5 and 7.6 |
| 8 | C7.5 studio | L | closes idea -> creative -> results |
| 9 | C7.6 ads insight | M | no external approvals needed now; needs the actor check |
| 10 | C7.8 learning lanes | S | uses the collected posts and C7.6 ads |
| 11 | C7.7 brain map | L | reads best once the other data exists |

New tables (each with `workspace_id` and query tests): `platina_ops_checks`, `platina_run_steps`,
`platina_creative_briefs`, `platina_ads`, `platina_ad_snapshots`, `platina_ad_recommendations`,
`platina_graph_layouts`. New realtime scopes: `competitors`, `runs`, `studio`, `ads`, `ops`.

## 5. Budgets (D14: Apify $5 a month plus Firecrawl, both used)

| Pays for | Apify ($5 a month) | Firecrawl (1,000 credits a month) |
|---|---|---|
| LinkedIn posts, Waters and competitors | daily | no (refuses LinkedIn, F12) |
| LinkedIn and Meta ad libraries | weekly, more often when something moves | no |
| Event live mode (hashtags) | on the events you switch on | no |
| Waters' own site | no | first pass up to 300 pages, then changed pages only |
| Conference and event pages | no | about 25 watched, re-read only on change |
| Competitor pages and ad landing pages | no | about 50 watched, plus each new landing page once |

The orchestrator splits each budget across flows and never goes over its cap. The ops board forecasts month-end spend
and turns amber at 80%. The Gemini free embedding quota is the third limit (O1).

## 6. Decisions

| # | Decision | Answer (2026-09-22) |
|---|---|---|
| D6 | Clean the first-party knowledge base; allow safety fixes inside `/w` code | **Yes.** BD Biosciences is part of Waters, so its 11 passages stay first-party. The 42 third-party passages are backed up, removed and re-added as public sources. |
| D7 | Where the Studio lives | **In Platina** (`/p/[ws]/studio`), keeping the boundary |
| D8 | Pictures | Not answered; going with **diagrams and charts drawn by code**. Generated images can come later. |
| D9 | Ad account connections | **No connections.** Ads insight is scraped from public ad libraries for Waters and competitors (C7.6). |
| D10 | Official science APIs (PubMed, ClinicalTrials.gov) | Not answered; **parked**, not needed for C7 |
| D11 | Colour | **Mild blue like the Salesforce logo**: #00A1E0 as brand, with #0176D3 for buttons and links (C7.9) |
| D12 | Count Waters' own public data as first-party? | Not answered; **no change**. Public data learns in its own lane (C7.8). |
| D13 | Conference list | **Checked** (C7.3 tables) |
| D14 | Scraping budget | **Apify $5 a month plus Firecrawl, both** (§5) |
| O1 | Paid Gemini key for embeddings | still open |

**CLAUDE.md lines to add when C7.0 lands:**
- First-party URL ingest accepts only the client's own domains and handles; everything else is public (Plane B) and
  goes through Competitors or market sources.
- Safety fixes inside InstaMedia code are allowed (D6): the ownership guard, the single ingest path, safe fetch, and no
  invented ads numbers.
- No ad-account connections (D9); ads insight comes from public ad libraries, as Plane B.
- Public-pattern learning (C7.8) runs separately from first-party learning and is always labelled public.

## 7. Progress

| Slice | Status |
|---|---|
| C7.0 a-f | **built 2026-09-23** on `fix/c7-0-leaks`: ownership guard + own-sites list, safe fetch on every URL reader, URL clean-up and duplicate check, interrupted-ingest sweep, `/kb` box rewired to the guarded ingest (old scraper deleted), Meta sync can no longer invent numbers. Live: Waters' knowledge base cleaned (4 other-company sources = 42 passages, 8 dead rows removed, backed up); 25 own passages remain incl. BD Biosciences. No invented ads rows existed (all 4 campaigns were 0), so no reset or `campaigns` migration was needed. Migration 0084 (`client_identities`) applied. Unit 2,577 green; browser spec `e2e/knowledge-guard.spec.ts` passes. |
| C7.0 g | **built 2026-09-23** on `chore/next-15`: Next 15.5.26 + React 19; async `params`/`searchParams` codemod (80 files); `useFormState` -> `useActionState` (53 files); `next.config.mjs` cleaned. Unit 2,577 green, typecheck and lint clean, production build passes, all 12 browser specs pass. `npm audit --omit=dev`: no critical (left: Next's bundled postcss, build-time only, fixed only in Next 16). |
| C7.1-C7.9 | not started |
