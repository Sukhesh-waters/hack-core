# Ground-zero research: verification of the 9 Nov 2026 market brief, codebase impact, counter-positioning

Date: 9 Nov 2026 · Status: **research snapshot, NOT a plan.** `CLAUDE.md` wins on any conflict.
Input: "InstaMedia AI market research brief, 9 Nov 2026" (pasted by the owner; not in the repo).
Method: each high-impact claim re-checked on the web on 9 Nov 2026; each product implication checked
against the code on `main` (`3cd6091`). Facts decay fast; every line carries its source or file.

---

## 1. Corrections to the brief (act on these first)

| Brief says | Verified 9 Nov 2026 | Source |
|---|---|---|
| Meta Commercial / Self-Serve Ad Terms with the AI-liability section take effect 20 Nov 2026 | **Paused on 5 Nov 2026. Will not take effect on 20 Nov.** Existing (6 Mar 2024) terms stay in force; no new date. Covers Commercial Terms, Product Catalog Terms, Self-Serve Ad Terms and Ad Creative Generative AI Terms. Advantage+ enhancements that are on by default keep running (product features, not legal text) | facebook.com/business/help/2481113349080785; ppc.land "Meta halts its Nov 20 terms"; facebook.com/legal/commercial_terms/update |
| Graph API v25 is the reference point | **v27.0 shipped 4 Nov 2026.** v21.0 is removed **21 Jan 2027** (calls then answered by the oldest live version); v22.0 on 20 May 2027. `total_video_consumption_rate` stops returning data early Nov 2026 on all versions. v27 adds `is_ai_generated` on post edits | developers.facebook.com/docs/graph-api/changelog/versions; ppc.land "Meta's API v27…" |
| meta.ts pinned to v21.0 (fine for now) | Graph API v21 is fine until 21 Jan 2027, but **Marketing API v21.0 expired 9 Sep 2025** — and the ad-insights connector calls campaign insights on v21.0 | adstackwatch.com Meta v21 deadline page |
| UNVERIFIED: Instagram media-level reach changed in 2026 | **`reach` is still a valid IG media insight** (estimated unique accounts). `views` is the primary metric (successor to impressions/plays; impressions removed 21 Apr 2025). Sked's "reach moved to unique viewers" is its own UI relabel, not an API removal. April 2026 added `saved_count`, `shares_count`, `reposts_count` and aggregated totals | developers.facebook.com IG blog 22 Apr 2026; postzen.dev; mellow.world |
| MagicBrief acquired by Canva and shut down 31 Jul 2026 (single source) | **Confirmed** by MagicBrief's own site: acquired Jun 2025, closed 31 Jul 2026, team built **Canva Grow** (create, publish, analyse ads; Meta + TikTok). Canva is now a creative-analytics competitor | magicbrief.com/faqs |
| ChatGPT Ads self-serve in India, Europe, MENA from 31 Aug 2026; $1B run rate | **Confirmed.** Self-serve lists India, UAE, Saudi Arabia, Qatar, Kuwait, Oman, Bahrain among available countries; 50+ tech/measurement partners | openai.com; help.openai.com Ads Manager availability; Reuters 31 Aug 2026 |
| Platform MCP servers commoditise ad-account chat | **Confirmed for Meta:** official remote Ads MCP server (`mcp.facebook.com/ads`) with reporting, creation, catalogs, experiments; "ads MCP server rules" (e.g. deny budget increase > 20%) since 16 Jul 2026, limited availability | developers.facebook.com/documentation/mcp |

## 2. What the brief missed that hits Platina directly

### 2.1 The core positioning is already occupied

Platina's ideology — *calibrated, not confident; every recommendation carries its test; the system grades
itself* — is now marketed by at least five products:

| Product | What it claims | Overlap with Platina |
|---|---|---|
| **Lumenous** | "The only AI platform that tracks its own accuracy": Brier score published (0.125), hypotheses **SHA-256 timestamped** before testing, three models cross-check, tiered source authority | Falsifier + grading + multi-model check. They **publish** calibration; ours is PLANNED (WTR-2) |
| **Signal Plane (Control Plane)** | Competitive intelligence; 10+ monitors; severity-ranked "decision packet" every Monday to Slack/Notion/email; "Judgment Loop" scores 90-day predictions with confidence | Competitor watch + prediction tracking + weekly push. Our digest is PLANNED (WTR-3) and in-app only |
| **Cogny** | "Growth Tickets": DB refuses a recommendation without `expected_outcome` and `estimated_impact_usd`; "Truth Ledger" | Falsifiability enforced in schema (same as our B1 gate) |
| **Prooflytics** | Agent with per-tenant memory of confirmed/failed hypotheses (HADI), competitor findings, validity windows | Refutation memory, lessons, expiry |
| **HookAI** | Specialist agents, approval gate, "Decision Ledger", "says so plainly when no target exists yet" | Human gate, decision record (our CORE-1 PLANNED), honest "no baseline" |

**Conclusion:** "calibrated AI marketing" is not a moat on its own, the same way the brief concludes "AI OS
for agencies" is not. The pitch must lead with what these products do not do (§4).

### 2.2 Data-source risk (Platina's Plane B)

- **LinkedIn** is actively enforcing: Proxycurl permanent injunction (Jul 2025); **ProAPIs consent judgment
  16 Sep 2026** barring scraping, fake accounts and *offering or using third-party services that provide
  LinkedIn data* (binds the defendants only). No reported action against Apify yet. Platina's interest and
  event layers lean on LinkedIn company posts via Apify (151 posts, 6 companies, 21 Sep 2026).
- **Meta Ad Library:** the official API returns commercial ads only for ads delivered to the EU/UK; Meta's
  terms forbid automated collection without written permission. Spend and reach exist only for political
  ads (as ranges) — any exact spend for a commercial ad is invented. Platina already shows "activity, not
  performance" and never synthesises numbers, which is the right stance.
- Implication: Plane B is a dependency the competitors above also carry, but Platina's value (interest
  momentum, event participation proofs) depends on it more heavily than a first-party-only tool.

## 3. Codebase impact (read-only findings)

| # | Finding | Where | Severity |
|---|---|---|---|
| C1 | Instagram media insights pinned to **Graph v21.0**, removed 21 Jan 2027 (74 days) | `src/lib/connectors/meta.ts:10`, `src/lib/connectors/metrics-read.ts:15` (Platina's read-only metrics) | High, dated |
| C2 | Ad campaign insights on **Marketing API v21.0, expired 9 Sep 2025** — likely failing or silently answered by a newer version | `src/lib/connectors/meta-ads.ts:71` (InstaMedia `/w/*` ads) | High — verify live |
| C3 | IG insights request `reach,saved,shares` but **not `views`**, now the primary metric; baselines built on reach alone miss replays/views | `meta.ts:41`, `metrics-read.ts:86` | Medium |
| C4 | Access token passed in the **URL query string** (ends up in logs and proxies) in the two Instagram connectors. The ads connector already sends it in the `Authorization` header (fixed in C7.0) | `meta.ts:41`, `metrics-read.ts:86` | Medium (security) |
| C5 | Brief implication 3 (metric definition version on insight rows): **Platina already has it** — every falsifier metric declares `scaleVersion`; `compareMeasurements` throws across versions. **Creative metric snapshots and InstaMedia insight rows do not** carry an API version / metric definition | `src/lib/platina/falsifier-metrics.ts`; `platina_creative_metrics` | Medium — needed before C1/C3 migration so pre/post baselines never mix |
| C6 | Brief implication 6 (don't build ad-account chat) already matches the constitution (no ad-account connections, no writes) | `CLAUDE.md` | — |
| C7 | `WEEKLY_PLAN.md` and "Phase G2 (decision receipts)" referenced by the brief **do not exist in this repo**; the closest are use cases `UC-STR-03..06 decision receipts` in `docs/usecase-catalogue.md` and Platina's receipts/gate events | repo search | Clarify |
| C8 | Meta v27 `is_ai_generated` on posts could feed an "AI exposure" record per creative (brief implication 4) without any write scope | — | Opportunity |

## 4. Counter-positioning (analysis, not fact)

### 4.1 Where Platina is genuinely different from the five "calibrated" products

1. **Two-plane evidence law.** Public data is watched but never embedded or cited; only the client's own
   measured results are evidence. None of the five state this separation. It also answers the scraping
   risk: public data informs, never proves.
2. **Blind adversarial check, not just multi-model agreement.** Lumenous cross-checks with three models;
   Platina's challenger is blinded to author, confidence and source, runs once, and its objection rate is
   itself monitored (alarm when the challenger agrees too often).
3. **Refutation memory used as counter-evidence.** A proved-wrong insight is kept and deliberately retrieved
   as the opposing view in the next plan; others archive outcomes but do not inject counter-evidence.
4. **Refuses to invent impact.** Cogny requires `estimated_impact_usd` from the model; Platina's rule is that a
   model never produces a number. This is a sharp contrast for regulated buyers and finance teams.
5. **Cost cascade.** Surprise filter plus spot-check audit makes always-on watching cheap and measures its own
   miss rate; none of the five publish a cost discipline.
6. **Vertical fit.** Regulated B2B (claims screen for "clinically proven", "FDA approved"), trade-show-led
   campaigns (event participation proofs), Gulf region. The analytics competitors above are DTC / paid-social
   first; the "Agency OS" set is generic.

### 4.2 Where competitors are ahead (gaps to close or concede)

| Gap | Who has it | Platina status |
|---|---|---|
| Published calibration score | Lumenous (Brier) | Calibration card PLANNED (WTR-2) |
| Tamper-evident pre-registration of predictions | Lumenous (SHA-256) | Gate events store a payload hash; falsifiers are not hashed at write time |
| Weekly push to Slack / Notion / email | Signal Plane | Digest PLANNED, in-app only; email/Teams archived by constitution |
| Plan-level decision ledger | HookAI, Cogny | CORE-1 decision record PLANNED |
| Always-on hosting | all (SaaS) | Local runtime only (owner decision 15 Oct) |
| Brain stages actually on | — | All `off` at last record (15 Oct) |

### 4.3 Attacks to prepare for

| Attack | Short answer |
|---|---|
| "Lumenous already publishes its accuracy." | Accuracy on what evidence? We separate public signal from your own results and never let public data prove anything; a score built on mixed evidence is not a calibration of your market. (Credible only once our calibration card ships.) |
| "Cogny gives a dollar impact for every action." | A model-estimated dollar figure is a guess presented as a fact. We state the test and measure the outcome. |
| "Meta's own Ads MCP lets any AI run my ads." | We don't run ads. We decide what is worth doing and prove whether it worked; the MCP is an execution channel, not a judgement layer. |
| "Your data comes from scraping LinkedIn." | Public signal is watched and labelled public, never stored as evidence or cited; the decisions rest on the client's own results. (Plane B dependency remains a real risk — see §2.2.) |
| "Canva Grow does creative + analytics for free." | Creative volume is not the bottleneck; knowing which belief behind the creative held up is. |
| "It runs on a laptop." | True today by owner decision; hosting is a separate decision. |

## 5. Open questions that decide the next operations

1. Which product does this research target: InstaMedia (2–10 person agencies, India, organic/paid social),
   Platina (Waters, regulated B2B, Gulf), or both as the study's "split into two products" question?
2. The brief's open question: is client spend mostly organic social (Planable class) or paid (Segwise class)?
3. Where do `WEEKLY_PLAN.md` and "Phase G2" live?
4. Risk appetite on Plane B sources (LinkedIn via Apify, Meta Ad Library).
5. Which gap from §4.2 to close first, and whether the Meta API migration (C1–C5) is scheduled before
   21 Jan 2027.

## 5a. Owner answers (9 Nov 2026)

| Question | Answer |
|---|---|
| Target product | **InstaMedia** (2–10 person agencies, India) |
| Client spend | **Mostly organic social** → competitor set is Planable / Sprout / Agorapulse / Hootsuite / Predis, not Segwise / Motion |
| Meta API | **Verify live first**, then plan |
| First gap to close | Owner asked for a recommendation (§7.3) |
| Public data | Keep using free crawlers (Firecrawl) **and** add official APIs; find better data-pooling methods |

## 7. Follow-up research

### 7.1 Meta API: what "verify live" needs to answer

| Call | Current state (researched) | What the live check must confirm |
|---|---|---|
| Ad campaign insights `GET /v21.0/{campaign}/insights` (`meta-ads.ts:71`) | Marketing API v21 expired 9 Sep 2025. Meta **auto-upgrades** expired calls to endpoints that did not change (its own example is insights) and marks them with an `X-Ad-Api-Version-Warning` response header; changed endpoints fail. Our code never reads that header, so an upgraded call looks healthy | Does the response carry the warning header, and which version answered? Are `spend, impressions, clicks, actions` all returned? |
| IG media insights `metric=reach,saved,shares` on v21 (`meta.ts:41`, `metrics-read.ts:86`) | Graph v21 works until 21 Jan 2027, then redirected to the oldest live version. `reach` still valid; `views` now primary and not requested | Values returned for recent media; whether `views` is available for the same media |
| Changes applied to **all versions on 27 Oct 2026** | Facebook Page/post reach and impressions metrics removed; root `?ids=` batch reads and `ETag`/`304` on Graph removed; poll ads, delivery-estimate fields removed | **Code check done: none of these are used** (no Page insights, no `?ids=` batching in `src/`) |

Constraint: there are no Meta app credentials in `.env.local`; tokens come from client accounts connected in
the database. Owner approved a read-only check; it is `scripts/verify-meta.ts` (token sent in a header,
never printed; writes nothing).

**Live run, 9 Nov 2026 — blocked before Meta was called:**
- The database refused the connection: Supabase pooler answered `tenant/user postgres.eqhzajbueglkvgkypran
  not found`. The Supabase project is paused, deleted or the `DATABASE_URL` points at the wrong project.
  Every script and the app itself are down until this is fixed.
- `META_CONNECTOR_ENABLED=false`, so InstaMedia has not been syncing Instagram anyway.
- The ad insights connector is called with no campaign and no token (`ads/actions.ts:59`), so it cannot be
  checked live at all; it is effectively dormant.

### 7.2 Better data pooling for organic social (official APIs + free crawlers)

Principle: **official API first where the client has connected an account; free crawler for public web
pages; Apify only where neither works.** Every row keeps its source and metric definition version (C5).

| Source | Method | What it gives | Limits | Plane |
|---|---|---|---|---|
| Client's own Instagram | Instagram Graph API (already connected) | Own insights: views, reach, saves, shares, plus Apr 2026 `saved_count`, `shares_count`, `reposts_count` | 4,800 × impressions per 24 h | A |
| **Competitors' Instagram** | **Business Discovery** (`business_discovery.username(...)`, official, free, through the client's own connected IG account) | Public profile (followers, media count, bio) and recent media (caption, timestamp, likes, comments, `view_count`) of other Business/Creator accounts | 200 calls/hour per app user; no insights, no Stories, no personal accounts; hidden likes are absent, not zero | B |
| Client's own Facebook Page | Graph API Page insights (new metrics: `page_total_media_view_unique`, `post_total_media_view_unique`) | Own page views/viewers | App Review | A |
| Client's own LinkedIn page | LinkedIn **Community Management API** | Follower, page, share and video statistics; reactions and comments | Needs LinkedIn approval; Development tier 500 app calls/day; marketing version 202511 sunsets 16 Nov 2026 | A |
| Client's own TikTok | TikTok **Display API** | Profile and recent videos: views, likes, comments, shares | Connected user only; 600 req/min per endpoint. Research API is closed to commercial users | A |
| **Any public YouTube video** | **YouTube Data API v3** (API key) | Views, likes, comments for any public video/channel | 10,000 units/day; 100 searches/day | B |
| Public web pages (competitor sites, press, trade news) | **Firecrawl** (already in use), plus free alternatives: **Crawl4AI** (Apache-2.0, self-hosted, Playwright, robots.txt check off by default — must be turned on) and **Jina Reader** (`r.jina.ai/` prefix, keyless 20 req/min) | Page text as Markdown | Firecrawl self-host is AGPL-3.0; all must pass `safe-fetch` | B |
| Public Meta ads | Apify (current) or the official Ad Library API | Commercial ads only for EU/UK delivery via the official API; Meta terms forbid automated collection without permission | Spend/reach exist only for political ads | B |
| LinkedIn competitor posts | Apify (current) | Company posts | Active LinkedIn enforcement (§2.2) | B |

Biggest wins for InstaMedia's organic-social clients: **Business Discovery** replaces most Instagram
competitor scraping with an official, free, sanctioned source; **YouTube Data API** adds public video data
legally; **Crawl4AI / Jina Reader** cut Firecrawl credit spend for plain pages.

**Constitution check:** `CLAUDE.md` says public pattern data comes from "Apify actors only", and Platina
content retrieval is Apify/Firecrawl until an own-code adapter ships. Business Discovery, YouTube Data API,
Crawl4AI and Jina Reader would each need an **owner decision recorded in `CLAUDE.md`** before code. The
fetch registry (`src/lib/platina/fetch/registry.ts`) is already pluggable, so they fit without a schema
change on the Platina side.

### 7.3 Recommended first gap (decided on the owner's request)

For InstaMedia (small agencies, organic social), the brief's own finding is that agencies now use AI most
for **reporting and explaining results** (42%), not for making content. Planable, Sprout, Agorapulse and
Hootsuite schedule and approve posts; none of them show *what was predicted before posting and whether it
came true*. So, in order:

1. **Decision receipts, sealed when made.** Every recommendation records what it expected, why, and the
   measurable test, with a hash taken at that moment, so nobody can edit it afterwards. When results arrive,
   the receipt shows predicted vs actual. This is the brief's "Phase G2", it is cheap (InstaMedia already has
   decision-receipt use cases `UC-STR-03..06`; gate events already hash payloads), and it becomes the
   client report agencies already want.
2. **A weekly client-ready summary** built from those receipts (what we expected, what happened, what we
   changed). This answers Signal Plane's Monday packet for the small-agency market.
3. **Accuracy score later**, once enough receipts have closed; showing it earlier would be a number built on
   too little data, which the product's own rules forbid.

## 6. Not covered here

Google Ads AI Max / PMax re-verification; TikTok Symphony details; incrementality/MMM; Indian competitor
tools; pricing re-verification for the brief's competitor table; GCC-specific competitors.

## Sources (9 Nov 2026)

facebook.com/business/help/2481113349080785 · ppc.land/meta-halts-its-nov-20-terms-that-would-let-it-crawl-business-websites ·
marketing-interactive.com (Meta delays commercial terms) · developers.facebook.com/docs/graph-api/changelog/versions ·
ppc.land/metas-api-v27-may-add-catalog-products-to-new-ads-by-default · adstackwatch.com/deadlines/meta-graph-api-v21-expiration ·
developers.facebook.com/blog/post/2026/04/22/instagram-api-updates-for-partnerships-metrics-collaboration-and-engagement ·
postzen.dev/blog/instagram-insights-explained · magicbrief.com/faqs · openai.com/index/expanding-access-to-ai-with-chatgpt-ads ·
help.openai.com/en/articles/20001245-ads-manager-availability · developers.facebook.com/documentation/mcp ·
lumenous.ai · signalplane.dev · cogny.com/blog/falsifiable-marketing-experiments · prooflytics.io/marketing-ai-agent · gohook.co ·
news.linkedin.com (Proxycurl) · therecord.media / proxypicker.com (LinkedIn v. ProAPIs, 16 Sep 2026) ·
scrapegrounds.com/platforms/meta · dev.to (Meta Ad Library scraping traps)
