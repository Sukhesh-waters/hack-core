# Campaign intelligence — interest-led campaign suggestions (plan)

Status: **Approved by the owner 2026-09-21.** C0–C2 done, C3–C5 built — see §8.
Date: 2026-09-21. Client used as the live test: **Waters** (workspace
`waters-gcc-internal`), competitors Thermo Fisher Scientific, Agilent,
Shimadzu, SCIEX, Bruker.

## 1. What the owner asked for

1. Real-time data in: the client's site and relevant pages, competitors'
   pages **including LinkedIn**, and live campaigns (online ads, in-person
   events worldwide Waters could take part in).
2. Suggestions ordered by evidence, not creativity: **top = what people are
   interested in right now, with proof** ("higher impressions ⇒ more people
   interested in that domain/product"); then which campaigns to run (online
   or in-person) with real-time data proofs; **creative (video scripts etc.)
   at the bottom, lowest priority.**
3. Find and fix the flow disruptions on the way.

## 2. What the live Waters run showed (2026-09-21)

Onboarded through `scripts/onboard-client.ts` (same library calls as the
`/p/[ws]/start` UI), Inngest dev server running. 8 sources, 13 runs, all
`completed`; 45 documents; client profile built; 3 competitor findings
("Agilent unveils 8890B GC system with faster cycle times", …).

| # | Disruption | Evidence | Status |
|---|---|---|---|
| D1 | Source discovery guesses `/news`, `/press` — both 404; the real newsroom is `ir.waters.com`; locale sitemaps not followed | dry run: 2 of 9 sources found | **C1** |
| D2 | Every newly approved source was re-collected 50 s after onboarding (cadence measured from 1970) — each page paid twice | 5 of 8 specs had an `event` + a `schedule` run | **FIXED** (`schedule.ts` `neverRunAnchor`, tests) |
| D3 | Firecrawl never used by Platina: onboarding asks for 3–5 pages per source, Firecrawl rung is single-page only | 45/45 docs via Apify | **C1** |
| D4 | Multi-page crawl follows nav links: 6 of 18 competitor pages were contact / sign-in / navigation | analysis `skip_reason`s | **C1** |
| D5 | Ad Library keyword search "Waters" returned **0 Waters ads** — charter boats, cruises, BattleBots | 10/10 ads irrelevant | **FIXED** (advertiser must carry the searched name) |
| D6 | Every ad ever collected was stored **without its text** (`snapshot.body` is `{text}`) | "Ad 142344… by Blue Dolphin Charters" | **FIXED** (`adText`, tests) |
| D7 | Brand Gene vault (93 Waters chunks) does not feed Platina | by design (boundary) | C1 makes Platina read the same way |
| D8 | Duplicate/ugly spec name "Waters · ads/library/" | spec list | C1 (trivial) |

The 10 irrelevant ads already stored in `waters-gcc-internal` are Plane B
noise; they produced no finding. Deleting them needs the owner's OK.

## 3. Reality check — "higher impressions ⇒ more interest"

The idea is right; the data has limits, and the plan is built around them.

| Signal | What it really measures | Available? (verified or known) |
|---|---|---|
| Meta Ad Library impressions | reach of an ad | **Only political/issue and EU-delivered ads.** Live: commercial ads return `impressions_index: -1`. Not a GCC signal. |
| Ad **longevity** + count (Meta, LinkedIn, Google Ads Transparency) | what competitors keep paying for — an ad that runs 60+ days is working for them | yes, every ad has start/end dates |
| LinkedIn company **post engagement** (reactions, comments, reposts) | audience interest per topic, per competitor | via an Apify actor (public pages, **no login cookies**) — to verify in C0 |
| **Search interest** (Google Trends, by country & topic) | what people actually look for, by region — the closest thing to "people's interest" | via Apify's Google Trends actor — to verify in C0 |
| Event pages (exhibitors, sessions, dates, location) | where the audience physically gathers | Firecrawl/Apify page reads; presets exist (ASMS, Pittcon, HPLC, analytica, ACS); add GCC: Arablab, Medlab Middle East |
| The client's **own** campaign results | true impressions/CTR | Plane A only, via outcome import — never mixed with the above |

Two corrections to the idea, stated plainly:

- **A competitor's impressions measure its budget, not market interest.**
  Paid reach is recorded as *competitor pressure*; *interest* comes from
  organic engagement and search. The ranking uses **rates and momentum**
  (change vs. the source's own baseline), never raw counts.
- **Min-N gate applies.** A topic with three data points shows
  "insufficient signal", not a score.

## 4. Architecture

```
sources ──► documents (Plane B, existing)
   │
   └──► interest signals  (NEW, numbers not prose)
          topic × region × channel × metric × window × proof-URL
                 │
                 ▼
        momentum per topic/region (pure, min-N gated)
                 │
   client profile (offers, keywords) ──► fit
   competitor ads/posts ───────────────► pressure (share of voice)
   events calendar ────────────────────► timing
                 │
                 ▼
        OPPORTUNITIES (new finding use case, ranked, each with proofs)
                 │
                 ▼
        suggestion page, in this order:
          1. What people are interested in now   (interest insights + proofs)
          2. Campaigns to run                    (online · in-person, why now)
          3. Plan                                (existing planner, from an opportunity)
          4. Creative ideas                      (collapsed, generated on demand)
```

- New table `platina_interest_signals` (additive migration, workspace_id on
  every row and asserted in SQL tests): `topic, region, channel, source_kind,
  metric, value, value_low/high (ranges), window_start, window_end,
  collected_at, source_url, brand_id, raw`.
- Momentum and ranking are **pure functions** with tests; the model router is
  used only to map free text to the client's topic list, never to invent a
  number.
- Opportunity cites **one plane** (two-layer rule). Creative generation reads
  an opportunity; it never feeds back into the ranking.

## 5. Slices

| Slice | Contract | Proof it works |
|---|---|---|
| **C0** actor verification | Verify the LinkedIn company-posts, LinkedIn Ad Library and Google Trends actors live (fields, cost per 100 items, no cookies). Record in the actor matrix. | fixture files + cost table |
| **C1** better collection | Platina first pass uses the whole-site picker (map → pick → Firecrawl single pages); newsroom subdomains; no nav/contact/sign-in pages; spec names fixed. Picker + section chunker move to `src/lib/scrape/` (shared, allowlisted). | re-run Waters: 0 nav pages skipped, newsroom collected, docs via firecrawl |
| **C2** LinkedIn | New social source kind `linkedin_company` (competitor posts + engagement) via Apify; engagement into `metrics`. Thermo Fisher first. | live: Thermo Fisher posts with reactions/comments |
| **C3** interest signals | Table + writers for: LinkedIn engagement, ad longevity/count, Google Trends by GCC country for the client's topics. | signals rows for Waters topics, min-N respected |
| **C4** events | Event sources (presets + GCC: Arablab, Medlab ME) → dates, location, exhibitors; "is a competitor exhibiting?" | upcoming events list with dates + proof URLs |
| **C5** opportunities | Ranking stage → `opportunity` findings with proofs; suggestion page in the order above; creative collapsed at the bottom. | Waters page shows ranked opportunities, every number linked |
| **C6** learning loop | Recorded outcomes of run campaigns re-weight topics (existing plan-feedback loop, Plane A). | a recorded result changes the next ranking |

## 6. Budget — owner decision needed

Apify limit on this account: **$5/month** ($0.17 used). One Waters first pass
used a few cents, but LinkedIn posts for 6 companies + ad libraries + weekly
Trends for ~10 topics × 6 GCC countries will not fit in $5/month at any useful
cadence. Firecrawl: 1,000 credits/month, ~10 per site read.

Options: raise the Apify plan, or run C2/C3 weekly instead of daily.

## 7. Owner decisions

1. Approve this plan (C0 → C6 order).
2. Apify budget (above).
3. Delete the 10 irrelevant ads in `waters-gcc-internal` (yes/no).
4. LinkedIn: public company pages via Apify only, no personal-account
   cookies — confirm this is acceptable for the product.

## 8. Progress (2026-09-21)

| Slice | Status | Live proof |
|---|---|---|
| C0 | **done** | actor matrix updated; LinkedIn posts adopted, LinkedIn ads = pressure only (no impressions/dates), Google Trends weekly-async only (niche terms ≈ 0 in AE). ≈ $0.15. |
| C1 | **done** | site rung: Waters re-run read `ir.waters.com` newsroom + ESG + blog, Thermo about + investors, 7/7 docs via Firecrawl, 0 nav/contact pages; picks remembered 7 days on the target. D2, D5, D6, D8 fixed; **D9** found+fixed (a ticked "ads" box was silently dropped by the approve action); **D10** found+fixed (ideation discarded all directions when one title exceeded 80 chars). |
| C2 | **done** | `linkedin:@company` social source, weekly (cadence is now a floor for non-probe sources — the daily ad library had been running every 6 h); 49 posts from 5 companies with reactions/comments/reposts. Bruker's page slug unknown (`bruker` returns nothing). LinkedIn field on the onboarding form; `scripts/add-linkedin.ts`. |
| C3 | **built, thin data** | table `platina_interest_signals` (migration 0078, applied); engagement index vs. each company's median post; ads as pressure; topic assignment (client topics + emerging themes, model never produces numbers); job `platina-interest-extract` (after social/ad collection + daily); `scripts/interest-report.ts`. Live: 47 signals — only "mass spectrometry" passes min-N (n=13, 1.24×); every theme n=1. Needs history: a 3-month LinkedIn backfill (~$0.36) is the proposed next step. |
| C4 | **built; event pages pending the daily cap** | tables `platina_events` + `platina_event_participants` (migration 0079); model names events and COPIES date/place words, code checks the words are in the text and parses them (a date not on the page is dropped); pattern fallback for event pages; job `platina-event-extract` (after conference/post collection + daily); `scripts/add-events.ts`, `scripts/events-report.ts`. Live from 11 stored posts: 9 events, 10 participation proofs, 0 rejected dates — e.g. SCIEX Summit 2026 (Darmstadt, 13–14 Oct, 3 SCIEX posts), Waters Inform (Lisbon, 12–15 Apr 2027). Page reads: ARABLAB LIVE 26–28 Oct 2026 Dubai lists 337 exhibitors, none of Waters/Thermo/Agilent/Shimadzu/SCIEX/Bruker; ASMS 2026 and analytica 2026 already over. **D11** fixed: HPLC preset domain dead (DNS) → hplc2027.com; Medlab ME is now WHX Labs Dubai; GCC presets added. **D12** fixed: a never-collected source waited a full cadence after a capped first run (weekly event pages → a week); now retries on the 6 h adaptive start until its first success. 7 event pages added to Waters; their first runs hit the workspace daily cap (40, spent by C1/C2 live tests) and collect after 00:00 UTC. |
| C5 | **built** | `/p/[ws]/opportunities` (sidebar: Opportunities), pure ranking in `lib/platina/opportunities.ts`, computed on read (no model call on load; deviation from "opportunity findings": nothing to go stale, and the planner already starts from an event or a client goal). Order: 1 interest insights with linked proofs (below min-N: "not enough posts", no number) → 2 campaigns: events ranked by lead time (≥21 d), not a rival's own event, home region, rivals present, date; online topics only when gated and ≥1.0× typical, with competitor ad pressure as proof → 3 plans for the client → 4 creative, collapsed, drafted on demand via solutions/new. A rival's own event (SCIEX Summit) becomes an online counter-campaign, not "go there". Live: mass spectrometry campaign → planner → plan 79dad5b7 in 10 s, citing evidence. |
| C6 | **built 2026-09-22** | see 2026-09-22-c6-learning-loop.md §5 |
