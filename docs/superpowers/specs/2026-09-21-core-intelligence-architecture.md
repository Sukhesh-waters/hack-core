# Core intelligence flow — architecture and audit (2026-09-21)

The product in one line: **an AI orchestrator drives the scrapers, turns what
they collect into checked insights, stores every insight as a vector, and
feeds those vectors into ideation and planning — refreshed as new data
arrives.** This document is the map of that flow as built, what was proven on
live data (client: Waters, workspace `waters-gcc-internal`), and what is
still open.

## 1. The flow

```
 SOURCES (per client + competitors, and workspace-wide)
   web pages ─┐  Firecrawl first (1 credit, JS rendered), Apify fallback
   LinkedIn ──┤  Apify harvestapi company posts (weekly; one-time backfill)
   ad library ┤  Apify Meta ad library (daily; advertiser-name filtered)
   events ────┘  conference pages via Firecrawl (weekly)
        │  scheduler: cadence floor after first success; retries every 6 h until then
        │  budgets: per-client first-pass allowance, then workspace daily cap
        ▼
 SIGNAL DOCUMENTS  (Plane B, raw, never embedded, never cited as-is)
        │
        ├──► ANALYSIS (per document)                       signal-analyze job
        │      triage -> proposer/challenger debate on different models
        │      -> cited claim -> BRAIN CHUNK (embedded) + finding
        │
        ├──► INTEREST (per client)                          interest-extract job
        │      engagement index vs each company's median post; ads = pressure
        │      model assigns topics only; numbers are computed
        │      -> platina_interest_signals -> momentum (median, min-N 5)
        │
        └──► EVENTS (per workspace)                         event-extract job
               model names events and COPIES date/place words;
               code verifies the words are on the page, parses them
               -> platina_events + platina_event_participants (proof per row)
                          │
                          ▼
            INSIGHT ENHANCER (market-insight-sync)  <- runs at the end of both jobs
              gated measurements -> one sentence each -> embedded BRAIN CHUNK
              keyed (interest:<client>:<topic>, pressure:…, event:<key>)
              unchanged = untouched; changed = superseded + rewritten
                          │
                          ▼
 BRAIN  (Plane C vectors: debate claims + measured insights)
        │  retrieval: vector + keyword -> reciprocal rank fusion -> relevance
        │  floor -> rerank; scoped to client + competitors + workspace-wide sources
        ▼
 IDEATION (solutions/new)   PLANNER (plan/*)   OPPORTUNITIES PAGE (computed on read)
        │                         │                interest -> campaigns -> plans -> creative
        ▼                         ▼
 CREATIVE (on demand, last)   PLAN + freshness ("N new signals — re-plan")
                                  │
                                  ▼
                           OUTCOMES / FEEDBACK (Plane A) -> worked/failed lessons -> planner
```

Orchestration of the models (every call through `routeAI`):

| Workload | fast ladder | quality ladder |
|---|---|---|
| interactive (user waiting) | Groq → Gemini → NVIDIA → Bedrock | Bedrock → Gemini → Groq → NVIDIA |
| background (Inngest jobs) | NVIDIA → Gemini → Groq → Bedrock | Bedrock → Gemini → NVIDIA → Groq |

A provider near its rate limit (read from Groq's headers) moves back; a
cooling provider moves last; a reply that is prose when JSON was asked
("derailed") falls through to the next model, with the first reply salvaged
if every model derails.

## 2. The rules the flow keeps

| Rule | Where it is enforced |
|---|---|
| Raw public data is never embedded; only derived, checked insights are | Brain writers only (`signal-analyze`, `market-insight-sync`) |
| A model never produces a number | engagement index, momentum, dates, days-to-event are computed (`interest.ts`, `events.ts`) |
| A model's dates must be on the page | `quotedIn` + `parseDateRange`; 2 rejected live |
| Min-N: below 5 data points, no magnitude | `topicMomentum` status; page and Brain skip insufficient topics |
| Every number has its proof link | proofs on signals, events, participants; first `sourceSignalId` is the citation |
| workspace_id on every query | SQL tests assert it for every new query |
| Budgets are not bypassed | backfill runs through the normal audit run and purses |

## 3. Proven on live data (2026-09-21)

- Firecrawl site rung: Waters newsroom (`ir.waters.com`), ESG, blog; no nav/contact pages.
- LinkedIn: 151 posts from 6 companies after a 3-month backfill (~$0.30); Bruker repointed to `bruker-corporation`.
- Interest: 8 subjects pass min-N (was 1). Examples: PFAS analysis 1.34× (8 posts, 3 companies); mass spectrometry 1.09× (41 posts, 6 companies, down from 2.43×).
- Events: 25 known, 8 upcoming, 28 participation proofs. **Bruker is going to ARABLAB LIVE 2026** (three of its own posts) — although the event page's partial exhibitor list did not name it.
- Brain: 11 interest + 8 event insights embedded; a planner brief about "a Dubai trade show" retrieves the Arablab insight first; a PFAS brief retrieves the PFAS interest measurement first.
- Planner hand-off from the Opportunities page: plan created in 10 s citing evidence.

## 4. Disruptions found and fixed

| # | Disruption | Fix |
|---|---|---|
| D1–D8 | see campaign-intelligence plan §2 | fixed (D7 by design) |
| D9 | ticked "ads" box silently dropped at onboarding | fixed |
| D10 | ideation lost all directions over one long title | trim, not reject |
| D11 | HPLC preset domain dead; Medlab ME renamed | presets fixed, Gulf presets added |
| D12 | a never-collected source waited a whole cadence after a capped first run | retries on the 6 h adaptive start until first success |
| D13 | (suspected hidden run reason) | not a defect: the Audits page shows it |
| D14 | a run degraded because the model answered `"items": null`; one bad item discarded its siblings | null = none; items checked one by one; >5 trimmed |
| D15 | measured insights (interest, events) never reached the Brain — planner and ideation blind to them | insight enhancer (`market-insight-sync`) at the end of both jobs |
| D16 | client-scoped plans excluded workspace-wide sources (event pages) | scope includes workspace-wide sources |
| D17 | one viral post (18×) inflated a topic's average | momentum uses the median |
| D18 | generic profile words ("analytical systems", "service offerings") taken as topics | generic filter widened |
| D19 | router tests expected NVIDIA absent from the ladders | tests match the agreed ladders (NVIDIA kept) |

## 5. Open — in priority order

1. **C6 learning loop.** Recorded results already become worked/failed lessons for the planner; they do not yet re-weight which topics/events the Opportunities page ranks first.
2. **Plane A is empty for Waters in Platina** (0 brand chunks). The InstaMedia Brand Gene vault (93 Waters chunks) is kept separate by the module boundary; the client's own pages feed only its profile. Owner decision needed: let Platina ingest the client's own site into brand chunks (first-party baseline), or keep the baseline to imported campaign results only.
3. **Findings backlog.** 47 findings in "new" with no triage. Either an owner review queue on the Cockpit, or auto-close findings older than N days with no decision.
4. **Event pages** (Arablab, WHX Labs, Pittcon, HPLC 2027, ASMS, ACS) collect after 00:00 UTC — the workspace daily cap was spent by today's live tests.
5. **Embedding model** stays `gemini-embedding-001` (768d); the NVIDIA 2048d migration is a separate, explicit re-embed decision.
6. Topic labels stored before the D18 filter ("analytical systems") remain in history and age out of the 120-day window.
