# Brand Context Forms + Apify Harness Layer — Correction & Development Plan

> **Status:** APPROVED FOR EXECUTION.
> **Written for:** any executing session (Sonnet 4.5/5, Opus, Fable). Each slice below
> carries a self-contained execution prompt; run them in order, one slice per session,
> tests green before the next.
> **Sources analyzed:** `InstaMedia AI Prototype.dc.html` (244 KB reference flow),
> current codebase at commit `01deaaa` (Phases 1–4 live).

## How to run this plan (for the human operator)

Open one fresh Claude Code session per slice and paste exactly this:

```
Read CLAUDE.md, then read
docs/superpowers/plans/2026-07-06-brand-intake-forms-and-apify-harness.md
in full. Execute Slice <A|B|C|D|E1|E2> only, following its execution prompt,
Section 0 (session primer), and Section 2 (locked decisions). One reviewable
diff, tests green, then stop and summarize.
```

Do not run two slices in one session. Do not skip ahead. If a session proposes
deviating from a locked decision in Section 2, it must stop and ask first.

---

## 0. Session primer — read before touching code

Everything an executing session must know about this repo that isn't obvious
from the slice prompts. **Follow these conventions exactly; do not introduce new ones.**

**Stack & layout**
- Next.js 14 App Router, TypeScript, single monolith. Routes in
  `src/app/(app)/w/[ws]/…` (workspace-scoped), auth in `src/auth.ts` +
  `src/auth.config.ts` (NextAuth v5, JWT strategy + Drizzle adapter — do not "fix").
- DB: Drizzle + Supabase Postgres. Schema lives ONLY in `src/db/schema.ts`.
  Migrations: `npm run db:generate` then `npm run db:migrate` (config self-parses
  `.env.local`). Never hand-write SQL files.
- Every tenant table registers in `workspaceScopedTables` at the bottom of
  `schema.ts` — a schema test fails if a registered table lacks `workspace_id`.
- Query layer: `src/db/queries/*.ts`. Export query **builders** (functions
  returning an un-awaited Drizzle builder) alongside async executors, because
  tests assert isolation via `.toSQL()` — see `src/db/queries/schedule.test.ts`
  for the pattern to copy.
- AI agents: `src/lib/ai/*.ts`. Every model call goes through `routeAI` from
  `src/lib/ai/router.ts` — never call a provider SDK directly. Agent tests mock
  it: `vi.mock("@/lib/ai/router", () => ({ routeAI: vi.fn() }))`.
- Background jobs: Inngest. Client `src/inngest/client.ts`, functions in
  `src/inngest/functions/`, served at `src/app/api/inngest/route.ts`
  (inngest v4: `createFunction({ id, triggers: [...] }, handler)` — two args).
  Local dev needs `INNGEST_DEV=1` (already in `.env.local`).
- Email: `resend` client from `src/lib/resend.ts`.

**Server action pattern (copy it exactly)** — see
`src/app/(app)/w/[ws]/studio/[contentId]/actions.ts`:
`"use server"` file → zod-parse a FormData → `requireUser()` →
`requireMembership(workspaceId, user.id)` → work → `catch { return
{ error: actionErrorMessage(error) } }` → `revalidatePath` → return undefined.
Client forms use `useFormState` + `useFormStatus` (see `refine-form.tsx`).

**UI language**: dark glass theme. `GlassCard` component, `label-mono` class for
section labels, accents `text-brand-teal` / `text-brand-purple` /
`text-brand-amber`, shadcn `Button`/`Badge`/`Label`. Fonts and colors are already
in `tailwind.config.ts` — never inline hex styles.

**Testing**: vitest, colocated `*.test.ts`. TDD is mandatory: write the failing
test, show it red, implement, show green. Suite must stay fully green
(`npm test`, currently 130 passing) and `npx tsc --noEmit` clean before commit.

**Workflow**: one commit per slice (Slice E: one per sub-slice), message style
`feat: <what shipped>` with a short body, ending
`Co-Authored-By:` the executing model. Push to `main`.

**Domain invariants (constitution — violating these fails review)**
- `workspace_id` on every table and every query.
- Two-layer rule: first-party `posts` = baseline truth; `pattern_posts`
  (`source=public`, `weight=neutral`) = inspiration only. Never mixed, never
  co-cited in a "why this idea" explanation.
- Min-N gate: below baseline threshold show "insufficient baseline", never a
  fabricated score.
- No agent spawns an agent; retries are plain function calls, capped explicitly.
- Degradation over crashing: missing env/API → clear flagged state, app keeps working.

---

## 1. Gap Analysis — prototype flow vs current build

The prototype models Brand DNA as **user-declared structured data captured at intake**:

```js
brandDNA: {
  tones: ['Warm', 'Educational', 'Authentic'],   // chips from a fixed vocabulary
  hex_colors: ['#0d9488', '#f59e0b', '#111827'], // brand palette swatches
  banned_words: ['cure', 'clinical claims'],      // hard "never say" list
}
// plus per-workspace: mission, visual style ("Minimal, warm, editorial"),
// typography, social & web links, content pillars
// (Education / Product / UGC / Founder voice), focus-area select
// (Behind-the-scenes / Customer stories / Founder journey /
//  Product education / UGC)
```

Its intake wizard: **Client profile → Brand basics → Brand DNA & channels →
Deliverables contract → Assign team → "Researching…"** — the AI *enriches* what the
human declared; it never invents from nothing. Its Brand DNA Vault screen shows an
**editable** vault (tone chips, color swatches, banned words) + "Ingested sources"
(site scrape, pasted captions, competitor pages) with chunk counts.

| Area | Prototype / user expectation | Current build | Verdict |
|---|---|---|---|
| Client intake | Multi-step wizard capturing brand context | `clients/new`: **name + handle only** | ❌ CORRECT |
| Brand DNA origin | Declared by human, enriched by AI | 100% AI-inferred from CSV captions (`researchBrand`) | ❌ CORRECT |
| Banned words | Hard vault list, "never appear in generated content" | Only AI-guessed `doNots`; no deterministic enforcement | ❌ CORRECT |
| Colors / visual style / typography / logo | Captured at intake, shown in vault | Absent entirely | ❌ CORRECT |
| Branding type (personal / promotion / aesthetic / minimal…) | User-selected positioning | Absent | ❌ CORRECT |
| KB data entry | Sources are added on top of declared context | **CSV import is the mandatory front door** | ❌ DEMOTE to add-on |
| Apify | Pattern layer, "inspiration only", budget-capped | One-shot `fetchPublicPosts(handle)` — no segments, no cadence, no insight surface | ⚠️ EXPAND (harness) |
| Harness rules | Dedicated "Harness Rules" settings section | No such concept | ⚠️ BUILD (scoped to Apify) |
| Two-layer rule | "same store, roles enforced at query time" | Enforced (separate table + CI test) — **stronger than prototype** | ✅ KEEP OURS |
| Compliance | implicit | Dedicated agent w/ 1-retry loop (Phase 4) | ✅ KEEP OURS |

Per CLAUDE.md: we follow the prototype's *intent*, not its literal flow. Where our
build is stronger (two-layer isolation, compliance loop, min-N gate), we keep ours.

## 2. Design decisions (locked for all slices)

1. **Declared vs derived stay separate fields, merged at read time.**
   `brand_profiles` gains a `declared` jsonb (`BrandContext`, human-owned, editable
   forever) alongside the existing `identity` jsonb (`BrandIdentity`, AI-derived,
   regenerated on research). A pure `mergeBrandDna(declared, identity)` resolves
   conflicts — **declared always wins**. Rationale: never let a model overwrite a
   human's brand rules; re-research never destroys form input.
2. **Banned words become deterministic, not just prompt guidance.** The compliance
   agent keeps its LLM audit, but a **code-level substring/word-boundary check** on
   `declared.bannedWords` runs first and is authoritative. An LLM can miss; a
   `String.includes` cannot.
3. **CSV becomes an add-on.** Intake works with zero posts. The scoring engine's
   min-N gate already handles "insufficient baseline" honestly — lean on it.
4. **Apify harness = config + runner + insight, pattern layer only.** Segmented
   scrape targets per workspace, budget caps, Inngest-scheduled runs, and a
   "Top performers / Inspiration" surface. Nothing from it ever cites into a
   "why this idea" baseline explanation (constitution two-layer rule; CI-tested).
5. **Logo/typography as references, not uploads (this phase).** `logoUrl` +
   free-text `typography` fields. File storage (Supabase Storage) is a separate
   later slice — do not block intake on storage infra.
6. **No new services.** Everything stays in the Next.js monolith + Inngest + Drizzle.

### The `BrandContext` shape (single source of truth for Slices A–D)

```ts
export type BrandContext = {
  brandType:
    | "personal_brand" | "product_promotion" | "aesthetic_lifestyle"
    | "minimalistic" | "educational_authority" | "community_ugc";
  mission: string;                    // 1–2 sentences
  showcaseTheme: string;              // "theme of showcasing" — e.g. "Minimal, warm, editorial"
  tones: string[];                    // chips: Warm/Bold/Educational/Playful/Minimal/Authentic (+ custom)
  pillars: string[];                  // Education / Product / UGC / Founder voice (+ custom)
  bannedWords: string[];              // deterministic enforcement in compliance
  avoidTopics: string[];              // softer guidance, LLM-enforced
  colors: string[];                   // hex palette
  typography: string | null;          // free text, e.g. "Serif display / clean sans body"
  logoUrl: string | null;
  links: { website?: string; instagram?: string; facebook?: string; other?: string[] };
};
```

### The `MergedBrandDna` shape (output of `mergeBrandDna`, consumed by all agents)

```ts
// Superset of BrandIdentity so existing prompt builders keep working, plus the
// declared-only visual/positioning fields generation prompts can now use.
export type MergedBrandDna = {
  voice: string;            // identity.voice, else derived from declared.tones ("Warm, Authentic")
  tone: string;             // identity.tone, else declared.tones.join(", "), else "Neutral"
  audience: string;         // identity.audience, else "General audience" (AI enriches later)
  pillars: string[];        // union(declared.pillars, identity.pillars), case-insensitive dedupe
  doNots: string[];         // union(declared.bannedWords, declared.avoidTopics, identity.doNots)
  formats: string[];        // identity.formats, else []
  // declared-only passthrough (null-safe when declared is null):
  brandType: BrandContext["brandType"] | null;
  showcaseTheme: string | null;
  colors: string[];         // [] when undeclared
  typography: string | null;
  bannedWords: string[];    // declared.bannedWords verbatim — the deterministic check reads THIS
};
```

`mergeBrandDna(null, null)` returns a valid neutral object (never throws) — but
call sites should still refuse to generate when BOTH sources are empty
(no profile row at all).

---

## 3. Slices (execution order A → B → C → D → E)

Workflow for every slice: **TDD (red → green), `npm test` + `npx tsc --noEmit`
clean, one commit per slice, migration applied via `npm run db:migrate` when schema
changes.** Constitution rules apply throughout: workspace_id everywhere, two-layer
rule, no agent spawns an agent, degradation ladder.

---

### Slice A — Brand Context schema + merge logic (foundation, no UI)

**Contract:** `brand_profiles.declared` jsonb exists; `mergeBrandDna` is pure and
tested; brand research agent consumes declared context; compliance agent enforces
banned words deterministically.

**Execution prompt for the implementing session:**

> Read CLAUDE.md, WEEKLY_PLAN.md, and
> `docs/superpowers/plans/2026-07-06-brand-intake-forms-and-apify-harness.md`
> (this file — Sections 2 and 3, Slice A). Implement Slice A only, TDD.
>
> 1. In `src/db/schema.ts`: add the `BrandContext` type exactly as specified in
>    Section 2, and a `declared: jsonb("declared").$type<BrandContext>()` column to
>    `brand_profiles`. Generate + apply migration.
> 2. Create `src/lib/ai/brand-merge.ts`: pure `mergeBrandDna(declared: BrandContext | null,
>    identity: BrandIdentity | null): MergedBrandDna`. Declared wins on every
>    conflict; identity fills gaps (voice, audience); union pillars, dedupe
>    case-insensitively; `doNots = declared.bannedWords ∪ declared.avoidTopics ∪ identity.doNots`.
>    Test: declared-only, identity-only, conflict (declared wins), null/null.
> 3. Update `buildBrandPrompt` in `src/lib/ai/brand-agent.ts`: accept optional
>    `declared` and inject it as "Human-declared brand context (authoritative —
>    do not contradict it, enrich it)". The agent's job shifts from *invent* to
>    *enrich*: it fills voice/audience nuance and validates pillars against
>    evidence. Update its tests.
> 4. In `src/lib/ai/compliance-agent.ts`: add pure `findBannedWords(draft: Draft,
>    banned: string[]): ComplianceViolation[]` doing case-insensitive
>    word-boundary matching across caption/script/hashtags/cta. `enforceCompliance`
>    runs it BEFORE the LLM check; any hit forces a fail (merged into violations)
>    on both the first check and the post-retry re-check. Tests: hit in each field,
>    multi-word phrases ("clinical claims"), no false positive on substrings inside
>    words, and the retry loop still capped at 1.
> 5. Update `brandRules()` in `src/lib/ai/generation-agent.ts` to accept the merged
>    DNA so drafts are generated with declared colors/theme/tone context in the
>    system prompt (text only — no image work).
>
> **Acceptance checklist:**
> - [ ] `declared` column live in Supabase (migration applied), typed `BrandContext`.
> - [ ] `mergeBrandDna` pure, exported, covers declared-only / identity-only /
>       conflict-declared-wins / null-null (returns neutral object, never throws).
> - [ ] `findBannedWords("50% off cure-all", ["cure"])` flags; `["cur"]` does not
>       flag "cure" is WRONG — word-boundary means "cure" ≠ "secure"; multi-word
>       phrases ("clinical claims") match across the phrase.
> - [ ] `enforceCompliance` fails deterministically on banned words even when the
>       mocked LLM says pass — on first check AND post-retry re-check; retry still
>       capped at exactly 1.
> - [ ] `buildBrandPrompt` includes declared context as authoritative when present;
>       existing behavior unchanged when absent.
> - [ ] `npm test` fully green, `tsc` clean, one commit.

---

### Slice B — Intake wizard: forms-first brand onboarding (UI)

**Contract:** `clients/new` becomes a multi-step wizard capturing `BrandContext`;
client creation writes a `brand_profiles` row with `declared` populated and
`status="declared"` (new enum value); CSV nowhere in the wizard.

Wizard steps (adapted from prototype, improved — not cloned):
1. **Client profile** — name, handle, website (existing fields + links).
2. **Positioning** — `brandType` (radio cards: Personal brand / Product promotion /
   Aesthetic-lifestyle / Minimalistic / Educational authority / Community-UGC),
   mission, `showcaseTheme` free text with placeholder "Minimal, warm, editorial".
3. **Voice & rules** — tone chips (multi-select, fixed vocabulary + free "add your
   own"), pillars chips, banned words (tag input), avoid-topics (tag input).
4. **Visual identity** — color palette (repeatable hex color inputs, native
   `<input type="color">` + hex text), typography free text, logoUrl.
5. **Review & create** — read-back card; Create runs existing `createClient` +
   inserts brand profile with `declared`. Success screen offers two *optional*
   next actions: "Run brand research" (agent enrich) and "Seed knowledge base"
   (links to import — see Slice D).

**Execution prompt:**

> Read CLAUDE.md and this plan (Sections 2–3, Slice B). Slice A must already be
> merged; do not re-implement it. Build the intake wizard, TDD on all pure logic.
>
> 1. Add `"declared"` to the `brandStatus` pgEnum (migration). Lifecycle becomes:
>    `declared → researching → ready | failed`. `getBrandProfile` consumers must
>    treat `declared` as "has context, not yet enriched" — ideation/generation may
>    run using merged DNA where `identity` is null (mergeBrandDna handles it).
> 2. Zod schema `brandContextSchema` in `src/lib/validation.ts` mirroring
>    `BrandContext` (hex color regex `#[0-9a-fA-F]{6}`, bannedWords lowercase-
>    trimmed, max lengths). Unit tests: valid, bad hex, empty tones allowed.
> 3. Rebuild `clients/new` as a client-side stepper (single server action on final
>    submit — no per-step server state). Follow the existing UI language:
>    GlassCard, label-mono, brand-teal/purple/amber accents, chip pattern from
>    the prototype's tone toggles. Keep it keyboard-usable.
> 4. Server action `createClientWithContext`: one transaction — insert client,
>    insert brand_profiles row (`status: "declared"`, `declared` jsonb). Zod-parse
>    first; `requireMembership` as everywhere.
> 5. Update the client detail `/brand` screen's research action: research becomes
>    "Enrich with AI" — passes `declared` into `researchBrand` (Slice A already
>    wired the prompt), sets status `researching → ready`, never touches `declared`.
> 6. Switch every `profile.identity` gate to merged DNA. The complete call-site
>    inventory (verified at commit `2442af1` — re-grep `profile.identity` to
>    confirm before editing):
>    - `src/app/(app)/w/[ws]/studio/[contentId]/actions.ts` — 2 gates
>      (`refineDraftAction` ~line 50, `runComplianceAction` ~line 101)
>    - `src/app/(app)/w/[ws]/ideation/actions.ts` — 2 gates (~lines 43, 96)
>    - `src/app/(app)/w/[ws]/clients/[clientId]/brand/page.tsx` — render gate (~line 27)
>    Replace the gate `profile?.status !== "ready" || !profile.identity` with:
>    profile row must exist AND (`declared` OR `identity`) non-null → build
>    `mergeBrandDna(profile.declared, profile.identity)` and pass it where
>    `identity` was passed. Agent function signatures in `src/lib/ai/*` accept the
>    merged shape (Slice A already widened them). Error copy when no profile at
>    all: "No brand context yet — complete intake or run research."
> 7. Ideation with an empty baseline: `whyReason` must read "Declared brand
>    context (no baseline yet)" and `citations` stays `[]` — never invent post
>    citations. Add the unit test.
>
> **Acceptance checklist (all must be demonstrably true):**
> - [ ] Wizard: create client with full BrandContext, zero CSV anywhere in flow.
> - [ ] brand_profiles row: `status="declared"`, `declared` populated, `identity` null.
> - [ ] Ideation → generation → compliance runs on declared-only client.
> - [ ] KB shows "insufficient baseline", scores absent not faked.
> - [ ] "Enrich with AI" sets identity without touching `declared`.
> - [ ] `npm test` green, `tsc` clean, migration applied, one commit.

---

### Slice C — Brand DNA Vault (editable) + KB source registry

**Contract:** the `/brand` screen becomes the prototype's "Vault": declared context
is editable post-onboarding (chips, colors, banned words); an "Ingested sources"
card lists where KB data came from.

**Execution prompt:**

> Read CLAUDE.md and this plan (Slice C). Slices A–B merged.
>
> 1. `/w/[ws]/clients/[clientId]/brand` gains a "Vault" tab (alongside Identity +
>    Knowledge): edit forms for tones/pillars/bannedWords/avoidTopics/colors/
>    showcaseTheme/typography/logoUrl, reusing Slice B's chip + palette components
>    (extract them to `src/components/brand/` first if they were page-local).
> 2. Server action `updateBrandContext`: zod-parse partial updates, merge into
>    `declared`, bump `updatedAt`. Edits do NOT reset `identity` or status; add an
>    "Enrichment may be stale — re-run research" hint when `declared.updatedAt >
>    profile.updatedAt`-style comparison indicates drift (simplest honest signal).
> 3. Sources card: derive from `import_jobs` (CSV) + `connected_accounts` (Meta) +
>    pattern runs (Slice E) for this client's workspace — label each with layer
>    (baseline vs pattern), row counts, and freshness. Read-only.
> 4. Banned-word edits must propagate: compliance uses merged DNA at call time
>    (already true via Slice A) — add one regression test proving a word added via
>    `updateBrandContext` fails a draft that previously passed.
>
> **Acceptance checklist:**
> - [ ] Vault tab edits every BrandContext field; persists via `updateBrandContext`.
> - [ ] Regression test: word added in vault → previously-passing draft now fails
>       compliance with a violation naming that word.
> - [ ] Sources card lists CSV jobs + connected accounts with layer labels and counts.
> - [ ] `identity` and status untouched by vault edits; staleness hint renders.
> - [ ] Tests green, tsc clean, one commit.

---

### Slice D — CSV demoted to add-on + KB entry points

**Contract:** CSV import is no longer the onboarding front door; it lives as one of
several "Add data" options inside the KB screen.

**Execution prompt:**

> Read CLAUDE.md and this plan (Slice D). Small, surgical slice.
>
> 1. KB page (`/w/[ws]/kb`): add an "Add data" section with three cards —
>    "Import CSV (add-on)" → existing `clients/[clientId]/import` flow,
>    "Connect account" → `/accounts`, "Pattern scan" → `/patterns` (Slice E; render
>    as disabled "Coming soon" until E ships).
> 2. Remove/reword any copy that presents CSV as required (intake wizard success
>    screen, KB empty state). Empty-state copy: "Your baseline builds as data
>    arrives — declared Brand DNA already powers ideation."
> 3. Verify (test exists from Slice B, keep it green): full idea → draft → comply
>    path with zero imported posts.
>
> **Acceptance checklist:**
> - [ ] KB "Add data" section: CSV / Connect account / Pattern scan (disabled) cards.
> - [ ] No screen presents CSV as required; empty states reference declared DNA.
> - [ ] Existing import flow itself unchanged and still fully functional.
> - [ ] Tests green, one commit.

---

### Slice E — Apify harness layer: segmented scraping + inspiration surface

**Contract:** per-workspace harness config controls *what* Apify scrapes (segments),
*how much* (caps), and *when* (cadence); runs execute via Inngest; results land in
`pattern_posts` only; a Patterns screen surfaces top performers as inspiration with
an insight brief that cites pattern rows only.

**Schema:**
- `harness_rules` table: id, workspace_id, `segments` jsonb
  (`{ kind: "competitor_handle" | "hashtag" | "niche_query", value: string, note?: string }[]`),
  `maxPostsPerRun` int (default 30, hard cap 100), `cadence` enum
  (`manual | daily | weekly`, default manual), `enabled` bool, timestamps.
  One row per workspace (unique index).
- `pattern_runs` table: id, workspace_id, harness_rule_id, segment jsonb snapshot,
  status enum (`queued | running | done | failed`), postsFetched int, error text,
  startedAt/finishedAt. (Both tables → `workspaceScopedTables`.)
- `pattern_posts` gains `runId` + `segment` text columns (nullable; existing rows fine).

**Execution prompt:**

> Read CLAUDE.md and this plan (Slice E). This is the largest slice — if the
> session judges it too big for one diff, split at the marked seam: E1 =
> schema + runner + Inngest; E2 = insight agent + Patterns screen. TDD throughout.
>
> **E1 — config + runner:**
> 1. Schema as specified above; migration; both tables in `workspaceScopedTables`.
> 2. Extend `src/lib/connectors/apify.ts`: `runSegment(segment, cap)` maps segment
>    kinds to actor inputs — competitor_handle → existing instagram-scraper
>    directUrls; hashtag → hashtag mode; niche_query → hashtag-ified query.
>    Apify actors only (constitution). Everything returned is tagged
>    `source=public, weight=neutral` — reuse the existing ingestion path, adding
>    runId/segment. Dedupe per external post id within the workspace before insert.
> 3. `src/lib/harness.ts`: pure planners — `nextRunDue(rule, now)`,
>    `clampCap(requested)` (≤100), `segmentToActorInput(segment)`. Fully unit-tested;
>    the impure runner stays thin.
> 4. Inngest function `pattern-scan` (follow `src/inngest/functions/reminders.ts`
>    conventions): hourly cron scans enabled harness_rules where `nextRunDue`,
>    plus an event trigger (`"patterns/run.requested"`) for the manual "Run now"
>    button. Each segment = one `step.run`; per-segment failures record on
>    pattern_runs and never kill the sweep. Degradation: no `APIFY_TOKEN` → runs
>    marked failed with a clear message, UI shows it, app unaffected.
>
> **E2 — insight + screen:**
> 5. `src/lib/ai/pattern-insight-agent.ts`: input = top N pattern posts of a run
>    (by public engagement), output = `{ observations: [{ pattern, evidence:
>    patternPostIds[], suggestion }] }` — format/hook/structure observations,
>    "inspiration only" framing. **It must never receive baseline rows** — type
>    the input to pattern-post shapes and add a layer-separation unit test
>    mirroring the existing CI one: a pattern insight must never appear in any
>    "why this idea" baseline citation path.
> 6. `/w/[ws]/patterns` screen + nav item: harness config form (segment list
>    editor, cap, cadence, enable toggle), run history with per-run status/counts,
>    top-performer grid (caption excerpt, engagement, segment badge, PATTERN
>    LAYER · INSPIRATION ONLY label), insight brief card. Enable the KB
>    "Pattern scan" card from Slice D.
> 7. Ideation may OPTIONALLY receive pattern observations as a clearly separated
>    "format inspiration" prompt section — never as evidence, never cited in
>    whyReason. Add the guardrail test before wiring it.
>
> **Acceptance checklist E1:**
> - [ ] `harness_rules` + `pattern_runs` migrated, in `workspaceScopedTables`,
>       isolation `.toSQL()` tests present.
> - [ ] `runSegment` maps all 3 segment kinds; caps clamped ≤100; dedupe on
>       external post id per workspace proven by test.
> - [ ] Inngest `pattern-scan` registered (visible in `GET /api/inngest`
>       function_count); manual "Run now" event works; per-segment failure
>       recorded on pattern_runs without killing the sweep.
> - [ ] No `APIFY_TOKEN` → run fails soft with clear error text, app unaffected.
>
> **Acceptance checklist E2:**
> - [ ] Insight agent input type accepts ONLY pattern-post shapes; layer-separation
>       test: insight ids never intersect baseline citation ids.
> - [ ] `/w/[ws]/patterns` screen: config editor, run history, top-performer grid
>       with "PATTERN LAYER · INSPIRATION ONLY" labels, insight brief.
> - [ ] KB "Pattern scan" card enabled; nav item added.
> - [ ] Guardrail test merged BEFORE the optional ideation inspiration wiring.
> - [ ] Tests green, tsc clean, one commit per sub-slice.

---

## 4. Execution order, model routing, and gates

| Order | Slice | Size | Suggested session model |
|---|---|---|---|
| 1 | A — schema + merge + deterministic banned words | M | Sonnet (mechanical, well-specified) |
| 2 | B — intake wizard | L | Opus/Fable (UX judgment) |
| 3 | C — vault editing + sources | M | Sonnet |
| 4 | D — CSV demotion | S | Sonnet |
| 5 | E — Apify harness (E1/E2 seam) | XL | Opus/Fable for E1 design, Sonnet OK for E2 UI |

Gates: each slice = plan already approved here → implement as one reviewable
diff → `npm test` + `tsc` green → commit → next. No slice starts until the
previous one is on main. Env additions for E: `APIFY_TOKEN` (exists),
optional `APIFY_ACTOR_ID` override.

## 5. Explicitly out of scope (do not build in these slices)

- File uploads / Supabase Storage for logos (URL field only for now).
- Image/video generation of any kind (constitution: cut).
- Competitor *website* scraping beyond Apify actors (no own-scraper pipelines).
- Ads Manager, Client Portal, Drift monitor (trigger-gated, unchanged).
- LinkedIn. CSV covers it.

## 6. Risks & honest notes

- **Apify cost/ToS:** hashtag scans can return junk; caps + dedupe are mandatory,
  and `weight=neutral` means junk can't poison scoring. Budget cap is per-run
  post count, not dollars — revisit if usage grows.
- **Declared-only ideation quality:** with zero posts, ideas run on declared DNA
  alone; whyReason must say "declared brand context — no baseline yet" rather
  than cite nothing. Covered in Slice B step 6 test.
- **Banned-word matching is intentionally dumb** (word-boundary, case-insensitive).
  It will not catch misspellings or synonyms — that's what the LLM layer is for.
  The two together are the guarantee.
