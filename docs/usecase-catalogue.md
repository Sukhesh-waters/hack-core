# InstaMedia AI — Use Case Catalogue

**Single source of truth for what the product does, from foundation through end state.**
Organised by capability, not by build stage.

- **Version:** 1.0 · 2026-08-05
- **Last substantive update:** 2026-08-17 — real-time collaboration roadmap. New Gap entries in §9.3, refusal narrowed in §15. See `docs/REALTIME-ARCHITECTURE-AUDIT-2026-08.md` and `docs/superpowers/specs/2026-08-17-realtime-collab-roadmap-design.md`.
- **Supersedes:** the claude.ai Project Instructions panel (which still describes a dead FastAPI/Celery/CLIP/DALL-E stack), `instamedia_master_plan.html`, `instamedia_architecture.html`. Delete or archive those.
- **Does not supersede:** `CLAUDE.md` (build constitution — rules), `PHASE-G-strategy-memory-delta.md` / `PHASE-G-implementation-plan.md` (spec and execution record for the now-shipped strategy-memory arc, §14). This document is the *what*; those remain the *how* and the historical record of *what shipped and how it was verified*.
- **Note:** the InstaMedia user guide was removed in the Platina rebrand; this document is now the only description of the legacy InstaMedia use cases.

---

## 0. How to read this

Every use case carries a status and an invariant. The status vocabulary is fixed:

| Status | Meaning |
|---|---|
| **Live** | Shipped on `main`, tested, reachable from the UI |
| **Partial** | Shipped but incomplete in a way that is documented, not accidental |
| **Gap** | Specced or identified, not built |
| **Deferred** | Deliberately not built; has an explicit trigger |
| **Refused** | Permanently rejected; do not revisit |

**Why there are no phases here.** Phases in the prior planning docs encoded *dependency and permission*, not schedule. Flattening the catalogue makes the product legible but makes everything look equally buildable. The dependency information is preserved per-entry as `Blocked by` and consolidated in §12. Build order comes from §12, never from reading this list top to bottom.

---

## 1. Foundational invariants

These constrain every use case below. A use case that violates one of these is not a use case, it is a bug.

| # | Invariant | Enforcement |
|---|---|---|
| I1 | **Workspace isolation.** Every table has `workspace_id` NOT NULL + index. Every query's WHERE includes it, including UPDATE and DELETE. | `.toSQL()` test on every query asserting the workspace param |
| I2 | **Two-layer separation.** First-party consented data feeds the baseline/scoring engine. Public/Apify data feeds a separate pattern layer. Never mixed, never both cited in one "why this idea." | Structural: `pattern_posts` has no score columns. Leakage is architecturally impossible, not merely forbidden. Plus `validateCitations` / `validateEvidence` at both agent boundaries |
| I3 | **Minimum-N gate.** Below `MIN_BASELINE_N` (20) — `DRIFT_MIN_N` (5) for drift — show "insufficient baseline," never a number. | `scoreAgainstBaseline` returns a status, not a fabricated score |
| I4 | **No agent spawns an agent.** | Convention + review |
| I5 | **Degradation ladder.** Provider throttled → router swaps. Meta down → CSV fallback. KB stale → flag it. Email fails → honest error + logged failure row. Never silent, never stale-served-as-fresh. | Per-path; see individual entries |
| I6 | **Single AI call-site.** Every model call goes through `routeAI` (`src/lib/ai/router.ts`). No agent can bypass cost tracking or the budget cap. | grep-verified; all non-test call sites are agent modules |
| I7 | **Human governs, AI proposes.** No autonomous publishing, spending, SOP modification, or performance claims without evidence. | Per-path |
| I8 | **Spec-first, one vertical slice at a time.** Plan → diff → review. A slice is not done until `tsc`/`eslint`/`vitest` are green. | Workflow |

---

## 2. Identity, tenancy & access

| ID | Use case | Actor | Status | Notes |
|---|---|---|---|---|
| UC-ID-01 | Sign in with email or Google | Any user | Live | NextAuth v5 |
| UC-ID-02 | Claim an organisation and create a first workspace | Founder | Live | `/org/claim`, slug pre-check with numeric fallback |
| UC-ID-03 | Join an existing workspace via invite code or slug | Team member | Live | `/join` |
| UC-ID-04 | Switch between workspaces | Any member | Live | `/hub` workspace list |
| UC-ID-05 | Every server action authorises before touching the DB | System | Live | `requireUser()` → `requireMembership(workspaceId, user.id)`, no exceptions |
| UC-ID-06 | Role-gated destructive actions | Owner / admin | Live | Closing or reassigning a ticket away from its owner is owner/assignee/admin only; deleting is owner-only. Enforced server-side, not hidden in UI |
| UC-ID-07 | Dev auth bypass in non-production | Developer | Live | Double-gated: non-prod env check **and** explicit opt-in env var, fixed dev identity only. Never an arbitrary-email credentials provider |
| UC-ID-08 | Client-facing login (`client_viewer` role) | Client | **Refused** for now — see §11 |

---

## 3. Client management

| ID | Use case | Actor | Status | Notes |
|---|---|---|---|---|
| UC-CL-01 | Onboard a client through an intake wizard | Account manager | Live | Multi-step; client-side step gating is UX only, `clientWithContextSchema` re-validates server-side |
| UC-CL-02 | Record brand context (type, mission, showcase theme) | Account manager | Live | `updateBrandContext` |
| UC-CL-03 | Store a client contact email for reporting | Account manager | Live | `clients.contactEmail` (F1). **Correction to older notes:** this gap is closed; client-facing report delivery is possible today |
| UC-CL-04 | See everything about one client on one screen | Anyone | Live | Client detail page: their open tickets, content in production, campaigns. Built specifically to kill the four-screens-per-client problem |
| UC-CL-05 | Set a measurable goal for a client | Strategist | Live | `clientGoals` table (migration 0039). Goals section on the client detail page, `createClientGoalAction`. No `targetValue` column, by design — see UC-STR-01 |
| UC-CL-06 | Record the hypothesis a goal is testing | Strategist | Live | Free-text field on `clientGoals`, deliberately unstructured — a `{audience, variable, metric}` shape is a DSL and would fill with junk at 4-client scale |
| UC-CL-07 | Model a retainer / engagement / scope of work | Ops | **Refused** — retainer terms live in a signed PDF; no workflow reads them |
| UC-CL-08 | Manage a contacts table (multiple stakeholders per client) | Account manager | **Deferred** — trigger: a client with >2 people who need distinct report routing |

---

## 4. Ingestion — first-party layer

Everything here writes to `posts` with `source = first_party`. This is the only data allowed to become performance truth (I2).

| ID | Use case | Actor | Status | Notes |
|---|---|---|---|---|
| UC-ING-01 | Import a client's historical posts from CSV | Account manager | Live | De-risks the Meta app-review wait. Feeds the same `buildImportPlan` pipeline as the live connector |
| UC-ING-02 | Connect a Meta/Instagram account | Account manager | Live, flag-gated | `META_CONNECTOR_ENABLED`. Access token encrypted AES-256-GCM (`src/lib/crypto.ts`), never stored raw |
| UC-ING-03 | Pull latest media manually ("Sync now") | Account manager | Live | `runAccountSync` |
| UC-ING-04 | Pull latest media automatically | System | Live | Hourly Inngest cron, `0 * * * *`. Capped at 60 accounts/tick, concurrency 3, oldest-pulled-first so a growing fleet degrades to "every few hours" rather than timing out |
| UC-ING-05 | Never double-count a post on re-sync | System | Live | `pullMetaMedia` has no since-cursor, so every sync dedupes against `listExistingPostExternalIds` via `dedupeItems`. **This was a CRITICAL defect** — without it, hourly re-import progressively corrupted every client's statistical baseline. Do not remove |
| UC-ING-06 | Normalise captions on ingest | System | Live | `normalizeCaptions` via Groq, inside `runWithAiCost` so the sync is cost-attributed |
| UC-ING-07 | Embed posts for semantic retrieval | System | Live | Gemini embeddings, 768-dim, manually pinned. **Re-verify the dimension after any SDK update** — a silent change breaks pgvector inserts |
| UC-ING-08 | Degrade gracefully when insights are unavailable | System | Live | `fetchMediaInsights` returns `{}` on failure; the row stays importable and unscored rather than blocking the import |
| UC-ING-09 | See a connection's health | Account manager | Live | Heartbeat: status, `lastPullAt`, `lastError`. One account's failure never aborts the sweep |
| UC-ING-10 | Disconnect an account | Account manager | Live | Sets status, does not delete history |
| UC-ING-11 | Detect an import job stuck mid-flight | Account manager | Live | Stalled-import sweep (F2). A `processing` job older than the threshold is surfaced as stalled rather than silently pending forever |
| UC-ING-12 | Ingest from LinkedIn / TikTok / YouTube | Account manager | **Deferred** — trigger: a design-partner client's primary channel is not Meta. CSV covers it meanwhile |

---

## 5. Ingestion — public pattern layer

Everything here writes to `pattern_posts` with `source = public`, `weight = neutral`. **Structurally score-free.** This layer is inspiration; it can never become evidence.

| ID | Use case | Actor | Status | Notes |
|---|---|---|---|---|
| UC-PAT-01 | Define what to scan (segments: hashtags, competitor handles) | Strategist | Live | Harness Rules page; `harnessRules` |
| UC-PAT-02 | Run a pattern scan on demand | Strategist | Live | Fires `patterns/run.requested`; the Inngest function does the work, the action stays thin |
| UC-PAT-03 | Run pattern scans on a cadence | System | Live | `pattern-scan.ts`; per-rule try/catch so one bad rule never kills the batch |
| UC-PAT-04 | Add a single public page one-off | Strategist | Live | Apify; result count clamped by `clampCap` against `HARNESS_HARD_CAP`, deduped by `listExistingExternalIds` |
| UC-PAT-05 | Generate an inspiration brief from top pattern posts | Strategist | Live | `generatePatternInsights`. Prompt explicitly frames posts as "inspiration only"; the word "baseline" never appears in it |
| UC-PAT-06 | Guarantee no baseline id leaks into a pattern insight | System | Live | `validateEvidence` strips any id that isn't a real pattern row. Tested with an explicit intersection assertion |
| UC-PAT-07 | Keep an insight after generating it | Strategist | Live | `insights` table (migration 0040). `generateInsightBrief` persists via `createInsights`, reusing `validateEvidence`'s already-stripped output. Verified live: reopening the KB page costs zero additional `routeAI` calls |
| UC-PAT-08 | Retrieve pattern posts semantically relevant to the current topic | System | **Gap** | Today the insight agent gets a generic top-12 prompt-stuff. Adding embeddings to `pattern_posts` would enable real retrieval. Blocked by: nothing technical; blocked on whether output quality actually improves — measure first |
| UC-PAT-09 | Run own scrapers instead of Apify | System | **Refused** — own-scraper pipelines were cut and must not be reintroduced |

---

## 6. Brand intelligence

| ID | Use case | Actor | Status | Notes |
|---|---|---|---|---|
| UC-BR-01 | Build a Brand DNA profile for a client | Strategist | Live | Runs once, cached. Voice, tone, audience, pillars, do-nots, formats |
| UC-BR-02 | Ingest declared brand material (URLs, docs) into a client knowledge vault | Strategist | Live | `knowledgeSources` / `knowledgeChunks`. **Explicitly labelled in the UI** as "declared material, not public pattern data. Never cited as performance truth" |
| UC-BR-03 | See where every piece of KB data came from | Anyone | Live | Source registry: CSV jobs, connected accounts (BASELINE) visually separated from pattern scans (PATTERN · INSPIRATION ONLY) |
| UC-BR-04 | Detect brand-voice drift over time | Strategist | Live | `drift` — measures how often a client's recent drafts needed a compliance rewrite. Hand-rolled SVG gauge (`gauge-ring.tsx`), min-N gated at `DRIFT_MIN_N` |
| UC-BR-05 | Emotion/sentiment scoring of creative (CLIP/Whisper/HF) | System | **Refused** — cut. Meta Brand Memory killed this positioning; the agency operating layer is the moat, not emotion AI |

---

## 7. Scoring, baseline & the learning loop

| ID | Use case | Actor | Status | Notes |
|---|---|---|---|---|
| UC-SC-01 | Score a post against its own client's baseline | System | Live | z-score + magnitude + direction, with freshness decay. **Baselines are per client** — one account's results never re-weight another's |
| UC-SC-02 | Refuse to score below sample size | System | Live | Returns `insufficient_baseline` with null magnitude. A small client stays honest even while a large one in the same workspace scores fine |
| UC-SC-03 | Leave a post unscored when the metric is missing | System | Live | Null engagement rate → `unscored`, and excluded from the baseline entirely |
| UC-SC-04 | Re-score everything when new results land | System | Live | `buildRescorePlan` + `rescore` Inngest job. Each published result grows the baseline, so magnitudes shift and yesterday's star post becomes less special. This is the loop |
| UC-SC-05 | Backfill missing embeddings during the rescore sweep | System | Live | Embedding failure degrades — rows stand without vectors |
| UC-SC-06 | Manual entry of post metrics | Account manager | **Refused** — removed on purpose (`491e7f9`). Never reintroduce; hand-typed metrics are indistinguishable from fabricated ones |

---

## 8. Ideation, generation & the studio

| ID | Use case | Actor | Status | Notes |
|---|---|---|---|---|
| UC-IDE-01 | Turn a topic into scored content ideas | Strategist | Live | Retrieval (min-N gated *before* any model call) → ~200-token driver brief → ideation agent on the quality tier |
| UC-IDE-02 | See why an idea was suggested | Strategist | Live | "Why this idea" with citations to real first-party posts |
| UC-IDE-03 | Strip fabricated or cross-layer citations | System | Live | `validateCitations` keeps the reason, drops any citation not in the allow-list |
| UC-IDE-04 | Cite only evidence the brief actually used | System | Live | `citedPostIds` — the subset the driver brief genuinely referenced, not the whole retrieval pool. Falls back to the pool only in declared-only mode |
| UC-IDE-05 | Be honest when there is no baseline yet | System | Live | `markDeclaredOnly` rewrites every "why" to `DECLARED_ONLY_REASON` and forces citations to `[]`. Ideas still generate; they just stop pretending to be evidence-backed |
| UC-IDE-06 | Show the evidence state as a visible label | Strategist | Live | Idea cards show a chip: declared-only / baseline-backed / no-citations, derived from `whyReason`/`citedCaptions` (copy only, no new logic). Computed server-side in `page.tsx` — importing `DECLARED_ONLY_REASON` from the client-side idea card broke the client bundle (`node:async_hooks`), caught in the browser pass |
| UC-IDE-07 | Accept an idea and generate a full draft | Strategist | Live | `acceptIdea` → generation agent → `content` row → redirect to studio. Guarded against double-submit at both the read-check and the UPDATE WHERE |
| UC-IDE-08 | Reject an idea | Strategist | Live | Status-guarded; "already decided by someone else" on a lost race |
| UC-IDE-09 | Edit an idea before drafting | Strategist | Live | |
| UC-IDE-10 | Refine a draft | Copywriter | Live | Refinement loop in the studio |
| UC-IDE-11 | Compliance-check a draft against Brand DNA | System | Live | Deterministic banned-word check runs *first*, then the LLM audit. One auto-fix retry, then a human decides. Passing moves the draft to review |
| UC-IDE-12 | Comment on a draft with the team | Anyone | Live | Thread on the studio page, refreshes every 10s |
| UC-IDE-13 | Mark a post as published | Account manager | Live | Publish-back. Real metrics sync separately via UC-ING-03/04 and feed the loop — the button records the publish event, it does not record metrics |
| UC-IDE-14 | Ground ideation in a persistent client goal | Strategist | Live | Optional goal picker on the topic form, server-validated against workspace+client before reaching `buildIdeationPrompt`. Byte-identical output when no goal is selected (tested + verified live) |
| UC-IDE-15 | Rank retrieval by goal relevance | System | **Deferred** — trigger: UC-IDE-14 shipped and measured. Changing `retrieveDrivers` semantics needs its own evaluation |
| UC-IDE-16 | Generate images or video | System | **Refused** — no image/video generation exists or will. Humans own creative; the AI augments strategy, copy and planning |
| UC-IDE-17 | Route designs to Canva via MCP | System | **Refused** — cut |

---

## 9. Planning, delivery & agency operations

This is the operating layer — the actual moat.

### 9.1 Planning

| ID | Use case | Actor | Status | Notes |
|---|---|---|---|---|
| UC-OPS-01 | Plan and validate a month of content | Strategist | Live | `plan` |
| UC-OPS-02 | Move a piece of content through production stages | Producer | Live | Kanban: brief → in progress → internal review → done. Guard-in-WHERE on every transition; a stale click affects 0 rows rather than corrupting state |
| UC-OPS-03 | Schedule an approved post to a calendar slot | Producer | Live | Calendar-created items enter as `draft` + `productionStage: brief` — they cannot bypass compliance. Only `scheduleContent`, reachable solely through an approval gate with `complianceStatus === "passed"`, writes `status: scheduled` |
| UC-OPS-04 | Be reminded before a scheduled slot | Team | Live | Inngest scheduled function |
| UC-OPS-05 | See overdue slots | Anyone | Live | `isOverdueSlot` |
| UC-OPS-06 | Prevent two posts landing in the same client slot | System | Live *(verify)* | Duplicate-slot guard was specced in counterattack §2.7 — confirm it landed before relying on it |
| UC-OPS-07 | Pre-populate a month from a cadence skeleton | Strategist | **Deferred** — trigger: the team reports rebuilding the same monthly shape by hand more than twice |

### 9.2 Work tracking

| ID | Use case | Actor | Status | Notes |
|---|---|---|---|---|
| UC-OPS-10 | Create a ticket with assignee, due date, priority | Anyone | Live | Open → in progress → blocked → done |
| UC-OPS-11 | Link a ticket to a client, content, idea, or campaign | Anyone | Live | `linkedType` + `linkedId`, both-or-neither, informational deep-link with no cascade — a ticket outlives its linked object |
| UC-OPS-12 | Break a ticket into sub-tasks | Anyone | Live | Self-referencing `parentTicketId`; cross-workspace parent is rejected and tested |
| UC-OPS-13 | Comment on a ticket | Anyone | Live | |
| UC-OPS-14 | See a complete ticket history without anyone logging it | Anyone | Live | `ticketActivity` — append-only, records status changes, assignments, comments, labels, mentions |
| UC-OPS-15 | Label and filter tickets | Anyone | Live | |
| UC-OPS-16 | @mention a teammate in a comment | Anyone | Live | Parsed in `addTicketComment`, logged as activity |
| UC-OPS-17 | Find an assignee or link in a long list | Anyone | Live | Searchable pickers once a workspace grows past a handful of people or clients |
| UC-OPS-18 | Get a ticket suggested from underperformance or drift | System | Live | **The flagship differentiator.** Reports and Drift pre-fill the new-ticket form via query params. It *suggests*; it never auto-creates. `linkedType` from the URL is validated against the real union before it is trusted |
| UC-OPS-19 | Work a mobile-first work order page | Creator | **Deferred** — trigger: a creator actually reports the desktop board is unusable in the field |

### 9.3 Approvals & team

| ID | Use case | Actor | Status | Notes |
|---|---|---|---|---|
| UC-OPS-20 | Queue and decide sign-offs | Approver | Live | Hub approval queue |
| UC-OPS-21 | Chat with the workspace in a shared channel | Team | Live | With live presence |
| UC-OPS-22 | Keep quick shared tasks and reminders | Team | Live | `hubTasks` / `hubReminders` — deliberately separate from Tickets; for one-off items that don't need an assignee or a thread |
| UC-OPS-23 | See updates without refreshing | Team | Partial | Degradation ladder: realtime signal → refetch → 30s poll. Generalised in D1 from hub-only to a workspace channel (`use-workspace-realtime.ts`) with scopes covering Production, the SOP run board, Cockpit, and Approvals — still one mechanism, not hub-only anymore. **Known gap (2026-08-17 audit):** Calendar has none of this — no broadcast, no subscription, no poll fallback. Tracked as Phase 1 of the real-time roadmap (see below) |
| UC-OPS-24 | Direct-message a teammate 1:1 or in a small group | Team member | Gap | New `conversations`/`conversation_participants`/`direct_messages` model, distinct from the workspace-wide channel in UC-OPS-21. Reuses the proven broadcast/subscribe primitive with its own scope. Phase 2 of the 2026-08-17 real-time roadmap. Internal-team-only — explicitly distinct from UC-MEA-10 (client portal), which stays deferred |
| UC-OPS-25 | See who's online anywhere in the workspace, not just Hub | Team | Gap | Presence (`onlineIds`) is currently computed per-page inside Hub, the SOP run board, Cockpit, Production, and Approvals separately, with no shell-level indicator. Phase 1: promote `useWorkspaceRealtime` to the shared layout so presence is computed once and shown everywhere |
| UC-OPS-26 | See at a glance that a surface just updated live | Team | Gap | Cross-cutting finding from the 2026-08-17 audit: even where the broadcast pipeline is fully correct (Production, SOP, Hub, Approvals), nothing on screen distinguishes a live update from a stale page load — no pulse, no flash-highlight, no "updated Xs ago." Phase 1 adds a reusable "live" visual grammar component |
| UC-OPS-27 | Get notified through the same live channel every other surface uses | Team | Gap | `notification-bell.tsx` currently polls every 60s on a system disconnected from the Realtime channel UC-OPS-23 already uses. Phase 1 rewires it onto the real channel instead of running a second, worse notification path |

### 9.4 Knowledge & process

| ID | Use case | Actor | Status | Notes |
|---|---|---|---|---|
| UC-OPS-30 | Write and share internal docs | Anyone | Live | Markdown via `react-markdown` + `remark-gfm` (escapes HTML by default). Workspace-scoped, slug unique per workspace. Explicitly separate from the client RAG vault |
| UC-OPS-31 | Mark a doc as an SOP | Anyone | Live | `workspace_docs.kind`. Superseded in practice by the full SOP template/run system below — this flag now mostly matters for docs that describe a process without being run as one |
| UC-OPS-32 | Run an SOP as real work | Producer | Live | Superseded by a full run engine, not the lighter "spawn a ticket" design once planned: `sop_templates`/`sop_steps`/`sop_runs`/`sop_run_steps`, a dependency graph with a cycle guard, approval + compliance gates, at-risk detection, reschedule-downstream, and AI template generation from prose. The ticket-spawning design is obsolete — do not build it, it would be a second, weaker way to run an SOP |
| UC-OPS-33 | Version an SOP / track staleness | Anyone | **Deferred** — trigger: someone reports following a stale SOP |
| UC-OPS-34 | Link a doc back to the objects that reference it | Anyone | **Deferred** — trigger: after real doc usage shows the need. Reuses the `linkedType`/`linkedId` idiom; do not build before there are docs worth backlinking |

---

## 10. Automation

Deterministic by design. No AI in this loop, ever — stated in the file header comment.

| ID | Use case | Actor | Status | Notes |
|---|---|---|---|---|
| UC-AUT-01 | Build a rule: trigger + cadence → action | Ops | Live | Closed typed unions stored as jsonb, not a DSL |
| UC-AUT-02 | Start from a template instead of a blank form | Ops | Live | Three starter templates, all fully editable before save |
| UC-AUT-03 | Be prevented from building a nonsensical rule | System | Live | `isSensibleRule` blocks `ticket_unassigned` + `create_ticket` — a ticket about an unassigned ticket. The reject-list is exactly one combination and a test asserts that, so the guard can't silently grow |
| UC-AUT-04 | Run rules on a cadence | System | Live | Hourly Inngest cron. The only cross-workspace query in the app is `listEnabledAutomationRules`; it is documented and re-scoped per row in the runner |
| UC-AUT-05 | See why a rule failed | Ops | Live | `automationRuns.error` surfaced (F9.1) |
| UC-AUT-06 | Automation tickets carry real links | System | Live | F9.2 + `linkForTrigger` — `idea_stale` links to the idea; combinations with no representable link honestly return null rather than a dangling id |
| UC-AUT-07 | Avoid re-firing on a still-matching object | System | **Partial — documented limitation.** Cron re-evaluation can re-fire each tick; daily cadence bounds it to once/day per rule. A per-(rule, object) dedupe ledger is a follow-up slice if it actually bites |
| UC-AUT-08 | Event-triggered (reactive) automation | System | **Deferred** — v1 is cron-only, matching every existing sweep idiom |
| UC-AUT-09 | JQL-style query language for rules | Ops | **Refused** — violates the closed-union-not-a-DSL design call |

---

## 11. Measurement & business

| ID | Use case | Actor | Status | Notes |
|---|---|---|---|---|
| UC-MEA-01 | See workspace-wide engagement trend and totals | Anyone | Live | Reports page opens with trend + totals, then per-client breakdown |
| UC-MEA-02 | See a client's top and underperforming posts, format breakdown, next-month schedule count | Anyone | Live | Every number min-N gated |
| UC-MEA-03 | Send a report | Account manager | Live | To team members or the client contact email |
| UC-MEA-04 | Answer "did the June report go out to Aurora Skincare?" | Account manager | Live | `reportSends` audit table logs every attempt — success **and** failure. A min-N-gated number must never be stored or resent from the log |
| UC-MEA-05 | Explore analytics separately from reporting | Anyone | Live — *as one surface* | Analytics was folded back into Reports (C1) after it became a duplicate silo. `/analytics` is a permanent legacy redirect. **Do not rebuild it as a separate page** |
| UC-MEA-06 | Plan a paid campaign brief | Account manager | Live | Objective, audience, budget, dates, linked creative — routed through the same approval gate as organic. No live spend without approval |
| UC-MEA-07 | See campaign targeting and creative after creation | Account manager | Live | Expandable detail row (fixes the dead-write field problem) |
| UC-MEA-08 | See live ad spend and performance | Account manager | **Gap by design** | `campaigns.spend/impressions/clicks/conversions` exist but are never rendered — no ad-platform connector exists, and showing planning data as live performance would be a lie. The columns wait for a real connector. **Do not surface them** |
| UC-MEA-09 | Close the loop between planned and published content | Strategist | **Gap** | Measurement currently attaches to posts, not to the plan that produced them |
| UC-MEA-10 | Self-serve client portal | Client | **Deferred** — trigger: a client explicitly asks for self-serve visibility. Constitution scope lock; `org_admin` / `client_viewer` roles stay out until then. **Unaffected by the 2026-08-17 personal-chat unblock (UC-OPS-24)** — that's internal-team DMs, not client-facing access; this stays deferred |

---

## 12. Cost, telemetry & operations

| ID | Use case | Actor | Status | Notes |
|---|---|---|---|---|
| UC-COST-01 | Route every AI call through one abstraction | System | Live | `routeAI` over Groq / Gemini Flash+Pro / Bedrock. Swapping providers is config, not a rebuild |
| UC-COST-02 | Attribute every token to a workspace | System | Live | `AsyncLocalStorage` cost context set by `runWithAiCost` in each server action. Real provider token counts when reported; `estimateTokens` (~4 chars/token) as fallback |
| UC-COST-03 | Cost each call against a real pricing table | System | Live | Per-model rates in `pricing.ts` |
| UC-COST-04 | Stop spending at a daily cap | System | Live | `enforceAiBudget` runs *before* the provider call. On first breach: one zero-cost `cap-alert` marker row (deduped), email to workspace members, then `AIBudgetError` surfaced verbatim as a user-facing budget message |
| UC-COST-05 | See today's spend, spend by provider, recent calls | Founder | Live | Cockpit. Genuinely computed end to end — no placeholder numbers anywhere in the page or its queries |
| UC-COST-06 | Fail loudly on missing production config | System | Live | `src/lib/env.ts` zod check at boot. Prevents the old behaviour where a missing `EMAIL_FROM` silently fell back to a Resend sandbox address |
| UC-COST-07 | Cross-workspace owner cockpit | Founder | **Deferred** — trigger: managing workspaces beyond the first four clients |

---

## 13. The morning glance

| ID | Use case | Actor | Status | Notes |
|---|---|---|---|---|
| UC-OV-01 | See pipeline health in one screen | Anyone | Live | Slots scheduled this month, open approvals, overdue slots, ideas ready for review |
| UC-OV-02 | See operational signals composed in one row | Anyone | Live | AI spend vs cap, drift status, open tickets, recent automation failures — each linking through to the page where you'd actually act |
| UC-OV-03 | Keep the overview read-only | System | Live | It is a window, not a control panel. Control actions live on their own pages. Do not add mutations here |
| — | *Naming note* | — | — | This composition was shipped internally as "Marketing OS." That name overclaims — it is a dashboard widget row, not an operating system for marketing. Prefer "Overview" in all user-facing and investor-facing copy |

---

## 14. Strategy & decision memory

Closed as of Phase G (2026-08-06). The operating loop from *plan* through *rescore* through *decide, review, and record what worked* is now shipped and tested end-to-end — UC-STR-07/08/09 remain intentionally out (below), each with an explicit trigger.

| ID | Use case | Actor | Status | Notes |
|---|---|---|---|---|
| UC-STR-01 | Set and track a client goal | Strategist | Live | = UC-CL-05. **No `targetValue` column** — a numeric target invites a "62% to goal" render off a sub-min-N baseline |
| UC-STR-02 | Persist a pattern insight with its evidence | Strategist | Live | = UC-PAT-07 |
| UC-STR-03 | Record a decision: what, why, on what evidence, expected outcome, review date | Strategist | Live | `decisions` table (migration 0041), `/decisions` page + client detail summary. Follows the `ticketActivity` / `reportSends` log-table pattern |
| UC-STR-04 | Have decisions cite only first-party evidence | System | Live | `validateDecisionEvidence`, mirroring `validateCitations`. Proven against real Postgres in `decisions.integration.test.ts` — a seeded pattern-layer id never survives the write, not just in the pure function but in the persisted row |
| UC-STR-05 | Keep insight evidence and decision evidence structurally separate | System | Live | `insights.evidencePatternIds` and `decisions.evidencePostIds` are different columns on different tables, never joined. UI renders them in separate, separately-labelled blocks too (I2 as a UI requirement, not just a data one) |
| UC-STR-06 | Be reminded to review a decision when its review date arrives | System | Live | Daily Inngest cron (`decision-review.ts`, 9am), existing Team Hub message path, `reviewSurfacedAt` stops it repeating. **Never auto-sets an outcome** — verified live by running the cron body twice: run 1 surfaced and stamped, run 2 surfaced zero |
| UC-STR-07 | Auto-correlate a decision against subsequent engagement | System | **Refused** | A statistics claim made below `MIN_BASELINE_N`. This is exactly the fabricated confidence the whole architecture refuses |
| UC-STR-08 | Compile a repeating pattern into a proposed playbook | System | **Deferred** — trigger: ≥20 reviewed decisions with recorded outcomes. Worthless without the corpus |
| UC-STR-09 | Feed rejection memory back into ideation prompts | System | **Deferred** — trigger: enough rejected ideas to constitute a signal |

---

## 15. Permanently refused

Not "deferred." Do not revisit, and do not accept a re-proposal that renames them.

| Item | Why |
|---|---|
| Own scraping pipelines (Playwright etc.) | Cut. Apify only, pattern layer only |
| Image / video generation (DALL-E, SDXL, Imagen, Sora, Nova Reel) | Humans own creative. Not the moat |
| CLIP / Whisper / HuggingFace emotion scoring | Meta Brand Memory killed the positioning |
| Canva MCP design routing | Cut |
| Opportunity object / agency sales pipeline CRM | Near-zero CAC via an existing network. A pipeline manager for a pipeline of one |
| Engagement / retainer object | Terms live in a signed PDF; no workflow reads them |
| Generic relationship-edge table with a verb vocabulary | A DSL by another name; already rejected twice (JQL, EAV custom fields) |
| Capacity-aware planning | Requires per-person capacity, skills, leave, approval turnaround, task duration history. None exist. Any prediction would be fabricated — violating I3 |
| Five-level Evidence Ladder | The existing three computed states are honest. Adding uncomputable levels makes the system *look* more rigorous than it is |
| Cross-workspace boards | Violates I1 |
| Manual post-metrics entry | Removed on purpose; indistinguishable from fabrication |
| Command palette, global search, full mobile responsiveness, bulk grid edit, collaborative co-editing, page animations | Standing refuse-to-build list. Animations additionally blocked by a known bundle regression on the docs route. **Narrowed 2026-08-17** — this item previously read "real-time collaboration," which was ambiguous: it never applied to the broadcast/presence/live-update mechanism (UC-OPS-21/UC-OPS-23), shipped since before this catalogue existed. What stays refused is specifically *collaborative co-editing* — simultaneous multi-user editing of the same field with shared cursors or operational transforms (Google-Docs-style). Presence, live updates, and 1:1 chat are a different category and are now active work — see UC-OPS-24..27 and `docs/superpowers/specs/2026-08-17-realtime-collab-roadmap-design.md`. If a future proposal for co-editing shows up under a new name, this refusal still applies to it |
| Marketplace / plugin architecture | No third-party developer audience |
| SLA / escalation policies | No on-call rotation or client-facing intake to escalate against |
| Full Confluence-style page hierarchy + versioning | Deferred in D1's own scope; do not smuggle back in |

---

## 16. Known open defects and standing risks

| # | Issue | Severity | Note |
|---|---|---|---|
| R1 | **Mostly closed.** Real-Postgres integration tests now exist (`layer-separation.integration.test.ts`, `metrics.integration.test.ts`, `decisions.integration.test.ts`), gated on `INTEGRATION_DB=1`, running in CI. Still true for the *rest* of the ~35 query files: `.toSQL()` shape assertions only, no execution proof | Medium | Remaining blind spots outside the three integration-tested files: `date_trunc` bucket boundaries, claim-update races under real concurrency, missing indexes past a few thousand rows |
| R2 | **Accessibility sweep never done** | Medium | Explicitly deferred, not silently dropped. Not a clean single slice — dozens of files with no natural boundary |
| R3 | Automation re-fire on still-matching objects | Low | UC-AUT-07; bounded by daily cadence |
| R4 | Stale planning docs contaminating retrieval | **Active** | Three mutually incompatible product versions have coexisted in project files. Has caused real mid-session contamination. §0 lists what to delete |
| R5 | Gemini embedding dimension manually pinned at 768 | Medium | Re-verify after every SDK update |
| R6 | Meta app review is the longest-lead external dependency | High | Requires a stable Vercel production URL registered early; rotating tunnel URLs break the process |
| R7 | Leaked keys in git history via an old `.env.example` | **Critical if not done** | Apify, Gemini, Resend, Google OAuth secret, Supabase DB password. Confirm rotation completed |
| R8 | Honest unit economics | — | LTV ≈ $4–7k, not $15–40k. The genuine strength is near-zero CAC through the existing agency network. Do not restate the inflated figure |

---

## 17. Dependency map — what actually unblocks what

The catalogue above is flat. Build order is not. Read this, not §2–14, when deciding what to build next.

```
Non-code, do first — still open, owner action required
  └─ Replace the Project Instructions panel · delete stale HTML docs   (R4)
  └─ Confirm key rotation                                              (R7)

Shipped (Phase G, 2026-08-06)
  ├─ UC-CL-05 / UC-STR-01  client goals + hypothesis
  │     └─ unblocked UC-IDE-14  goal-grounded ideation — shipped alongside it
  ├─ UC-PAT-07 / UC-STR-02  persist insights
  │     └─ unblocked decision → insight citation — shipped in the same slice
  ├─ UC-IDE-06  evidence-state label
  └─ UC-STR-03..06  decision receipts

Trigger-gated — do not start unprompted
  ├─ UC-IDE-15  goal-aware retrieval             trigger: goal-grounded ideation output measurably improved
  ├─ UC-STR-08  playbook compiler                trigger: ≥20 reviewed decisions
  ├─ UC-STR-09  rejection memory                 trigger: enough rejections to signal
  ├─ UC-PAT-08  pattern embeddings               trigger: measured quality gain
  ├─ UC-MEA-10  client portal                    trigger: a client asks
  ├─ UC-COST-07 cross-workspace cockpit          trigger: >4 client workspaces
  ├─ UC-ING-12  non-Meta connectors              trigger: a client's primary channel isn't Meta
  └─ Capacity planning                           trigger: never, per §15
```

**One slice at a time.** The constitution forbids parallel half-done verticals, and every audit in this project's history has confirmed that discipline was load-bearing, not ceremonial.

---

## 18. Maintenance rule for this document

This file is the catalogue. When a slice ships, change its status here in the same diff — not in a new document. Eleven planning documents already exist and doc proliferation has caused measurable retrieval contamination (R4). If you find yourself creating a twelfth, the correct move is almost always to edit this one instead.