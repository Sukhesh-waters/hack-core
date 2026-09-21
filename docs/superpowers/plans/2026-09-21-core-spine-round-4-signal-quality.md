# Core Spine — Round 4: from "the loop runs" to "the output is worth reading"

**Created:** 2026-09-21
**Audience:** implementing agents (Sonnet), one slice per agent, one slice per PR.
**Authority:** `CLAUDE.md` (the constitution) outranks this document. If they
disagree, the constitution wins — you stop and report the conflict, you do not
resolve it yourself.
**Companion docs (read before starting any slice):**
- `docs/superpowers/specs/2026-09-20-core-spine-design.md` — round-3 diagnosis (D1–D7), slices S0–S8.
- `docs/superpowers/plans/2026-09-20-core-spine-build-plan.md` — **§0 working protocol, §1 ground-truth contracts, §6 failure playbook. §0.1 and §0.2 apply verbatim here and are not repeated.**
- `docs/superpowers/manual-test-plan.md` — the owner's click-through path.

---

---

## Status — updated 2026-09-21, end of the Opus build session

Slices **R0 (router failover), R1, R2, R3, R4, R6, R7, R8 are built, tested and
green.** Uncommitted. Migrations **0074–0077 generated and applied**.

```
npm test        2192 passed | 10 skipped (238 files)      baseline was 2057
npm run typecheck   clean
npm run lint        clean
npm run build       clean
npx tsx scripts/verify-spine.ts   runs, and caught 2 real defects on first use
```

| Slice | State | Note |
|---|---|---|
| **R0** provider failover *(added by owner request)* | done | Any provider error → next LLM. `buildLadder` + `providerHealth` cooldown + 60s timeouts + aggregate error naming every rung. |
| **R1** signal triage | done | `signal-value.ts`, `change-diff.ts`, `getPreviousSignalDocument`, index 0074. |
| **R2** subject-aware analysis | done | `analysis-input.ts`, `analysis-plan.ts`, `finding-title.ts`, new prompts, `skip_reason` 0075. |
| **R3** client-scoped stages | done | `stages/scope.ts`, scoped `wire.ts`, `brand-standard.ts`, confirm action + UI, 0076. |
| **R4** engagement readable | done | `engagement.ts`, `listEngagementDocsForBrands`, client-page strip with min-N gate. |
| **R5** social actors live | **done — live-verified** | Four real Apify runs (NASA, 3 items each). **Every field name the mapper reads is present and correct.** Dated fixtures + 10 regression tests in `actors.live.test.ts`. Live finding: `clockworks~tiktok-profile-scraper` returns video items, not a profile object — so TikTok's `social_profile` and `social_posts` yield the same shape, and followers ride along on every post. |
| **R9** deep scraping + campaign research *(added 2026-09-21)* | done | **Render escalation:** a crawl that comes back as a JavaScript shell is retried once with the headless-browser crawler, the decision is remembered on the source, and it is reported as a run *note* — never as a failure. **Ad research:** onboarding now derives the competitor's public ad library (what they are paying to say, not just what their site claims), unprobed and unticked so it is never a surprise spend. |
| **R6** realtime honesty | done | **Diagnosed live: Realtime works** (SUBSCRIBED, REST broadcast 202). The bug was a duplicate channel join per topic. Fixed with a shared channel + tested state machine. |
| **R7** budgets compose | done | `fetch/budget.ts` owns every spend number with composition assertions; per-client first-pass allowance (0077). |
| **R8** verification harness | done | `scripts/verify-spine.ts`, read-only, exit 1 on failure. |

### Live findings from this session (do not re-derive)

1. **`gemini-3.6-flash` is not on this key's model list at all.** Google answers
   it with a free-tier 429, which reads exactly like an exhausted quota — so
   every Gemini call failed, every debate fell back to Groq, and the validation
   layer was never independent. `gemini-2.5-flash` (200 in 1.6s) and
   `gemini-flash-latest` (200 in 4.3s) both work on this key. The router now
   holds an ordered **candidate list** instead of one id, because this class of
   failure has now hit this codebase three times. `npx tsx scripts/verify-providers.ts`
   answers it in five seconds.
2. **Realtime was never broken.** A direct probe SUBSCRIBEs and the REST
   broadcast returns 202. The permanent "Reconnecting" was the hook joining the
   same topic twice.
3. **The social mapper's field names are right.** Live-confirmed against four
   actors: `likesCount`/`commentsCount`/`videoViewCount`/`timestamp` on
   Instagram, `diggCount`/`commentCount`/`playCount`/`shareCount`/
   `createTimeISO`/`authorMeta.fans` on TikTok.

**Still required:** the live end-to-end verification of §6 with a real client
and real competitors (spends Apify credits). Everything above is proven by unit
tests, a clean build, and the targeted live probes named here — not by a full
pass through the real forms.

---

## 0. Read this first

### 0.1 What round 3 achieved, re-verified today

Round 3 (S0–S7) fixed the reasons the product *did nothing*. On the
uncommitted working tree, 2026-09-21:

```
npm test  ->  Test Files  228 passed | 5 skipped (233)
              Tests      2057 passed | 10 skipped (2067)      exit 0
```

The loop is live: `npm run dev:all` starts app + job runner; approval starts a
first pass immediately; sources report live status; a client profile appears
~12s after approval; analysis is paced, reclaims stale claims and retries; the
debate falls back to Groq and records the fallback honestly.

**Round 4 is not about making it run. It runs.** It is about what it produces:
generic findings, engagement numbers nobody reads, stages that can never fire
for a client onboarded the way the product tells you to onboard one, and a
transport that has never once said "Live".

### 0.2 The sentence that defines done

> An operator pastes a client URL and three competitor URLs, and within one
> working session the product tells them **something they did not already
> know**, attributed to a **named competitor**, **dated**, and specific enough
> to act on — and the campaign planner **cites that same thing**.

Judge every slice against that sentence. A slice that goes green without moving
it is not done.

### 0.3 Round-4 additions to the working protocol

On top of build-plan §0.1 (READ → VERIFY → PLAN → BUILD → TEST → VERIFY →
REPORT):

1. **A live verification, not only unit tests.** §6 defines the harness. Paste
   real output with real timings. Round 3 proved a fully green suite coexists
   happily with a pipeline that files "Contact sales" as a market finding.
2. **A cost line in every report.** Apify pages spent, model calls spent. The
   free Apify plan and a 20-request/day Gemini key are the real constraints.
3. **A throwaway workspace.** Never verify inside `internal-sales`. Create,
   verify, delete (§6.1).
4. **A before/after quality sample** for any slice touching analysis output:
   one finding produced before your change, the matching one after. That is the
   only evidence that "quality" moved.

### 0.4 Hard rules specific to this round

| Rule | Why |
|---|---|
| **No schema drops, no column removals, no file deletions.** Additive migrations only. | Deletion requires the owner-signed Slice 12 transition matrix. Nothing here is signed. |
| **Do not edit `src/lib/platina/boundary.test.ts`.** | It is the module boundary. A failing boundary test means your design is wrong. |
| **Do not import `@/lib/connectors/*` into Platina.** | Decision B stands: re-express shapes locally under `src/lib/platina/fetch/`. |
| **Do not raise `DAILY_ANALYSIS_CAP`, `MAX_FETCHES_PER_DAY` or `dailyActorCallCap` to make a verification pass.** | Owner spend decisions (§3). Report the ceiling you hit; never move it. |
| **A filtered-out or skipped document is recorded with a reason and stays visible.** | Silence is the defect class this project keeps re-learning. |
| **Never claim a transport, provider or result you have not seen respond.** | Q7 exists because a pill said "Reconnecting" for a whole session and nobody could say why. |
| **Plane A and Plane B never mixed in one rationale.** | Constitution. `plan/agent.ts` has the test; keep it green when you touch prompts. |

---

## 1. Ground truth — the pipeline on 2026-09-21

Read from the files today. Do not re-derive.

```
cron */5   scan-coordinator.ts
             listSchedulableSpecs()                    all workspaces, approved+enabled
             listStaleQueuedRuns(now-2m) -> re-send    (round 3: survives a dead job runner)
             isDue(spec, probeCapable)   -> "platina/probe.tick"
                 |
                 v
           probe-tick.ts
             header-only conditional GET (ETag / Last-Modified) — own code, no content
             costCapReached(spec)                      48 pages/spec/UTC day
             -> createAuditRun -> "platina/audit-run.requested"
                 |
                 v
           audit-run.ts            concurrency: { limit: 2 }     <- round 3 fix for Apify 402
             executeAuditRun(deps, ws, runId)          orchestrator.ts state machine
               competitor_scan -> runFetchStage
                  pageBudget = min(specPagesRemaining 48, workspacePagesRemaining cap 40)
                  runApprovedScan -> waters.ts -> Apify run-sync-get-dataset-items
                  insertSignalDocuments()              unique (scan_spec_id, content_hash)
                  own_brand spec -> "platina/client.profile.requested"
               brand_divergence -> divergenceStage(ws)           <- Q5/Q6 workspace-wide, always skips
               ideation         -> ideationStage(ws)             <- Q5 workspace-wide
             -> "platina/contradict.requested"
                 |
                 v
           contradict-sweep.ts     dispatcher only
             analysisBatchSize(analysedToday, cap 100, batch 50)
             -> one "platina/signal.analyze" per unprocessed doc
                 |
                 v
           signal-analyze.ts       throttle 8/min, global concurrency 2, per-ws 4
             claimSignal (atomic unprocessed->processing, 10-min stale reclaim)
             own_brand page? -> markSignalProcessed ("used for its profile")
             runContradictionRound(`${title}\n${body}`)          <- Q1 no subject, no change
             insertTranscript -> findingPathFor(state)
               agreed|qualified -> embedText -> insertBrainChunk + insertFinding("new")
               contested        -> insertFinding("needs_decision")
               refuted          -> transcript only
             markSignalProcessed
                 |
                 v
           plan/context.ts         assemblePlanContext
             retrievePatternEvidence: vector + lexical -> RRF -> relevance floor -> rerank
             scoped to a client via listSignalIdsForBrands()     works (round 3)
             clientProfile as context, never citable             correct — keep it that way
```

**Proven end-to-end:** collection, dedupe, client profile, analysis dispatch,
debate + honest fallback, findings, Brain chunks, retrieval, client-scoped
planning, re-plan on new evidence, caps, health page.

**Not proven / not built:** everything in §2.

---

## 2. Round-4 defects (Q1–Q10)

Evidence read on 2026-09-21. Each states the real-world consequence and the
slice that fixes it.

### Q1 — The analysis has no subject. *(→ R2)*

`src/inngest/functions/platina/signal-analyze.ts:81` passes
`` `${signal.title ?? ""}\n${signal.body}` `` into `runContradictionRound`. The
proposer system prompt (`src/lib/platina/debate.ts:49-51`) is *"You propose a
single market driver from public signal."*

The model never learns **which competitor** the page belongs to, **which
client** it competes with, **what kind of source** it is, or **whether anything
changed**. An anonymous wall of text, asked for a market driver. Generic in,
generic out — this is the mechanical cause of "competitor findings are still
generic", not a prompt-polish detail.

Worse at write time: `signal-analyze.ts:139` sets the finding title to
`signal.title` — the HTML `<title>`. That is why the findings list reads like a
sitemap ("Contact sales", "Pricing", "About us") rather than intelligence.

### Q2 — Every page is analysed, including boilerplate. *(→ R1)*

`src/lib/platina/fetch/waters.ts:98` accepts any document with a non-empty
body. `insertSignalDocuments` (`src/db/queries/platina.ts:284-317`) dedupes
only on `(scan_spec_id, content_hash)`. Nothing asks *is this page worth two
model calls?*

Consequence: a cookie banner, a careers page and a contact form each consume a
debate (2 model calls) plus an embed, push the 100/day analysis cap, burn the
20/day Gemini quota, and leave a generic finding behind. On a 25-page crawl of a
typical SaaS site, roughly half the pages are navigation-and-legal noise.

### Q3 — Change is collected but never diffed. *(→ R1 + R2)*

The most valuable competitor signal is *"this page changed, and here is what
changed"*. The pipeline already detects it: `probe-tick` fires on
ETag/Last-Modified change, and the `(scan_spec_id, content_hash)` unique index
means a changed page inserts a **new row while the previous row survives**.

Nothing compares them. `signal-analyze` reads only the new body. The product
knows a page changed and discards *what* changed.

No index supports the lookup either: `platina_signal_documents`
(`src/db/platina-schema.ts:280-310`) indexes `workspace_id` plus the
`(scan_spec_id, content_hash)` unique pair — no `canonical_url`.

### Q4 — Engagement metrics are write-only. *(→ R4)*

`metrics jsonb` is defined (`src/db/platina-schema.ts:297`), mapped per platform
with fixture tests (`src/lib/platina/fetch/actors.ts:183-260`), written
(`src/db/queries/platina.ts:305`) — and read nowhere:

```
grep -rn "metrics" src/lib/platina src/app/(platina) --include=*.ts --include=*.tsx
  -> actors.ts (writer), registry.ts (type), plan/agent.ts (a prompt saying "do not invent metrics")
```

Not the debate, not the finding, not the Brain chunk, not the planner, not one
page. The owner's explicit ask — *"posts / impressions analysis"* — is stored
and dropped on the floor.

### Q5 — Analysis stages are workspace-wide, not client-scoped. *(→ R3)*

`src/lib/platina/stages/wire.ts:36-38` loads `listRecentBrandEvidence(ws, 10)`
and `listRecentBrainEvidence(ws, 10)` with **no brand filter**;
`src/inngest/functions/platina/audit-run.ts:123-124` calls `divergenceStage(ws)`
/ `ideationStage(ws)`.

In a workspace with two clients, client A's brand standard is compared against
client B's competitors, and ideation proposes from a pool mixing both. Not a
cross-workspace leak — isolation holds — but a correctness bug that worsens with
every client added, i.e. with every unit of the product's success.

### Q6 — Divergence can never fire for a client onboarded through `/start`. *(→ R3)*

`src/lib/platina/stages/divergence.ts:49-51` returns
`skipped: "no declared brand standard yet"` when `platina_brand_chunks` is empty
for the workspace. Brand chunks are written by exactly two paths:
`/p/[ws]/actions.ts` (manual paste) and `brand-refresh.ts` (approved brand
sources).

The `/start` flow writes neither — it produces a `ClientProfile`
(`src/lib/platina/profile.ts`), which divergence does not read. So the S5 stage
round 3 built and tested **never runs for any client created the way the product
tells you to create one**. The most complete piece of dead machinery in the
spine.

### Q7 — The realtime transport has never reported "Live". *(→ R6)*

`src/components/platina/use-platina-realtime.ts:66-71` sets `live` only on
`SUBSCRIBED`, `reconnecting` on `CHANNEL_ERROR` / `TIMED_OUT`. The previous
session saw "Reconnecting" throughout and never diagnosed it.

Environment is not the cause — `.env.local` has `PLATINA_REALTIME_SECRET`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. So the
channel is being refused: publishable-key format rejected by realtime-js,
Realtime disabled on the project, or the project requires a private/authorised
channel. The 20s poll covers correctness, so this is honesty and latency, not
data loss — but a permanent "Reconnecting" is a lie in the header, and the
owner's use case is explicitly real-time.

### Q8 — The social path has never met a live actor. *(→ R5)*

`src/lib/platina/fetch/actors.ts:8-11` says so outright. `mapSocialItem` reads
`likesCount`, `commentsCount`, `videoViewCount ?? videoPlayCount`, `diggCount`,
`playCount`, `shareCount`, `authorMeta.fans`, `createTimeISO`.

If any name is wrong the failure mode is the worst available: `pickMetrics`
silently drops the field (only finite numbers ≥ 0 survive), so posts arrive with
**no metrics and no error**. Fixtures cannot catch this; one real run per
platform can.

### Q9 — The challenger is structurally pinned to a 20/day quota. *(→ R7)*

`src/lib/platina/debate.ts:47` pins the proposer to `groq`; `:69` tries `gemini`
for the challenge and falls back to `groq` on a Gemini `AIRouterError`. Round
3's fallback is correct and honest (`downgradeIfNotIndependent`,
`SAME_PROVIDER_CAVEAT`, never "agreed").

But this key answers 20 Gemini requests **per day**. After 20 debates every
subsequent round is same-provider, permanently "qualified, not independent". The
validation layer — what makes a finding trustworthy — is off by default for any
real workload. Owner decision O1.

### Q10 — The budget does not fit a real client. *(→ R7)*

| Knob | Value | Where |
|---|---|---|
| Pages per source per UTC day | 48 | `src/lib/platina/fetch/schedule.ts:13` |
| Pages per **workspace** per UTC day | 40 (default) | `src/inngest/functions/platina/audit-run.ts:84` |
| Analyses per workspace per UTC day | 100 | `src/lib/platina/analysis.ts:8` |
| Max pages per crawl target | 25 | `src/lib/platina/fetch/actors.ts:21` |

The workspace cap (40) is **lower than one source's cap** (48) and lower than two
targets at full depth (50). A realistic first pass — one client plus four
competitors at 25 pages — wants 125 pages and gets 40, so the product's first
impression takes three days. Meanwhile the analysis cap (100) is unreachable,
because collection can only ever produce 40 documents a day. The numbers were
set independently and do not compose.

---

## 3. Owner decisions required (agents: do not decide these)

| # | Decision | Blocks | Recommendation |
|---|---|---|---|
| **O1** | Enable billing on the Gemini key, or accept same-provider validation as the norm. | R7 acceptance | Enable billing. Independent challenge is the product's credibility claim; 20/day makes it decorative. |
| **O2** | First-pass page allowance: a one-time per-client onboarding budget (proposed default 150 pages) separate from the steady-state daily cap, both visible in the UI. | R7 | Approve. Without it the first impression takes days. |
| **O3** | Does a `ClientProfile` count as the "declared brand standard" for divergence, or must the operator confirm it once first? | R3 | Operator confirms once. Text derived from a client's own site becoming an unreviewed Plane A standard blurs the two-layer rule. One confirmation screen, then it is a standard. |
| **O4** | Delete or disable the 5 stale "Live verification" sources in `internal-sales` (Agilent ×3, example.com ×2, all enabled). | any live run in that workspace | Delete. They spend Apify credits the moment the job runner starts. |
| **O5** | `CLAUDE.md` still calls the planner *"a feedback loop … not retrieval"*. Since S6 it **is** retrieval over the workspace's own Brain. | nothing technically — a standing contradiction agents keep tripping over | Amend the line. |

If your slice's acceptance depends on an unsigned decision: build to the
recommendation **behind a config value with the conservative default**, say so
in your report, and never change a cap to make your own verification pass.

---

## 4. The slices

Dependency order. Each is one vertical slice, one PR, tests + live verification.
R1 → R2 → R3/R4 are the value chain; R5, R6, R7 are independent and can run in
parallel; R8 closes the round.

---

### R1 — Signal triage: page value + change diff *(pure lib + one additive index)*

**Fixes:** Q2, and the data half of Q3.
**No AI in this slice.** Pure functions and one query. That is why it is first:
it is cheap, it is fully unit-testable, and it halves the cost of everything
after it.

**Preconditions**
- `npm test` green on your branch point.
- You have read `waters.ts`, `queries/platina.ts:284-317`, `platina-schema.ts:280-310`.

**Contract — new file `src/lib/platina/signal-value.ts` (pure, no IO, no clock)**

```ts
export type SignalValueVerdict = {
  worthAnalysing: boolean;
  /** Plain-language, shown in the UI. Never empty when worthAnalysing is false. */
  reason: string;
  /** 0..1, for ordering the analysis queue. */
  score: number;
};

export function scoreSignal(input: {
  url: string;
  title: string | null;
  body: string;
  sourceKind: string | null;
  metricsPresent: boolean;
}): SignalValueVerdict;
```

Rules, each its own test:
- **Boilerplate paths** (`/privacy`, `/terms`, `/cookie*`, `/legal`, `/careers`,
  `/jobs`, `/login`, `/signin`, `/cart`, `/checkout`, `/contact`, `/support`,
  `/sitemap*`, `/rss*`) → not worth analysing, reason names the path class.
  Match on the **path**, never on a substring of the whole URL (a competitor
  named "Contact Ltd" must not be filtered).
- **Too thin**: under 400 characters of prose after whitespace collapse → not
  worth analysing ("too little text to draw anything from").
- **Navigation-dominant**: more than 60% of lines under 40 characters → not
  worth analysing ("looks like navigation, not content").
- **Social documents are never filtered by length** — a caption with metrics is
  a real signal (`metricsPresent === true` bypasses the thin-text rule).
- Everything else → worth analysing, score rising with prose length, presence of
  numbers/dates/currency, and `sourceKind` (`press_release` > `competitor_site` > other).
- **Deterministic**: same input, same verdict. No `Date.now()`, no randomness.

**Contract — new query in `src/db/queries/platina.ts`**

```ts
/** The most recent PROCESSED document for the same canonical URL before this one. */
export async function getPreviousSignalDocument(
  workspaceId: string,
  canonicalUrl: string,
  beforeFetchedAt: Date,
): Promise<{ id: string; title: string | null; body: string; fetchedAt: Date } | null>;
```
Follow the query-test convention exactly (build-plan §1.4): the generated SQL
must be asserted to contain the `workspace_id` filter.

**Contract — new pure module `src/lib/platina/change-diff.ts`**

```ts
/** What changed between two versions of the same page, as prose a model can read. */
export function summariseChange(
  previous: { title: string | null; body: string; fetchedAt: Date },
  current: { title: string | null; body: string; fetchedAt: Date },
  budgetChars?: number,   // default 1200
): { added: string[]; removed: string[]; summary: string } | null;
```
- Line-level diff after whitespace collapse. No dependency — write it, it is ~60 lines.
- Returns `null` when the change is cosmetic only (timestamps, counters, a
  single changed digit inside otherwise identical text).
- `summary` is bounded by `budgetChars` and always names the age of the previous
  version in days.

**Migration:** additive index only.
```sql
CREATE INDEX platina_signal_documents_ws_canonical_fetched_idx
  ON platina_signal_documents (workspace_id, canonical_url, fetched_at DESC);
```
Generate with `npm run db:generate`. No column drops, no table changes.

**Tests (must fail before your change)**
- `signal-value.test.ts`: one case per rule above, plus the "Contact Ltd"
  false-positive guard, plus determinism.
- `change-diff.test.ts`: added-only, removed-only, both, cosmetic-only → null,
  budget respected, previous-age reported.
- `queries/platina.test.ts`: `getPreviousSignalDocument` SQL contains the
  workspace filter and orders by `fetched_at desc`.

**Live verification:** none needed (no IO). Paste the test output.

**Done when:** `scoreSignal` and `summariseChange` exist, are pure, are fully
tested, the index migration is generated and applied, and **nothing calls them
yet**. R2 wires them.

**Do not:** filter at fetch time (documents are cheap; analysis is expensive),
delete documents, or change `insertSignalDocuments`.

---

### R2 — Subject-aware analysis *(the biggest quality win in this round)*

**Fixes:** Q1, and the analysis half of Q3.

**Preconditions:** R1 merged. `npm test` green.

**Contract — new pure module `src/lib/platina/analysis-input.ts`**

```ts
export type AnalysisSubject = {
  competitorName: string | null;   // the brand this page belongs to
  clientName: string | null;       // the own_brand it competes with
  sourceKind: string | null;
  url: string;
  collectedAt: Date;
};

/** The complete text the debate sees. Bounded, deterministic, no IO. */
export function buildAnalysisInput(input: {
  subject: AnalysisSubject;
  title: string | null;
  body: string;
  change: { summary: string } | null;
  metrics: PlatinaSignalMetrics | null;
}): string;
```

The rendered input must state, in this order:
1. `Competitor: <name>` / `Watched for client: <name>` — or, when a brand is not
   attached, `Competitor: unknown (source not linked to a client)`. **Never
   invent a name.**
2. `Source: <kind> — <url>, collected <date>`
3. When `change` is present: `WHAT CHANGED SINCE <n> DAYS AGO:` followed by the
   diff summary, **before** the page body. The change is the signal; the body is
   context.
4. When `metrics` is present: one line of real numbers, labelled as engagement
   measurements (feeds R4).
5. The page body, truncated to a stated budget with the truncation made visible.

**Prompt changes — `src/lib/platina/debate.ts`**
- Proposer system prompt becomes subject-aware. It must ask for: *what this
  competitor is now doing or claiming, what is new about it, and why it matters
  to the named client* — and forbid restating the page. Keep the JSON contract
  (`{text, evidenceSpans, specificity}`) so `parseClaim` is untouched.
- Add to the contract: `headline` — a specific sentence naming the competitor
  and the move (≤ 90 chars), and `noveltyReason`. The model must answer
  `"nothing new"` when the page is static marketing copy with no change
  attached; that maps to a low specificity and a refuted/contested path rather
  than a manufactured driver.
- Challenger prompt gains one explicit duty: *is this actually new, or is it
  ordinary marketing copy that any competitor would publish?* Generic-ness is
  now an objection the challenger is asked for by name.
- **Keep `parseClaim` / `parseAttack` tolerant.** They are the honesty layer;
  a schema change must not make a malformed reply throw.

**Wiring — `src/inngest/functions/platina/signal-analyze.ts`**
- After `claimSignal`, before the debate: call `scoreSignal`. When
  `worthAnalysing === false`, `markSignalProcessed` and return
  `{ skipped: verdict.reason }` — **no model call**. The reason must reach the
  run timeline / document row so the operator can see what was skipped and why
  (add a nullable `skipped_reason text` column if nothing suitable exists —
  additive only).
- Load the subject: the spec's `brandId` → `getBrand` → and for a competitor,
  its `parentBrandId` → the client name. One `step.run`, reusing the existing
  `getScanSpec` call — do not add a second round trip.
- Load the previous version via `getPreviousSignalDocument` and
  `summariseChange`. A null diff (cosmetic) is passed as `null`, not as an empty
  string.
- Finding title becomes the model's `headline`, falling back to
  `<Competitor> — <what changed>` and only then to the page title. **The HTML
  `<title>` is the last resort, never the first choice.**
- The finding summary keeps citing its signal document; nothing becomes uncited.

**Tests**
- `analysis-input.test.ts`: order of sections; unknown competitor renders the
  honest string and never a guess; change precedes body; truncation visible;
  deterministic.
- `debate.test.ts`: extend for the new fields; a reply missing `headline` still
  parses; `"nothing new"` maps to the low-specificity path.
- `signal-analyze` behaviour: a low-value document is marked processed **with
  zero calls to the router fake** (assert the fake was not called — this is the
  cost guarantee); a document with a previous version gets a change summary in
  the input; a document without one does not.
- Boundary + plane tests stay green.

**Live verification (§6):** one competitor with a real site. Required evidence:
- The findings list from **before** this change (page-title style) and after
  (headline style), side by side, same source.
- One skipped document with its visible reason.
- Model-call count for the run: it must be measurably lower than the document
  count.

**Done when:** every new finding names a competitor and says what is new, a
low-value page costs zero model calls, and a changed page produces a finding
about the change rather than about the page.

**Do not:** touch `findingPathFor`, the contradiction floors, or
`downgradeIfNotIndependent`. Validation semantics are not in scope.

---

### R3 — Client-scoped stages, and a brand standard that exists

**Fixes:** Q5, Q6. **Depends on O3.**

**Preconditions:** R2 merged (not strictly required by the code, but the
before/after quality comparison is meaningless without it).

**Part A — scope the stages to a client**
- `src/db/queries/platina.ts`: add `brandId` (nullable) to
  `listRecentBrandEvidence` and `listRecentBrainEvidence`; when present, restrict
  to signals belonging to that brand **and its competitors** — reuse
  `listSignalIdsForBrands`, which already exists and is tested. Workspace filter
  stays mandatory and asserted in SQL.
- `src/lib/platina/stages/wire.ts`: `divergenceStage(ws, brandId)` /
  `ideationStage(ws, brandId)`.
- `src/lib/platina/orchestrator.ts`: the stage executors receive the run's brand
  (via its spec). When a run has no brand, keep today's workspace-wide behaviour
  and **record that on the run timeline** ("workspace-wide: this source is not
  linked to a client").
- `src/inngest/functions/platina/audit-run.ts`: pass the spec's `brandId`
  through.

**Part B — a brand standard the `/start` flow actually produces**
- New query `listBrandEvidenceForBrand(ws, brandId)`; when a client has
  confirmed its profile, its confirmed profile statements become the declared
  brand standard rows the divergence stage loads.
- Per O3: the client page gains one confirmation — *"This is how we'll describe
  <client> when we compare competitors. Confirm or edit."* Confirmation writes
  `platina_brand_chunks` rows tagged to the brand (additive `brand_id` column,
  nullable) through the **existing** `insertBrandChunk` path, so Plane A stays
  operator-confirmed rather than model-derived.
- Until confirmed, divergence keeps skipping — but the skip reason changes from
  the dead-end "no declared brand standard yet" to the actionable *"confirm how
  we describe <client> to turn this on"*, linked to the confirmation screen.

**Tests**
- Two clients in one workspace: client A's divergence never loads client B's
  competitor evidence (the Q5 regression test — write it first, watch it fail).
- Workspace isolation on both new queries, SQL filter asserted.
- Unconfirmed profile → skip with the actionable reason; confirmed → stage runs
  and produces a finding citing both lists.
- Plane discipline: a divergence finding keeps brand ids and brain ids in
  **separate** cited lists (`stages/cited.ts` already enforces this — assert it
  still holds after scoping).

**Live verification:** one client, two competitors, profile confirmed →
`brand_divergence` reaches `done` with at least one cited finding. Paste the run
timeline showing the stage status change from `skipped` to `done`.

**Done when:** divergence and ideation run per client, and a client onboarded
through `/start` can reach a divergence finding without anyone pasting brand
text by hand.

**Do not:** auto-promote a `ClientProfile` into Plane A without the
confirmation. That is the O3 line.

---

### R4 — Engagement metrics become readable signal

**Fixes:** Q4.

**Preconditions:** R2 merged (`buildAnalysisInput` already renders a metrics
line). R5 ideally verified first — if the field names are wrong, this slice
renders zeros. If R5 has not run, state that caveat in your report.

**Scope**
1. **Into the analysis:** the metrics line R2 added is already in the input;
   this slice makes the proposer prompt treat it as measured evidence — *"these
   numbers are measurements, not claims; you may compare them to other posts by
   the same account, and you may not extrapolate to reach or revenue"*.
2. **Into the brand view:** `/p/[ws]/brands/[id]` gains an engagement strip for
   social sources: median likes/comments/views over the collected window, the
   number of posts it rests on, and the date range. **Min-N gate applies** — below
   `minBaselineN` render "insufficient baseline", never a number.
3. **Into the planner:** `PlanEvidence` gains an optional
   `metrics: { median: …; n: number; window: string }` on items derived from
   social signals, rendered under the phase that cites them. Plane B only. Never
   mixed into a Plane A rationale.
4. **Aggregation is pure and tested:** new `src/lib/platina/engagement.ts` —
   median, n, window, outlier handling — no IO.

**Tests**
- `engagement.test.ts`: median with even/odd n; n below the floor returns
  `insufficient`; a missing metric is excluded from n rather than counted as 0
  (the `pickMetrics` contract must not be undone downstream).
- Plan rendering: a phase citing a social chunk shows its numbers; a phase
  citing a page chunk shows none; the plane-mixing test stays green.
- UI: the brand page renders "insufficient baseline" under the floor.

**Live verification:** one real Instagram or TikTok source (limit 3 posts) →
numbers appear on the brand page and, when cited, under a plan phase. Paste the
raw `metrics` jsonb of one row next to the rendered figure.

**Done when:** a number that came from a real actor payload is visible in the
product, with its n, and disappears behind the min-N gate when n is too small.

**Do not:** embed metrics into Brain chunk text (they are numbers, not prose —
they belong in structured fields), or let a metric become a plan claim without
its n.

---

### R5 — Prove the social path against a live actor

**Fixes:** Q8. Independent of R1–R4; can run in parallel from day one.

**Preconditions:** `APIFY_TOKEN` present; owner aware this spends credits.
Budget: **≤ 3 items per actor, one run each**. Four runs total, maximum.

**Method**
1. One real run per actor with the smallest legal limit:
   `apify~instagram-profile-scraper`, `apify~instagram-scraper`,
   `clockworks~tiktok-profile-scraper`, `clockworks~tiktok-scraper`.
   Use a large public account (not a client's).
2. Save the **raw** first item of each payload to
   `src/lib/platina/fetch/fixtures/<actor>-live-2026-09-21.json`.
   **Keep the existing fixtures** — add, never replace. A field that changed
   must be visible as a diff between two dated fixtures.
3. Fix `mapSocialItem` / `pickMetrics` for any field name that differs. If a
   field is genuinely absent from the live payload, it is absent — do not
   substitute a neighbouring field that looks similar.
4. Add a test per new fixture asserting the mapped `metrics` object.
5. If an actor is paywalled, deprecated or renamed: **stop and report.** Do not
   substitute a different actor — the actor matrix
   (`docs/superpowers/plans/platina-apify-actor-matrix.md`) is a signed
   document, and an actor swap is an owner decision.

**Done when:** every field `mapSocialItem` reads is confirmed present in a dated
live fixture, or removed with a note saying why.

**Report must include:** the four run ids, the credits spent, and a table of
`field name → present/absent/renamed`.

---

### R6 — Make the realtime pill true

**Fixes:** Q7. Independent; can run in parallel.

**Step 1 — diagnose before touching anything (timeboxed to 30 minutes).**
Write a throwaway script under the scratchpad (not the repo) that subscribes to
a channel with the same URL and publishable key the browser uses, and prints the
raw status and error payload. Answer one question: **why is the channel
refused?** The candidates, in likelihood order:
- the publishable key format is not accepted by realtime-js on this version,
- Realtime is not enabled for the Supabase project,
- the project requires an authorised/private channel, so an anon broadcast
  subscribe is rejected,
- the broadcast REST call is silently failing too (`realtime-server.ts:41-58`
  swallows every error by design — instrument it locally, do not remove the
  swallow).

**Step 2 — the fix follows the diagnosis, and only then.** Acceptable outcomes:
- **It can be fixed** (key, project setting, channel config, `private: true`
  plus a token from the membership-checked layout): fix it, and the pill reads
  "Live" in the live verification.
- **It cannot be fixed without a Supabase plan or config change the owner must
  make:** then make the product honest — the pill must not sit on
  "Reconnecting" forever. After a bounded number of failed attempts it settles
  on "Polling", with a title attribute naming the real reason, and the health
  page gains a Realtime row stating it plainly. Write up what the owner must
  change.

**Tests:** hook state machine — token absent → polling; subscribe error →
bounded retries → polling with a reason; SUBSCRIBED → live. Assert the poll
interval keeps running in every state (the correctness guarantee).

**Live verification:** two browser tabs on `/p/<ws>/findings`; send
`platina/contradict.requested` from the Inngest UI; record the delay until tab 2
updates. Report both the pill state and the measured latency. If you cannot open
a browser, say so — do not infer the transport from code.

**Done when:** the pill reports something that is true, and the owner knows
exactly what (if anything) they must change in Supabase.

---

### R7 — Budgets that fit one real client

**Fixes:** Q9, Q10. **Depends on O1 and O2.**

**Scope**
1. **Make the caps compose.** One module, `src/lib/platina/fetch/budget.ts`,
   owns every spend number and states the relationship between them in a comment
   that is also a test: per-source ≤ per-workspace-day, per-workspace-day ≤
   analysis cap, first-pass allowance separate from the daily cap.
2. **First-pass allowance** (O2): a per-client one-time onboarding budget,
   default 150 pages, consumed before the daily cap applies, recorded on the
   brand row (additive column), and **shown during onboarding**: "We'll read up
   to 150 pages for this client to build the first picture, then about 40 a day
   to keep it current."
3. **The cap is visible where it bites.** The client page and the cockpit show
   pages used today vs the cap and the next reset (00:00 UTC). A run that stops
   on the cap already records `DAILY_CAP_REASON` — surface it as a sentence, not
   a status code.
4. **Challenger diversity** (O1): if billing is enabled, nothing changes in code
   except removing the fallback's inevitability from the docs. If it is not,
   add a workspace-level *"independent validation is unavailable today"* banner
   sourced from the real fallback count, so "qualified, not independent" stops
   being invisible. **Do not change the debate's semantics.**

**Tests:** budget composition (the relationship assertions); first-pass consumed
before daily; first-pass is per client and per lifetime, not per day; cap
surfaces a sentence.

**Live verification:** set the daily cap to 1 in admin, let a real source tick,
confirm the degraded run and the banner (this path is already in the manual test
plan §9 — re-run it and paste it).

**Done when:** an operator can predict what a new client will cost before
approving it, and the product tells them when it has stopped and when it
resumes.

---

### R8 — The live use-case regression harness

**Fixes:** the reason every round so far has had to re-discover its own state by
hand. Runs last, but read it first — §6 is what R1–R7 verify against.

**Scope:** `scripts/verify-spine.ts`, one command, non-interactive:

```
npx tsx scripts/verify-spine.ts --client https://<site> --competitor https://<site> [--keep]
```

It must, against the real stack (real Inngest, real Apify, real router):
1. Create a throwaway workspace and a client, derive and approve sources.
2. Wait for the first pass, printing each source's live status with elapsed
   seconds.
3. Assert and print, with timings: client profile present and non-empty;
   documents inserted > 0; skipped documents with reasons; findings produced;
   at least one finding whose title is **not** the page title; a divergence
   stage status; a client-scoped plan that cites at least one evidence id.
4. Print a cost line: Apify pages, model calls by provider, and the independent
   vs fallback debate split.
5. Delete everything it created unless `--keep`, and **verify the deletion**.
6. Exit non-zero on any assertion failure, with the failing step named.

**Tests:** the script typechecks; its assertion helpers are unit-tested with
fakes; `--keep` is the only path that leaves data behind.

**Done when:** one command answers "is the spine actually working end to end
right now?" in under five minutes, and its output is the artefact pasted into
every future round's report.

---

## 5. Sequencing and parallel ownership

```
R1 ──► R2 ──► R3
         └──► R4 (needs R5's confirmation to be meaningful)
R5 ─────────────────► (independent, start immediately)
R6 ─────────────────► (independent, start immediately)
R7 ─────────────────► (independent, gated on O1/O2)
                               R8 ──► last, consumes all of the above
```

**File ownership — two agents must never hold the same file in the same round:**

| Slice | Owns |
|---|---|
| R1 | `lib/platina/signal-value.ts`, `lib/platina/change-diff.ts`, one query + index in `db/queries/platina.ts`, `db/platina-schema.ts` (index only) |
| R2 | `lib/platina/analysis-input.ts`, `lib/platina/debate.ts`, `inngest/functions/platina/signal-analyze.ts` |
| R3 | `lib/platina/stages/*`, `lib/platina/orchestrator.ts`, `inngest/functions/platina/audit-run.ts`, brand-evidence queries, the confirmation UI |
| R4 | `lib/platina/engagement.ts`, `lib/platina/plan/evidence.ts`, `app/(platina)/p/[ws]/brands/[id]/page.tsx` |
| R5 | `lib/platina/fetch/actors.ts`, `lib/platina/fetch/fixtures/*` |
| R6 | `components/platina/use-platina-realtime.ts`, `live-status.tsx`, `lib/platina/realtime*.ts`, the health page's Realtime row |
| R7 | `lib/platina/fetch/budget.ts`, `fetch/schedule.ts`, `lib/platina/analysis.ts`, cap UI |
| R8 | `scripts/verify-spine.ts` |

R2 and R3 both touch `audit-run.ts`/`signal-analyze.ts` indirectly — **R3 waits
for R2 to merge.** R4 touches `plan/evidence.ts`, which R2 does not; they can
overlap once R2 is merged.

---

## 6. The live verification harness (mandatory, every slice)

### 6.1 Throwaway workspace protocol

1. `npm run dev:all` — app **and** job runner. Confirm
   `/p/<ws>/admin/health` shows Background jobs: Working before you start.
   Nothing below is valid without it.
2. Create a **new** workspace for the verification. Never `internal-sales` —
   it holds the owner's real data and five enabled stale sources (O4) that will
   spend credits the moment the runner starts.
3. Use real public sites. `example.com` proves nothing: it has no sitemap, no
   press page and no marketing copy, and every round that used it learned
   nothing.
4. Delete everything when done, and say in your report that you verified the
   deletion.

### 6.2 The four use cases every verification walks

These are the owner's real-time flows. A slice reports on the ones it touches.

| # | Use case | What must be true |
|---|---|---|
| **UC1** | *Paste a client URL, watch it become understanding.* | Sources visibly move Queued → Reading → Analysing → Done; the client profile card fills within ~30s; the page refreshes itself. |
| **UC2** | *A competitor moved.* | A finding names the competitor and the move, is dated, links to its source, and offers "Plan a response to this move". After R2, its title is not an HTML page title. |
| **UC3** | *A plan reacts to new evidence.* | An open plan shows "N new signals since this plan"; re-planning produces a new plan with "What changed" and a link to the one it revises; the old plan and its recorded result are untouched. |
| **UC4** | *The operator can see the machine.* | Health page truthful; caps visible; skipped documents visible with reasons; degradation banners reflect the real state (jobs down, quota out, cap reached). |

### 6.3 What to paste in the report

- The command you ran and its real output (timings included).
- A timings table: approve → first status change → profile → all sources done →
  first finding → plan built.
- The cost line: Apify pages, model calls per provider, independent vs fallback
  debates.
- For analysis slices, the before/after finding pair (§0.3.4).
- Anything you could **not** verify, named explicitly. "I did not open a
  browser" is an acceptable sentence; implying you did is not.

---

## 7. Definition of done — every slice

```
[ ] New tests written BEFORE the change, observed failing, then passing.
[ ] npm test            green (baseline: 2057 passing as of 2026-09-21)
[ ] npm run typecheck   clean
[ ] npm run lint        clean
[ ] npm run build       clean          (round 3 was broken twice by build-only errors)
[ ] boundary.test.ts    green, exception table still zero
[ ] Migration additive only; generated AND applied; no drops
[ ] Live verification from §6 pasted, with timings and cost
[ ] Before/after quality sample (analysis slices only)
[ ] Report: what you did, what you did NOT do, every assumption, every owner
    decision your work is waiting on
[ ] Nothing committed unless the owner asked for a commit
```

## 8. Reporting template

```
SLICE:        R<n> — <title>
STATUS:       done | blocked | partial
TESTS:        <files> passed | <n> new tests | baseline 2057 -> <n>
LIVE:         <what you ran, in which workspace, deleted? yes/no>
TIMINGS:      approve -> first status <s>s | profile <s>s | all done <s>s | finding <s>s | plan <s>s
COST:         <n> Apify pages | <n> Groq calls | <n> Gemini calls | <n>/<n> debates independent
QUALITY:      before: "<finding title>"   after: "<finding title>"
NOT DONE:     <explicitly, including anything you could not verify>
ASSUMPTIONS:  <every one>
BLOCKED ON:   <owner decisions O1-O5, or none>
```

## 9. Traps this codebase has already sprung (do not re-learn them)

1. **Nothing scheduled runs without the job runner.** `npm run dev` alone looks
   healthy and does nothing. Check `/p/<ws>/admin/health` first, every time.
2. **A dead model id is an opaque 404.** Read the provider's real response body —
   Gemini names its successor model in the error text. See
   `docs/superpowers/plans/` history and the router comments.
3. **Apify 402 is an account memory/credit limit, never a bad target site.**
   Parallel runs exhaust the free 8 GB pool. `audit-run` is capped at
   concurrency 2 and cheerio crawls request 1 GB — do not raise either to go
   faster.
4. **Gemini free tier is 20 requests per day on this key**, not per minute. A
   429 that says "daily" will not clear in an hour.
5. **A silently-dropped field looks identical to a missing measurement.**
   `pickMetrics` drops anything that is not a finite number ≥ 0 — which is
   correct, and which is exactly why R5 needs a live payload.
6. **Inngest deduplicates event ids for 24 hours.** `analyzeEventId` buckets by
   the stale-claim window on purpose. Do not "simplify" it back to a bare id.
7. **The unique index on `(scan_spec_id, content_hash)` is the dedupe.** Do not
   add an application-level dedupe on top; it will disagree.
