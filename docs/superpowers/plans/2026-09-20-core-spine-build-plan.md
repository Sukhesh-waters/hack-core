# Core Spine — Build Plan for Implementing Agents

**Created:** 2026-09-20
**Companion design doc:** `docs/superpowers/specs/2026-09-20-core-spine-design.md`
**Audience:** implementing agents (Sonnet) working slice-by-slice in this repo.
**Authority:** `CLAUDE.md` (the constitution) outranks this document. If this
document and the constitution disagree, the constitution wins and you stop and
report the conflict — you do not "resolve" it yourself.

---

## 0. How to use this document

### 0.1 Working protocol — every slice, without exception

```
1. READ    the slice section end to end, plus every file it names.
2. VERIFY  the "Preconditions" block. If one fails, STOP and report.
           Do not "fix it along the way".
3. PLAN    post a diff plan: files touched, contracts added, tests added.
           Wait for approval. (Constitution: Plan -> diff -> review.)
4. BUILD   in the order given. Schema -> queries -> lib -> jobs -> UI.
5. TEST    `npm test` and `npm run typecheck` must both be green.
           New tests must fail before your change and pass after it.
6. VERIFY  run the slice's "Acceptance" commands and paste real output.
7. REPORT  what you did, what you did not do, and every assumption made.
```

### 0.2 Hard rules for agents

| Rule | Why |
|---|---|
| **One slice per branch/PR.** Never combine S1 and S2. | Reviewability; the constitution mandates vertical slices. |
| **Never delete a table, column, route, or file.** | Deletion requires the owner-signed Slice 12 transition matrix. Additive migrations only. |
| **Never edit `src/lib/platina/boundary.test.ts` to make your import pass.** | That test is the module boundary. A failing boundary test means your design is wrong, not the test. |
| **Never invent a number in the UI.** | Min-N gate. Below `minBaselineN`, render "insufficient baseline". |
| **Never let a fetch failure become a document.** | A fabricated signal poisons the Brain permanently. |
| **Never write a hostname literal on a `fetch(` line in Platina code.** | `boundary.test.ts` scans for it; only `api.apify.com` is allowed. Pass URLs as variables (see `fetch/probe.ts` — it does exactly this and passes). |
| **Never claim a step works without pasting the command output.** | Most of the defects below existed *because* something silently did nothing. |
| **If a test is hard to write, the design is wrong.** | Stop and report rather than deleting the assertion. |

### 0.3 Commands

```bash
npm run dev          # Next.js only — NOTHING scheduled runs
npm run dev:jobs     # (added in S0) the Inngest dev server — REQUIRED
npm test             # vitest run, src/**/*.test.ts
npm run typecheck    # tsc --noEmit
npm run lint
npm run db:generate  # drizzle-kit generate  (creates the migration SQL)
npm run db:migrate   # drizzle-kit migrate   (applies it)
npm run test:e2e     # playwright
```

---

## 1. Ground truth — the contracts you code against

Do not re-derive these. They are verified as of 2026-09-20.

### 1.1 The collection pipeline, as it exists

```
cron */5  scan-coordinator.ts
            listSchedulableSpecs()            -- all workspaces, approved+enabled
            isDue(spec, probeCapable, now)    -- fetch/schedule.ts, pure
            -> sendEvent "platina/probe.tick" (one per due spec)
                |
                v
          probe-tick.ts
            getScanSpec(ws, specId)           -- re-checks approved+enabled
            probeSource(...)                  -- header-only conditional GET
            costCapReached(spec)              -- 48 actor fetches/spec/UTC day
            -> createAuditRun(...)  only when content likely changed
            -> sendEvent "platina/audit-run.requested"
                |
                v
          audit-run.ts
            executeAuditRun(deps, ws, runId)  -- orchestrator.ts state machine
              stage competitor_scan -> runFetchStage
                 getScanSpec -> status must be "approved"
                 runApprovedScan(spec)        -- registry.ts, assertApproved
                   -> waters.ts fetchViaWaters -> Apify run-sync-get-dataset-items
                 insertSignalDocuments(ws, specId, docs)   -- hash dedupe
              stages brand_divergence / ideation -> SKIPPED (stubs, D4)
            -> sendEvent "platina/contradict.requested"
                |
                v
          contradict-sweep.ts
            listUnresolvedSignals(ws).slice(0, 5)          -- D5 bottleneck
            runContradictionRound(text, floors)            -- debate.ts, routeAI
            insertTranscript -> findingPathFor(state)
              agreed|qualified -> embedText -> insertBrainChunk + insertFinding("new")
              contested        -> insertFinding("needs_decision")
              refuted          -> transcript only
            markSignalProcessed(ws, signalId)
```

### 1.2 Key signatures

```ts
// src/lib/ai/router.ts
type ChatTask = {
  kind: "chat"; prompt: string; system?: string; json?: boolean;
  tier?: "fast" | "quality";          // fast: Groq->Gemini
                                       // quality: Bedrock->Gemini Pro->Groq
  pin?: "groq" | "gemini" | "bedrock"; // bypass the ladder
};
type EmbedTask = { kind: "embed"; texts: string[] };
routeAI(task): Promise<string /* chat */ | number[][] /* embed */>

// src/lib/ai/context/types.ts  — THIS UNION IS CLOSED. Do not add members.
type ContextState =
  | "context_available" | "insufficient_baseline"
  | "insufficient_relevance" | "missing_context";
type ContextResult<T> =
  | { state: "context_available"; context: T }
  | { state: "insufficient_baseline"; sampleSize: number }
  | { state: "insufficient_relevance" }
  | { state: "missing_context"; reason: string };
logContextAssembly({ taskType, workspaceId, state, sections })

// src/lib/orchestrator/run.ts
runOrchestration<TParams, TContext, TProposal, TOutput>({
  taskType, contextParams, assembleContext, agent, validate, critic?, apply
}): Promise<OrchestrationResult<TOutput>>
// Agents PROPOSE. Only runOrchestration decides whether apply() runs.

// src/lib/platina/fetch/registry.ts
assertApproved(spec): asserts spec is ApprovedScanSpec   // throws if not
runApprovedScan(spec, adapterKey = "apify"): Promise<FetchOutcome>
type FetchOutcome = { docs: RawSignalDoc[]; failures: FetchFailure[] };
// registerAdapter("web") THROWS — the own-code content adapter is unshipped.

// src/lib/platina/fetch/schedule.ts   (pure, fully tested)
ADAPTIVE_START_MINUTES = 360; ADAPTIVE_MAX_MINUTES = 1440;
MAX_FETCHES_PER_DAY = 48;            // PER SPEC per UTC day — not per workspace
isProbeCapable(kind); isDue(spec, probeCapable, now); costCapReached(spec, now);
backoffInterval(current); tightenInterval(current, cadenceFloor);
PROBE_CAPABLE_KINDS = new Set(["competitor_site"]);

// src/lib/platina/gates.ts
PLATINA_GATES = ["declare", "confirm", "approve", "publish"]
GATE_CAPABILITY.confirm === "gate.confirm"   // the capability that permits a fetch
```

### 1.3 Schema invariants enforced by tests (`src/db/platina-schema.test.ts`)

- Every `platina_*` table has a **non-null, indexed** `workspace_id`.
- `platina_signal_documents` has **no `embedding` column** (Plane B, by construction).
  Adding one breaks a structural test. Do not.
- Every embedded table carries `embedding_model_version`.
  `PLATINA_EMBEDDING_MODEL_VERSION = "gemini-embedding-001"`. Bumping it
  requires a re-embed backfill — mixed versions in one index are meaningless.
- `platina_signal_documents` has `uniqueIndex(scan_spec_id, content_hash)`.
  **Consequence for S3:** two distinct pages in one multi-page crawl with
  byte-identical content insert once. That is correct dedupe, not a bug — but
  your fetch counters must report `fetched` and `inserted` separately (they
  already do).

### 1.4 Query-layer convention — copy it exactly

Every list/read is split in two: an exported **query builder** (testable via
`.toSQL()`) and a thin `await` wrapper.

```ts
// src/db/queries/platina.ts
export function subjectsQuery(workspaceId: string) {
  return db.select({...}).from(platinaBrands)
           .where(eq(platinaBrands.workspaceId, workspaceId));
}
export async function listBrands(workspaceId: string) {
  return subjectsQuery(workspaceId);
}
```

```ts
// src/db/queries/platina.test.ts — the isolation assertion, mandatory
it("brandsQuery filters workspace_id", () => {
  const { sql, params } = brandsQuery("ws_p").toSQL();
  expect(sql).toContain('"workspace_id" =');
  expect(params).toContain("ws_p");
});
```

**Every new query builder gets this test.** No exceptions. Isolation is
enforced in the app layer only — there is no RLS to catch you (the app
connects as a plain Postgres role, so `auth.uid()` is always NULL and any RLS
policy keyed on it silently never matches).

### 1.5 Boundary rules (`src/lib/platina/boundary.test.ts`)

Platina code (`app/(platina)`, `components/platina`, `lib/platina`,
`inngest/functions/platina`, `db/platina-schema.ts`, `db/queries/platina.ts`)
may import **only**:

```
@/auth  @/db  @/db/schema  @/db/platina-schema  @/db/queries/platina
@/db/queries/memberships  @/db/queries/workspaces  @/lib/permissions
@/lib/ai/router  @/lib/orchestrator/run  @/lib/ai/context/types
@/lib/ai/usage-context  @/lib/action-errors  @/lib/utils  @/inngest/client
+ anything under @/lib/platina or @/components/platina
+ npm packages and relative paths
```

Forbidden outright: `@/lib/connectors/*`, `@/lib/data/*`, `@/lib/ai/agents/*`,
`@/db/queries/{tickets,hub,sop,posts,schedule,campaigns,notifications,...}`,
`@/app/(app)/*`, `@/inngest/functions/*` except `platina`.

The exception table is **empty and is a ratchet**. It may only shrink.

Also scanned: the strings `sopRunId`, `sop_run_id`, `hub_message`,
`kind: "ticket"`, `kind: "email"` may not appear outside three named files.

---

## 2. Analysis — why the product does not work today

Seven defects. Each is stated with its evidence, its mechanism, and the slice
that fixes it. **Read this before writing code**; several "obvious fixes" are
wrong because of a mechanism described here.

### D1 — Nothing scheduled ever runs locally → S0

**Evidence:** `.env.local` sets `INNGEST_DEV=1`. `package.json` has no script
that starts an Inngest dev server. `README.md` contains zero occurrences of
"inngest" (verified by grep).

**Mechanism:** `INNGEST_DEV=1` makes the SDK expect a local dev server that
discovers `/api/inngest` and drives crons/events. Without it the
`*/5 * * * *` coordinator never ticks. No tick -> no probe -> no run -> no
Apify call -> no signal document -> no debate -> no finding -> no Brain chunk.
Every page renders empty and **nothing logs an error**, because nothing was
asked to happen.

**Why this matters more than it looks:** every other defect below was
invisible underneath this one. Fix and verify D1 before diagnosing anything
else, or you will chase ghosts.

### D2 — Collection depth is one static page → S3

**Evidence:** `src/lib/platina/fetch/waters.ts:52`

```ts
return { startUrls: [{ url }], maxCrawlDepth: 0, maxCrawlPages: 1,
         crawlerType: "cheerio" };
```

**Mechanism:** one target = one HTTP page of *server-rendered* HTML.
`cheerio` executes no JavaScript, so a React/Next competitor site returns a
shell with no content. No sitemap seeding, no pagination, no article bodies.
This is adequate as a *change detector* and useless as a *data pool*.

**Contradiction to be aware of:** raising the crawl budget multiplies Apify
cost linearly and the per-spec cap (`MAX_FETCHES_PER_DAY = 48`) counts *runs*,
not *pages*. A 25-page budget silently multiplies spend by 25 without tripping
any existing cap. S3 must add page-level accounting, not just raise a number.

### D3 — No social / post / engagement collection in the core flow → S3

**Evidence:** `PlatinaScanTarget["kind"]` is
`competitor_site | press_release | conference | trade_editorial | ad_library`.
The 8 social actors (`apify~instagram-scraper`, `clockworks~tiktok-scraper`,
profile, comments, reels, deep-post, ad-library) live in
`src/lib/connectors/apify-actors.ts`, which `boundary.test.ts` forbids Platina
from importing.

**Mechanism:** the owner's requirement — "competitor analysis of posts /
impressions" — has **no code path at all** in the Platina flow. It exists on
the InstaMedia side, behind the boundary, wired to a different schema.

**The trap:** the obvious fix (import the connector) fails `boundary.test.ts`.
The second obvious fix (add it to the allowlist) is a constitution amendment
that requires owner sign-off. See Decision B in §3.

### D4 — The analysis stages are stubs → S5

**Evidence:** `src/lib/platina/orchestrator.ts:72`

```ts
const STAGE_EXECUTORS: Partial<Record<PlatinaAnalysisStep, "fetch">> = {
  competitor_scan: "fetch",
};
const STAGE_DEFERRED_TO = {
  brand_divergence: "Slice 8", ideation: "Slice 5", claims_screen: "Slice 8",
};
```

and `src/inngest/functions/platina/divergence-scan.ts` in full: list brand
chunks, add up the length, return the count. It analyses nothing.

**Mechanism:** the default `analysisSequence` is
`["competitor_scan", "brand_divergence", "ideation"]`. Two of the three
stages record "skipped — deferred" on the run timeline and return. A run
therefore reports **completed** having done only a fetch. The timeline is
honest; the status is misleading to a user who does not open the timeline.

### D5 — Insight throughput is 5 documents per sweep → S4

**Evidence:** `contradict-sweep.ts`: `for (const signal of signals.slice(0, 5))`,
triggers `cron "30 */6 * * *"` plus the per-run event.

**Mechanism:** each signal costs 2 AI calls (proposer + challenger) and 1
embed. The cap was a cost guard. But once S3 raises collection volume, the
backlog grows unboundedly: docs arrive faster than 5-per-sweep drains them,
`listUnresolvedSignals` returns an ever-older head, and **the newest signals
are never analysed** (the queue is FIFO by insertion). The product would
report "fresh" collection while reasoning only over stale documents.

### D6 — The planner cannot see anything that was collected → S6

**Evidence:** `src/lib/platina/plan/context.ts` in full assembles from
`listPlanLessons(workspaceId, "worked"|"failed", 3)`. It never queries
`platina_brain_chunks`, `platina_findings`, or `platina_signal_documents`.
`buildPlanPrompt()` renders only `context.brief` + worked/failed lessons.

**Mechanism:** collection, insight, KB and planning are two disconnected
products sharing a database. The "planner that learns" learns only from its
own past plans plus a human-typed note. **This is the single biggest
misalignment between the built product and the product's stated value.**

**Contradiction to respect while fixing it:** you cannot simply dump Brain
chunks into the plan prompt. The constitution's two-layer rule forbids
first-party (Plane A) and public/Apify (Plane B) evidence from ever being
cited together in one "why this idea". S6 must carry them as two arrays and
enforce separation in a test.

### D7 — There is no client/project entity in Platina → S1

**Evidence:** Platina tenancy is `workspace_id` + `platina_workspace_profiles`
(`division`, `region`, `business_unit`, unique per workspace). `clients` is
`src/db/schema.ts:234` — InstaMedia side, behind the boundary.

**Mechanism:** the owner's step "add a project/client and we start collecting"
has nothing to attach to. Scan specs hang off `workspace_id` directly, so
there is no way to say "these 14 sources belong to Acme, those 9 to Acme's
competitor Globex", no per-client coverage view, no per-client cost, and no
way for the planner to ask "what do we know about *this* brand".

### D8 (UX) — The product has two front doors and speaks build vocabulary

- `/w/[ws]/*` (46 pages) and `/p/[ws]/*` (26 pages); one bridge link, on
  `/hub` (`src/app/(app)/hub/page.tsx:73`).
- `workspace/ready` says features "come online in the next slices" and routes
  to `/w/[ws]/kb` — an empty page with no next action.
- `/p/[ws]/scans` renders `eyebrow="S3–S5 · gate 2"` and a button reading
  `Gate 2 · confirm fetch`.
- No surface anywhere answers "is collection running right now, and what did
  it cost".

---

## 3. Architecture decisions

Decisions A–D need owner sign-off **before S1 merges**. S0 is unblocked and
depends on none of them.

### Decision A — where the spine lives  *(recommended: A1)*

| | Approach | Consequence |
|---|---|---|
| **A1 ✅** | New Platina-owned brand/client table; `/p` becomes the core product; `/w` stays live and untouched | No constitution change. No deletion. Costs ~120 lines of duplicated actor-input shapes (Decision B). |
| A2 | Platina reads InstaMedia `clients` | Requires amending the `boundary.test.ts` allowlist — a constitution amendment, and the exception table is a ratchet that is supposed to only shrink. |
| A3 | Merge the two halves | Requires the signed Slice 12 transition matrix. Large, risky, not now. |

**Rationale for A1:** the boundary exists because the two products have
different tenancy models (InstaMedia: many clients per workspace; Platina: one
division per workspace). Crossing it does not merely add an import — it merges
two tenancy models, which is the A3 project in disguise.

**Naming (binding):** the new table is **`platina_brands`**, rows are "brands"
in code and **"Clients"** in the UI for `kind = "own_brand"`.
Do **not** name it `platina_subjects`: `platina_gate_events` already has
generic `subject_type` / `subject_id` columns meaning "the row this gate
decision was about", and a table called `subjects` makes
`subjectType: "subject"` nonsense.

### Decision B — social collection  *(recommended: duplicate)*

Re-express the actor input/output shapes inside `src/lib/platina/fetch/`.
~120 lines, fixture-tested. The alternative (extract a neutral
`src/lib/actors/` both sides import) is cleaner but is a boundary allowlist
change, i.e. a constitution amendment.

**Do not** copy `src/lib/connectors/apify-actors.ts` wholesale. Copy only the
input builder and the output field mapping for the three actors S3 needs.
Dead duplicated code is worse than no duplication.

### Decision C — spend control  *(recommended: two-level cap)*

`MAX_FETCHES_PER_DAY = 48` is **per spec**. With 20 specs that is 960 actor
runs/day, and after S3 each run may crawl up to 25 pages. Add:

- `platina_workspace_config.dailyActorCallCap` (default **40**), and
- page-level accounting so a 25-page crawl counts as 25, not 1.

The coordinator refuses past the cap and records `degradedReason` on the run,
so the UI can say *why* collection paused instead of going quiet.

### Decision D — AI providers  *(confirmed)*

Groq + Gemini only. Bedrock stays optional and unconfigured; AWS setup is a
parallel track (see `.github/agents/aws-models-configuration.agent.md`) and
**no slice below depends on it**.

⚠️ **Consequence agents must know:** `tier: "quality"` is documented as
`Bedrock -> Gemini Pro -> Groq`. With AWS unset, every "quality" call starts
at **Gemini Pro** (`gemini-3.1-pro-preview`). The planner
(`plan/agent.ts: generateCampaignPlan`) uses `tier: "quality"`. So a Gemini
quota exhaustion degrades the planner to Groq mid-session — silently, unless
S0's health page is showing which provider answered.

---

## 4. Target flows

### 4.1 Onboarding (the flow the owner asked for)

```
sign in (NextAuth)
   -> /org/claim         org exists?           no -> create
   -> /workspace/setup   workspace exists?     no -> create
   -> /p/[ws]/start      any platina_brands?   no -> ONBOARD (below)
                                               yes -> /p/[ws] cockpit

ONBOARD  (3 screens, no jargon)
  1. "Who are we working for?"
        name, website, instagram/tiktok/linkedin handles, region
        -> insert platina_brands { kind: "own_brand" }
  2. "Here's what we'll watch."
        deriveSources(brand)           -- pure, own-code, no network
        probeDiscovery(candidates)     -- header-only; sitemap/RSS/ETag only
        proposeCompetitors(brand)      -- routeAI, DRAFT ONLY
        -> operator edits the list
  3. "Approve."   ONE button
        insertGateEvent({ gate: "confirm", subjectType: "brand", ... })
        requireCapability(ws, user, GATE_CAPABILITY.confirm)
        insertScanSpec(...) x N  -> approveScanSpec(...) x N
        -> redirect /p/[ws]/brands/[id]   (live collection view, never empty)
```

### 4.2 Collection → insight → KB (post-S3/S4/S5)

```
coordinator(*/5)
  -> due specs (jitter-spread) -> probe.tick
       probe-capable kind? cheap conditional GET: 304 -> stop (cost 0)
                                                  200 -> changed -> run
       probe-less kind?      adaptive interval decides
       workspace cap reached? -> STOP, record degradedReason, surface in UI
  -> audit-run
       stage competitor_scan   -> Apify fetch (budgeted pages) -> signal docs + metrics
       stage brand_divergence  -> own-brand chunks vs competitor chunks -> findings
       stage ideation          -> Brain -> candidate directions w/ evidence ids
  -> signal.analyze (one event per doc, bounded concurrency)
       debate round -> agreed/qualified -> embed -> Brain chunk + finding
                    -> contested        -> finding needs_decision
                    -> refuted          -> transcript only
```

### 4.3 Plan, grounded (post-S6)

```
brief (2 lines)
  -> assemblePlanContext
       worked[] / failed[]        past plans + recorded results     (existing)
       patternEvidence[]          Plane B: brain chunks + findings  (NEW)
       baselineEvidence[]         Plane A: first-party              (NEW, empty for now)
       coldStart: boolean         inside the context, NOT a new ContextState
  -> generateCampaignPlan   (tier "quality")
  -> validatePlan           (deterministic: day ranges, 180-day cap)
  -> critiquePlan           (tier "fast", independent challenge)
  -> insertPlan + feedback
  -> roadmap UI shows each phase's evidence + collected-at date
  -> team records worked/failed -> feeds the next plan
```

---

## 5. The slices

### S0 — Make the loop observable

> **Fixes D1. Blocks everything. No owner decision needed — start here.**

**Preconditions:** none.

**Why first:** every other defect was hidden under this one. Until an agent
can *see* the loop run, all later verification is guesswork.

**Files**

| Action | Path |
|---|---|
| modify | `package.json` (scripts) |
| modify | `README.md` (a "Running the background jobs" section) |
| create | `src/app/(platina)/p/[ws]/admin/health/page.tsx` |
| create | `src/lib/platina/health.ts` + `health.test.ts` |
| create | `scripts/smoke-collect.ts` |

**Steps**

1. `package.json` scripts:
   ```json
   "dev:jobs": "npx inngest-cli@latest dev -u http://localhost:3000/api/inngest",
   "dev:all": "npm run dev & npm run dev:jobs"
   ```
   On Windows `&` does not chain — document running the two in separate
   terminals rather than shipping a broken `dev:all`. Prefer
   `concurrently` only if it is already a dependency; do not add one for this.

2. `src/lib/platina/health.ts` — pure shaping, no JSX, fully unit-testable:
   ```ts
   export type ProbeStatus = "ok" | "degraded" | "down" | "not_configured";
   export type HealthCheck = {
     id: string; label: string; status: ProbeStatus;
     detail: string;            // human sentence, never a secret
     remedy?: string;           // the exact next action
   };
   export function summarize(checks: HealthCheck[]):
     { status: ProbeStatus; blocking: HealthCheck[] };
   ```
   Checks to implement:
   - `apify_token` — **presence only**. `Boolean(process.env.APIFY_TOKEN)`.
     Never render, log, or length-report the value.
   - `model_router` — one ~1-token `routeAI` call per tier; report the
     **provider and model id that answered**. This is what catches a retired
     model id in 5 seconds instead of a week (it has already happened twice:
     `gemini-2.0-flash` and `gemini-2.5-pro` both 404'd after retirement).
   - `inngest` — most recent `platina_audit_runs.queuedAt`, or the newest
     `platina_audit_run_events.createdAt`. Older than 15 min with approved
     specs present -> `degraded`, remedy: "start the Inngest dev server".
   - `database` — round-trip ms on a trivial query.
   - `collection` — per workspace: approved specs, docs inserted today,
     findings today, actor calls today vs cap.

3. The page renders `HealthCheck[]` with the remedy text visible. Tailwind /
   shadcn only.

4. `scripts/smoke-collect.ts` — takes `--ws <id> --spec <id>`, calls
   `runApprovedScan` directly (bypassing Inngest entirely) and prints
   `fetched / inserted / failures`. This separates "Inngest is broken" from
   "Apify is broken", which is otherwise indistinguishable from the UI.

**Failure modes and what to do**

| Symptom | Cause | Action |
|---|---|---|
| Health page: router `down` on both tiers | no `GROQ_API_KEY` / `GEMINI_API_KEY` | report; do not hardcode a fallback |
| Router `degraded`, Gemini 404, message names a successor model | retired model id | update the constant in `src/lib/ai/router.ts` **only**; note the old id in the comment as the existing entries do |
| `inngest` check `down` while dev server is running | dev server pointed at the wrong port/URL | check the `-u` flag matches the Next dev port |
| smoke-collect throws `unknown signal adapter: apify` | `waters.ts` was not imported, so `registerWatersAdapter()` never ran | import it in the script, as `audit-run.ts:19` does |
| smoke-collect throws `APIFY_TOKEN is not set` | env not loaded in a bare `tsx` run | load `.env.local` explicitly in the script |

**Tests:** `health.test.ts` — every check renders each `ProbeStatus` without
throwing; `summarize` reports `down` when any blocking check is down; no check
ever puts a secret in `detail` (assert against a fixture containing a
fake token value).

**Acceptance**

```
npm test && npm run typecheck
# two terminals: npm run dev  |  npm run dev:jobs
open /p/<ws>/admin/health   -> every check green, or a remedy sentence
npx tsx scripts/smoke-collect.ts --ws <id> --spec <id>
   -> prints fetched/inserted/failures with real numbers
```

**Rollback:** delete the health route and script; revert `package.json`.
Nothing else depends on S0 code at runtime.

---

### S1 — `platina_brands`: the client/project entity

> **Fixes D7. Requires Decision A signed.**

**Preconditions:** S0 acceptance passed. Decision A = A1 confirmed in writing.

**Files:** `src/db/platina-schema.ts`, `src/db/queries/platina.ts` (+ its
`.test.ts`), `drizzle/` (generated), `src/db/platina-schema.test.ts`.

**Schema**

```ts
export const platinaBrandKind = pgEnum("platina_brand_kind",
  ["own_brand", "competitor"]);
export const platinaBrandStatus = pgEnum("platina_brand_status",
  ["active", "paused"]);

export type PlatinaBrandHandles = {
  instagram?: string; tiktok?: string; linkedin?: string; youtube?: string;
};

export const platinaBrands = pgTable("platina_brands", {
  id: id(),
  workspaceId: workspaceFk(),
  name: text("name").notNull(),
  kind: platinaBrandKind("kind").notNull().default("own_brand"),
  // A competitor belongs to the own_brand it competes with. NULL for own_brand.
  parentBrandId: text("parent_brand_id"),
  homepageUrl: text("homepage_url"),
  handles: jsonb("handles").$type<PlatinaBrandHandles>().notNull().default({}),
  region: text("region"),
  notes: text("notes"),
  status: platinaBrandStatus("status").notNull().default("active"),
  createdById: text("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
}, (table) => ({
  workspaceIdx: index("platina_brands_workspace_id_idx").on(table.workspaceId),
  parentIdx: index("platina_brands_parent_idx").on(table.parentBrandId),
  nameUnique: uniqueIndex("platina_brands_workspace_name_unique")
    .on(table.workspaceId, sql`lower(${table.name})`),
}));
```

Also: `platina_scan_specs` gains **nullable** `brand_id`. Nullable is
mandatory — existing rows have no brand and must keep working.

Register the table in `platinaWorkspaceScopedTables` or the isolation test
will not cover it. **Check that export exists and add the entry.**

**Deliberate non-decisions**
- `parentBrandId` is a plain `text`, **not** a self-FK with cascade. A
  self-referencing cascade on a table that also cascades from `workspaces`
  creates a delete path nobody has reasoned about. Enforce the relationship in
  the query layer.
- No `logoUrl`, no `industry`, no `tier`. Add a column when a slice needs it.

**Queries:** `brandsQuery(workspaceId)`, `listBrands`, `getBrand`,
`createBrand`, `updateBrand`, `listCompetitorsOf(workspaceId, parentId)`.
Each read gets the `.toSQL()` workspace-filter test.

**Failure modes**

| Symptom | Cause | Action |
|---|---|---|
| `db:generate` emits a `DROP` | drizzle diffed against stale state | **STOP.** Never apply. Report the generated SQL. Additive only. |
| Unique index fails to create | existing duplicate names | none exist yet (new table); if seen, the migration is being applied to the wrong DB |
| Isolation test doesn't cover the new table | not registered in `platinaWorkspaceScopedTables` | add it |

**Acceptance:** `npm test` green including a new test asserting a brand in
ws A is not returned for ws B; `npm run db:generate` produces an
**additive-only** migration; paste the generated SQL in the report.

---

### S2 — Auto-derive sources from a brand

> **The "add a client and we start collecting" step. Requires S1.**

**Preconditions:** S1 merged. Decision C's cap design agreed.

**Files:** `src/lib/platina/onboard/derive.ts` (+ test),
`src/lib/platina/onboard/competitors.ts` (+ test),
`src/app/(platina)/p/[ws]/start/*`, `src/app/(platina)/p/[ws]/actions.ts`.

**`derive.ts` — pure, no network, fully deterministic**

```ts
export type SourceCandidate = {
  kind: PlatinaScanTarget["kind"];
  value: string;              // absolute URL or @handle
  cadenceMinutes: number;
  reason: string;             // plain language, shown in the UI
  confidence: "certain" | "likely" | "guess";
};
export function deriveSources(input: {
  homepageUrl: string; handles: PlatinaBrandHandles;
}): SourceCandidate[];
```

Candidates: `/sitemap.xml`, `/sitemap_index.xml`, `/robots.txt`,
`/feed`, `/rss.xml`, `/atom.xml`, `/news`, `/press`, `/newsroom`, `/blog`,
plus one `social_profile` per handle. Same input -> same output, ordered
stably. **Test it as a pure function with table-driven cases.**

**Discovery probe — the legal/architectural fine print**

The constitution permits, as own code: conditional GET, ETag /
If-Modified-Since, sitemap `lastmod`, RSS/Atom — **because they retrieve no
page content**. Content retrieval remains Apify-only until the own-code web
adapter ships.

Therefore:
- ✅ Reuse `src/lib/platina/fetch/probe.ts` to check which candidates exist.
- ✅ Read a sitemap's `<loc>` / `<lastmod>` (that is the sitemap's content,
  not the page's) — *if this reading is disputed, ask the owner rather than
  assuming.*
- ❌ Do **not** fetch and parse an HTML page to discover links.
- ❌ Do **not** call `registerAdapter("web")` — the registry throws.
- ❌ Do **not** write a hostname literal on a `fetch(` line.

**`competitors.ts`**

```ts
export function buildCompetitorPrompt(brand): string;   // pure, testable
export async function proposeCompetitors(brand): Promise<CompetitorProposal[]>;
// CompetitorProposal = { name, homepageUrl, reason, confidence }
```
`tier: "fast"`, `json: true`, zod-parsed like `plan/agent.ts` does. Max 8.
**Every proposal is a draft.** Nothing is fetched until the operator approves.
A malformed model reply throws a typed error and the screen shows "we couldn't
suggest competitors — add them yourself", never an empty silent list.

**The approval gate — one action, plain language**

```
requireUser()
requireCapability(workspaceId, user.id, GATE_CAPABILITY.confirm)
insertGateEvent({ gate: "confirm", decision: "approved",
                  subjectType: "brand", subjectId: brand.id,
                  payloadHash: hashGatePayload(approvedCandidates) })
for each approved candidate: insertScanSpec(...) then approveScanSpec(...)
```

UI copy: **"We'll watch these 14 pages for Acme. Start collecting."**
Not "Gate 2 · confirm fetch". The gate machinery stays; the vocabulary goes.

**Failure modes**

| Symptom | Cause | Action |
|---|---|---|
| Every candidate probes as missing | site blocks HEAD/conditional GET, or a WAF | fall back to `confidence: "guess"` and let the operator decide; do **not** silently drop |
| Competitor proposal returns nonsense/hallucinated domains | model | it is a draft by design; the operator prunes. Never auto-approve. |
| `insertScanSpec` succeeds, `approveScanSpec` fails midway | partial approval | wrap the loop so a failure leaves specs as `draft` (harmless: `assertApproved` blocks fetching) and report how many were approved |
| Boundary test fails | you imported something outside the allowlist | redesign; do not edit the test |

**Tests:** `derive.test.ts` determinism + ordering + handle mapping;
`competitors.test.ts` prompt snapshot + zod rejection of a malformed reply;
an action test that an unapproved spec still cannot reach an adapter.

**Acceptance:** create a brand through `/p/[ws]/start`, approve, then confirm
`listScanSpecs(ws)` shows N approved specs each carrying `brandId`, and the
health page's `collection` check reflects them.

---

### S3 — Real depth, social sources, engagement metrics

> **Fixes D2 + D3. The most expensive slice — both in tokens and in money.**

**Preconditions:** S2 merged. Decision B signed. Decision C's caps implemented
*in this slice, before raising any budget*.

**Order matters. Do the caps first.** Raising crawl depth before page-level
accounting exists is how you get a surprise Apify bill.

**3a — page-level cost accounting (do this first)**

- `platina_workspace_config.dailyActorCallCap` (integer, default 40).
- Count **pages returned**, not runs, into `platina_scan_specs.fetchesToday`.
- `costCapReached` gains a workspace-level variant; the coordinator skips and
  records `degradedReason: "daily collection cap reached"` so the UI can
  explain the pause.

**3b — crawl budget**

Extend `PlatinaScanTarget`:
```ts
export type PlatinaScanTarget = {
  kind: "competitor_site" | "press_release" | "conference" | "trade_editorial"
      | "ad_library" | "social_profile" | "social_posts";
  value: string;
  adapter?: "apify";
  maxPages?: number;      // default 1; hard ceiling 25
  renderJs?: boolean;     // default false -> cheerio; true -> playwright
  seedFromSitemap?: boolean;
};
```

**Every source-kind touchpoint — update all of them or you ship a runtime
throw.** Verified list:

| File | What |
|---|---|
| `src/db/platina-schema.ts:136` | the union itself |
| `src/lib/platina/fetch/waters.ts:34` | `actorForSourceKind()` switch — **default throws** |
| `src/lib/platina/fetch/waters.ts:52` | `buildInput()` |
| `src/lib/platina/fetch/schedule.ts:30` | `PROBE_CAPABLE_KINDS` (social is **not** probe-capable) |
| `src/lib/platina/findings.ts` | `findingUseCaseForSourceKind()` |
| `src/app/(platina)/p/[ws]/audits/page.tsx:33,95,98` | `KIND_LABEL` + `<option>`s |
| `src/app/(platina)/p/[ws]/actions.ts:143` | the accepted-kind validation list |
| `src/inngest/functions/platina/scan-coordinator.ts:29` | the `?? "competitor_site"` default |
| `src/inngest/functions/platina/brand-refresh.ts:39` | hardcoded kind |

**3c — social actors** (Decision B: re-express locally, do not import
`@/lib/connectors/*`)

```
social_profile  -> apify~instagram-profile-scraper | clockworks~tiktok-profile-scraper
social_posts    -> apify~instagram-scraper        | clockworks~tiktok-scraper
ad_library      -> curious_coder~facebook-ads-library-scraper   (already mapped)
```
Pick the actor by the handle's platform, which the target `value` encodes
(e.g. `instagram:@acme`). Keep the mapping in one pure function with a test.

**3d — engagement metrics**

```ts
// additive column on platina_signal_documents — NEVER add `embedding` here
metrics: jsonb("metrics").$type<PlatinaSignalMetrics>()
export type PlatinaSignalMetrics = {
  likes?: number; comments?: number; views?: number; shares?: number;
  followers?: number; postedAt?: string;   // ISO
};
```
Normalize per platform in a **pure mapper** with fixtures under `fixtures/`.
Absent metric -> omit the key. **Never default a missing metric to 0** — zero
is a measurement, absence is not, and the min-N gate cannot tell them apart
afterwards.

**Failure modes**

| Symptom | Cause | Action |
|---|---|---|
| `no actor mapped for source kind: social_posts` | you added the enum member but not the switch case | update every touchpoint above |
| Apify returns 200 with `[]` | actor ran, matched nothing | that is a `failure` entry, **not** a document. `docs` stays empty. |
| Apify 402 / quota | credits exhausted | surface on the health page as `not_configured`/`down` with the remedy; do not retry in a loop |
| Playwright crawls cost 5–10× cheerio | `renderJs: true` | default false; require the operator to opt in per source, and show it in the UI |
| Multi-page crawl inserts 1 of 25 pages | identical `content_hash` across pages (shared shell), unique index dedupes | expected; ensure the run reports `fetched: 25, inserted: 1` so it is visible, and consider hashing main-content only |
| `platina-schema.test.ts` fails | you added an embedding column to signal documents | revert — Plane B is unembedded by construction |
| Actor returns a changed payload shape | Apify actor updated upstream | fixtures fail -> update the mapper, add the new fixture, keep the old one |

**Tests:** fixture-driven mapper tests per actor; `maxPages` ceiling enforced;
unknown kind still throws; workspace cap blocks dispatch; `metrics` absent-key
behaviour.

**Acceptance:** one real `social_posts` scan on a public handle produces
signal documents with populated `metrics`; `fetched`/`inserted` differ
visibly when dedupe fires; the cap demonstrably stops a run and the reason
appears in the UI.

---

### S4 — Throughput

> **Fixes D5. Requires S3 (there is no backlog to drain before it).**

**Files:** `src/inngest/functions/platina/contradict-sweep.ts`, a new
`signal-analyze.ts`, `src/app/api/inngest/route.ts`, `src/db/queries/platina.ts`.

**Change**

- `contradict-sweep` becomes a **dispatcher**: query unprocessed signals,
  emit one `platina/signal.analyze` event per document, stop at the workspace
  daily cap.
- New `platinaSignalAnalyze` function does the work for exactly one document
  (debate -> transcript -> finding/brain -> mark processed).
- Inngest `concurrency: { key: "event.data.workspaceId", limit: 4 }` so one
  busy workspace cannot starve the others.
- Register the new function in `src/app/api/inngest/route.ts`. **Forgetting
  this is silent** — the event fires and nothing listens.

**Ordering fix:** `listUnresolvedSignals` must order **newest first**
(`fetchedAt desc`). Today's FIFO means a backlog permanently hides the newest
signals — the exact failure described in D5.

**Idempotency:** the analyze function keys on `(workspaceId, signalId)`;
`markSignalProcessed` is the guard. A replay must be a no-op, not a duplicate
finding. Test this explicitly with a double-dispatch.

**Failure modes**

| Symptom | Cause | Action |
|---|---|---|
| Duplicate findings for one signal | retry before `markSignalProcessed` committed | mark processed in the same step as the finding insert, or add the unique key |
| AI spend spikes | fan-out unbounded | the workspace cap is the bound; assert it in a test with 200 queued signals |
| Nothing happens after dispatch | function not registered in `route.ts` | register it |
| Backlog never drains | cap too low for volume | report the numbers; the cap is an owner decision, not an agent decision |

**Acceptance:** seed 200 unprocessed signals; the dispatcher drains them under
the cap with zero duplicate findings; newest-first ordering demonstrated.

---

### S5 — Make the analysis stages real

> **Fixes D4. Requires S3 (needs competitor content to compare against).**

**Files:** `src/lib/platina/orchestrator.ts`, new
`src/lib/platina/stages/{divergence,ideation}.ts` (+ tests),
`src/inngest/functions/platina/divergence-scan.ts`.

**Change**

1. `STAGE_EXECUTORS` gains real executors for `brand_divergence` and
   `ideation`. Keep the existing **dependency-injected** shape — the
   orchestrator must stay DB-free and test-fakeable. Extend `OrchestratorDeps`
   with `runDivergenceStage` / `runIdeationStage` rather than importing queries
   into `orchestrator.ts`.
2. `brand_divergence`: own-brand Plane A/C chunks vs competitor-derived
   chunks -> findings with `useCase: "brand_divergence"`, each carrying its
   evidence chunk ids.
3. `ideation`: Brain -> candidate directions, each citing evidence ids.
4. `divergence-scan.ts` (currently a no-op counter): either make it the
   scheduled entry point for (2), or delete the Inngest function and let the
   run stages own it. **Do not leave a cron that counts rows and returns.**
   Deleting an Inngest function is a code deletion — get owner confirmation
   first (it removes no data, but the no-deletion rule is absolute).
5. Delete the `STAGE_DEFERRED_TO` entries you replaced. A stage that still
   cannot run records *why* on the run timeline.

**The status-honesty fix:** a run whose stages were all skipped must **not**
report `completed`. Map it to `degraded` with a reason. This is a behaviour
change — call it out in the PR.

**Failure modes**

| Symptom | Cause | Action |
|---|---|---|
| Stage throws -> run says `completed` | error swallowed | a throwing stage marks the run `degraded`, never silently completed |
| Divergence findings with no evidence ids | prompt not returning citations | validate with zod; reject and mark degraded rather than storing an uncited finding |
| `orchestrator.test.ts` needs a DB | you imported queries into the orchestrator | inject via `OrchestratorDeps` instead |
| Objection rate alarm fires | challenger objecting to everything | that is R5.1 working as designed — report, do not tune the prompt to silence it |

**Acceptance:** a run with the default 3-stage sequence executes all three;
the timeline shows real counters per stage; a forced stage failure produces
`degraded` with a reason.

---

### S6 — Connect the KB to the planner

> **Fixes D6. The payoff slice. Requires S5.**

**Files:** `src/lib/platina/plan/context.ts` (+ test),
`src/lib/platina/plan/agent.ts` (+ test),
`src/app/(platina)/p/[ws]/plan/[planId]/page.tsx`.

**Context**

```ts
export type PlanEvidence = {
  id: string;
  plane: "A" | "B";
  content: string;
  sourceUrl: string | null;
  collectedAt: Date | null;
  confidence: number | null;
};
export type PlanContext = {
  brief: string;
  worked: PlanLesson[];
  failed: PlanLesson[];
  patternEvidence: PlanEvidence[];    // Plane B — public/Apify derived
  baselineEvidence: PlanEvidence[];   // Plane A — first-party; empty for now
  coldStart: boolean;                 // inside the context, NOT a ContextState
};
```

⚠️ **`ContextState` is a closed union. Do not add `cold_start` to it.** Cold
start is `context_available` with `coldStart: true` and empty arrays.
`insufficient_relevance` is reserved for retrieval below `similarityFloor`
(default 0.35, per-workspace in `platina_workspace_config`).

Retrieve through the **existing** path — `retrieve.ts: retrieveBuckets`,
`rerank.ts: rerankCandidates`, `retrieval.ts: relevanceGate / minNGate`.
Do not write a second retrieval implementation.

Update `logContextAssembly` sections to include
`patternEvidence` / `baselineEvidence` counts, so a run's context is
reconstructable from logs.

**The two-layer rule, enforced in code**

`buildPlanPrompt` renders the two planes as **separate labelled blocks** and
instructs: *each phase's rationale cites evidence ids from one plane only.*

```ts
// plan/agent.test.ts — the test that matters most in this slice
it("never mixes plane A and plane B evidence in one rationale block", () => {
  const prompt = buildPlanPrompt(contextWithBothPlanes);
  const blocks = extractRationaleBlocks(prompt);
  for (const b of blocks) {
    expect(hasPlaneA(b) && hasPlaneB(b)).toBe(false);
  }
});
```

Because the planner uses `tier: "quality"` and AWS is unset, this path runs on
Gemini Pro with a Groq fallback (Decision D). A fallback that changes provider
mid-plan is acceptable; a fallback that silently drops evidence is not —
assert the prompt is unchanged across providers.

**Roadmap UI:** each phase lists its evidence with source link and
collected-at date. Evidence older than the workspace's staleness threshold is
labelled stale, not hidden (degradation ladder: flag it, don't silently serve
stale data).

**Failure modes**

| Symptom | Cause | Action |
|---|---|---|
| Plan cites evidence that doesn't exist | model invented ids | validate ids against the context in `validatePlan`; invalid ids -> `invalid_proposal`. `findInvalidCitationIds` already exists — reuse it. |
| Every plan is `insufficient_relevance` | `similarityFloor` too high, or the Brain is empty | check Brain chunk count first; an empty Brain is an S3/S4 problem, not a floor problem |
| Prompt exceeds context window | too many evidence chunks | cap top-k (start at 6 per plane) and rerank; never truncate mid-chunk |
| Plane-mixing test fails | prompt template restructured | **do not weaken the test** — fix the template |
| Cold-start plans look identical to grounded ones | `coldStart` not surfaced | the UI must label a cold plan as a cold plan |

**Acceptance:** with a populated Brain, a plan's phases cite real evidence ids
that resolve to real chunks with real source URLs; with an empty Brain, the
plan renders and is visibly labelled cold-start; the plane-mixing test passes.

---

### S7 — UX rebuild of the spine

> **Fixes D8. Can run in parallel from S2 onward.**

**Screens**

| Route | Purpose |
|---|---|
| `/p/[ws]/start` | 3-step onboarding (§4.1). Ends on a live view, never an empty page. |
| `/p/[ws]/brands` | the client/brand roster, own brands with their competitors nested |
| `/p/[ws]/brands/[id]` | per brand: sources watched, last change, what we learned, cost today |
| `/p/[ws]` (cockpit) | above the fold: is collection running · what changed in 24h · what needs a decision · what plan is live |

**Copy pass — mandatory, mechanical**

Remove every build vocabulary string from user-facing text. Known offenders:
`eyebrow="S3–S5 · gate 2"` and `Gate 2 · confirm fetch`
(`src/app/(platina)/p/[ws]/scans/page.tsx`), and the stale
"Ingestion, Brand DNA, and the studio come online in the next slices"
(`src/app/(app)/workspace/ready/page.tsx`).

```bash
# find the rest — expect false positives in comments, which are fine
grep -rn "Slice [0-9]\|gate [0-9]\|Gate [0-9]\|S[0-9]–S[0-9]" \
  "src/app/(platina)" src/components/platina --include=*.tsx
```

Gate vocabulary stays in the **schema, capabilities and comments**. It leaves
the **screen**.

**Other requirements**

- Every empty list states the single next action and links to it.
- A degradation banner component for the constitution's ladder (provider
  swapped, connector down, KB stale). Silence is the bug.
- Entry point: post-login and `workspace/ready` route to `/p/[ws]/start` when
  the workspace has no brands. `/w/*` stays **fully reachable and unchanged**,
  linked as the add-on workspace, not as a second front door.
- Tailwind / shadcn only. `style={}` only for genuinely dynamic values
  (progress widths, data-driven swatches) — the constitution's carve-out.
- Reuse `src/components/platina/*`: `page.tsx`, `header.tsx`, `sidebar.tsx`,
  `form-error.tsx`, `pending-button.tsx`, `live-status.tsx`,
  `plan-timeline.tsx`, `use-platina-realtime.ts`. Do not fork them.

**Failure modes**

| Symptom | Cause | Action |
|---|---|---|
| Live status pill claims "live" with no transport | `PLATINA_REALTIME_SECRET` unset -> 20s polling fallback | the pill must report the **real** transport, never an optimistic claim |
| `/w` routes break | you changed shared components | `/w` is untouched in this slice; revert |
| Nav loses a page | you removed a route from `PLATINA_NAV` | legacy routes stay reachable by URL until their transition slice — removal needs the signed Slice 12 matrix |

**Acceptance:** a brand-new account reaches "collection is running for my
client" without reading documentation or typing a URL. Paste the click path.

---

### S8 — Add-ons (explicitly out of scope)

SOP, content calendar, studio, tickets, hub, reports. Each becomes a consumer
of the spine **after S6 proves the loop**. Do not start any of them. If asked
to "just wire up the calendar too", decline and point here.

---

## 6. Cross-cutting failure playbook

### 6.1 "Nothing is happening"

Diagnose in this order. Each step eliminates a layer.

```
1. Is the Inngest dev server running?        -> health page `inngest` check
2. Are there approved specs?                 -> listScanSpecs(ws), status
3. Is the spec due?                          -> isDue(); check lastProbeAt
4. Is the cost cap hit?                      -> costCapReached(); fetchesToday
5. Did the probe say "unchanged"?            -> 304 means working, not broken
6. Does the adapter resolve?                 -> "unknown signal adapter: apify"
                                                = waters.ts never imported
7. Is APIFY_TOKEN set?                       -> "APIFY_TOKEN is not set"
8. Does Apify itself work?                   -> scripts/smoke-collect.ts
```

A 304 at step 5 is **success**: the cheap probe did its job and saved a paid
fetch. Do not "fix" it by forcing fetches.

### 6.2 Provider failures

| Failure | Detection | Correct response |
|---|---|---|
| Groq 404 on model id | `AIRouterError` status 404, provider groq | update `GROQ_MODEL`; the router already falls through to Gemini on a 404 |
| Gemini model retired | 404, message names the successor | update the constant; keep the retired id in the comment (see the two existing precedents) |
| Rate limit / 429 | router logs a zero-cost failure row then falls back | **this is the degradation ladder working**. Do not add a retry loop on top. |
| Both providers down | health page both `down` | fail loudly; never serve a fabricated plan |
| Daily cost cap hit (`AI_DAILY_COST_CAP_USD`) | router refuses | surface it; do not raise the cap in code |

### 6.3 Migration failures

- `db:generate` producing a `DROP` -> **STOP**, do not apply, report the SQL.
- A migration must be additive: new table, new nullable column, new index.
- Never `NOT NULL` without a default on a populated table.
- Supabase transaction pooler (port 6543) is in use with `prepare: false`.
  Some DDL behaves differently there; if a migration hangs, report rather than
  killing it mid-apply.

### 6.4 Boundary / constitution failures

| Failure | Meaning | Action |
|---|---|---|
| `no forbidden InstaMedia module is imported` fails | you imported across the boundary | redesign. Duplicate the shape (Decision B) or ask for an amendment. |
| `every internal import is allowlisted` fails | new `@/` module not on the list | if it is genuinely neutral infra, that is an owner decision — ask |
| `the exception table does not grow` fails | you added an exception | remove it. The table is a ratchet. |
| `no external call targets except the Apify platform API` fails | hostname literal near a `fetch(` | pass the URL as a variable |
| archived-bridge string scan fails | you wrote `sop_run_id` / `hub_message` / `kind: "ticket"` / `kind: "email"` | those are archived: never read, never written, never executed |

### 6.5 Contradictions inside the plan itself — resolved

These are places where two requirements pull against each other. The
resolution is binding; do not re-litigate it in code.

| Tension | Resolution |
|---|---|
| "Real-time data pooling" vs. cost caps | Caps win. Freshness comes from *cheap probes*, not frequent paid fetches. An honest "paused: daily cap reached" beats a surprise bill. |
| "Scrape everything" vs. Apify-only constitution | Apify-only wins until the own-code adapter ships. Header-only change probes are the sole own-code exception. |
| "One unified product" vs. the module boundary | Boundary wins (Decision A1). The spine is built Platina-side; `/w` stays live and untouched. |
| Rich AI insight vs. "no agent spawns an agent" | Fixed pipelines only: orchestrator stages and the propose/validate/critique triad. No dynamic agent trees. |
| Show impressive numbers vs. the min-N gate | Min-N wins. "Insufficient baseline" is a feature; a fabricated score is a defect. |
| Ship the UI fast vs. no inline styles | Tailwind/shadcn only, with the dynamic-value carve-out. |
| Planner needs everything vs. never mix planes | Two separate arrays, one plane per rationale, enforced by test. |
| Delete the stubs vs. never delete | Replacing a stub's *body* is fine. Removing a route/table/function needs the signed Slice 12 matrix. |

---

## 7. Practical configuration reference

### 7.1 Local development

```bash
cp .env.example .env.local   # then fill in — never commit .env.local
npm install
npm run db:migrate
# terminal 1
npm run dev
# terminal 2  (WITHOUT THIS, NOTHING SCHEDULED RUNS)
npm run dev:jobs
```

Required for the core spine to function at all: `DATABASE_URL`, `AUTH_SECRET`,
`GROQ_API_KEY`, `GEMINI_API_KEY`, `APIFY_TOKEN`, `INNGEST_DEV=1`.

Optional: `PLATINA_REALTIME_SECRET` (absent -> live updates degrade to 20s
polling, which is a supported state, not a failure);
`AI_DAILY_COST_CAP_USD`; `AUTH_DEV_BYPASS` (**never** in production — it signs
everyone in as one fixed dev identity and is additionally guarded by
`NODE_ENV !== "production"`).

Not required, do not configure for these slices: `AWS_*`, `BEDROCK_MODEL_ID`,
`META_CONNECTOR_ENABLED`.

### 7.2 Production (Vercel Pro)

- Remove `INNGEST_DEV`; set `INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY`, and
  sync the app so crons register. **A function missing from
  `src/app/api/inngest/route.ts` silently never runs** — that file is the
  registration list, not documentation.
- Use the Supabase **transaction pooler** (6543) with `prepare: false`.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only; it must never carry a
  `NEXT_PUBLIC_` prefix.

### 7.3 Cadence and cost tuning

| Knob | Where | Default | Guidance |
|---|---|---|---|
| probe cadence | `platina_scan_specs.cadenceMinutes` | 5 | fine — probes are nearly free |
| adaptive start | `ADAPTIVE_START_MINUTES` | 360 | probe-less kinds only |
| adaptive ceiling | `ADAPTIVE_MAX_MINUTES` | 1440 | |
| per-spec daily fetches | `MAX_FETCHES_PER_DAY` | 48 | **per spec**, not per workspace |
| per-workspace daily cap | `dailyActorCallCap` (S3) | 40 | the real spend control |
| crawl pages | `PlatinaScanTarget.maxPages` (S3) | 1, ceiling 25 | each page is billable |
| JS rendering | `renderJs` (S3) | false | playwright is 5–10× cheerio; opt-in per source |
| min baseline N | `platina_workspace_config.minBaselineN` | 20 | do not lower to make a demo look better |
| similarity floor | `similarityFloor` | 0.35 | raise if retrieval returns noise |
| contested/qualified | `contestedFloor` 0.4 / `qualifiedFloor` 0.7 | | tune only with evidence from transcripts |

### 7.4 AI tiers

| Tier | Ladder | Used by |
|---|---|---|
| `fast` | Groq (`openai/gpt-oss-120b`) -> Gemini Flash (`gemini-3.6-flash`) | debate, critic, competitor proposals |
| `quality` | Bedrock -> Gemini Pro (`gemini-3.1-pro-preview`) -> Groq | planner, divergence |
| embed | `gemini-embedding-001` | Brain chunks, brand chunks |

With AWS unset, `quality` starts at Gemini Pro. Bumping the embedding model
requires a full re-embed backfill (`PLATINA_EMBEDDING_MODEL_VERSION`); mixed
versions in one index are meaningless.

---

## 8. Definition of done — every slice

```
[ ] Preconditions verified and stated in the report
[ ] Diff plan was posted and approved before building
[ ] npm test green            (new tests fail before the change, pass after)
[ ] npm run typecheck green
[ ] npm run lint green
[ ] boundary.test.ts green, exception table still empty
[ ] platina-schema.test.ts green (workspace_id, plane invariants)
[ ] every new query builder has a .toSQL() workspace-filter test
[ ] migration is additive only; generated SQL pasted in the report
[ ] no new user-facing build vocabulary (Slice N / Gate N / S3–S5)
[ ] no fabricated number renders below minBaselineN
[ ] acceptance commands run, real output pasted
[ ] assumptions and anything NOT done stated explicitly
```

## 9. Sequencing

```
S0 ──► S1 ──► S2 ──► S3 ──► S4 ──► S5 ──► S6
                │
                └──────────► S7 (UI, parallel from here)

S0  unblocked, start now
S1  needs Decision A
S3  needs Decision B + Decision C implemented first
S6  the payoff — the planner finally sees what was collected
S8  not now
```

If you are an agent picking this up cold: **start at S0**, and do not skip the
"paste real output" step. Every defect in §2 survived this long because
something silently did nothing and no one could see it.
