# Metacognitive RAG — Architecture Brief

Design reference for revising the retrieval and learning pipeline. Uses cognitive and
psychological principles **only where each names a concrete failure mode and maps to a
mechanism with a metric.** A principle with no mechanism and no metric does not ship.

Internal design vocabulary only. None of these terms appear in the operator UI.

---

## 1. Governing rule — the cascade

Never spend a model call on something a hash, a statistic or a rule could decide.

```
hash → statistic → rule → cheap model → expensive model → human
```

Each stage exists to remove volume from the stage after it. Adding a stage is justified
only if it reduces total cost or prevents a named failure.

---

## 2. Principle → failure → mechanism → metric

| Principle | Failure mode | Mechanism | Metric |
|---|---|---|---|
| **Predictive coding** | Every scanned item processed by a model regardless of novelty | Per-source/topic expectation; only deviations proceed to the model | % of fetched items reaching a model call |
| **Metacognition** | Claims stored with no way to test them later | Single structured call returns `what / why / how / falsifier` | % of insights with a non-empty, testable falsifier |
| **Veil of ignorance** | Challenger biased by proposer identity or confidence | Blind review: challenger sees claim + evidence only | Objection rate; agreement rate by proposer model (should not differ) |
| **Apophenia** (pattern recognition) | Trends inferred from noise | Min-N + significance test in the deterministic gate | Insights rejected by gate; later-refuted rate of accepted ones |
| **Echo chamber / selective exposure** | Brain retrieves its own derived output, confirming itself | Cap derived chunks per answer; MMR diversity; one reserved disconfirming slot | Share of context from derived vs first-party; self-citation rate |
| **Info overload paradox** | More context degrades answers | Retrieve wide, rerank narrow, hard token budget per section | Tokens per generation; quality on eval set vs k |
| **Coastline paradox** | Measured value depends on the measuring scale | Fix and version the scale per metric: segment, window, chunk granularity | No cross-scale comparisons in any report |
| **Reinforcement / Goodhart** | Optimising a proxy drifts from the goal | Reward on lead quality, not volume; labelled explore share; human-confirmed lessons | Proxy-vs-outcome correlation over time |
| **Memory consolidation** | Compaction degrades into platitudes | Additive layers, provenance carried, generation ceiling | Max generation used as sole support (must be < 2) |
| **Heinz dilemma** | Rule conflicts with high-scoring recommendation | Deterministic rule wins; escalate with both sides shown | Escalations per week |

Heinz is the weakest fit — use it only for claims-rule conflicts. Do not build a moral
reasoning layer around it.

---

## 3. Revised pipeline

```
 1  Fetch + content hash          unchanged → stop                         [free]
 2  Surprise filter               within expected range → log, stop         [free]
 3  Interrogate (one call)        what / why / how / falsifier              [1 call]
 4  Blind challenger              claim + evidence only, one round          [1 call]
 5  Deterministic gate            min-N, significance, schema validity      [free]
 6  Brain write                   insight + provenance + falsifier          [embed]
 7  Retrieve, diversified         hybrid + MMR + one disconfirming slot     [query]
 8  Rerank under budget           wide → narrow, per-section token caps     [1 cheap call]
 9  Human gate                    approve / edit / reject with reason       [human]
10  Outcome tests the falsifier   promote / hold / demote / keep refutation [free]
         └──────────── loops back to 6 ────────────┘
```

### Changes from the previous flow

| Previous | Revised | Why |
|---|---|---|
| Every fetched item to the model | Hash + surprise filter first | Most fetched content is unchanged or unsurprising |
| Two-agent debate, challenger sees everything | Blind challenger | Removes identity and confidence bias |
| Separate why/what/how calls | One structured call | ~3–4× fewer tokens for the same reasoning |
| Insight stored without a test | Falsifier stored with insight | Makes the loop self-correcting, not self-confirming |
| Plain top-k retrieval | Hybrid + MMR + disconfirming slot | Breaks the echo chamber in a self-learning loop |
| Fixed k into generation | Rerank + token budget | Fewer, better chunks; lower cost |
| Re-rank by score | Test the falsifier, keep refutations | A recorded failure prevents re-proposing it |

---

## 4. Interrogation schema

One call, structured output, validated before anything downstream runs.

```ts
type Interrogation = {
  what: string            // the claim, one sentence, no hedging
  why: string[]           // evidence chunk IDs — validated against retrieved set
  how: string             // proposed mechanism
  falsifier: {
    metric: string        // what would be measured
    direction: "above" | "below"
    threshold: number
    window_days: number   // fixed scale — coastline rule
  }
  confidence: "low" | "medium" | "high"
}
```

Rejected if: `why` cites an ID not in the retrieved set; `falsifier` is missing or
untestable; `what` is not a single claim.

A claim that cannot name what would disprove it is not an insight. It does not enter the
Brain.

---

## 5. Surprise filter (predictive coding)

Keep a rolling expectation per `(source, topic)`: mean and spread of the tracked signal.

```
deviation = |observed − expected| / spread
if deviation < SURPRISE_FLOOR:  log the observation, update expectation, no model call
else:                           send to interrogation
```

- Expectations update on every observation, surprising or not
- Cold start: below min-N observations, everything proceeds (no expectation yet)
- `SURPRISE_FLOOR` is configurable per workspace; record the share of items it filters

---

## 6. Blind challenger (veil of ignorance)

The challenger receives **only** the claim text, the mechanism and the evidence chunks.

It does **not** receive: proposer model, proposer confidence, source name, prior scores.

- Exactly one round. No code path requests a second.
- Explicit `no_material_objection` output is permitted and expected
- **Objection rate above ~70% means the prompt is broken**, not the claims
- Agreement rate must not differ materially by proposer model — if it does, blinding failed

---

## 7. Anti–echo chamber retrieval

The risk is specific to self-learning: derived insights shape output, output shapes the
next derived insight, retrieval returns it, and confidence rises with no new evidence.

- **Cap** derived (Brain) chunks at a fixed share of any context, e.g. ≤ 40%
- **MMR** (maximal marginal relevance) to penalise near-duplicate chunks
- **One reserved disconfirming slot**: retrieve the highest-relevance chunk whose stance
  opposes the leading hypothesis, and include it explicitly labelled
- **Self-citation check**: a derived chunk may not be cited as support for itself or for
  a chunk it was compacted from

---

## 8. Token budget per generation

| Section | Cap |
|---|---|
| Brand standard | fixed, small, always included |
| First-party evidence | largest share |
| Derived hypotheses | ≤ 40% of evidence section |
| Disconfirming slot | 1 chunk |
| Instructions | fixed |

Retrieve ~50, rerank to ~8. Measure quality on the evaluation set as k varies — the
optimum is usually lower than intuition suggests.

---

## 9. Learning on outcome

When an outcome lands, test the stored falsifier, not the general result.

| Falsifier result | Action |
|---|---|
| Not triggered, effect held | Promote — confidence up, rank up |
| Not triggered, effect weak | Hold |
| Triggered | Demote — floor confidence, exclude from retrieval, **retain the record** |
| Window not elapsed | No change |
| Insufficient data | No change, report as insufficient |

Refutations are retained and retrievable as negative evidence. A recorded failure is what
stops the system re-proposing the same direction later.

---

## 10. Structural invariants

- No model call on unchanged content
- No insight without a testable falsifier
- Challenger is blind and runs exactly once
- Deterministic gates override every model
- Derived chunks never exceed their context cap and never cite themselves
- Every metric declares its measurement scale; no cross-scale comparison
- Refuted insights are demoted, never deleted
- A human approves every output that leaves the system

---

## 11. Build order

| # | Slice | Done when | Effort |
|---|---|---|---|
| 1 | Interrogation schema + falsifier | Insights without a falsifier are rejected | Low |
| 2 | Blind challenger + objection telemetry | Objection rate visible per prompt version | Low |
| 3 | Surprise filter | Share of items filtered is reported | Medium |
| 4 | Anti-echo retrieval (cap, MMR, disconfirming slot) | Self-citation rate measured and capped | Medium |
| 5 | Rerank + token budget | Eval set shows no regression at lower k | Medium |
| 6 | Falsifier-based grading + refutation memory | A triggered falsifier demotes and excludes | Medium |

Slice 1 first: everything downstream depends on insights carrying a testable falsifier.