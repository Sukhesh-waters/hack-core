# Phase 5 (W7) — Learning Loop + Collab + Cost

> **Status:** EXECUTING (same session that wrote it; slices commit in order).
> **Scope source:** WEEKLY_PLAN.md §W7. Ships: publish-back sharpens the next
> suggestion; team can comment; spend is visible and capped.

## Locked decisions

1. **Cost attribution via AsyncLocalStorage, not signature threading.**
   `src/lib/ai/usage-context.ts` exposes `runWithAiCost({ workspaceId, purpose }, fn)`.
   Server actions wrap agent calls; `routeAI` reads the context. No agent
   signature changes (their tests mock `routeAI` and stay untouched). Calls
   outside a context log with `workspaceId = null` (system).
2. **`ai_usage` table** — id, workspace_id (nullable for system calls, still
   registered in `workspaceScopedTables`), provider, model, kind (chat|embed),
   tier, tokens_in, tokens_out, cost_usd (real), purpose, created_at.
   Usage-row insert is fire-and-forget: a logging failure never fails the AI
   call.
3. **Real token counts when the provider returns them** (Groq `usage`,
   Gemini `usageMetadata`, Bedrock `usage`), else `ceil(chars/4)` estimate.
   Pricing map is a rough constants table in `src/lib/ai/pricing.ts`
   (`estimateCostUsd(model, tokensIn, tokensOut)`, pure, tested). Honest
   telemetry, not accounting.
4. **Daily cap**: `AI_DAILY_COST_CAP_USD` env, default 5. When a workspace's
   spend today ≥ cap, `routeAI` throws `AIBudgetError` with clear copy —
   actions surface it, app keeps working (degradation ladder). First breach
   of the day emails workspace members via resend and records a
   `purpose="cap-alert"` zero-cost row so the alert sends once.
5. **Comments = table + polling.** `comments` (workspace_id, content_id,
   author_id, body, created_at). Thread on the studio content page;
   a small client component calls `router.refresh()` every 10s. Supabase
   Realtime deferred — polling is the W7-sanctioned fallback.
6. **Learning loop = record real results → posts row → rescore sweep.**
   `recordResultsAction` on scheduled/approved/published content: metrics
   form (reach/likes/comments/shares/saves) → insert a first_party `posts`
   row (postedAt = schedule slot ?? now, caption from draft) → content
   status → published → send Inngest `posts/rescore.requested`.
   Inngest `rescore` function: recompute z-score/magnitude/direction for
   EVERY scorable first-party row in the workspace against the grown
   baseline (pure `buildRescorePlan` in `src/lib/rescore.ts`, tested), batch
   update, then embed any posts missing embeddings via existing
   `embedPosts`. This is what "re-weights drivers": retrieval ranks by
   magnitude, magnitudes shift as the baseline learns.
7. **Screens**: `/w/[ws]/cockpit` (spend today + 7d by provider, call counts,
   cap bar — cost view only, NOT cross-workspace ops) and `/w/[ws]/analytics`
   (per-client: posts, median ER, top up/down drivers, recent published
   results). Both read-only server components. Nav: Analytics + Cockpit.

## Slices (one commit each)

- **5.1 Cost telemetry**: pricing + usage-context + ai_usage schema/migration
  + router logging & cap + spend queries (isolation-tested) + Cockpit + nav
  + `runWithAiCost` wrapping in ideation/studio/brand/patterns actions.
- **5.2 Collab comments**: comments schema/migration + queries + thread UI on
  studio content page + polling refresher.
- **5.3 Learning loop**: `buildRescorePlan` + record-results action/form +
  Inngest rescore function + Analytics screen + nav.

Constitution holds throughout: workspace_id everywhere, two-layer rule
(results are first-party; pattern rows never enter scoring), min-N gate
(rescore respects `insufficient_baseline`), no agent spawns an agent, TDD,
`npm test` + `tsc` green per slice.
