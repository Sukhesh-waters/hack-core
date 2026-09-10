# Phase 3 — Intelligence (Brand DNA → Retrieval → Ideation → Generation)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use checkbox syntax.
> **Format note:** core logic (router tier, retrieval SQL, agents, guardrails) is fully coded below; screens specify exact routes/props/queries but reuse the established Phase 1/2 component patterns (GlassCard + useFormState forms) without repeating boilerplate — same executor, same session, conventions proven twice.

**Goal:** Onboard a brand once, then: topic → driver brief (first-party only) → scored ideas with "why this idea" citations → brand-tuned draft with refinement — the core demo path (W4+W5).

**Architecture:** The router gains a `quality` tier (Bedrock Claude → Gemini Pro → Groq degradation ladder). All agents are thin modules: pure prompt-builders + zod response parsers around `routeAI`, so every agent is unit-testable with a mocked router. Retrieval runs pgvector cosine similarity hard-filtered to the first-party layer, with a CI guardrail. A citation validator guarantees "why this idea" can only cite baseline post ids.

**Tech Stack:** Existing stack + `@anthropic-ai/bedrock-sdk` (Mantle client — the only sane SigV4 path; Bedrock is in the locked stack). Bedrock model id `anthropic.claude-opus-4-8` (env-overridable `BEDROCK_MODEL_ID`).

## Global Constraints (constitution)

- Every AI call through `routeAI` — agents never touch providers.
- Two-layer rule: retrieval + driver brief + citations read `source='first_party'` ONLY; CI-gated toSQL guardrail like Phase 1/2.
- Min-N gate: ideation on a client below `MIN_BASELINE_N` returns `insufficient_baseline` — honest empty state, no fake ideas-from-nothing. (Ideas require a baseline; the brief is the mechanism.)
- No agent spawns an agent: compliance-style retry limited to explicit user-triggered refine; agents are single calls.
- Degradation ladder: Bedrock unconfigured/down → Gemini quality model → Groq. Missing keys → clear UI state, never a crash.
- `workspace_id` on new tables (`brand_profiles`, `ideas`), registered in `workspaceScopedTables`.
- Gate per task: `npm run lint && npm run typecheck && npm test` (+ build for UI tasks). Commit per task to main.

## File Structure

```
src/db/schema.ts                      (modify: brand_profiles, ideas, content.ideaId)
src/db/schema.test.ts                 (modify: registry + shape tests)
src/lib/ai/router.ts / router.test.ts (modify: quality tier + bedrock provider)
src/lib/flags.ts / flags.test.ts      (modify: bedrockConfigured)
src/lib/ai/retrieval.ts / retrieval.test.ts (create: similarity query + driver brief)
src/lib/ai/brand-agent.ts / brand-agent.test.ts (create)
src/lib/ai/ideation-agent.ts / ideation-agent.test.ts (create: + validateCitations)
src/lib/ai/generation-agent.ts / generation-agent.test.ts (create: draft + refine)
src/db/queries/brand.ts               (create: profile get/upsert)
src/db/queries/ideas.ts / ideas.test.ts (create: scoped-SQL test)
src/app/(app)/w/[ws]/clients/[clientId]/brand/  (create: page + actions + tabs + research-form)
src/app/(app)/w/[ws]/ideation/        (create: page + actions + topic-form + idea-card)
src/app/(app)/w/[ws]/studio/          (create: list page + [contentId] detail + refine-form + actions)
src/components/workspace-nav.tsx      (modify: Ideation + Studio links)
src/app/(app)/w/[ws]/clients/page.tsx (modify: Brand DNA link per client)
.env.example                          (modify: AWS_*, BEDROCK_MODEL_ID, GEMINI_QUALITY_MODEL)
drizzle/0004_*.sql                    (generated)
```

---

### Task 1: Schema — brand_profiles, ideas, content.ideaId

**Interfaces produced:**
- `brandProfiles`: `id, workspaceId, clientId (unique per workspace via uniqueIndex(workspaceId, clientId)), identity: jsonb $type<BrandIdentity>, status: pgEnum brand_status("researching"|"ready"|"failed"), error: text, model: text, createdAt, updatedAt`
- `ideas`: `id, workspaceId, clientId, topic, hook, angle, format, whyReason: text, citations: jsonb $type<string[]> (post ids), status: pgEnum idea_status("new"|"drafted"|"archived"), createdAt`
- `content`: add `ideaId: text("idea_id").references(() => ideas.id)` (nullable)
- `type BrandIdentity = { voice: string; tone: string; audience: string; pillars: string[]; doNots: string[]; formats: string[] }` exported from schema file.

**Steps:** failing tests (registry includes both tables; ideas.citations column exists; brandProfiles unique index) → implement → `npm run db:generate` (inspect 0004) → gate → commit `feat: brand profile and ideas schema`.

Test additions to `src/db/schema.test.ts`:

```ts
describe("intelligence tables (Phase 3)", () => {
  it("brand_profiles and ideas are workspace-scoped", () => {
    expect(schema.workspaceScopedTables).toMatchObject({
      brandProfiles: schema.brandProfiles,
      ideas: schema.ideas,
    });
  });

  it("one brand profile per client (cached, runs once)", () => {
    const { indexes } = getTableConfig(schema.brandProfiles);
    expect(indexes.some((idx) => idx.config.unique)).toBe(true);
  });

  it("ideas carry citations for the why-this-idea chip", () => {
    expect(getTableColumns(schema.ideas).citations).toBeDefined();
  });
});
```

---

### Task 2: Router quality tier (Bedrock → Gemini Pro → Groq)

**Files:** modify `src/lib/ai/router.ts`, `router.test.ts`, `src/lib/flags.ts`, `flags.test.ts`; `npm install @anthropic-ai/bedrock-sdk`; env example.

**Interfaces:**
- `ChatTask` gains `tier?: "fast" | "quality"` (default `"fast"` — existing callers unchanged).
- `flags.ts` gains `bedrockConfigured(): boolean` (AWS_REGION + AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY all set).

**Implementation (add to router.ts):**

```ts
const BEDROCK_MODEL = () =>
  process.env.BEDROCK_MODEL_ID ?? "anthropic.claude-opus-4-8";
const GEMINI_QUALITY_MODEL = () =>
  process.env.GEMINI_QUALITY_MODEL ?? "gemini-2.5-pro";

export async function routeAI(task: ChatTask | EmbedTask) {
  if (task.kind === "embed") return geminiEmbed(task.texts);
  if (task.tier === "quality") return qualityChat(task);
  /* existing fast path unchanged */
}

/**
 * Quality tier degradation ladder: Bedrock Claude → Gemini Pro → Groq.
 * Bedrock is skipped entirely when AWS creds are absent (external dep:
 * verify in-region availability — WEEKLY_PLAN §5).
 */
async function qualityChat(task: ChatTask): Promise<string> {
  if (bedrockConfigured()) {
    try {
      return await bedrockChat(task);
    } catch {
      // fall through the ladder
    }
  }
  try {
    return await geminiChat(task, GEMINI_QUALITY_MODEL());
  } catch {
    return groqChat(task);
  }
}

async function bedrockChat(task: ChatTask): Promise<string> {
  // Mantle client (SigV4 via AWS env creds); model ids carry the anthropic. prefix
  const { AnthropicBedrockMantle } = await import("@anthropic-ai/bedrock-sdk");
  const client = new AnthropicBedrockMantle({
    awsRegion: process.env.AWS_REGION,
  });
  const response = await client.messages.create({
    model: BEDROCK_MODEL(),
    max_tokens: 4096,
    ...(task.system ? { system: task.system } : {}),
    messages: [{ role: "user", content: task.prompt }],
  });
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new AIRouterError("Bedrock returned no text", "bedrock");
  }
  return block.text;
}
```

(`AIRouterError.provider` union widens to `"groq" | "gemini" | "bedrock"`; `geminiChat` gains an optional `model` param defaulting to the existing fast model.)

**Tests (added):** quality tier with no AWS creds skips Bedrock and calls Gemini quality model URL (`gemini-2.5-pro`); Gemini 500 → falls through to Groq; with AWS creds stubbed, `vi.mock("@anthropic-ai/bedrock-sdk")` returns a text block and neither Gemini nor Groq is called; bedrock failure → Gemini. Also: `tier: "quality"` with everything down rejects with `AIRouterError`.

**Env example additions:**

```bash
# Quality tier (Phase 3): Bedrock Claude, else Gemini Pro fallback
AWS_REGION=""
AWS_ACCESS_KEY_ID=""
AWS_SECRET_ACCESS_KEY=""
BEDROCK_MODEL_ID="anthropic.claude-opus-4-8"
GEMINI_QUALITY_MODEL="gemini-2.5-pro"
```

Commit: `feat: router quality tier — Bedrock Claude with Gemini Pro/Groq ladder`.

---

### Task 3: Retrieval — similarity query + driver brief (first-party only)

**Files:** `src/lib/ai/retrieval.ts`, `retrieval.test.ts`.

**Interfaces:**
- `similarPostsQuery(workspaceId, clientId, embedding: number[])` — exported for the toSQL guardrail; joins `postEmbeddings` → `posts`, filters BOTH tables to workspace + `source='first_party'`, orders by cosine distance, limit 8.
- `retrieveDrivers({ workspaceId, clientId, topic }): Promise<DriverBrief>` where
  `type DriverBrief = { status: "insufficient_baseline"; sampleSize: number } | { status: "ready"; brief: string; citedPostIds: string[]; drivers: DriverPost[] }` and `type DriverPost = { id: string; caption: string | null; direction: string | null; magnitude: number | null; format: string | null }`.
- `buildBriefPrompt(topic, drivers): string` — pure, tested directly.

**Logic:** baseline size via `getBaselinePoints` → below `MIN_BASELINE_N` → insufficient. Else: embed topic (`routeAI embed`), fetch similar 8 + top movers (direction `up` by magnitude desc, 5) + down movers (3) via `listPosts`-style scoped queries, dedupe by id, `buildBriefPrompt` (drivers rendered as `[{id-prefix-8}] "caption…" direction=up mag=0.82 format=reel`), fast-tier chat: "~200-token driver brief for {topic}; cite drivers inline as [xxxxxxxx]; only the listed first-party rows exist." Return brief + cited ids (regex `\[([a-f0-9-]{8})\]` mapped back to full ids).

**Guardrail tests (CI):** `similarPostsQuery(...).toSQL()` contains `"source" =` with param `first_party` **twice** (posts + embeddings), contains `"workspace_id" =`, and orders by the embedding distance operator (`<=>`); `buildBriefPrompt` includes ids and never includes the words `pattern` / rows not passed; `retrieveDrivers` with small baseline returns insufficient without calling the router (mock assertion).

Drizzle cosine distance: `import { cosineDistance } from "drizzle-orm"` — `orderBy(cosineDistance(postEmbeddings.embedding, embedding))`.

Commit: `feat: first-party retrieval and driver brief with CI layer guardrail`.

---

### Task 4: Brand DNA agent + queries

**Files:** `src/lib/ai/brand-agent.ts`, `brand-agent.test.ts`, `src/db/queries/brand.ts`.

**Interfaces:**
- `researchBrand(input: { name: string; handle: string | null; kbStats: { total: number; baselineSize: number; medianEngagement: number | null }; topCaptions: string[] }): Promise<BrandIdentity>` — quality-tier json chat; zod schema mirrors `BrandIdentity` (pillars 3–6, doNots ≤6, formats ≤5); throws `BrandResearchError` on unparseable output (surfaced as `status: "failed"` + stored error).
- `buildBrandPrompt(input): string` — pure.
- Queries: `getBrandProfile(workspaceId, clientId)`, `saveBrandProfile(workspaceId, clientId, patch)` (insert-or-update on the unique index via `onConflictDoUpdate`).

**Tests:** prompt contains name/captions/stats; valid JSON → parsed identity; invalid JSON → throws `BrandResearchError`; router called with `tier: "quality"` (mock assertion). Cached-runs-once is enforced at the action layer (research only when no `ready` profile or explicit re-run).

Commit: `feat: Brand DNA research agent with cached per-client profile`.

---

### Task 5: Ideation agent + citation guardrail

**Files:** `src/lib/ai/ideation-agent.ts`, `ideation-agent.test.ts`, `src/db/queries/ideas.ts`, `ideas.test.ts`.

**Interfaces:**
- `generateIdeas(input: { topic: string; identity: BrandIdentity; brief: string; drivers: DriverPost[] }): Promise<IdeaDraft[]>` with `type IdeaDraft = { hook: string; angle: string; format: string; why: { reason: string; citations: string[] } }` — quality tier, json, zod-parsed (4–6 ideas).
- `validateCitations(ideas: IdeaDraft[], allowedPostIds: string[]): IdeaDraft[]` — **pure constitution guardrail**: strips any citation not in the allowed first-party set; an idea whose citations all vanish keeps `reason` but `citations: []`.
- Queries: `listIdeas(workspaceId, { clientId?, limit? })`, `insertIdeas`, `getIdea(workspaceId, ideaId)`, `markIdeaDrafted` — plus a toSQL workspace-scope test on the list query.

**Key test (constitution):**

```ts
it("strips citations that are not first-party baseline rows — never cited, ever", () => {
  const ideas = [idea({ citations: ["post_real", "post_forged"] })];
  const out = validateCitations(ideas, ["post_real"]);
  expect(out[0].why.citations).toEqual(["post_real"]);
});
```

Plus: quality-tier assertion, malformed JSON throws, count clamped 4–6.

Commit: `feat: ideation agent with first-party-only citation guardrail`.

---

### Task 6: Generation + refinement agent

**Files:** `src/lib/ai/generation-agent.ts`, `generation-agent.test.ts`.

**Interfaces:**
- `generateDraft({ idea: { hook, angle, format }, identity }): Promise<Draft>` with `type Draft = { caption: string; script: string; hashtags: string[]; cta: string }` — quality tier, json, zod.
- `refineDraft({ draft, feedback, identity }): Promise<Draft>` — same shape, single call (no loops).
- `formatDraftBody(draft): string` — pure markdown (`## Caption`, `## Script`, `## Hashtags`, `## CTA`) stored in `content.body`; `parseDraftBody(body): Draft | null` inverse for refine round-trips.

**Tests:** format/parse round-trip; hashtags normalized (`#` prefixed, ≤30); refine prompt includes feedback verbatim + prior draft; identity doNots appear in both prompts (brand-tuned per spec); quality-tier assertion.

Commit: `feat: generation and refinement agents with brand-tuned drafts`.

---

### Task 7: Brand screens (research loading → Identity/Knowledge tabs)

**Files:** `src/app/(app)/w/[ws]/clients/[clientId]/brand/{page.tsx,actions.ts,research-form.tsx,profile-tabs.tsx}`; modify clients list page (add "Brand DNA" link per client row).

- `actions.ts`: `runBrandResearch(_prev, formData)` — requireUser+Membership → skip if a `ready` profile exists unless `force==="true"` (cached, runs once) → mark `researching` → gather inputs (client row, `getKbStats`, top-10 up-mover captions) → `researchBrand` → save `ready` (+model used) or `failed`+error → `revalidatePath`. State pattern identical to Phase 2 actions.
- `page.tsx` (server): no profile → intro + `<ResearchForm/>` ("Research brand" button; pending label "Researching brand — reading the knowledge base…" = the W4 loading screen). `failed` → error card + retry. `ready` → `<ProfileTabs identity knowledge/>` + subtle "Re-run research" form (`force`).
- `profile-tabs.tsx` (client): two-tab toggle — **Identity** (voice, tone, audience, pillar badges, doNots list) / **Knowledge** (KB stat grid + top driver captions with ScoreChip) — plain useState toggle styled like nav pills.

Gate incl. build. Commit: `feat: Brand DNA screen — research flow with Identity and Knowledge tabs`.

---

### Task 8: Ideation screen

**Files:** `src/app/(app)/w/[ws]/ideation/{page.tsx,actions.ts,topic-form.tsx,idea-card.tsx}`.

- `actions.ts`: `runIdeation` — validates topic (zod: 3–120 chars) + clientId → requires `ready` brand profile (error: "Run Brand DNA research first") → `retrieveDrivers` → `insufficient_baseline` → honest error state naming N/`MIN_BASELINE_N` → else `generateIdeas` → `validateCitations(ideas, drivers.map(d=>d.id))` → `insertIdeas` → revalidate. `draftIdea` — takes ideaId, calls `generateDraft`, inserts `content` row (title=hook, `ideaId`, status draft, body=formatDraftBody), `markIdeaDrafted`, redirects to `/w/[ws]/studio/[contentId]`.
- `page.tsx`: client dropdown + topic input (`topic-form.tsx`), then `listIdeas` grid of `idea-card.tsx` — hook (display font), angle, format badge, **why-chip**: purple-outlined block "Why: {reason}" + cited first-party captions (ids resolved via a `getPostsByIds(workspaceId, ids)` helper added to `queries/posts.ts` — workspace-scoped) + "Draft it" button (form → `draftIdea`).

Commit: `feat: ideation screen — scored ideas with why-this-idea baseline citations`.

---

### Task 9: Studio + refinement, nav, ship

**Files:** `src/app/(app)/w/[ws]/studio/{page.tsx,[contentId]/page.tsx,[contentId]/refine-form.tsx,[contentId]/actions.ts}`; `workspace-nav.tsx` (+ `Lightbulb` Ideation, `PenTool` Studio); `queries/clients.ts` gains `getContentById(workspaceId, contentId)` + `listDrafts(workspaceId)`.

- Studio list: drafts (content rows having `ideaId`) with title/status/created → link to detail.
- Detail: rendered draft sections (parse body; fallback to raw pre), refine textarea (`refineForm` → `refineDraftAction`: parse stored body → `refineDraft` → update row) — pending label "Refining with brand rules…".
- Full gate + build; push; watch CI (integration suite runs against the CI Postgres).

Commit: `feat: creative studio with refinement loop; Phase 3 complete` + push.

---

## Known non-goals (deliberate)

- Compliance agent, approvals, calendar — Phase 4 (W6) per plan.
- No per-workspace cost telemetry yet (W7); Bedrock spend rides the $90 credit — quality tier is only invoked from explicit user actions (research/ideate/draft/refine), never in loops.
- No streaming UI for agent calls — server actions block with pending labels (adequate at these latencies; revisit in W8 polish).
- Embeddings exist only for CSV/Meta-ingested posts; clients without embeddings still work (retrieval falls back to top/bottom movers — similarity set may be empty, brief still builds).

## Self-review

- W4 coverage: Brand DNA cached agent ✅ (unique index + action skip), retrieval → ~200-token brief citing first-party only ✅ (guardrail), router end-to-end with Bedrock quality tier ✅ (+degradation), Brand Research loading + Identity/Knowledge tabs ✅.
- W5 coverage: ideation with why-chips citing baseline rows only ✅ (validateCitations + CI test), generation (caption+script+hashtags, brand-tuned) ✅, refinement loop ✅, Ideation + Studio screens ✅.
- Types line up: `BrandIdentity` (Task 1) consumed by Tasks 4–6; `DriverPost` (Task 3) feeds Task 5; `Draft`/`formatDraftBody` (Task 6) feed Tasks 8–9; `IdeaDraft.why.citations` are `posts.id` values resolved by `getPostsByIds`.
