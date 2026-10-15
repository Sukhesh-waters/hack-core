# Platina AI OS — Build Constitution

> **Owner decision 2026-09-20 (rebrand):** the product is named **Platina AI OS**
> and all user-visible naming uses it. **Every feature is kept**: the InstaMedia
> workspace surface (`/w/*`) and all Platina pages remain live and reachable.
> Only UI and content were revised (naming, landing page, InstaMedia-specific
> user docs). A **campaign planner** was added as a Platina feature at
> `/p/[ws]/plan`: two-line brief -> planner that learns from recorded results (a
> feedback loop over the workspace's own plans, not retrieval, not RL) -> visual
> roadmap. Deletion of any code or tables still requires the owner-signed Slice
> 12 transition matrix and an explicit backup/approval. The Platina/InstaMedia
> module boundary (`src/lib/platina/boundary.test.ts`) still applies.

## Stack (locked, do not deviate without updating this file)
- Single Next.js 14 App Router TypeScript monolith. No separate Python/FastAPI service.
- API via Route Handlers / Server Actions. Background/scheduled work via Inngest — not Celery.
- DB: Postgres + pgvector via Drizzle ORM (Supabase-hosted).
- Auth: NextAuth v5.
- UI: Tailwind + shadcn/ui. No inline styles, no custom templating DSL.
- Model router: one call-site abstraction over Groq / Gemini Flash+Pro / AWS Bedrock.
  Every AI call goes through it — swapping providers is a config change, not a rebuild.
- Public pattern data: Apify actors only, tagged source=public, weight=neutral. Never
  touches the first-party baseline engine.
- Platina AI OS lives at `/p/[ws]`, schema in `src/db/platina-schema.ts`,
  lib in `src/lib/platina/*`. It shares auth, workspace membership, the model router, and
  the neutral infra (`src/lib/orchestrator/run.ts`, `src/lib/ai/context/types.ts`,
  `src/lib/ai/usage-context.ts`, `src/lib/action-errors.ts`) only. InstaMedia routes
  and tables stay untouched. Platina ingestion is a pluggable
  source-adapter registry (`src/lib/platina/fetch/registry.ts`); adapter 1 is Apify.
  An own-code web adapter may land later without a schema change. Until that adapter
  ships, public fetches still go through Apify. A header-only change probe
  (conditional GET, ETag/If-Modified-Since, sitemap lastmod, RSS/Atom) that
  retrieves no page content is not a content fetch and may run as own code;
  content retrieval remains Apify-only until the own-code adapter ships.
  **Owner decision 2026-09-21 (Firecrawl):** a single public web page
  (competitor_site / press_release / trade_editorial / conference, one page,
  no sitemap crawl) is fetched through Firecrawl first, falling back to the
  Apify crawler when Firecrawl fails for a reason another scraper could
  survive. Social profiles/posts, the Meta ad library and multi-page crawls
  stay Apify-only. The one Firecrawl client is shared infra at
  `src/lib/scrape/firecrawl.ts` (allowlisted in the boundary test); docs keep
  the same Plane B rules (source=public, never embedded, never citable).
  InstaMedia's paste-a-URL knowledge ingest also uses it (first-party vault).
  **Owner decision 2026-09-22 (own site + learning loop, plan C6):** a
  client's OWN website may be crawled multi-page through Firecrawl
  (map -> filter -> read, capped per day, then header-only change probes so
  only changed pages are re-read); it is consented first-party (Plane A).
  Competitor multi-page crawls stay Apify-only. The planner's learning loop
  is a feedback loop plus bandit re-weighting (Thompson sampling) over the
  workspace's own recorded results, min-N gated — not deep RL. Platina may
  read post metrics from connected accounts through one read-only shared
  call (`src/lib/connectors/metrics-read.ts`, allowlisted in the boundary
  test); it never posts, schedules or writes through InstaMedia connectors.
  **Owner decision 2026-10-13 (metacognitive Brain, plan
  docs/superpowers/plans/2026-10-13-metacognitive-brain.md, D1-D7):** every
  Brain claim carries a falsifier from the metric registry
  (`src/lib/platina/falsifier-metrics.ts`); a daily grader tests it when its
  window closes; refuted claims are demoted, never deleted. Facts are exempt
  only with a code-verified quote. Each new stage runs behind a per-workspace
  off/shadow/on mode, and every Brain state change is journaled
  (`setBrainState`) so it can be undone.
  **Owner decision 2026-09-22 (plan C7, D6/D9):** first-party knowledge
  ingest (InstaMedia's knowledge base and Platina alike) accepts only the
  client's OWN pages — an allowlist of the client's domains and social pages
  (`client_identities`, checked by `src/lib/ingest/ownership.ts`). A
  competitor's or any other company's page is refused there and tracked as
  public (Plane B) instead. Every server-side fetch of a URL someone else
  chose goes through `src/lib/net/safe-fetch.ts` (no private/internal
  addresses, every redirect re-checked). These shared modules are allowlisted
  in the boundary test, and these safety fixes may touch InstaMedia code.
  No ad-account connections: ads insight comes from public ad libraries
  (LinkedIn via Apify, Meta via Apify) as Plane B, and no code path writes to
  or logs in to an ad account. No metric is ever synthesised: a number the
  platform did not report is "not measured".
  Platina code must not call InstaMedia
  ticket, Hub, SOP, content, calendar, campaign, or notification modules.
  `platina_campaigns.sop_run_id` and Platina alert actions `hub_message` / `ticket` /
  `email` are archived: never read, never written, never executed.
- Deploy / Runtime: Owner decision 2026-10-15 — no Vercel deployment for now; runtime is local (`npm run dev:all` — Next.js + Inngest dev server) focused on showcasing the prototype ideology against Supabase Postgres.

## Non-negotiable rules
- workspace_id isolation on every table, every query. No cross-workspace leakage, ever.
  Isolation is enforced at the app layer (Drizzle query + membership/capability
  check), not via Postgres RLS — the app connects through DATABASE_URL (a plain
  Postgres role, not Supabase's authenticated client), so `auth.uid()` is always
  NULL and any RLS policy keyed on it silently never matches. This is a deliberate
  choice, not an oversight: every query must filter by workspace_id explicitly,
  and query tests must assert that filter is present in the generated SQL.
- Two-layer rule: first-party consented data feeds the baseline/scoring engine.
  Public/Apify data feeds a separate pattern layer. Never mixed, never both cited
  in a "why this idea" explanation.
- No agent spawns an agent.
- Minimum-N gate: don't show a direction/magnitude score below the baseline
  sample-size threshold — show "insufficient baseline" instead of a fake number.
- Degradation ladder: provider throttled → router swaps provider. Meta API down →
  fall back to CSV import. KB stale → flag it, don't silently serve stale data.
- Scope: the W1–W8 wedge (ingestion → KB → Brand DNA → ideation →
  studio/compliance → calendar → learning loop) is the core. Owner decision
  2026-07-13: Brand Drift, Reports, Ads Management, and Cockpit are UNBLOCKED
  and live. Client Portal and org_admin/client_viewer views remain out of
  scope until explicitly unblocked. Owner decision 2026-08-17: personal/team
  chat (1:1 and small-group DMs between internal team members, distinct from
  Client Portal) is UNBLOCKED as part of the real-time collaboration roadmap
  — see docs/superpowers/specs/2026-08-17-realtime-collab-roadmap-design.md
  (Phase 2). Client Portal itself remains out of scope; this does not unblock
  client-facing chat access.
- Styling: no static inline styles — Tailwind/shadcn only. Exception: dynamic
  runtime values Tailwind cannot express (progress-bar widths, data-driven
  color swatches) may use style={}.

## Workflow
- Spec-first, one vertical slice at a time. Never "build the ingestion system" —
  always "build this one slice to this contract."
- Every slice ships with tests; not done until CI passes.
- Plan → diff → review. Propose a plan, wait for approval, implement as a
  reviewable diff.

## design reference:
- refer in the file for our design reference planned in (make sure to follow this design, but not follow in the same flow or feature implementation we are here to over come user pain point so our design or flow should be different )
reference file: /Users/sukheshkannasaravanan/Desktop/pd-instamedia/InstaMedia AI Prototype.dc.html