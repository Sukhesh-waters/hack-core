# Metacognitive Brain — build plan (B0–B9)

Status: **APPROVED 2026-10-13. Final dev plan.** The owner accepted every
recommendation (D1–D7, §10). **B0 built** (branch `feat/b0`, merged to `main`);
migration 0087 waits for the database (§15). Environment and the code-verified
flow are in §15 and override any Vercel-specific step above while hosting is
paused.
Source brief: [docs/newbrain.md](../../newbrain.md) (architecture, principles, invariants).
This plan maps that brief onto the code as it stands on `main` (d7bd1f6), names what
already exists, and lays out the order to build the rest without breaking the
live flow (collection → analysis → Brain → Opportunities / Ideas / Planner →
realtime refresh).

Vocabulary rule from the brief stands: "predictive coding", "veil of ignorance",
"falsifier" and the rest are **internal names only**. The operator copy is in §9.

---

## 0. The short version

1. **About half of the brief is already built in some form.** Content-hash dedupe,
   header-only probes, the low-value triage, the one-round debate, the
   `no_material_objection` marker, objection-rate telemetry, RRF + rerank, the
   generation ceiling, refutation memory (`demoted_by_receipt_id`), Thompson
   learning with min-N, and the labelled explore share all exist. The plan
   **extends those modules**. It does not add a parallel pipeline.
2. **The missing pieces:** a falsifier on every claim, a challenger that is
   actually blind (today it sees the proposer's self-score and the source),
   a surprise filter, a significance test, MMR with a derived-chunk cap,
   a disconfirming slot, a per-section token budget, and a job that tests stored
   falsifiers when their window closes.
3. **Real-time safety comes from three rules:**
   - every stage ships behind a per-workspace mode `off | shadow | on`;
   - schema changes are additive only;
   - interactive paths (planner, ideas, brief) may not gain a serial round trip.

   Shadow mode computes the new decision, logs it and changes nothing. A mode
   flips only after its shadow numbers are read.
4. **Freeze:** no mode flips to `on` in `waters-gcc-internal` before
   **27 Oct 2026** (ARABLAB LIVE is 26 Oct). Shadow is allowed, because it
   cannot change what the operator sees.
5. **For real-time planning**, the result is plans that know when their evidence
   was proved wrong. Every insight carries a test. A daily job runs the tests.
   A refuted insight is broadcast on the existing `insights` realtime scope, and
   any plan that cited it shows "evidence behind this phase was proved wrong —
   re-plan". The planner also gets fewer, more diverse, budgeted chunks, which
   makes it cheaper rather than slower.
6. **Any failure can return to the same data** (§11). Recovery has five levels:
   - a mode flip back to the old path (seconds);
   - an undo journal for every state change the new stages make;
   - a replay of skipped documents;
   - a rebuild of derived tables from source;
   - a table backup with written down-SQL before every migration.

   A snapshot is taken before every flip to `on`. Nothing in this plan deletes a
   row.
7. **Prototype milestones** (§12) put something visible in front of the owner
   every 1–2 weeks. The scale rules keep the same code working when there are
   many workspaces instead of one.

---

## 1. Brief → code: what exists, what is missing

| Brief stage | Exists today | Gap this plan closes |
|---|---|---|
| 1 Fetch + content hash | `fetch/canonical.ts contentHash`, unique `(scan_spec_id, content_hash)` index, `fetch/probe.ts` header-only probe, `change-diff.ts` (cosmetic numeric change → null) | No funnel numbers: "% of fetched items reaching a model call" is not measured anywhere |
| 2 Surprise filter | `signal-value.ts` (boilerplate, thin text, nav ratio), and `interest.ts` momentum vs the company's median (but only for the interest job) | No per-(source, topic) expectation in front of the debate. Every non-boilerplate changed page costs 2 calls |
| 3 Interrogate | `debate.ts PROPOSER_SYSTEM`: one call returning `headline / text / noveltyReason / evidenceSpans / specificity` | No `how`, no `falsifier`. `evidenceSpans` are free quotes, not ids validated against the input |
| 4 Blind challenger | `debate.ts`: one round (`nextRoundAllowed() === false`), different provider (`avoid`), `NO_MATERIAL_OBJECTION`, `objection-rate.ts` (ceiling 0.8) | **Not blind.** The challenger prompt is `Signal` (names the competitor, client and URL) + `proposal.text` (the raw JSON, including `specificity` = proposer confidence). There is no prompt version or model on the transcript, so "agreement by proposer model" cannot be computed |
| 5 Deterministic gate | `contradiction.ts resolve()` (deterministic, but 45% of the score is the proposer's own `specificity`), `retrieval.ts minNGate / relevanceGate`, `topicMomentum` min-N 5 | No significance test: the median ratio over 5 posts can be noise. No "is this claim testable at all" check. Self-reported confidence feeds the score |
| 6 Brain write | `platina_brain_chunks` (confidence, agreement_state, source_signal_ids, absorbed_chunk_ids, generation, status, insight_key) | No falsifier, mechanism, structured subject/direction (needed for the disconfirming slot), grade state or due date |
| 7 Diversified retrieval | vector + lexical → `fusion.ts` RRF → relevance floor → `rerank.ts` (in `plan/context.ts`, `retrieve.ts`) | No MMR, no derived-share cap, no disconfirming slot, no self-citation check |
| 8 Rerank under budget | `rerank.ts` (1 cheap call, ≤20 → take 6–8), `EVIDENCE_TOP_K = 6`, 400-char truncation per item | No per-section token budget. No eval of plan quality against k (`eval.ts` measures retrieval recall@k only) |
| 9 Human gate | `gates.ts` (declare/confirm/approve/publish), review verdicts, Useful/Dismiss ledger events, brand-standard confirmation | No reject-with-reason on a Brain insight itself |
| 10 Outcome tests falsifier | `demote.ts` (topic-level worked/failed demotes), `learning.ts` Thompson, `credit.ts` trust, `consolidate.ts` monthly | Nothing tests a *stored prediction*. Demotion is topic-wide and coarse |
| Coastline | `interest.ts` RECENT 30 / BASELINE 90 days, per-company median | Scales are constants scattered across files, not declared or versioned per metric |
| Goodhart | Rewards come only from confirmed reviews; explore share 0.2 is labelled | No proxy-vs-outcome correlation. "Lead quality" is not defined (see D4) |
| Heinz | `claims-gate.ts` | A high-scoring idea that breaks a claims rule is not escalated with both sides shown |

---

## 2. How this avoids disturbing the live flow

### 2.1 Modes per stage

One new jsonb column on `platina_workspace_config`:

```ts
brainModes: {
  interrogation: "off" | "shadow" | "on",
  challenger:    "off" | "shadow" | "on",
  gate:          "off" | "shadow" | "on",
  surprise:      "off" | "shadow" | "on",
  retrieval:     "off" | "shadow" | "on",
  budget:        "off" | "shadow" | "on",
  grading:       "off" | "shadow" | "on",
}   // default: all "off"
```

Read once per job or request through the existing `getWorkspaceConfig`, which
both `signal-analyze` and `assemblePlanContext` already call, so this adds no
query. `off` is byte-for-byte today's path. Rollback is setting the mode back.

What shadow means differs by stage, because some stages cannot run twice for free:

| Stage | Shadow behaviour | Extra cost in shadow |
|---|---|---|
| Interrogation | New prompt and schema used; validation **records** failures but nothing is rejected | none (same one call) |
| Challenger | Deterministic 50/50 split by `hash(signalId)`: half blinded, half today's prompt. Rates compared by arm | none |
| Gate | Gate verdict computed and logged; the write proceeds as today | none (pure code) |
| Surprise | Decision logged ("would skip"); the document is still analysed. **This measures the filter's false-negative rate for free:** how often the model found a move in a doc the filter would have dropped | none |
| Retrieval | New evidence set computed beside the old one; the old one is used. Overlap, derived share and disconfirming-fill rate are logged | 1 extra query, run **in parallel** with the existing ones |
| Budget | Token counts that would be cut are logged | none |
| Grading | Grades computed and stored; no promote or demote applied | the daily job's reads |

### 2.2 Rules every slice keeps

- **Additive schema.** New nullable columns and new tables only. No backfill
  rewrites gen-0 rows (`mayRewriteGen0() === false` stays true). Old rows read
  as "untested" and are never retro-rejected.
- **Same Inngest surface.** `platina/signal.analyze`, its event-id dedupe, the
  `claimSignal` idempotency, `concurrency { key: workspaceId, limit: 4 }`,
  global 2 and the throttle of 8/min are unchanged. New work is new `step.run`s
  inside the existing function, plus one new daily cron (B5) and nothing else.
- **No new serial hop on interactive paths.** The planner does embed →
  `Promise.all(queries)` → rerank → plan call today. New retrieval work goes
  inside the same `Promise.all` or runs in-process (MMR and the budget are pure
  code over candidates already in memory). Latency budget: p50 of plan
  assembly may not regress by more than 50 ms; it is measured in shadow.
- **Realtime unchanged.** Same channel (`platina:<hmac>:live`), same scopes.
  B5 reuses the existing `insights` scope for "a claim was proved wrong".
  Telemetry writes are fire-and-forget, like `suggestions-record.ts`: they
  catch and never block a page or a job.
- **The cost guarantee generalises.** `analysis-plan.ts` already proves that a
  skip means no provider call. Every new filter (surprise, gate) gets the same
  kind of unit test: skip ⇒ the injected router fake was never called.
- **Constitution.** workspace_id in every new query, with SQL-string tests;
  all code in `src/lib/platina/*` (boundary test); every model call through
  `routeAI` / `routeChatWithProvenance`; no agent spawns an agent (the
  challenger is a second call from the same job, as today); a number the
  platform did not report is "not measured", never synthesised.

### 2.3 The ARABLAB window

| Dates | Allowed on `waters-gcc-internal` |
|---|---|
| now → 26 Oct | build, tests, deploy with modes `off`; `shadow` from B0–B3 once merged |
| 27 Oct → | flips to `on`, one stage at a time, each after its shadow numbers are read |

The Events page and live mode are the hard date. Nothing in this plan touches
`events.ts`, `event-extract`, `/p/[ws]/events` or `/p/[ws]/live` rendering
before 27 Oct.

---

## 3. Cascade mapping (governing rule)

`hash → statistic → rule → cheap model → expensive model → human`, mapped onto
the router as it stands:

| Rung | Here | Module |
|---|---|---|
| hash | content hash, ETag/Last-Modified probe | `fetch/canonical.ts`, `fetch/probe.ts` |
| statistic | surprise (novelty vs expectation), significance test, min-N | new `surprise.ts`, `significance.ts`; `interest.ts` |
| rule | signal-value triage, schema validation, claims rules, testability | `signal-value.ts`, new `interrogation.ts`, `claims-gate.ts` |
| cheap model | rerank, blind challenger | router `fast` ladder (background ladder in jobs) |
| expensive model | interrogation (proposer), planner, idea engine | router `quality` ladder where already used |
| human | approve / edit / reject with reason | `gates.ts`, review, ledger events |

Every stage reports how much volume it removed (§8), so "each stage exists to
remove volume from the next" can be checked rather than assumed.

---

## 4. Data model (all additive)

Migrations continue from `0086`.

**0087 — modes, telemetry, transcript provenance (B0)**
- `platina_workspace_config.brain_modes jsonb not null default '{}'` (missing key = `off`)
- `platina_workspace_config.surprise_floor real not null default 1.0`,
  `surprise_audit_share real not null default 0.1`,
  `derived_context_share real not null default 0.4`
- `platina_debate_transcripts`: `proposer_provider`, `proposer_model`,
  `challenger_provider`, `challenger_model`, `prompt_version text`,
  `blinded boolean`, `objected boolean` (all nullable)
- new `platina_brain_telemetry` (append-only): `id, workspace_id, stage, decision,
  subject_id, detail jsonb, prompt_version, created_at`, indexed on
  `(workspace_id, stage, created_at)`. Kept for 120 days; the monthly
  consolidation job prunes it.
- new `platina_brain_state_log` (append-only, **the undo journal**, §11): `id,
  workspace_id, brain_chunk_id, field (status | grade_state | confidence |
  agreement_state), from_value, to_value, cause (stage + prompt_version or
  script name), grade_id, created_at`. Every state change a new stage makes
  goes through one writer, `setBrainState()`, which writes the log row and the
  change in the same transaction. Kept forever: it is small and it is the
  audit trail.
- `platina_signal_documents.skip_cause text` (nullable): `low_value | own_brand
  | nothing_new | surprise | untestable | gate`. This gives a machine-readable
  cause next to the human `skip_reason`, so replays select by cause (§11.3).

**0088 — interrogated insights (B1)** on `platina_brain_chunks`:
- `kind text` — `claim | measured | fact | compacted` (null = legacy)
- `mechanism text` (the "how")
- `evidence_refs jsonb` — the validated `why` ids (`sig:<docId>#e3`, `brain:<id>`, `fp:<id>`)
- `falsifier jsonb` — see §5.1
- `subject_key text` (e.g. `brand:<id>|topic:pfas analysis`), `direction text` (`up | down | none`)
- `grade_state text not null default 'untested'` — `untested | holding | promoted | refuted | insufficient`
- `due_at timestamp` (created + window), `prompt_version text`
- `written_by text`, e.g. `interrogation-v1`, `insight-writer-v2`, null for
  legacy. Every row a new stage creates is findable, and can be archived, by
  this marker.
- index `(workspace_id, grade_state, due_at)`

**Every migration ships with its reverse.** Drizzle has no automatic down, so
each one gets a hand-written `drizzle/down/00NN.sql`. These are additive
migrations, so the down drops only the new columns and tables. CI applies up →
down → up against the test database, which proves the down works before it is
ever needed.

**0089 — expectations (B4)** new `platina_expectations`: `workspace_id, key,
n, mean, m2, updated_at`, unique `(workspace_id, key)`. Welford running mean
and variance; one upsert per observation.

**0090 — grades (B5)** new `platina_insight_grades` (append-only): `id,
workspace_id, brain_chunk_id, metric, scale_version, window_days, threshold,
direction, measured_value, n, verdict, created_at`.
Plus `platina_brain_chunks.refuted_by_grade_id text` (sits beside the existing
`demoted_by_receipt_id`; both are kept).

---

## 5. Slices

Each slice: contract → files → tests → shadow read → flip. Done means tests
green, typecheck, lint and `next build` clean, plus the slice's shadow numbers
written into §14 of this file.

### B0 — Baseline telemetry, modes, metric registry  *(Low · prerequisite)*

Without a before-number, none of the brief's metrics can show improvement, so
this comes before the brief's Slice 1. It is small.

- `brain-modes.ts` (pure): parse `brainModes`, default `off`, `modeOf(config, stage)`.
- `brain-telemetry.ts`: `recordBrainEvent()` (fire-and-forget, catches) and
  `brainFunnel(workspaceId, since)` returning the numbers in §8.
- `signal-analyze.ts`: record a funnel event at every exit that exists today
  (own_brand, low_value, nothing_new, analysed), and persist
  `proposer/challenger provider + model` (already returned by
  `routeChatWithProvenance`) and `prompt_version` on the transcript.
- **`falsifier-metrics.ts` — the metric registry (the coastline rule).** One
  entry per metric the system really measures. Each entry declares its scale:

  ```ts
  { id: "engagement_index", plane: "B", table: "platina_interest_signals",
    segment: ["brand", "topic"], aggregation: "median",
    windows: [30, 90], minN: 5, scaleVersion: 1,
    measure: (deps, segment, window) => Promise<{ value: number | null; n: number }> }
  ```

  Initial entries, all already collected: `engagement_index` (per company
  median), `topic_momentum` (30-day window only: it is always measured
  against a fixed 90-day baseline), `ad_days_running`, `event_participants`,
  and Plane A creative metrics (`engagement_rate`, `ctr`, `leads`) from
  `platina_creative_metrics`. **`active_ads` was dropped when B0 was built:**
  no code writes it, so a falsifier on it could never be graded.
  Moving the RECENT/BASELINE constants out of `interest.ts` happens here
  (re-exported, so nothing else changes).
  `compareMeasurements(a, b)` throws when scale versions differ. Reports go
  through it, so a cross-scale comparison cannot be written.
- Admin → Health: a "Brain quality" card (reuse `ops-view.ts`) showing the
  funnel and objection rate per prompt version.
- **Recovery tooling ships in B0, before any stage can write** (§11):
  `setBrainState()` + the state log, `npm run platina:brain-mode`,
  `platina:brain-snapshot` / `--restore`, `platina:brain-undo`,
  `platina:brain-replay`, the down-SQL files, and the legacy-equivalence
  golden test.
- **Constitution.** Record the owner decision of 2026-10-13 in `CLAUDE.md`,
  next to the C6 learning-loop paragraph: "every Brain claim carries a
  falsifier from the metric registry; a daily grader tests it; refuted claims
  are demoted, never deleted; facts are exempt only with a code-verified quote".

Tests: modes parsing; funnel arithmetic; SQL tests for workspace_id on every
new query; registry: every metric has a scale version, windows and minN;
`compareMeasurements` refuses mixed scales.

### B1 — Interrogation schema + falsifier  *(Low · brief Slice 1)*

**Contract.** The proposer returns:

```ts
type Interrogation = {
  headline: string                 // kept: findings and UI need it
  what: string                     // one claim, one sentence, no hedging
  why: string[]                    // ids from the numbered input, e.g. "e3"
  how: string                      // mechanism
  kind: "claim" | "fact"           // see D1
  falsifier: {                     // required for kind = "claim"
    metric: FalsifierMetricId      // enum from the registry, nothing else
    subject: { brand?: string; topic?: string }   // the segment it is measured on
    direction: "above" | "below"
    threshold: number
    window_days: 30 | 90           // from the metric's declared windows
  } | null
  confidence: "low" | "medium" | "high"   // recorded, NOT scored (see B3)
}
```

Two deliberate additions to the brief's schema, both needed to make it work:
`falsifier.subject`, because a metric without a segment cannot be measured,
and `headline`, because the findings list renders it today.

**Numbered input.** `analysis-input.ts` already builds identity → what
changed → engagement → page text. It now numbers each paragraph, diff line
and metric line `[e1]…[eN]`, and returns the id → text map with it. `why`
must cite those ids. The check is the same kind as `plan/evidence.ts
findCitationProblem`, but for analysis.

**Validation** (`interrogation.ts`, pure, rule rung). Rejected when:
- `why` is empty or cites an id not in the map;
- `what` is not one claim: more than one sentence terminator, longer than 220
  characters, or hedge words (`may`, `might`, `could`, `possibly`) on a claim;
- `kind = "claim"` and the falsifier is missing, its metric is not in the
  registry, its window is not one the metric declares, or its subject cannot be
  resolved to a brand or topic in this workspace;
- `kind = "fact"` and no cited span contains a verbatim quote of the fact's
  key noun phrase. This is the same "code verifies the words are on the page"
  approach as `events.ts quotedIn`.

`what = "nothing new"` stays a valid, cheap exit, exactly as today.

**Measured insights get falsifiers from code, not from a model.**
`market-insight-writer.ts` already writes deterministic interest and pressure
insights. Each one now carries a code-built falsifier, e.g. "PFAS analysis
engagement index (median, per company, 30 d) below 1.0 within 30 days". This
costs nothing and puts the existing measured Brain under the same loop.

**Shadow → on.** In shadow, invalid replies are written as today and flagged
`grade_state = 'insufficient'` with the reason in telemetry. When on, an invalid
claim produces a transcript (kept for audit) and a skipped signal with the
reason "the claim could not be tested". It produces no Brain chunk and no
finding.

Tests: the validator table (each rejection rule); id validation against the
map; facts need a quote; insight-writer falsifiers are deterministic; the
"nothing new" path is unchanged; a parse failure is treated as invalid, never
as a salvaged claim.

### B2 — Blind challenger + objection telemetry  *(Low · brief Slice 2)*

**Contract.** The challenger prompt is built by a new pure function
`blindChallengerInput(interrogation, spanMap)`. It contains only `what`, `how`
and the **texts** of the cited spans. It does **not** contain the proposer's
provider or model, its `confidence`, `specificity` or `noveltyReason`, the
source URL or domain, the raw proposer JSON, or any prior score. Competitor
names stay where they appear inside the claim or spans, because they are part
of the claim, not its provenance.

- The challenger's output adds an explicit
  `verdict: "no_material_objection" | "objection"` field; the existing
  `parseAttack` mapping stays as the fallback.
- One round, enforced as today. A unit test asserts that the blinded prompt
  string contains none of: the proposer provider id, the model id,
  `specificity`, `confidence`, `http`, or the source domain.
- `objection-rate.ts` gains `objectionRateBy(rounds, key)` for per prompt
  version and per proposer model. The alarm moves from 0.8 to the brief's
  **0.7**, with a second alarm when agreement between proposer models differs
  by more than 15 points at N ≥ 20 each ("blinding failed").

**Shadow** is the 50/50 split in §2.1, run for one week; then compare the arms.

Tests: the redaction assertions; per-key rates; both alarms; min-rounds guard;
the transcript stores `blinded`, `objected`, providers and models.

### B3 — Deterministic gate  *(Low–Medium · brief stage 5)*

New `insight-gate.ts`, pure. It runs after the challenger and before any
Brain write.

1. **Schema validity:** the output of B1.
2. **Testability (min-N):** the falsifier's segment must already have at least
   the metric's `minN` observations in the registry's table. Otherwise the
   claim can never be graded, so it is held as `insufficient` (finding yes,
   Brain no).
3. **Significance (apophenia):** for claims and measured insights about a
   trend, a one-sided Mann–Whitney U test, recent window against baseline
   window, on the raw observations (`significance.ts`, exact for small N,
   normal approximation above 20). It passes at p < 0.10; that level was
   chosen for N between 5 and 20 and is a config value. It applies to
   `market-insight-writer` momentum insights too: a "rising" topic that fails
   it is written as "not clearly different from usual" instead.
4. **Resolve v2:** `contradiction.ts resolve()` stops weighting the proposer's
   self-reported `specificity` (45% today). New inputs, all deterministic:
   validated evidence coverage (cited spans / spans that exist), the
   challenger's confounder strength, and falsifier validity. Self-reported
   confidence is stored for telemetry only. Owner decision **D7**. Run in shadow
   first: compute both scores and log how many states would change.

Deterministic beats model: if the gate refuses, no model output can override it.

Tests: significance against known tables; min-N refusal; resolve v2 does not
change with `specificity`; shadow logs both states.

### B4 — Surprise filter  *(Medium · brief Slice 3)*

**What is "the tracked signal".** A magnitude signal fails on busy pages. A
newsroom changes every day, so its usual change is large, and a filter on
magnitude would drop every new press release. The tracked value is therefore
**novelty**, plus engagement for social posts:

| Source kind | Observation | Expectation key |
|---|---|---|
| web / press / trade page | `novelty = 1 − max Jaccard(added words, words of the last 5 versions of this URL)`, word sets via `consolidate.ts words()` | `nov:<canonicalUrl>` |
| social post | engagement index vs that company's median (already computed for interest) | `eng:<brandId>` |
| ad library | median days running of the advertiser's ads (`ad_days_running`; `active_ads` is not collected) | `ads:<brandId>` |

`surprise.ts` (pure, statistic rung):
`deviation = |observed − mean| / max(sd, floorSd)`. Skip when
`deviation < surprise_floor` (D2, default 1.0). The expectation updates on
every observation, surprising or not. Cold start: below 5 observations per
key, everything proceeds. Hard overrides that always proceed: the first time a
URL is seen, and a diff containing a date or a price (rule rung; this reuses
the date and price patterns in `events.ts` and `change-diff.ts`).

**Audit sample.** `surprise_audit_share` (default 10%) of would-skip documents
are analysed anyway, deterministically by `hash(signalId)`, and labelled
"audit sample". This keeps the false-negative rate measured after the filter is
on, not only during shadow. If the model finds a move in more than 20% of
audited skips at N ≥ 20, an ops alert recommends lowering the floor. Code never
moves the floor; the person does.

**Placement** in `analysis-plan.ts`: own_brand → signal-value → `loadPrevious`
→ change summary → **surprise** → analyse. It sits after `loadPrevious` (it
needs the previous version) and before any provider. The existing guarantee
holds and is extended: surprise skip ⇒ no provider call.

**What it does not touch.** The interest and event jobs read signal documents
directly. A document the surprise filter skips still feeds measured interest,
pressure, events and the public learning lane. Only the two-call debate is
gated.

Tests: Welford update; cold start; overrides; audit sampling is deterministic;
a skip calls no provider (injected fake); the newsroom case (busy page,
genuinely new words) proceeds; the repeating-widget case is skipped.

### B5 — Falsifier grading + refutation memory  *(Medium · brief Slice 6, moved forward)*

This moves ahead of retrieval for a concrete reason: falsifier windows start
running the day B1 goes on (30 days minimum), so the grader must exist before
the first windows close, and the disconfirming slot in B6 retrieves refutations.

New Inngest cron `platina-falsifier-grade` (daily 05:00 UTC,
`concurrency { limit: 1 }`, per-workspace loop, like `platina-learning`):

| Measured result | Action |
|---|---|
| window not elapsed | none |
| `n < metric.minN` or not measured | `insufficient`; report "not enough data to test" (never a synthesised number) |
| falsifier triggered | **refute**: `grade_state = refuted`, `status = demoted`, confidence floored, `refuted_by_grade_id` set, excluded from support retrieval, **kept** and retrievable as negative evidence |
| not triggered, effect held (significance in the claimed direction) | **promote**: `grade_state = promoted` |
| not triggered, effect weak | **hold**: `grade_state = holding` |

- **Confidence becomes earned, not reported.** After the first grade,
  `confidence = Beta(1 + held, 1 + refuted)` mean, the same arithmetic as
  `learning.ts`. A model never sets it again.
- **Ledger link (C8.5).** Each grade is written as a measured-result event for
  every suggestion whose `inputs` cited that chunk, so `credit.ts` trust picks
  it up with no new learning code.
- **Realtime.** A refutation broadcasts on the existing `insights` scope.
- **Planes.** A Plane B-derived claim graded on a Plane A metric is allowed. It
  is what `demote.ts` already does ("slow loop wins"). The grade records which
  plane measured it, and nothing cites both.
- **Shadow** for the first month: grades are stored, nothing promoted or
  demoted. The owner reads the first batch (D5).

Tests: every row of the table; the min-N refusal; idempotent per (chunk,
window); a refuted chunk is excluded from support queries but returned by the
negative-evidence query; credit events appear in the ledger.

### B6 — Anti-echo retrieval  *(Medium · brief Slice 4)*

One shared pure module, `diversify.ts`, used by all four retrieval call sites:
`plan/context.ts retrievePatternEvidence`, `retrieve.ts retrieveBuckets`,
`opportunity-brief.ts` and `idea-run.ts`.

1. **Wider pool.** About 50 candidates (today 20–60) from the same vector and
   lexical queries, fused by RRF as today.
2. **MMR** (λ = 0.7) over the fused list. Similarity is Jaccard over
   `words()`, in process, so 768-dimension vectors are not shipped back from
   Postgres. Moving to pgvector cosine is a later option, taken only if the B7
   eval says Jaccard is not enough.
3. **Derived cap.** Brain (derived) chunks may use at most
   `derived_context_share` (default 40%) of the **evidence token budget**, not
   40% of whatever happens to be present. A cold-start workspace with no
   Plane A still gets derived evidence, just less of it. Confirmed lessons and
   own-site pages count as first-party.
4. **One disconfirming slot.** Take the leading hypothesis (top derived chunk)
   with its `subject_key` and `direction`. The slot gets the most relevant chunk
   with the same subject and the opposite direction, or a **refuted** chunk on
   that subject (B5 refutation memory). It is labelled in the prompt
   `COUNTER-EVIDENCE (may contradict the above)`, and the snapshot carries
   `role: "disconfirming"`. This runs as one extra query inside the existing
   `Promise.all`. When the slot is empty, the plan records "no counter-evidence
   found"; the fill rate is a metric.
5. **Self-citation check.** A derived chunk may not support itself or anything
   in its own lineage (`absorbedChunkIds`, shared `sourceSignalIds`). At write
   time (B1, B3), an insight whose validated support is derived-only (no `sig:`
   or `fp:` id) is refused. At read time, a chunk and its compaction parents
   are never both in one context. Metric: self-citation rate.
6. **Two-layer rule unchanged.** The buckets stay separate and labelled, and
   `findCitationProblem` still refuses a phase that cites both planes.
   `canCiteHypothesisAlone(generation < 2)` stays.

Retrieved chunks get `last_retrieved_at` touched as today. That is how
consolidation knows what is in use.

**In-request fallback.** With mode `on`, if the new retrieval throws (a bad
row, a missing column after a partial deploy), the same request falls back to
the old retrieval, records `retrieval.fallback` in telemetry, and the plan is
still written. An operator never sees a blank plan because of this slice.

Tests: MMR on near-duplicates; cap arithmetic including the cold-start case;
disconfirming selection (opposite direction beats refuted, refuted beats empty);
self-citation refusal; all four call sites keep their current signatures (the
old path stays under mode `off`).

### B7 — Rerank under a token budget + quality eval  *(Medium · brief Slice 5)*

- `context-budget.ts` (pure). Token estimate is characters / 4, matching how
  `pricing.ts` estimates. Section caps per generation:

  | Section | Cap (planner default) |
  |---|---|
  | Client standard (profile, confirmed brand standard) | fixed 400 tokens, always included |
  | First-party evidence | the largest share of 2,400 evidence tokens |
  | Derived hypotheses | ≤ 40% of the evidence tokens (B6) |
  | Disconfirming slot | 1 chunk |
  | Lessons + learned patterns | fixed 500 |
  | Instructions | fixed (the prompt) |

  It never cuts a chunk mid-sentence (this keeps the `EVIDENCE_TOP_K` rule
  "never truncate mid-chunk"): it drops whole chunks from the bottom of each
  section.
- Rerank: about 50 → about 8 per plane through the existing `rerankCandidates`
  (one cheap call; `MAX_CANDIDATES` goes from 20 to 50, and content per
  candidate drops to 240 characters to hold the call's size).
- **Quality vs k eval** (`scripts/brain-eval.ts`, operator-run, not CI because
  it spends tokens):
  - 15 fixed Waters briefs (PFAS, ARABLAB, mass spec, GCC labs…) run at
    k = 4, 6, 8, 12.
  - Deterministic scores: citation validity, plane rule, share of phases with
    evidence, counter-evidence acknowledged, tokens in, latency.
  - Plus a blind owner rating of 5 plans per k, shown in shuffled order without
    the k.
  - Done when: "no regression at lower k".
  - The existing retrieval eval (`eval.ts`, recall@k) also runs on the new
    retrieval and must not drop.

### B8 — Real-time planning on the new Brain  *(Medium · the point of all this)*

How the planner uses it, all within the existing `/p/[ws]/plan` and
`plan/freshness.ts`:

1. **Better context, same latency.** `assemblePlanContext` switches to B6 and B7
   behind `retrieval` and `budget` modes. There is no new round trip (§2.2).
2. **Freshness counts what matters.** "N new signals — re-plan" currently
   counts new evidence. It now counts only **gated** new insights relevant to
   the plan's scope, plus one stronger flag: **"evidence behind this plan was
   proved wrong"**, raised when B5 refutes a chunk the plan cited (its evidence
   snapshot already stores the ids). Pushed live through the `insights` scope.
3. **Phase-level badges.** In the roadmap, a phase whose cited chunk is refuted
   shows "proved wrong on <date>" with the measured number and a re-plan button.
   A promoted chunk shows "held up when tested".
4. **Plans carry their own test.** The planner already returns phases with
   evidence ids. It now also returns one plan-level falsifier from the same
   registry, e.g. "leads from this campaign below 10 within 30 days". It is
   graded by B5 on Plane A metrics when results land. Grades flow into
   `platina_plan_feedback` as worked/failed and into the C8.5 ledger as a
   measured result. That closes the planner's learning loop on a stated
   prediction rather than a general impression.
5. **Opportunities and ideas** get the same retrieval, the cap and the
   counter-evidence line on the card. The idea engine's 80/20 learned/explore
   split is unchanged and stays labelled.

Tests: freshness counts gated insights only; a refuted cited chunk raises the
flag and broadcasts; the plan falsifier is validated with the B1 validator; an
e2e test where the planner renders "proved wrong" after a seeded refutation.

### B9 — Goodhart, coastline reports, rule conflicts  *(Low)*

- **Proxy vs outcome.** The monthly consolidation digest adds the Spearman
  correlation between the proxy (engagement index, review verdicts) and the
  outcome (D4: `leads` from imported results), per client, at N ≥ min-N. It
  flags when ρ < 0.3. Reward stays on confirmed outcomes; explore stays labelled.
  The results import (`metrics-import.ts`) gains an optional `qualified_leads`
  column. When a client supplies it, the outcome switches to it. When it is
  absent, it is "not measured", never estimated.
- **Consolidation ceiling.** The digest reports the maximum generation used as
  sole support, which must stay < 2 (already enforced by
  `canCiteHypothesisAlone`; now also measured). A merge keeps the survivor's
  falsifier, and the absorbed chunks' grades stay attached through `absorbedChunkIds`.
- **Rule conflict (Heinz, narrow).** When an idea or plan line scores in the top
  third and `claims-gate.ts` blocks it, the rule wins and an inbox item shows
  both sides: the rule, and the evidence and score. Metric: escalations per
  week. No moral-reasoning layer.
- **Human gate on insights.** Brain map and Findings gain approve / edit /
  reject-with-reason on an insight (reasons: wrong fact, not new, not
  testable, other). A reject is a ledger event (a "Wrong fact" event already
  lowers input trust in `credit.ts`).

---

## 6. Order, effort, dates

| # | Slice | Depends on | Effort | Target |
|---|---|---|---|---|
| B0 | Telemetry, modes, metric registry, **recovery tooling** | — | 3 d | merge by 17 Oct, shadow on |
| B1 | Interrogation + falsifier | B0 | 3 d | merge by 21 Oct, **shadow** |
| B2 | Blind challenger | B1 | 1.5 d | merge by 23 Oct, A/B shadow |
| B3 | Deterministic gate | B1 | 2 d | merge by 24 Oct, shadow |
| — | **ARABLAB freeze ends** | | | 27 Oct: flip B1 → B2 → B3 on, two days apart |
| B4 | Surprise filter | B0 | 3 d | shadow 1 week, then on |
| B5 | Grading + refutation memory | B1, B3 | 3 d | live before 20 Nov (first 30-day windows close) |
| B6 | Anti-echo retrieval | B5 | 3 d | shadow 1 week |
| B7 | Budget + eval | B6 | 2.5 d | eval run → flip |
| B8 | Real-time planning | B5–B7 | 3 d | |
| B9 | Goodhart, rule conflicts, insight review | B5 | 2 d | |

This differs from the brief's build order in two places. B0 goes first so every
metric has a before-number. Grading (the brief's 6) moves to B5 because
falsifier windows start the day B1 goes on, and B6 retrieves refutations.

One branch per slice off `main`, as in C7/C8. Each slice is a reviewable diff.

---

## 7. Structural invariants → the test that proves each

One file, `src/lib/platina/brain-invariants.test.ts`, with one named test per
invariant in the brief's §10, so the list cannot drift from the code:

| Invariant | Proven by |
|---|---|
| No model call on unchanged content | unique hash index + `planAnalysis` skip ⇒ router fake never called (unchanged, surprise, low-value) |
| No insight without a testable falsifier | `insertBrainChunk` refuses `kind=claim` without a registry-valid falsifier (mode on) |
| Challenger blind, exactly once | redaction assertions; `nextRoundAllowed() === false` |
| Deterministic gates override every model | gate refusal ⇒ no Brain write regardless of agreement state |
| Derived ≤ cap, never self-cited | `diversify` cap + lineage tests |
| Every metric declares its scale; no cross-scale comparison | registry completeness; `compareMeasurements` throws |
| Refuted insights demoted, never deleted | no delete query exported for brain chunks; refute keeps the row |
| A human approves every output that leaves | existing gate tests (`gates.ts`, publish gate); unchanged |

---

## 8. Metrics (Admin → Health → "Brain quality")

All computed from `platina_brain_telemetry`, transcripts and grades. No metric
is shown below its minimum N; below it, the card reads "not enough data yet".

| Metric | Formula | Healthy |
|---|---|---|
| Model-call share | analysed / fetched documents, 7 d | falling after B4 |
| Stopped by stage | counts at hash / triage / surprise / gate | each stage removes volume |
| Surprise false-negative rate | audit samples with a move / audit samples | < 20% |
| Testable share | claims with a valid falsifier / claims | → 100% when on |
| Objection rate | per prompt version | 20–70% |
| Agreement by proposer model | per model, N ≥ 20 | gap < 15 points |
| Gate rejections | per reason | visible, not zero |
| Later-refuted rate of accepted | refuted / graded | tracked month on month |
| Derived share of context | derived tokens / evidence tokens | ≤ 40% |
| Self-citation rate | derived-only-supported writes / writes | 0 when on |
| Disconfirming fill rate | slots filled / generations | rising as grades land |
| Tokens per generation | from usage context | falling after B7 |
| Proxy-vs-outcome ρ | monthly | ≥ 0.3 |
| Max generation as sole support | per answer | < 2 |
| Escalations | per week | low, explained |

---

## 9. Operator copy (internal terms never shown)

| Internal | Shown to the operator |
|---|---|
| hash stop | "Unchanged since last read" |
| surprise filter skip | "Nothing unusual compared with this page's normal changes" |
| audit sample | "Checked anyway (spot check)" |
| falsifier | "How we'll know if this is wrong" |
| refuted | "Proved wrong on <date>: <metric> was <value>" |
| promoted | "Held up when tested" |
| insufficient | "Not enough data to test yet" |
| blind challenger | "Second opinion" (existing wording) |
| disconfirming slot | "Counter-evidence" |
| derived cap | not shown |

Copy follows `docs/superpowers/plans/platina-copy-glossary.md` and the light
palette (#0176D3 buttons).

---

## 10. Owner decisions — DECIDED 2026-10-13

The owner accepted every recommendation.

| # | Question | Decision |
|---|---|---|
| D1 | Factual moves (a launch, an acquisition, attending a show) predict nothing, so they have no falsifier. Are they insights? | **Yes, as `kind = fact`.** Code verifies a verbatim quote. Facts are exempt from the falsifier, can never be promoted, and are labelled "fact (quoted)" |
| D2 | Surprise floor and audit share | **1.0 standard deviation and a 10% audit sample.** Reviewed after 1 week of shadow |
| D3 | Derived share of context | **40% of the evidence budget** |
| D4 | "Lead quality" for the Goodhart check | **`leads` from imported results now**, plus an optional `qualified_leads` import column. Never estimated |
| D5 | Grading autonomy | **Shadow for the first month; the owner reads the first batch. Then automatic** (reversible through the undo journal, §11.2) |
| D6 | Freeze on Waters | **No flip to `on` before 27 Oct 2026** |
| D7 | Drop the proposer's self-reported confidence from the agreement score | **Yes, after the B3 shadow** shows how many states would change |

---

## 11. Recovery — returning to the same data after a failure

Goal: whatever goes wrong, the workspace can return to the exact data and
behaviour it had before, without losing anything collected in between.
Everything is built in B0, before any new stage writes a row.

### 11.1 Five levels, cheapest first

| Level | Failure | Return path | Time | Data lost |
|---|---|---|---|---|
| L0 | A stage behaves badly (bad skips, wrong grades, slow planner) | `npm run platina:brain-mode -- --ws <slug> --stage <s> --mode off`. The next job or request takes the old path | seconds | none |
| L1 | A stage changed Brain state wrongly (bad refutations, bad promotions, resolve v2 states) | `platina:brain-undo` applies the inverse of the state-log rows after time T for a cause (§11.2) | minutes | none: undone changes are logged too |
| L2 | Documents were skipped that should not have been (surprise filter, untestable, gate) | `platina:brain-replay` re-queues them through the normal sweep (§11.3) | an hour or two (throttled) | none: skipped documents were never deleted |
| L3 | A derived table is wrong (expectations, telemetry) | `--rebuild-expectations` recomputes from signal-document history. Derived tables are never the source of truth | minutes | none |
| L4 | A migration or deploy breaks | Restore the pre-migration table backup, or run `drizzle/down/00NN.sql`, and redeploy the previous commit (Vercel instant rollback) | minutes | none: additive schema, backup taken first |

Provider failures are not a recovery case; the existing router ladder and
cooldowns handle them. An interrogation that fails validation releases the
signal claim (`releaseSignal`, as today) and the next sweep retries it. An
invalid reply is never salvaged into a claim.

### 11.2 The undo journal

- **One way to change Brain state.** Every status, grade_state, confidence or
  agreement_state change made by a new stage goes through `setBrainState()`.
  That function writes a `platina_brain_state_log` row (from → to, cause,
  grade id) in the same transaction. A unit test greps that no new module
  updates those columns directly.
- **Undo.** `platina:brain-undo -- --ws <slug> --cause grading --since <iso>
  [--apply]` is a dry run by default, which prints every change it would
  reverse. On `--apply` it writes the inverse through `setBrainState()` (cause
  `undo:<run id>`), so an undo can itself be undone.
- **New rows are not deleted.** Rows a stage created (marked by `written_by`)
  are set to `archived`. `--restore-archived` brings them back.

### 11.3 Replay of skipped documents

`platina:brain-replay -- --ws <slug> --cause surprise|untestable|gate --since <iso> [--limit N] [--apply]`:

- Selects by `skip_cause`, resets those documents to `unprocessed`, and lets the
  normal sweep pick them up. Same job, same `claimSignal`, same throttle (8 per
  minute), same daily AI cap.
- Event ids use a new bucket, so the existing 10-minute dedupe does not swallow
  the replay.
- The dry run prints the count and an estimated model-call cost before
  anything is queued.
- A replayed document that produces a claim is handled like any other. If one
  produces a duplicate of an existing insight, monthly consolidation merges it,
  as it does today.

### 11.4 Snapshot before every flip

`platina:brain-snapshot -- --ws <slug>` writes
`backups/<date>-brain-<ws>-<stage>.json` (git-ignored, same pattern as
`kb-quarantine.ts`). It holds:

- every Brain chunk's id, status, grade_state, confidence and agreement_state;
- the workspace config, including `brainModes`;
- the expectation rows;
- the funnel counts at that moment.

`--restore <file>` returns state columns and config to the snapshot through
`setBrainState()`. It leaves content and embeddings alone: they are never
changed by these stages. Rows created after the snapshot are archived. Taking a
snapshot is a required step in the flip checklist (§11.7).

### 11.5 Proof that "off" is the same data

A golden test, `brain-legacy-equivalence.test.ts`, runs a recorded set of
fixture documents through the analysis plan and the writers with every mode
`off`. It asserts that the rows that would be written (finding, transcript,
Brain chunk, skip) equal a stored snapshot from today's `main`. It runs in CI on
every slice. If it changes, something leaked past a mode switch and the slice
is not done.

### 11.6 Deploy order (every slice with a migration)

`main` auto-deploys to Vercel. From B0 on, the analysis job writes the new
columns, so **the migration is applied to the database before the code
reaches `main`**. Additive columns are safe for the old code that is still
running. The reverse order breaks `insertTranscript` in the live job. The
Brain quality card fails soft (one "not available yet" row) if this is ever
missed. The analysis job does not, which is why the order is a rule.

1. Table backup of the tables the migration touches (`backups/`).
2. `npm run db:migrate`, then verify the new columns and tables exist.
3. Merge to `main`; Vercel deploys.
4. Rollback: redeploy the previous commit first, then `drizzle/down/00NN.sql`
   if the schema must go too.

### 11.7 Flip checklist (every stage, every workspace)

1. Shadow numbers for the stage written into §14.
2. `platina:brain-snapshot` taken; the file name is recorded in §14.
3. `platina:brain-mode --mode on`.
4. Watch the Brain quality card for 48 h. Rollback triggers:
   - the stage's healthy range in §8 breached;
   - planner p50 up by more than 50 ms;
   - any error rate above 2% in its telemetry.
5. On a trigger: L0 first, then L1 or L2 for anything it wrote, then a
   written note in §14.

---

## 12. Prototype milestones and scale

Each milestone is something the owner can open in the app, built in
prototype-level slices on `main` behind modes.

| Milestone | When | What the owner sees |
|---|---|---|
| M1 — "Is it testable?" | ~24 Oct (shadow) | Brain quality card: funnel, objection rate per prompt version. New insights on Brain map show "How we'll know if this is wrong" (read-only) |
| M2 — "Less noise" | ~4 Nov | Waters on: claims need a test, blind second opinion, gate. Surprise filter in shadow with its "would skip" count and spot-check results |
| M3 — "Plans that argue back" | ~14 Nov | Planner: diverse, budgeted evidence with one "Counter-evidence" line. Plans state their own test |
| M4 — "Proved right or wrong" | ~25 Nov | First grades after 30-day windows close: "Held up when tested" / "Proved wrong on <date>" live on plans, Opportunities and Brain map, with re-plan |

**Scale rules**, so the prototype does not need rewriting at many workspaces:

- **Grader fan-out.** The daily cron emits one `platina/falsifier.grade` event
  per workspace (event id `grade:<ws>:<day>`, deduped), keyed with concurrency
  `{ key: workspaceId, limit: 1 }`. Each run grades due chunks in pages of 200,
  one `step.run` per page. This stays under Inngest's step limits, and a crash
  resumes at the next page: grades are unique per (chunk, window).
- **Per-document cost stays O(1).** One expectation upsert, one telemetry
  insert, and at most one previous-version read, which exists today.
- **Retrieval stays bounded.** About 50 candidates; MMR is O(k²) at k = 50,
  which is about 2,500 Jaccard comparisons in memory, under 5 ms. No vectors
  are shipped back.
- **Indexes for every new read path:** `(workspace_id, grade_state, due_at)`,
  `(workspace_id, stage, created_at)`, unique `(workspace_id, key)` on
  expectations.
- **Retention:** telemetry 120 days (pruned in consolidation), grades and the
  state log kept.
- **Per-workspace knobs, not code changes:** floors, shares and modes live in
  `platina_workspace_config`, so a second client is a config row.

---

## 13. Risks and known traps

- **Quota.** Gemini embeddings return 429 after about 250 texts a day: Brain
  writes keep storing text without a vector and backfill later (as today).
  Groq allows 8k tokens a minute: the challenger stays on the background
  ladder. A larger rerank call (50 candidates) must use the fast ladder and
  shorter content.
- **Prompt-version drift.** Every prompt change bumps `prompt_version`, so
  objection rates are never compared across versions.
- **Busy-page false negatives.** The surprise filter is the riskiest stage;
  that is why it uses novelty rather than magnitude, has hard overrides, and
  keeps a permanent audit sample.
- **Thin grading early.** For the first 30 days nothing has been graded, so the
  disconfirming slot and "proved wrong" flags will be sparse. The metrics say
  so instead of implying emptiness is health.
- **Local runs.** Nothing scheduled runs without the Inngest dev server
  (`npm run dev:all`), and it crashes after a long idle; restart it. The owner's
  own dev server picks up queued runs. Use `--inline` scripts for proofs.
- **Concurrent edits.** The owner edits the same files in Cursor. Keep edits
  narrow per slice, never reformat whole files, and stage only this slice's hunks.

---

## 14. Shadow results and flips (filled in as slices run)

| Slice | Shadow window | Result | Snapshot file | Flipped on | Rollbacks |
|---|---|---|---|---|---|
| B0 | | | | | |
| B1 | | | | | |
| B2 | | | | | |
| B3 | | | | | |
| B4 | | | | | |
| B5 | | | | | |
| B6 | | | | | |
| B7 | | | | | |
| B8 | | | | | |
| B9 | | | | | |

---

## 15. Environment and code-verified flow (2026-10-13)

### 15.1 Environment, as of tonight

| Item | State | What it changes |
|---|---|---|
| Hosting | Vercel plan cancelled, for now | Nothing auto-deploys from `main`. Merging is safe without a database. CLAUDE.md "Deploy: Vercel only" no longer describes reality (owner to confirm the new target) |
| Database | Supabase project `eqhzaj…` unreachable (pooler: tenant not found; host does not resolve). Being re-provisioned tonight | 0087 is not applied. B1+ builds and tests without a database (unit + SQL-shape tests) |
| Runtime | Local only: `npm run dev:all` (Next + Inngest dev server) | Crons run only while `dev:all` is up. Every scheduled job in this plan must catch up on start, not assume it fired yesterday |

**When the database is back:** run these steps, in this order, before
`npm run dev:all` starts the job runner against it.

| Case | Steps |
|---|---|
| **A. Same project restored** | 1. Table backup (`platina_workspace_config`, `platina_debate_transcripts`, `platina_signal_documents`) to `backups/`.<br>2. `npm run db:migrate` (applies 0087 only).<br>3. Verify the columns and the two tables exist.<br>4. Start `dev:all` |
| **B. New project** | 1. `npm run db:migrate` (0000 → 0087).<br>2. Re-onboard Waters (`scripts/onboard-client.ts --apply`, then `platina:force`, `platina:evidence`).<br>3. Start `dev:all`. Collection, the Brain, the funnel numbers and every learning baseline start from zero. Milestone dates (§12) then count from that day, because falsifier windows are at least 30 days |

The rule in §11.6 still holds in both cases. The job runner must never run new
code against a database without its migration, or `insertTranscript` fails.

### 15.2 The real-time planning path, verified in code

Each claim the plan rests on was checked against the code on `feat/b0`:

| # | Claim | Where | Verdict |
|---|---|---|---|
| V1 | Support retrieval already excludes anything not `active` | `similarBrainChunksQuery`/lexical in `db/queries/platina.ts` filter `status = 'active'` and the embedding version | **Holds.** A B5 refutation (status `demoted`) drops out of support with no retrieval change. B6 needs exactly one new query: refuted/demoted chunks on the same subject, for the counter-evidence slot |
| V2 | Plans keep the evidence ids they cited | `PlanDoc.evidence` (a frozen `PlanEvidenceSnapshot[]`) + `phases[].evidenceIds` (jsonb) | **Holds.** B8's "evidence behind this plan was proved wrong" is a lookup of snapshot ids against `grade_state`. The plan-level falsifier is an optional `PlanDoc.falsifier` field. **No plan-table migration** |
| V3 | Freshness is cheap and scoped | `plan/freshness-read.ts`: active Brain chunks since `plan.createdAt`, scoped through `sourceSignalIds`; no model call | **Holds.** B8 changes stay in two places: filter to gated insights in `brainEvidenceSinceQuery`, plus one refuted-cited query |
| V4 | A refutation reaches an open plan page live | The header's `PlatinaLiveStatus` subscribes to the workspace channel, and any scope signal refreshes the page (coalesced). `market-insight-sync` and `learning-service` already broadcast `insights` | **Holds.** B5 broadcasts `insights` after grading; no new client wiring |
| V5 | Job order leaves the grader fresh measurements, and credit sees grades the same day | Crons: `scan-coordinator` every 5 min → `audit-run` → `interest.extract.requested` (also daily 04:30) → analysis (`contradict-sweep`, event + 6-hourly backstop, 8/min) → **grader 05:00** → `platina-learning` 06:00 → `consolidate` 1st of month | **Holds.** 05:00 sits between interest extraction and learning |
| V6 | Insight writes can take the new fields without touching callers | `insertBrainChunk(input)` takes an options object, and `market-insight-writer.ts` plans `write/supersede/unchanged` per `insightKey` | **Holds.** B1 adds optional fields. Code-built falsifiers attach in the insight writer's `write` path |
| V7 | B0 telemetry cannot double-count on a job replay | `recordBrainEvent` runs inside the `step.run` that does the exit's write | **Holds** (Inngest memoises completed steps) |
| V8 | The analysis decision is stable while new stages land | `analysis-writes.ts` + `brain-legacy-equivalence.test.ts` (9 fixtures) | **Holds.** Every later slice must keep it green with its mode `off` |
| V9 | Debate-claim Brain writes signal the plan page | `signal-analyze` broadcasts `findings` only | **Fine as is** (V4: any scope refreshes). B1 adds an `insights` broadcast when a claim enters the Brain, so a future per-scope listener stays correct |

### 15.3 Local-runtime adjustments to the slices

- **Catch-up, not "yesterday".** The B5 grader takes every chunk with
  `due_at <= now`, so a missed 05:00 run is caught up the next time `dev:all`
  runs. Monthly consolidation already checks its own month. The B4
  expectation update happens per observation, so it has nothing to miss.
- **Inngest dev server.** It crashes after a long idle ("error leasing
  partition"). The ops check flags a job runner that is not running, and
  nothing in this plan assumes a cron fired.
- **Verification is code-first until the database is back.** Every slice
  ships pure modules with unit tests, SQL-shape tests for every query, and the
  golden test. Live shadow numbers (§14) start once the database and
  `dev:all` are up.

### 15.4 Build waves from here

| Wave | Runs in parallel | Needs a database? |
|---|---|---|
| W1 (now) | **B1** interrogation + falsifier (owns migration 0088) · **B3/B4 pure**: `significance.ts`, `surprise.ts` · **B6/B7 pure**: `diversify.ts`, `context-budget.ts` | No |
| W2 | **B2** blind challenger (needs B1's schema) · **B3 wiring** (gate) · **B5** grader + 0089 grades table | No to build; yes for shadow numbers |
| W3 | **B4 wiring** (expectations table 0090) · **B6/B7 wiring** into the four retrieval call sites | Same |
| W4 | **B8** real-time planning (badges, plan falsifier, refuted-cited freshness) · **B9** | Same |

Migrations are numbered in wave order (0088 B1, 0089 B5, 0090 B4), so two
parallel agents never generate the same number.
