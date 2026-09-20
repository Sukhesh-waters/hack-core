# Platina AI OS — Build Constitution

> **Owner decision 2026-09-20 (product direction):** the product is now
> **Platina AI OS**, and its single supported feature is **campaign planning**:
> a two-line brief -> a planner that learns from recorded results (a feedback
> loop over stored plans and outcomes, not retrieval) -> a visual roadmap on a
> timeline. All user-visible naming is "Platina AI OS". The InstaMedia surface
> (`/w/*`) and Platina's other pages are **hidden, not deleted**: code, tables,
> and data stay intact and reversible. Deletion (code or tables) still requires
> the owner-signed Slice 12 transition matrix and an explicit backup/approval;
> nothing in this decision authorises dropping data. Where this note conflicts
> with the older InstaMedia-era text below, this note wins; the Platina/InstaMedia
> module boundary (`src/lib/platina/boundary.test.ts`) still applies until the
> InstaMedia code is actually removed.

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
  the neutral orchestrator/context types (`src/lib/orchestrator/run.ts`,
  `src/lib/ai/context/types.ts`) only. InstaMedia routes and tables stay untouched
  (hidden from users, not removed). Platina ingestion is a pluggable
  source-adapter registry (`src/lib/platina/fetch/registry.ts`); adapter 1 is Apify.
  An own-code web adapter may land later without a schema change. Until that adapter
  ships, public fetches still go through Apify. A header-only change probe
  (conditional GET, ETag/If-Modified-Since, sitemap lastmod, RSS/Atom) that
  retrieves no page content is not a content fetch and may run as own code;
  content retrieval remains Apify-only until the own-code adapter ships.
  Platina code must not call InstaMedia
  ticket, Hub, SOP, content, calendar, campaign, or notification modules.
  `platina_campaigns.sop_run_id` and Platina alert actions `hub_message` / `ticket` /
  `email` are archived: never read, never written, never executed.
- Deploy: Vercel only (Pro plan — this is a real client-facing build, not Hobby/personal use).

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