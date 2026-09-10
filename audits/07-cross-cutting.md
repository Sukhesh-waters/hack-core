# Audit: Cross-Cutting (Ask assistant, auth/middleware, AI router, workspace isolation, secrets)
Generated: 2026-07-14 | Agent: Sonnet 5

## Ask InstaMedia assistant
### Flow traced
- Client: `src/components/ask-instamedia-lazy.tsx` (next/dynamic, ssr:false) → `src/components/ask-instamedia.tsx` (floating chat UI, session-local transcript state) → calls server action `askInstamediaAction` on submit.
- Server: `src/app/(app)/w/[ws]/ask/actions.ts` — validates input via `askSchema`, calls `requireUser()`, then `getMembership(workspaceId, user.id)` and bails with `{ error: "Not a member of this workspace." }` if null.
- Grounding: pulls `getWorkspaceById`, `listClients`, `scheduledSlotsQuery`, `hubTasksQuery`, `hubApprovalsQuery`, `newIdeasQuery` — all take `workspaceId` as the first argument and filter on it (verified in `src/db/queries/*.ts`). Grounding is explicitly restricted to first-party/operational data; `ask-agent.ts` comments confirm "Pattern-layer rows never enter this context" (two-layer rule).
- AI call: `src/lib/ai/ask-agent.ts::askInstamedia()` builds a system prompt + grounded prompt and calls `routeAI({ kind: "chat", ... })` — the single router call-site. Wrapped in `runWithAiCost({ workspaceId, purpose: "ask-instamedia" }, ...)` for budget/usage tracking.
- No agent spawning: no `inngest.send`, `child_process`, or `new Worker` anywhere in the ask flow; grep of the whole `src/lib/ai/*.ts` tree found only two files with spawn-related terms (`generation-agent.ts`, `compliance-agent.ts`) and both hits were just doc comments ("no agent spawns an agent"), not actual invocations.

### Findings
- None. Ask InstaMedia flow is workspace-scoped end-to-end, routes exclusively through `routeAI`, and does not spawn any background job or nested agent.

## Auth + middleware
- `src/middleware.ts` matcher: `["/hub/:path*","/hub","/org/:path*","/workspace/:path*","/join/:path*","/join","/w/:path*"]` — confirmed `/w/:path*` is present (the earlier session fix holds).
- `src/auth.config.ts` (edge-safe): `authorized({ auth }) { return Boolean(auth?.user) }` — session-cookie-only gate at the edge, correctly deferring DB/membership checks to server code (edge middleware can't hit Postgres).
- `src/app/(app)/layout.tsx`: re-checks `auth()` server-side, redirects to `/login` if no session — defense in depth for the whole `(app)` group.
- `src/app/(app)/w/[ws]/layout.tsx`: calls `requireUser()` then `requireMembership(params.ws, user.id)`, `notFound()` on failure. This layout wraps every route under `/w/[ws]/*` in Next.js's nested-layout model, so every one of the 25 `page.tsx` files under `w/[ws]/` inherits both the auth AND membership check even though none of them call `requireMembership` directly (confirmed this is by design, not a gap — `w/[ws]/page.tsx` itself is just a redirect to `/overview`, no data access).
- All 16 `actions.ts` files under `w/[ws]/*` independently call `requireUser()` + `requireMembership()`/`getMembership()` at the top of every exported action (server actions can be invoked directly and don't inherit layout guards, so this per-action check is required and present in 100% of files checked: accounts, ads, ads/new, approvals, ask, brand-gene, calendar, clients/new, clients/[clientId]/import, hub, ideation, kb, plan, production, reports, studio/[contentId]).
- `src/app/(app)/workspace/ready/page.tsx` (outside `/w/[ws]/`, so not covered by the workspace layout) independently checks `requireUser()` + `getMembership()` before calling `getWorkspaceById()` — correct.
- `getWorkspaceById(workspaceId)` (`src/db/queries/workspaces.ts`) itself does a bare primary-key lookup with no membership filter — by design, since it's always paired with an explicit `getMembership`/`requireMembership` call by every caller found (`ask/actions.ts`, `workspace/ready/page.tsx`, `lib/data/live/team-hub.ts` via `hub/actions.ts`, which itself calls `requireMembership`).

### Findings
- None. Every route and server action under `/w/[ws]/*` requires both authentication and workspace membership, not just session existence.

## AI router discipline
- Zero violations found. 12 call sites checked, all route through `routeAI()` in `src/lib/ai/router.ts`:
  `brand-gene/knowledge-actions.ts:69`, `brand-gene/knowledge-tab.tsx:25`, `lib/embed-posts.ts:30`, `lib/normalize.ts:45`, `lib/ai/ideation-agent.ts:92`, `lib/ai/retrieval.ts:58,71`, `lib/ai/compliance-agent.ts:87`, `lib/ai/brand-agent.ts:70`, `lib/ai/pattern-insight-agent.ts:81`, `lib/ai/ask-agent.ts:81`, `lib/ai/generation-agent.ts:92`.
- Grepped entire `src/` tree for direct provider endpoints (`api.groq.com`, `generativelanguage.googleapis.com`, `bedrock`, `api.openai.com`, `anthropic.com`) and for `fetch()` calls containing Groq/Gemini/Bedrock/OpenAI/Anthropic strings — the only matches are inside `router.ts` itself (`GROQ_URL`, `GEMINI_BASE` constants and their `fetch()` calls) plus one inert comment in `lib/normalize.ts:32` ("Classify captions into format + topics via the router (Groq fast tier)" — descriptive text only, the actual call is `routeAI(...)`).
- Degradation ladder is implemented as real fallback logic, not just documented:
  - `fastChat()` (default "fast" tier): tries `groqChat()`; on `AIRouterError` from Groq with status 429 or ≥500, falls through to `geminiChat()`. Other errors (e.g., missing key) propagate without swap.
  - `qualityChat()` ("quality" tier): tries `bedrockChat()` only if `bedrockConfigured()` (AWS creds present); any Bedrock failure falls through to `geminiChat(task, geminiQualityModel())`; any Gemini failure falls through to `groqChat()`. Ladder: Bedrock → Gemini Pro → Groq, matching the header comment.
  - Embeddings always go through `geminiEmbed()` (single provider, no fallback ladder — consistent with Gemini being the sole embeddings provider per the file's own doc comment).
- `bedrockChat()` lazy-imports `@anthropic-ai/bedrock-sdk` only when the quality tier is actually invoked, keeping the SDK out of the fast-path bundle — good practice, not a violation.

### Findings
- None. Router is the sole call-site; degradation ladder is functionally implemented, not aspirational.

## Workspace isolation sweep
All 21 tables in `src/db/schema.ts` with a `workspaceId` column, cross-checked against every query in `src/db/queries/*.ts`:

| Table | Status | Notes |
|---|---|---|
| memberships | PASS | all reads filter on workspaceId |
| clients | PASS | `clients.ts` — all selects filtered |
| content | PASS | `clients.ts`, `production.ts`, `schedule.ts`, `drift.ts`, `comments.ts` — all filtered; `advanceStage`/`scheduleContent` guard-in-WHERE on workspaceId + id |
| campaigns | PASS | `campaigns.ts` — `setCampaignStatus` guards workspaceId + id + status(from) |
| import_jobs | PASS | `sources.ts` filtered by workspaceId + clientId |
| posts | PASS* | reads all filtered; `applyScoreUpdates` (rescore.ts:26-37) updates by `posts.id` only, no workspaceId filter — **accepted exception**, only called from `inngest/functions/rescore.ts::rescoreSweep`, which reads `workspaceId` off a validated inngest event and passes it through `listScorablePosts(workspaceId)` to source the IDs being updated (same cron-sweep pattern as the accepted `dueRemindersQuery`) |
| post_embeddings | PASS | `posts.ts` `similarPostsQuery` filters on `postEmbeddings.workspaceId` |
| connected_accounts | PASS | `accounts.ts` — all filtered incl. `updateHeartbeat` |
| pattern_posts | PASS | `harness.ts`, `accounts.ts`, `sources.ts` — filtered |
| harness_rules | PASS* | reads/`upsertHarnessRule` filtered; `markRuleRan` (harness.ts:49-54) updates by `ruleId` only, no workspaceId filter — **accepted exception**, only called from `inngest/functions/pattern-scan.ts` cron sweep with an internally-sourced rule id (never user input) |
| pattern_runs | PASS* | `createPatternRun`/`patternRunsQuery` filtered; `finishPatternRun` (harness.ts:96-106) updates by `runId` only, no workspaceId filter — **accepted exception**, same cron caller (`pattern-scan.ts`), runId is internally generated, never client-supplied |
| pattern_profiles | PASS | `harness.ts` — filtered |
| pattern_comments | PASS | `harness.ts` — filtered |
| brand_profiles | PASS | `brand.ts` — filtered, upsert keyed on (workspaceId, clientId) |
| knowledge_sources | PASS | `knowledge.ts` — all filtered incl. `updateKnowledgeSource` |
| knowledge_chunks | PASS | `knowledge.ts` — filtered incl. vector search |
| ideas | PASS | `ideas.ts` — every mutation (`markIdeaDrafted`, `rejectIdea`, `updateIdeaFields`) guards workspaceId + id (+ status where relevant) |
| schedule | PASS* | reads/`createScheduledPost`/`scheduleContent` filtered; `markReminderSent` (schedule.ts:168-172) updates by `scheduleId` only, no workspaceId filter — **accepted exception**, only called from `inngest/functions/reminders.ts` using ids sourced from `dueRemindersQuery` (the already-accepted system-cron exception) |
| comments | PASS | `comments.ts` — filtered |
| hub_approvals | PASS | `hub.ts` — `decideHubApproval` guard-in-WHERE on workspaceId + id + status="pending" |
| hub_messages | PASS | `hub.ts` — filtered |
| hub_tasks | PASS | `hub.ts` — `setHubTaskDone`/`setHubTaskPriority` guard workspaceId + id |
| hub_reminders | PASS | `hub.ts` — filtered |
| ai_usage | PASS | `usage.ts` — all filtered |

*No new exceptions beyond the pattern already accepted for `dueRemindersQuery`. All three additional cases found (`applyScoreUpdates`, `markRuleRan`, `finishPatternRun`) follow the identical shape: system-cron-only callers (`inngest/functions/*.ts`), never invoked from user-facing server actions, and operate on internally-sourced IDs rather than client-supplied ones. Flagging them here for visibility since they were not named in the prompt's known-exception list, but they do not represent isolation gaps in practice.

## Secrets handling
- Grepped all `process.env.*` usage across `src/` (excluding tests). Secret-bearing keys (`GROQ_API_KEY`, `GEMINI_API_KEY`, `BEDROCK_MODEL_ID`, `AWS_REGION`/`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, `APIFY_TOKEN`, `RESEND_API_KEY`/`AUTH_RESEND_KEY`, `AUTH_SECRET`, `DATABASE_URL`) are read only in server-only files: `src/lib/ai/router.ts`, `src/lib/flags.ts`, `src/lib/connectors/apify.ts`, `src/lib/connectors/apify-actors.ts`, `src/lib/resend.ts`, `src/lib/crypto.ts`, `src/db/index.ts`, `src/lib/ai/budget.ts`, `src/auth.ts`. None of these files have `"use client"`.
- Two client components (`"use client"`) reference `process.env`: `src/app/(app)/w/[ws]/hub/use-hub-realtime.ts` and `src/lib/realtime.ts`, both reading only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Both are `NEXT_PUBLIC_`-prefixed by design (Next.js inlines these into the client bundle intentionally) and the key is Supabase's publishable/anon key, which is meant to be public and is governed by Supabase RLS/channel auth — not a secret leak.
- `.env.local` is git-ignored (`.gitignore:29` — `.env*.local`), confirmed via `git check-ignore -v`. `git status --short` shows no tracked env file changes.
- No API key, token, or secret is read directly inside any `app/**/page.tsx`, `app/**/actions.ts`, or component outside the designated connector/router/auth files above.

### Findings
- None. No secret-bearing env var is read in a client component; all provider keys stay server-side.

## Summary
- Critical: 0 | High: 0 | Medium: 0 | Low: 0
- Top 3 by impact: (1) Middleware matcher correctly includes `/w/:path*`, confirming the earlier session's fix held. (2) All 16 `w/[ws]/*` server actions independently enforce both auth and membership — no reliance on layout guards alone, which matters because server actions can be invoked directly. (3) Three previously-unlisted cron-only write paths (`applyScoreUpdates`, `markRuleRan`, `finishPatternRun`) update rows by bare id without a workspaceId filter — functionally safe today (system-cron callers only, non-user-controlled ids, same shape as the accepted `dueRemindersQuery` exception) but worth an explicit constitution note so they aren't mistaken for isolation bugs in a future audit, and so nobody wires a user-facing action to them without adding the workspaceId guard.
