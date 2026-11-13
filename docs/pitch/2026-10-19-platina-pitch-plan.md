# Platina AI OS — Pitch Report

**From problem statement to use cases, data flow, core architecture and logical operations**

| | |
|---|---|
| Document type | Source report for the final pitch document and deck |
| Product | Platina AI OS — the AI marketing agency that learns from itself |
| Reference deck | `Platina-AI-Marketing-Agency.pptx` (4 slides: overview, logical operations, data flows and architecture, core flows) |
| Prepared | 19 Oct 2026 |
| Runtime for the demo | Local: `npm run dev:all` (Next.js + Inngest dev server) against Supabase Postgres |
| Sources used | The four-slide deck; `CLAUDE.md` (build constitution); `docs/superpowers/specs/2026-09-21-core-intelligence-architecture.md`; `docs/superpowers/plans/2026-10-13-metacognitive-brain.md`; `docs/superpowers/plans/2026-10-14-brain-continuation.md`; the code under `src/lib/platina/*` |

### How to use this report

Each part is written so it can be lifted into the final document on its own.
Parts 1–4 are the story (why this exists and what it believes). Parts 5–9 are
the substance (who uses it, how data moves, how it is built, how it reasons).
Parts 10–11 are the proof and the guardrails. Parts 12–16 are the pitch
itself: run of show, demo script, preparation, questions and limits.
Numbers quoted from live data carry the date of the document they come from.

---

## Contents

1. Executive summary
2. Problem statement
3. Core ideology
4. The psychological tuning: how the system is taught to think
5. Users and use cases
6. The end-to-end journey
7. Data flow
8. Core architecture
9. Logical operations
10. Guardrails, trust and safety
11. Proof points: what is built and verified
12. The pitch narrative and run of show
13. Demo script, screen by screen
14. Demo preparation and runbook
15. Questions and objections
16. What we must not claim, and what is still open
17. Appendices: glossary, route map, module map, quality metrics

---

## 1. Executive summary

**The one sentence.** Most AI marketing tools are confident. Platina is
calibrated: it says what it believes, what would prove it wrong, then checks —
and it changes its mind in front of you.

**What it is.** Platina AI OS is an always-on marketing agency in software. It
watches the market (competitors, their ads, industry events, how your own
brand shows up), turns what changes into checked insights, and uses those
insights to plan campaigns, write briefs and content, screen risky claims and
decide who to reach again. One shared memory, the **Brain**, sits in the
middle. Every final call is made by a person.

**What makes it different.** It is built around a discipline, not a model.
Every insight it stores must answer four questions: *what* is the claim,
*why* (the evidence it rests on), *how* (the mechanism), and *what would prove
it wrong* (a measurable test with a deadline). A second AI challenges each
claim without knowing who wrote it. Code, not a model, checks every number and
sample size. When a campaign's results come back, the system runs the test it
stored at the start. Claims that held are promoted, claims that failed are
demoted and kept on record so the same idea is never proposed again.

**Why it matters.** Marketing teams lose money and credibility to confident
recommendations that nobody can audit afterwards. Platina makes every
recommendation traceable to its source, honest about what it does not know
("not enough data", "not measured"), and accountable to measured results.

**What we are showing.** A live walk-through of one campaign from a market
signal to a measured outcome, ending with the system re-planning because one of
its own beliefs was proved wrong.

**Status.** The full Brain build (stages B0–B9) is on `main`. Tests at the
last handoff (15 Oct 2026): 3,198 passed, 0 failed; typecheck, lint and
production build clean. Database migrations 0087–0090 are applied to Supabase
and the readiness check reports OK.

---

## 2. Problem statement

### 2.1 The situation

B2B and regulated-industry marketing teams (the first client is a scientific
instruments company operating in the Gulf) work in a market that moves every
day: competitors publish, advertise and exhibit; industry events come and go;
buyer interest shifts between topics. The team has to notice what matters,
decide what to do about it, produce on-brand material that stays within
regulatory language, and then prove whether it worked.

### 2.2 The pain, by the people who feel it

| Who | What hurts today |
|---|---|
| Marketing lead / CMO | Spends budget on recommendations that sounded right. When results disappoint, nobody can say whether the idea was wrong or the execution was. The same failed idea comes back next quarter under a new name. |
| Strategist / planner | Builds plans from memory, a few reports and gut feel. Cannot keep up with every competitor page, ad and event. Has no record of which past beliefs held up. |
| Content and brand team | Writes fast but risks off-brand tone or regulated claims ("clinically proven", "guaranteed") slipping through. |
| Analyst | Is asked for numbers that do not exist. Under pressure, missing data becomes zero or an estimate, and the estimate becomes a fact. |
| Executive / client | Sees confident decks, not evidence. Cannot tell a measured finding from a hunch. |

### 2.3 Why current tools do not fix it

1. **AI tools are fluent, not calibrated.** A large language model writes a
   convincing recommendation whether or not the evidence supports it. Fluency
   is mistaken for knowledge.
2. **No memory of being wrong.** Tools generate fresh answers each time. They
   do not store their past predictions, so they cannot check them, and they
   repeat ideas that already failed.
3. **Public data and own data get mixed.** Scraped competitor content and the
   client's own results end up in the same pile and are cited as if they were
   equally reliable.
4. **Small numbers become patterns.** Three good posts become "a trend".
5. **Missing numbers get invented.** Dashboards show zero where the platform
   reported nothing; AI tools estimate what was never measured.
6. **The machine is trusted blindly, or not at all.** Either outputs go out
   unchecked, or people ignore the tool because they cannot see its reasoning.
7. **Everything is analysed, so everything is expensive.** Sending every page
   change to a model is slow and costly, so teams either overspend or stop
   watching.

### 2.4 The root cause, in one line

> The problem is not that marketing lacks intelligence. It is that the
> intelligence it has is **confident but not accountable**: it never states
> what would prove it wrong, so it can never learn from being wrong.

### 2.5 Problem statement (for the final document)

Marketing teams need to act on a fast-moving market with recommendations they
can trust. Today's AI tools produce fluent but unverifiable advice: they mix
public and first-party data, invent missing numbers, find patterns in tiny
samples, forget their past predictions and repeat failed ideas. Teams need a
system that watches the market continuously, separates what is measured from
what is guessed, tests its own beliefs against real results, and keeps a person
in charge of every decision.

---

## 3. Core ideology

### 3.1 The belief

**Intelligence is not having answers. It is knowing how sure you should be,
and changing your mind when the evidence says so.** Platina is designed to
behave like the best strategist you have worked with: someone who ignores
noise, questions their own ideas, invites challenge, checks the maths, says "I
don't know yet" when that is true, and remembers when they were wrong.

### 3.2 Seven principles

| # | Principle | In one line |
|---|---|---|
| 1 | Calibrated, not confident | Every claim carries the test that could disprove it. |
| 2 | Attention is earned | Only what is genuinely surprising reaches the AI. |
| 3 | Challenge before trust | A second AI attacks each claim blind; code checks the numbers. |
| 4 | Measured beats modelled | A model never produces a number; a number the platform did not report is "not measured". |
| 5 | Two kinds of knowledge, never mixed | Public market data informs; only the client's own measured results count as evidence. |
| 6 | Learn from outcomes, not opinions | Only confirmed, measured results change what the system believes. |
| 7 | Humans decide | A person approves every output and confirms every lesson. |

### 3.3 The tagline set

- Primary: **"The AI marketing agency that learns from itself."**
- Proof line: **"Every number has a source, and a person makes every final call."**
- Closing line: **"AI learns from itself. Humans decide what it learns."**

---

## 4. The psychological tuning: how the system is taught to think

This is the heart of the pitch. Each mechanism takes a known thinking error,
in people and in AI, and builds the counter-habit into the software. For each
one: the human parallel, the error it prevents, how Platina does it, and where
the audience can see it.

> Note on wording: names such as "predictive coding" and "veil of ignorance"
> are used in the pitch and deck to explain the design. Inside the product the
> operator sees plain language instead (see Appendix A).

### 4.1 Predictive coding — attention is earned

- **Human parallel.** The brain does not process everything it senses. It
  predicts what should happen and only pays attention to the difference. You
  stop hearing the fridge until it stops.
- **Error prevented.** Attention overload: reacting to every change, paying a
  model to read pages that said nothing new.
- **How Platina does it.** A cost cascade runs cheapest check first:
  1. *Hash* — a content fingerprint and a header-only change probe (ETag,
     Last-Modified, sitemap date, RSS). Unchanged content stops here and
     never costs a model call.
  2. *Statistic* — the **surprise filter**. For every page, social account and
     advertiser the system keeps a running expectation (mean and variance,
     updated on every observation). A change is analysed only if it deviates
     from that page's normal by at least one standard deviation. Busy pages
     (a newsroom that changes daily) are judged on *novelty* — how many
     genuinely new words appear — not on size of change.
  3. *Rule* — low-value pages (boilerplate, thin text, navigation) are triaged
     out; dates and prices always proceed.
  4. Only then does a model see the signal.
- **Honesty built in.** 10% of the pages the filter would skip are analysed
  anyway as a spot check, so the system keeps measuring how often it would
  have missed something. If more than 20% of spot checks find a real move, an
  alert recommends lowering the threshold. Code never moves the threshold; a
  person does.
- **Where it is visible.** Live flow (`/live`): signals entering and most of
  them stopping before the AI. Admin → Health → Brain quality: "Pages skipped
  as nothing unusual" and "Spot checks that found something".

### 4.2 Metacognition — thinking about its own thinking

- **Human parallel.** Good experts ask themselves: what exactly am I claiming,
  why do I believe it, how would it work, and what would change my mind?
- **Error prevented.** Overconfidence and vague claims ("this will build
  awareness").
- **How Platina does it.** One AI call, four questions. The proposer must return:
  - **What** — one claim, one sentence, no hedging words ("may", "might",
    "could"), at most 220 characters.
  - **Why** — the ids of numbered evidence lines it was given (`e1`, `e2`…).
    Code checks every id exists. A citation the input does not contain is
    rejected.
  - **How** — the mechanism behind the claim.
  - **What would prove it wrong** — a *falsifier*: a metric from a fixed
    registry, the subject it is measured on (a brand or a topic), a direction
    (above / below), a threshold, and a window of 30 or 90 days.
- **The rule.** A claim that cannot name what would disprove it never enters
  the Brain. Pure facts (a launch, an acquisition, attending a show) predict
  nothing, so they are stored as facts only when code finds a verbatim quote
  of them on the page; facts can never be promoted.
- **Where it is visible.** Any insight in the Brain map or Findings shows its
  test as "How we'll know if this is wrong".

### 4.3 Veil of ignorance — challenge without bias

- **Human parallel.** We judge an idea more fairly when we do not know whose
  idea it is (blind peer review, blind auditions).
- **Error prevented.** Confirmation bias and deference: a reviewer agreeing
  because the author sounded confident or used a trusted model.
- **How Platina does it.** A second model, from a different provider, receives
  only the claim, its mechanism and the text of the evidence it cites. It does
  not see which model wrote it, how confident that model was, the source URL
  or any prior score. A unit test asserts none of those strings appear in the
  challenger prompt. Exactly one round: no endless debate. The challenger
  returns either "no material objection" or a specific objection.
- **Self-monitoring.** The system tracks the objection rate per prompt version
  and per proposer model. If the challenger agrees too often (over the
  ceiling) it is not really challenging; if agreement differs by more than 15
  points between proposer models, blinding has failed. Both raise alarms.
- **Where it is visible.** Findings: rounds marked contested, and claims shown
  as "Ruled out". Admin → Health: objection rate.

### 4.4 Code verifies — deterministic checks override every model

- **Human parallel.** A good analyst runs the numbers before believing the
  story.
- **Error prevented.** Apophenia — seeing patterns in noise — and the
  "law of small numbers".
- **How Platina does it.** After the challenge, a deterministic gate runs
  before anything is written:
  1. *Schema* — the four questions are valid.
  2. *Testability* — the falsifier's subject already has at least the
     metric's minimum number of observations; otherwise the claim can never be
     graded and is held as "not enough data to test yet".
  3. *Significance* — for any claim about a trend, a one-sided Mann–Whitney U
     test compares the recent window with the baseline window on the raw
     observations. It must pass at p < 0.10 (chosen for samples of 5–20). A
     "rising" topic that fails is written as "not clearly different from usual".
  4. *Agreement score* — computed from evidence coverage, the strength of the
     challenger's objection and falsifier validity. The proposer's own
     confidence is recorded but **never scored**: a model cannot vote for itself.
- **The rule.** If the gate refuses, no model output can override it.

### 4.5 Evidence floor — "not enough data" is an answer

- **Human parallel.** A careful scientist says "the sample is too small to
  tell".
- **Error prevented.** Fake precision.
- **How Platina does it.** Below the minimum sample (5 data points for topic
  momentum; a workspace minimum for learning), the system shows "Insufficient
  baseline", "not enough posts yet" or "not enough results yet" instead of a
  number. A topic below the floor is never proposed as a campaign.
- **Where it is visible.** Opportunities, Outcomes, Ideation, the learning
  panel.

### 4.6 No synthesised numbers — "not measured, never zero"

- **Human parallel.** Integrity: not filling gaps with guesses.
- **Error prevented.** Invented metrics that later become "facts".
- **How Platina does it.** A model never produces a number. Engagement
  indices, momentum, dates and days-to-event are computed by code from
  collected data; event dates a model extracts must appear verbatim on the
  page. A metric the platform did not report is stored as "not measured".
- **Where it is visible.** Results entry: "Leave a box empty when you don't
  have that number: empty means not measured, never zero."

### 4.7 Anti-echo memory — the system does not believe its own press

- **Human parallel.** Seeking out the opposing view; not quoting yourself as
  proof.
- **Error prevented.** Echo chambers: an AI citing its own earlier conclusions
  until they look like consensus.
- **How Platina does it.** When evidence is retrieved for a plan, brief or
  idea:
  - the Brain's own conclusions may fill at most **40%** of the evidence budget;
  - results are diversified (near-duplicates are pushed out) so one story
    cannot fill the context;
  - **one slot is reserved for counter-evidence**: the most relevant insight
    pointing the other way, or a claim that was already proved wrong on that
    subject. It is labelled "Counter-evidence (may contradict the above)". If
    none exists, the plan records "no counter-evidence found";
  - a conclusion may never support itself or anything in its own lineage.
- **Where it is visible.** Plan roadmap: "Counter-evidence the planner weighed".

### 4.8 Falsification and refutation memory — learning from being wrong

- **Human parallel.** Karl Popper's test of science: a claim is only useful if
  it can be proved wrong. And the habit of remembering mistakes so you do not
  repeat them.
- **Error prevented.** Sunk cost (defending a failed idea) and repeating
  failures.
- **How Platina does it.** A daily grader (05:00 UTC) checks every stored
  claim whose window has closed:

  | Measured result | What happens | Operator sees |
  |---|---|---|
  | Window not closed | Nothing | — |
  | Too few data points, or not measured | Marked insufficient; re-tested later | "Not enough data to test yet" |
  | The falsifier triggered | **Refuted**: demoted, confidence floored, excluded from supporting evidence, **kept** as counter-evidence | "Proved wrong on <date>: <metric> was <value>" |
  | Not triggered, effect held significantly | **Promoted** | "Held up when tested" |
  | Not triggered, effect weak | **Held**, weight unchanged | (still watching) |

- **Confidence is earned, not reported.** After the first grade, an insight's
  confidence becomes the mean of a Beta distribution over its record
  (1 + times held, 1 + times refuted). No model ever sets it again.
- **Nothing is deleted.** Every state change is written to an undo journal, so
  any lesson can be traced and reversed.

### 4.9 Exploration versus exploitation — not only doing what worked last time

- **Human parallel.** Good teams keep testing new ideas while doubling down on
  proven ones.
- **Error prevented.** Lock-in: one lucky early result dominating forever.
- **How Platina does it.** A feedback loop with **Thompson sampling** (a
  bandit method) over the workspace's own confirmed results — not deep
  reinforcement learning, because a client publishes tens of pieces a month,
  not thousands:
  - each confirmed result credits its features (topic, channel, format, hook,
    posting day, the opportunity it answered): worked = 1, mixed = 0.5,
    failed = 0;
  - each feature value keeps a Beta posterior; older results fade by a
    half-life so the loop keeps up with the market;
  - below the minimum count a value has no effect and says "not enough results
    yet";
  - ranking draws one random sample per value from a generator seeded by
    workspace and day, so the order is stable within a day but never frozen;
  - one slot per block is given to an untested option, labelled "trying
    something new" so nobody mistakes it for evidence.

### 4.10 Credit assignment — outcomes adjust what produced them

- **Human parallel.** Asking "which of my assumptions made this work?"
- **How Platina does it.** What happens to a suggestion (planned, dismissed
  and why, or a measured result) flows *backwards* along its record: to each
  feature it had, and as a **trust score** to each input it rested on. A
  measured result counts fully; a person's decision counts 0.3 of that, because
  it is an opinion before the market spoke. "Wrong fact" lowers that input's
  trust at full weight. Every credit is a readable count traceable to the
  event that caused it.

### 4.11 Human orchestration — automation without automation bias

- **Human parallel.** Accountability: someone signs.
- **Error prevented.** Automation bias (trusting the machine blindly) and the
  opposite, ignoring a tool you cannot see into.
- **How Platina does it.** Four gates exist in code and cannot be switched off
  (only who may use them is configurable): **declare**, **confirm**,
  **approve**, **publish**. Every gate event records the approver, the
  decision and a hash of exactly what was approved. Insights themselves can be
  approved, edited or rejected with a reason (wrong fact, not new, not
  testable, other). No lesson is stored without a person.

### 4.12 Summary table (for a single slide)

| Thinking error | Counter-habit built in | Operator sees |
|---|---|---|
| Reacting to everything | Predictive coding: hash → statistic → rule before any model | "Nothing unusual compared with this page's normal changes" |
| Overconfidence | Four questions incl. what would prove it wrong | "How we'll know if this is wrong" |
| Confirmation bias | Blind challenger, different provider, one round | "Second opinion", "Ruled out" |
| Seeing patterns in noise | Min-N + Mann–Whitney significance | "Not clearly different from usual" |
| Fake precision | Evidence floor | "Insufficient baseline" |
| Invented numbers | Code computes every number | "Not measured, never zero" |
| Echo chamber | 40% cap, diversity, counter-evidence slot | "Counter-evidence" |
| Sunk cost, repeated failures | Daily grading, refutation memory | "Proved wrong on …" / "Held up when tested" |
| Lock-in | Thompson sampling + labelled exploration | "Trying something new" |
| Automation bias | Four human gates, insight review | Approve / edit / reject with reason |

---

## 5. Users and use cases

### 5.1 Personas

| Persona | Goal | What Platina gives them |
|---|---|---|
| **Marketing lead** (decision maker) | Spend budget on what works; defend decisions | Plans that cite evidence, state their own test, and flag when that evidence is proved wrong |
| **Strategist / planner** | Respond fast to the market | Ranked opportunities with "why now", two-line brief → roadmap in seconds |
| **Content / brand owner** | Stay on brand and within regulated language | Brand standard declared by a person; claims screening that blocks risky words |
| **Analyst** | Honest numbers | Every number with its source; "not measured" instead of guesses; results import |
| **Executive / client sponsor** | Confidence in the agency | Cockpit, Live flow and Brain map showing what the system knows and how sure it is |

### 5.2 Use cases

Each use case: trigger → what the system does → what the person does →
output → guardrails.

**UC1 — Onboard a client in minutes**
- *Trigger:* a new client (brand) is added at `/start`.
- *System:* derives candidate sources (the client's own site, social pages,
  competitors) and checks which exist with header-only probes (no content
  read). Reads the client's own website (map → filter → read, capped per day)
  to build a profile of how the client speaks and what it sells.
- *Person:* confirms the client's own domains and social pages (an ownership
  allowlist), picks competitors, declares the brand standard.
- *Output:* a monitored client with competitors, sources and a profile.
- *Guardrails:* only the client's own pages are first-party; a competitor page
  is refused there and tracked as public data instead.

**UC2 — Competitor watch: "what changed, and when"**
- *Trigger:* scheduled collection (daily / weekly per source) or "read this
  link now".
- *System:* collects competitor pages, LinkedIn posts and ad-library entries;
  stops unchanged and unsurprising items; interrogates, challenges and gates
  the rest; writes a finding and, if it passes, a Brain insight.
- *Person:* triages findings (approve, dismiss, mark wrong).
- *Output:* Competitors page, Findings, alerts.
- *Guardrails:* public data is never cited as evidence on its own; ad data
  shows activity, never performance.

**UC3 — Opportunity finding: "ranked, with why now"**
- *Trigger:* opening `/opportunities` (computed on read).
- *System:* combines measured topic interest (engagement index against each
  company's median post, 30-day vs 90-day baseline), competitor ad pressure
  and the event calendar. Lists, in order: what people are interested in now →
  campaigns to run (online topics and events) → plan → creative.
- *Person:* picks an opportunity and hands it to the planner in one click.
- *Output:* ranked opportunities, each number next to its source link.
- *Guardrails:* ordering by stated rules, not an invented score; below the
  floor a topic says "not enough posts yet" and is never proposed.

**UC4 — Event readiness: "plan before, during, after"**
- *Trigger:* an event approaches (for example, ARABLAB LIVE, 26 Oct 2026, Dubai).
- *System:* event pages are read; a model names the event and copies the date
  and place words; code verifies those words are on the page and parses them.
  Participation is proven per competitor (for example, Bruker's attendance at
  ARABLAB LIVE 2026 was found from three of its own posts, though the event's
  partial exhibitor list did not name it — architecture spec, 21 Sep 2026).
- *Person:* starts a plan from the event; the date is fixed.
- *Output:* a roadmap planned backwards from the event day, covering before,
  during and after.
- *Guardrails:* events closer than 21 days are marked short notice; plans run
  at most 180 days.

**UC5 — Campaign planning: "region, budget, channels"**
- *Trigger:* a two-line brief at `/plan` ("what is being promoted, and who is
  it for"), or a plan started from a finding, an event or a client goal.
- *System:* assembles context (client profile, first-party evidence, public
  evidence, lessons from earlier plans, learned patterns), generates a plan of
  up to 8 phases (each with days, channel, message and the evidence ids it
  rests on), validates citations, runs an independent review, and saves it.
- *Person:* reads the plan and the reviewer's notes, approves or edits.
- *Output:* a visual roadmap, its evidence, its counter-evidence and its own
  stated test: "How we'll know if this plan is wrong".
- *Guardrails:* a phase may cite one evidence list only (never public and
  first-party together); a failed review is shown, never hidden.

**UC6 — Briefs and content: "on brand, with sources"**
- *Trigger:* an approved plan or opportunity.
- *System:* generates a brief and creative last, on demand, using the brand
  standard and cited evidence.
- *Person:* edits and approves.
- *Guardrails:* client profile is context only and is never cited as evidence.

**UC7 — Claims screening: "risky language blocked"**
- *Trigger:* final approval of a solution or content plan.
- *System:* deterministic scan for banned terms (defaults: "cure",
  "guaranteed", "best in class") and regulated claims ("clinically proven",
  "FDA approved"), or the workspace's own rules. When a top-ranked idea breaks
  a rule, an escalation shows both sides while the rule wins.
- *Person:* fixes the wording, or a named approver records an exception.
- *Guardrails:* no model opinion overrides a deterministic failure.

**UC8 — Results and learning: "measured, not guessed"**
- *Trigger:* a campaign's results arrive (CSV import, or read-only metrics
  from connected accounts).
- *System:* records each creative's numbers (blank = not measured), the person
  reviews worked / mixed / failed, the system updates feature statistics,
  credits inputs, and promotes or marks down the insights involved.
- *Person:* confirms the review. Nothing is learnt without confirmation.
- *Output:* Results, Learning ledger, Outcomes; next plans change.

**UC9 — Re-plan when the evidence changes**
- *Trigger:* new validated insights arrive in a plan's scope (3 or more marks
  the plan for re-planning), or evidence the plan cited is **proved wrong**.
- *System:* the plan shows "N new validated signals — worth re-planning" or
  "evidence behind this plan was proved wrong", pushed live.
- *Person:* clicks "Re-plan with the new evidence".
- *Output:* a revised plan that keeps what still holds, changes what the new
  evidence contradicts, and says what changed and why.

**UC10 — Retargeting: "who to reach again"**
- Uses measured engagement from the client's own results to decide which
  audiences and channels deserve another touch. The same min-N and
  not-measured rules apply.

---

## 6. The end-to-end journey

The product navigation follows the loop: **Watch → Decide → Make → Learn → Review.**

```
 ONBOARD          WATCH                 DECIDE              MAKE            LEARN                REVIEW
 /start      →    Live flow        →    Opportunities  →    Plan       →    Results         →    Audits
 client,          Brain map             ranked, why now     two-line        numbers in,          Findings
 own pages,       Events                                    brief →         review confirmed     Solutions
 competitors      Competitors                               roadmap,        Learning ledger
                  Ads                                       approved        Outcomes
                  Clients                                                        │
      ▲                                                                          │
      └──────────── the outcome tests the falsifier; next cycle ranks differently ┘
```

1. **Onboard.** The client's own domains and social pages are confirmed; the
   brand standard is declared by a person; competitors and events are chosen.
2. **Watch.** Collection runs on schedule. Most items stop at the cascade.
   The rest are interrogated, challenged, gated and written to the Brain.
3. **Decide.** Opportunities rank what to act on, each with its proof.
4. **Make.** The planner turns a two-line brief into a roadmap with evidence,
   counter-evidence and a stated test. A person approves. Claims are screened.
5. **Learn.** Results come back; a person confirms the review; the system
   updates what it believes, promotes and marks down insights, and credits
   inputs.
6. **Review.** Audits, findings and solutions keep a full record. The next
   plan starts from a smarter Brain.

---

## 7. Data flow

### 7.1 Sources

| Source | How it is collected | Cadence | Plane |
|---|---|---|---|
| Competitor and trade web pages (one page) | Firecrawl first (JavaScript rendered), Apify crawler as fallback | per source | B (public) |
| Competitor multi-page crawls | Apify only | per source | B |
| LinkedIn company posts | Apify | weekly (one-time backfill) | B |
| Meta and LinkedIn ad libraries | Apify (public libraries only; no ad-account login) | daily | B |
| Event / conference pages | Firecrawl | weekly | B |
| Client's own website | Firecrawl multi-page (map → filter → read, capped per day), then header-only change probes so only changed pages are re-read | daily cap | A (first-party, consented) |
| Client's campaign results | CSV import, or one read-only metrics call to connected accounts | when results land | A |
| Brand standard | Declared and confirmed by a person | on change | A |

Collection rules: the scheduler waits a cadence after the first success and
retries every 6 hours until then; budgets are a per-client first-pass allowance
then a workspace daily cap; every fetch of a URL someone else chose goes
through a safe-fetch layer that blocks private/internal addresses and re-checks
every redirect.

### 7.2 Three planes of trust

| Plane | What it holds | Embedded (searchable by meaning)? | Citable as evidence? |
|---|---|---|---|
| **B — Raw signal** | Public documents as collected | **No** (there is no embedding column) | **Never** |
| **A — Evidence** | The client's own pages, results and confirmed lessons | Yes | Yes |
| **C — Brain** | Derived, checked insights (debate claims, measured interest, events, facts) | Yes | As a hypothesis only, capped, never alone at depth ≥ 2 |

> Raw market signal has no embedding column, so it can never become a citation.

**Two-layer rule.** First-party data feeds the baseline and scoring. Public
data feeds a separate pattern layer. They are never mixed, and never both
cited in one "why this idea" explanation. A plan phase that cites both is
refused by code.

### 7.3 Step by step: from a page to a plan to a lesson

```
 SOURCE ─► fetch (Firecrawl / Apify) ─► SIGNAL DOCUMENT (Plane B, raw, never embedded)
                                              │
            ┌─────────────────────────────────┼──────────────────────────────┐
            ▼                                 ▼                              ▼
   ANALYSIS (per document)          INTEREST (per client)            EVENTS (per workspace)
   hash → triage → surprise →       engagement index vs each         model names event, copies
   interrogate (4 questions) →      company's median post;           date/place words; code
   blind challenger → gate          momentum = median, min-N 5;      verifies words on page,
   → finding + Brain insight        model assigns topics only        parses dates; proof per row
            │                                 │                              │
            └──────────────► INSIGHT WRITER (measured insights → one sentence each,
                             code-built falsifier, embedded; unchanged = untouched,
                             changed = superseded and rewritten) ◄───────────┘
                                              │
                                              ▼
                              BRAIN (Plane C vectors) + EVIDENCE (Plane A)
                                              │
              retrieval: vector + keyword → rank fusion → relevance floor →
              diversify → 40% derived cap → counter-evidence slot → rerank →
              token budget
                                              │
            ┌─────────────────────┬───────────┴──────────┬────────────────────┐
            ▼                     ▼                      ▼                    ▼
       OPPORTUNITIES          PLANNER                 IDEATION           LIVE FLOW / BRAIN MAP
                                  │
                         HUMAN GATE (approve / edit / reject)
                                  │
                         APPROVED OUTPUT (plan, brief, content) → claims screening
                                  │
                         MEASURED OUTCOME (Plane A, against the client's own baseline)
                                  │
                         WRITTEN BACK as new evidence; daily grader tests falsifiers;
                         learning re-weights features; credit flows to inputs
```

### 7.4 What data never does

- Raw public data is never embedded and never cited.
- A model never writes a number into the system.
- Platina never posts, schedules or writes through any account; it never logs
  in to an ad account.
- No query runs without a workspace filter; no data crosses workspaces.
- Nothing in the Brain is deleted; it is demoted, superseded or archived, with
  a journal entry.
- The real-time channel carries only "something changed" signals on an opaque
  per-workspace topic; pages refetch through their own authenticated render.

---

## 8. Core architecture

### 8.1 Stack

| Layer | Choice |
|---|---|
| Application | One Next.js 14 App Router TypeScript monolith (no separate Python service) |
| API | Route handlers and server actions |
| Background work | Inngest (scheduled and event-driven jobs) |
| Database | Postgres + pgvector via Drizzle ORM, hosted on Supabase |
| Auth | NextAuth v5, workspace membership and capabilities |
| UI | Tailwind + shadcn/ui; three.js for the 3D Live flow and Brain map |
| AI | One model router over Groq, Gemini (Flash and Pro), NVIDIA and AWS Bedrock |
| Collection | Firecrawl (single pages, own site), Apify (social, ad libraries, multi-page crawls) |
| Real time | Supabase Realtime broadcast, signal-only, with polling fallback |

### 8.2 The layers (matches deck slide 3)

```
 INPUTS                         ORCHESTRATOR                                  MEMORY
 ─────────────                  ──────────────────────────────                ──────────────────────
 Public market     ─────►       Context recipes                               Raw signal
 (competitors,                  decide exactly what the AI sees     ─────►    not embedded, never cited
  events, ads)                  Agents                                        Evidence
 Your campaigns    ─────►       propose, challenge, compose         ─────►    embedded, citable
 and outcomes                   Deterministic checks                          Brain
 Brand standard    ─────►       override every model                ─────►    embedded, hypothesis only
 (declared by a person)
                                MODEL ROUTER · fallback, budget caps, every call logged
```

**The orchestrator owns every write.** Agents only propose; the orchestrator
assembles context, runs the agent, validates its output, runs an independent
critic, and only then applies the result. No agent touches the database
directly, and **no agent spawns an agent** (the challenger is a second call
from the same job).

### 8.3 Model router

Every AI call goes through one router, so swapping a provider is configuration,
not a rebuild. Two ladders per workload:

| Workload | Fast ladder | Quality ladder |
|---|---|---|
| Interactive (a person is waiting) | Groq → Gemini → NVIDIA → Bedrock | Bedrock → Gemini → Groq → NVIDIA |
| Background (Inngest jobs) | NVIDIA → Gemini → Groq → Bedrock | Bedrock → Gemini → NVIDIA → Groq |

- A provider near its rate limit moves back in the ladder; a cooling provider
  moves last.
- A reply that is prose when JSON was asked ("derailed") falls through to the
  next model.
- Budget caps per workspace; every call is logged with provider, model and cost
  context.
- The blind challenger is deliberately routed to a different provider from the
  proposer.

### 8.4 Background jobs (Inngest)

| Job | What it does |
|---|---|
| Collection / audit runs | Fetch sources on cadence within budgets |
| `signal-analyze` | Cascade → interrogation → challenger → gate → finding + Brain insight (concurrency 4 per workspace, throttled) |
| `interest-extract` | Topic interest and momentum per client |
| `event-extract` | Events and participation proofs |
| Insight writer (`market-insight-sync`) | Measured insights into the Brain, at the end of both jobs |
| `platina-falsifier-grade` | Daily 05:00 UTC: grade claims whose window closed |
| `platina-learning` | Re-weight features from confirmed results |
| Monthly consolidation | Merge near-duplicates, report proxy-vs-outcome correlation, prune telemetry |

### 8.5 Key data structures

- `platina_signal_documents` — raw collected content, with content hash and
  skip cause.
- `platina_brain_chunks` — insights: kind (claim / measured / fact /
  compacted), what, mechanism, evidence refs, falsifier, subject and direction,
  grade state (untested / holding / promoted / refuted / insufficient), due
  date, confidence, agreement state, lineage, status.
- `platina_debate_transcripts` — proposer and challenger providers, models,
  prompt version, blinded, objected.
- `platina_expectations` — running mean and variance per source key (surprise
  filter).
- `platina_insight_grades` — append-only grading record.
- `platina_brain_state_log` — the undo journal for every Brain state change.
- `platina_brain_telemetry` — append-only stage decisions for the quality card.
- Plans, plan feedback, interest signals, events and participants, creative
  metrics, suggestions ledger, gate events.

### 8.6 Safe rollout: off / shadow / on

Every new Brain stage (interrogation, challenger, gate, surprise, retrieval,
budget, grading) runs behind a per-workspace mode:

- **off** — exactly the previous behaviour (byte-identical, tested);
- **shadow** — the new decision is computed and logged, nothing changes for
  the operator;
- **on** — the new decision is applied; if the stage itself fails, it falls
  back to the old path in the same request.

A mode flips to `on` only after its shadow numbers are read. Every migration is
additive and ships with a hand-written reverse.

### 8.7 Recovery in five levels

| Level | Failure | Return path | Time |
|---|---|---|---|
| L0 | A stage behaves badly | Flip its mode to off | seconds |
| L1 | Brain state changed wrongly | Undo journal reverses changes by cause and time | minutes |
| L2 | Documents skipped wrongly | Replay re-queues them (nothing was deleted) | 1–2 hours |
| L3 | A derived table is wrong | Rebuild from source history | minutes |
| L4 | A migration breaks | Restore table backup or run the down-SQL | minutes |

### 8.8 Isolation and boundaries

- `workspace_id` on every table and every query, enforced in the app layer,
  with tests that assert the filter is present in the generated SQL.
- Platina and the InstaMedia workspace surface share only auth, membership,
  the model router and neutral infrastructure; a boundary test enforces it.
- Shared safety modules: safe-fetch (no private addresses, redirects
  re-checked), ownership allowlist (first-party means the client's own pages).

---

## 9. Logical operations

This section describes each reasoning step precisely enough to be put on a
technical slide or appendix.

### 9.1 The five-step thinking pipeline (deck slide 2)

| Step | Name | Internal name | What happens |
|---|---|---|---|
| 1 | Notice | Predictive coding | Only surprising signals reach the AI (hash → surprise → triage) |
| 2 | Interrogate | Metacognition | One call, four questions: what, why, how, what would prove it wrong |
| 3 | Challenge | Veil of ignorance | A second AI attacks it blind, one round |
| 4 | Verify | No false patterns | Code checks schema, sample size, significance; deterministic gate wins |
| 5 | Remember | Provenance kept | Stored with its sources, its test, its due date and its lineage |

### 9.2 The cost cascade

`hash → statistic → rule → fast model → quality model → human`

| Rung | Implementation | Stops |
|---|---|---|
| Hash | Content hash with a unique index; header-only probes | Unchanged content |
| Statistic | Surprise filter (deviation ≥ 1.0 SD from the source's running mean; novelty for pages); min-N; Mann–Whitney | Normal changes; tiny samples; non-significant trends |
| Rule | Value triage (boilerplate, thin text, navigation); schema and testability checks; claims rules | Low-value pages; untestable claims; risky wording |
| Fast model | Rerank, blind challenger | Weak evidence; claims with material objections |
| Quality model | Interrogation (proposer), planner, idea engine | — |
| Human | Approve / edit / reject with reason | Anything a person disagrees with |

A unit test proves the cost guarantee for every filter: a skip means the model
router was never called.

### 9.3 Surprise filter (statistic rung)

- Observation per source kind: **novelty** for web pages
  (1 − word overlap with the previous version), **engagement index** for
  social posts (against the company's median), **median days running** for
  ads.
- Expectation per key updated on every observation with Welford's running
  mean and variance.
- `deviation = |observed − mean| / max(sd, floor)`; skip when below the floor
  (1.0).
- Cold start: below 5 observations per key, everything proceeds. Always
  proceed: first sighting of a URL, a change containing a date or a price.
- Spot check: a deterministic 10% of would-skip documents are analysed anyway.
- What it does not gate: measured interest, pressure, events and the public
  learning lane still read every document. Only the two-call debate is gated.

### 9.4 Interrogation contract

```text
headline    short title for lists
what        one claim, one sentence, no hedging, ≤ 220 characters
why         ids of numbered input lines [e1…eN], validated against the input
how         the mechanism
kind        claim | fact
falsifier   (required for claims)
            metric     from the registry only
            subject    brand and/or topic, resolvable in this workspace
            direction  above | below
            threshold  number
            window     30 or 90 days (as the metric declares)
confidence  low | medium | high  — recorded, never scored
```

Metric registry (each declares plane, table, segment, aggregation, windows,
minimum N and a scale version; comparing two different scale versions throws):
engagement index, topic momentum, ad days running, event participants, and
first-party creative metrics (engagement rate, click-through rate, leads).

Measured insights (interest trends) get falsifiers built by code, not by a
model: an "up" trend is refuted if topic momentum falls below 1.0 within 30
days, a "down" trend if it rises above 1.0. Ad-pressure and event insights
describe what exists now and carry no falsifier.

### 9.5 Blind challenger

- Input: only `what`, `how` and the text of the cited spans.
- Excluded: proposer provider and model, confidence, specificity, novelty
  reason, source URL or domain, raw JSON, prior scores.
- Output: `no_material_objection` or `objection` with the confounder.
- One round, enforced. Different provider from the proposer.
- Telemetry: objection rate per prompt version and per proposer model; alarm
  when the gap between proposer models exceeds 15 points at N ≥ 20.

### 9.6 Deterministic gate

1. Schema validity (interrogation contract).
2. Testability: the falsifier's segment already has at least the metric's
   minimum N.
3. Significance: one-sided Mann–Whitney U, recent vs baseline window, exact for
   small N and a normal approximation above 20; pass at p < 0.10.
4. Agreement score from deterministic inputs only: evidence coverage (valid
   citations ÷ 2, capped at 1), challenger confounder strength, falsifier
   validity.

### 9.7 Retrieval for planning (anti-echo)

1. Embed the brief; run vector and keyword queries in parallel (about 50
   candidates).
2. Fuse with reciprocal rank fusion; apply a relevance floor.
3. Diversify with maximal marginal relevance (λ = 0.7, word-overlap
   similarity, in process).
4. Cap Brain (derived) content at 40% of the evidence token budget.
5. Fill one counter-evidence slot (same subject, opposite direction, or a
   refuted claim on that subject).
6. Rerank with one fast model call (about 8 per plane).
7. Fit sections to a token budget (evidence 2,400 tokens; client standard 400;
   lessons and learned patterns 500), dropping whole chunks from the bottom —
   never cutting mid-sentence.
8. If the new retrieval fails, the same request falls back to the previous
   retrieval and logs it; the operator never gets a blank plan.

### 9.8 The planner flow

```
 two-line brief (or a finding / event / client goal turned into one)
   → assemble context: client profile (context only), first-party evidence,
     public evidence, counter-evidence, lessons (worked / failed), learned patterns,
     fixed date if any, earlier plan if revising
   → planner proposes: title, summary, 1–8 phases
       (name, start day, end day, channel, message, ≤ 4 evidence ids),
       revision note, stated test ("How we'll know if this plan is wrong")
   → validate: every cited id exists, one evidence list per phase, days in range
   → independent critic reviews; a failed review is shown, never hidden
   → orchestrator saves; a person approves
```

- Cold start: with no results logged, the planner is told to plan from the
  brief alone and not claim past evidence.
- Brief contract: 10–400 characters, at most two lines — what is promoted, and
  who it is for.
- Plans run at most 180 days; an event date anchors the plan backwards.

### 9.9 Freshness and real-time re-planning

- A saved plan watches its scope: when 3 or more new **gated** insights arrive,
  it shows "worth re-planning".
- If any evidence the plan cited is later refuted, the plan raises the stronger
  flag "evidence behind this plan was proved wrong", with a phase badge
  "Proved wrong on <date>". A promoted citation shows "Held up when tested".
- Changes are pushed live on the workspace's real-time channel.

### 9.10 Grading (the slow loop)

Daily at 05:00 UTC, per workspace: for each claim whose window has closed,
measure the falsifier's metric on its segment; apply the table in §4.8; record
the grade; update confidence to the Beta mean of its record; broadcast
refutations; write a measured-result event to the suggestions ledger so trust
scores update.

### 9.11 Learning (bandit re-weighting)

- Reward per confirmed result: worked 1, mixed 0.5, failed 0.
- Per feature value: Beta posterior with half-life fading; status
  "insufficient" below the minimum N.
- Ranking: one Thompson sample per value, seeded by workspace and day.
- Exploration: one slot per block for an untested option, labelled.
- The idea engine keeps an 80/20 split between learned and exploratory ideas.

### 9.12 The two loops (deck slide 4)

- **Fast loop proposes:** signal → insight (with its falsifier) →
  recommendation (cited, or refused) → campaign (approved by a person) →
  outcome (measured, not guessed).
- **Slow loop decides:** the outcome tests the falsifier → **Promoted**
  (confidence up, ranks first next cycle), **Held** (weight unchanged, keep
  watching) or **Demoted, kept** (excluded from answers, never re-proposed).

---

## 10. Guardrails, trust and safety

### 10.1 What stops it teaching itself nonsense (deck slide 4)

| Guardrail | Rule |
|---|---|
| Memory capped | Its own past conclusions stay a minority (≤ 40%) of any answer |
| Opposing view | One counter-evidence slot in every answer |
| Evidence floor | Below the minimum data points it says "not enough data" |
| Human confirms | No lesson is stored without a person |

### 10.2 Structural invariants (each proven by a named test)

| Invariant | Proven by |
|---|---|
| No model call on unchanged content | Hash index + skip ⇒ router never called |
| No insight without a testable falsifier | The Brain writer refuses a claim without a valid falsifier |
| The challenger is blind, exactly once | Redaction assertions; one-round rule |
| Deterministic gates override every model | Gate refusal ⇒ no Brain write |
| Derived ≤ cap, never self-cited | Cap and lineage tests |
| Every metric declares its scale | Registry completeness; mixed scales throw |
| Refuted insights demoted, never deleted | No delete query exists for Brain rows |
| A human approves every output that leaves | Gate and publish tests |

### 10.3 Data and security

- Workspace isolation on every query, asserted in tests.
- Safe-fetch for any URL someone else chose: no private or internal addresses,
  every redirect re-checked.
- First-party ingest only from the client's own allowlisted domains and pages.
- No ad-account connections; ad insight from public ad libraries only.
- Read-only metrics; no posting or scheduling from Platina.
- Every gate event records who, what (hash of the payload) and the decision.

### 10.4 Degradation ladder

| Failure | What happens |
|---|---|
| A model provider throttles | The router swaps provider |
| A connected platform's API is down | Fall back to CSV import |
| Knowledge is stale | Flagged, never silently served |
| Real time is down | Pages fall back to polling every 20 seconds |
| A new Brain stage fails | Falls back to the previous path in the same request |

---

## 11. Proof points: what is built and verified

Use these as factual statements in the final document. Each carries its date.

**Engineering (handoff of 15 Oct 2026)**
- All Brain stages B0–B9 built and on `main`.
- 3,198 tests passed, 0 failed (321 files); typecheck, lint and production
  build clean. Before the Brain work the suite had 2,787 tests.
- Migrations 0087–0090 applied to Supabase; readiness check prints OK.
- Pre-migration table backup and a restore snapshot saved.

**Live data, client workspace (architecture spec of 21 Sep 2026)**
- 151 LinkedIn posts from 6 companies after a three-month backfill (about
  $0.30 of collection cost).
- 8 interest subjects pass the minimum-N gate. Examples: PFAS analysis 1.34×
  (8 posts, 3 companies); mass spectrometry 1.09× (41 posts, 6 companies — down
  from 2.43× after one viral post was neutralised by using the median).
- 25 events known, 8 upcoming, 28 participation proofs; a competitor's
  attendance at ARABLAB LIVE 2026 found from its own posts.
- A planner brief about "a Dubai trade show" retrieved the ARABLAB insight
  first; a plan created from the Opportunities page in about 10 seconds,
  citing evidence.
- Two model-extracted event dates rejected live because the words were not on
  the page.

**Brain state at migration (15 Oct 2026)**
- 239 active Brain insights, 61 superseded, 448 signal documents, 280 debate
  transcripts — all intact through the migration.

**Defects found and fixed in the open (examples)**
- One viral post (18×) inflated a topic's average → momentum now uses the median.
- Measured insights never reached the Brain → the insight writer was added.
- Generic phrases ("analytical systems") taken as topics → filter widened.

---

## 12. The pitch narrative and run of show

### 12.1 Story arc

1. **Pain** — confident recommendations that turned out wrong, and nobody can
   say why.
2. **Belief** — intelligence is knowing how sure to be.
3. **System** — an agency in software, one Brain in the middle.
4. **Thinking** — five steps, four questions, a blind challenge, code checks.
5. **Proof** — one campaign traced live from signal to outcome.
6. **Peak** — the system is wrong, records it, and changes the next plan.
7. **Close** — the loop; humans decide what it learns.

### 12.2 Audience psychology (how the pitch itself is tuned)

- **Open with a felt pain**, not features. Ask: "When did a recommendation last
  tell you what would prove it wrong?"
- **One thread, start to end.** Follow one client and one campaign on every
  screen. Stories are remembered; tours are not.
- **Make refusal the hero.** Every "not enough data" and "not measured" on
  screen is a trust moment. Admitting limits makes the confident parts
  believable.
- **Design the peak.** The most memorable moment is the system marking one of
  its own insights down. Prepare the data so it happens reliably.
- **End on the loop.** The last image is slide 4: the outcome returns and tests
  the falsifier.
- **Concrete over abstract.** Say "PFAS analysis interest is 1.34× the usual
  post across 3 companies", not "we detect trends".

### 12.3 Run of show (about 18 minutes + questions)

| # | Time | Slide / screen | Message | Proof moment |
|---|---|---|---|---|
| 0 | 1:30 | New slide: The problem | Confident is not the same as right | Side-by-side: a typical AI recommendation (no source, no test) vs a Platina insight |
| 1 | 1:30 | **Slide 1** — Sense / Act / One Brain | An always-on agency in software; a person makes every final call | Point to the Brain in the middle |
| 2 | 2:00 | Demo: Cockpit → Live flow | It watches everything but only reacts to what changed | Most signals stop before any model |
| 3 | 1:30 | Demo: Competitors / Events | Market moves, with proof links | A competitor's event attendance found from its own posts |
| 4 | 1:30 | **Slide 2** — Logical operations | Four questions, blind challenger, code verifies, cost cascade | Read one claim aloud with its "what would prove it wrong" |
| 5 | 2:00 | Demo: Brain map → Findings | Insights are hypotheses with tests; some are ruled out | A "Ruled out" finding |
| 6 | 1:00 | **Slide 3** — Data flows | Truth vs meaning; raw signal can never be cited | "Public data is watched, never cited" |
| 7 | 1:30 | Demo: Opportunities | Ranked, with why now; "not enough posts yet" where true | A topic held back by the evidence floor |
| 8 | 2:30 | Demo: Plan | Two-line brief → roadmap, cited, counter-evidence, stated test, approved | Type the brief live |
| 9 | 2:00 | Demo: Results → confirm | Outcome returns; blank is "not measured" | **The peak:** "promoted / marked down" |
| 10 | 1:00 | Demo: Plan → Re-plan | Same brief, different plan | Revision note says what changed and why |
| 11 | 1:00 | **Slide 4** — the loop + guardrails | Fast loop proposes, slow loop decides | "AI learns from itself. Humans decide what it learns." |
| 12 | 0:30 | New slide: The ask | Pilot: one client, one campaign, one cycle | Restate the one sentence |

### 12.4 Talk track

**0. The problem.** "Every marketing team has had this: a confident
recommendation, a budget spent, a result that missed — and nobody can say
whether the idea was wrong or the execution was. AI tools make this worse,
because they are confident about everything. We built the opposite: an AI that
knows how sure it should be."

**1. Slide 1.** "Platina does the work of a marketing agency. It senses on the
left and acts on the right, and everything passes through one Brain. What makes
the Brain different is that every insight has to answer four questions before
it is trusted: what, why, how, and what would prove it wrong."

**2. Live flow.** "This is the market moving right now. Notice that most of it
stops here. A fingerprint says nothing changed; a statistic says this change is
normal for this page. The AI only sees what is genuinely surprising — the way
you don't notice the fridge until it stops humming. That's why it's cheap
enough to run all day."

**3. Competitors / events.** "Every number here sits next to its source. This
competitor's attendance at the event wasn't on the exhibitor list — the system
found it in the competitor's own posts, and the proof is one click away."

**4. Slide 2.** "Five steps. It ignores what hasn't changed, interrogates what
has, lets a second model attack the claim without knowing who made it, and lets
code check the numbers. The key is the fourth question: what would prove it
wrong. That test is stored with the insight, and used later."

**5. Brain map / Findings.** Open one insight and read its four answers. "Here
the second opinion found a problem, and the claim was ruled out. It isn't
deleted — it's kept, so the same idea never comes back."

**6. Slide 3.** "Two kinds of memory. Public market data is watched but never
embedded, so it can never be quoted as proof. Only your own measured results
become evidence. The orchestrator is the only thing allowed to write."

**7. Opportunities.** "Ranked by measured interest, competitor pressure and
event timing. And here — 'not enough posts yet'. It refuses to rank what it
can't measure."

**8. Plan.** Type the two-line brief. "Each phase cites its evidence. Here is the
counter-evidence it weighed. And here is the plan's own test: how we'll know if
this plan is wrong. Nothing goes out until a person approves it."

**9. Results — the peak.** Enter results, leaving one box empty. "Empty isn't
zero. If the platform didn't report it, it's not measured." Confirm. "Watch
this line: one insight promoted, one marked down. The system just learnt it
was wrong about something — and it won't propose that again."

**10. Re-plan.** "Same brief as ten minutes ago. Different plan. Not because we
retrained a model — because it tested its own beliefs against your results.
Read the revision note: it tells you what changed and why."

**11. Slide 4.** Trace the loop with your hand. "Four guardrails stop it
teaching itself nonsense: its own conclusions stay a minority, there's always
an opposing view, it refuses below the evidence floor, and a person confirms
every lesson. AI learns from itself. Humans decide what it learns."

**12. The ask.** "One client, one campaign, one full cycle. You'll see what it
believed, what it tested, and what it learnt."

---

## 13. Demo script, screen by screen

Use one client and one campaign throughout. Do not invent figures on stage —
use only what the seeded workspace shows.

| Step | Route | Click / action | Point at | Say |
|---|---|---|---|---|
| 1 | `/p/<ws>` (Cockpit) | Open | The summary of what is being watched and what needs a decision | "This is the agency's desk." |
| 2 | `/p/<ws>/live` | Open, let it animate | Particles stopping before "AI analysis"; the Brain point cloud | "Most signals stop here." |
| 3 | `/p/<ws>/competitors` | Open one competitor | A recent change with its date and source link | "What changed, and when." |
| 4 | `/p/<ws>/events` | Open the upcoming event | Participation proofs | "Proof per row." |
| 5 | `/p/<ws>/brain-map` | Click an insight node | What / why / how / "How we'll know if this is wrong" | "A hypothesis, with its test." |
| 6 | `/p/<ws>/findings` | Filter to ruled-out | A "Ruled out" finding and its second opinion | "The challenger won." |
| 7 | `/p/<ws>/opportunities` | Scroll the list | A topic with its engagement index and proofs; one marked "not enough posts yet" | "Measured, or refused." |
| 8 | `/p/<ws>/plan` | Type the two-line brief, submit | Roadmap phases, evidence ids, counter-evidence, stated test, review notes | "Cited, challenged, testable." |
| 9 | `/p/<ws>/results/<id>` | Enter numbers, leave one empty, confirm review | "not measured, never zero"; the promoted / marked-down banner | "It just learnt it was wrong." |
| 10 | `/p/<ws>/learning` | Open | The ledger entry and feature statistics | "Every lesson is traceable." |
| 11 | `/p/<ws>/plan/<id>` | "Re-plan with the new evidence" | The revision note | "Same brief, different plan." |
| 12 | `/p/<ws>/admin/health` (optional) | Brain quality card | Objection rate, gate holds, skipped-as-unusual share | "It measures its own thinking." |

### 13.1 The demo thread (fill with real seeded data)

1. **Signal:** a competitor changes something public (a page, an ad, an event
   presence).
2. **Insight:** the Brain forms a claim with a test — for example, "event-led
   content will beat product content for this segment; wrong if the
   engagement index for the topic falls below 1.0 within 30 days".
3. **Challenge:** Findings shows whether it was contested.
4. **Recommendation:** Opportunities → the campaign, with proofs.
5. **Campaign:** Plan → two-line brief → roadmap → approved.
6. **Outcome:** Results → numbers entered (one left blank) → confirmed.
7. **Learning:** promoted / marked-down banner → Learning ledger → Re-plan.

---

## 14. Demo preparation and runbook

### 14.1 Important constraints found in the current state

- **Every Brain stage is currently `off` in every workspace** (owner decision
  for the showcase, 15 Oct 2026). The planner's stated test works in any mode;
  counter-evidence, testable insights and "Held" gate results need their stages
  switched on.
- **Freeze on the client workspace:** no stage may be switched `on` in
  `waters-gcc-internal` before **27 Oct 2026** (ARABLAB LIVE is 26 Oct).
  Shadow is allowed. For a demo before then, use a second demo workspace, or
  the owner lifts the freeze for the demo.
- **"Proved wrong on …" / "Held up when tested" badges need grades,** and
  grading windows are 30 or 90 days. They will not appear on fresh data. The
  reliable peak moment is the **Results confirm banner** (promoted / marked
  down), which comes from the results learning loop and does not wait for a
  window.

### 14.2 Bring the system up

```
npm run platina:brain-readiness          # must print OK for 0087–0090
npm run dev:all                          # Next.js + Inngest dev server
```

### 14.3 Set the stages for the demo workspace

```
npm run platina:brain-snapshot -- --ws <ws>          # restore point first
npm run platina:brain-mode -- --ws <ws> --stage retrieval --mode on --apply
npm run platina:brain-mode -- --ws <ws> --stage budget --mode on --apply
npm run platina:brain-mode -- --ws <ws> --stage interrogation --mode on --apply
npm run platina:brain-mode -- --ws <ws> --stage gate --mode on --apply
npm run platina:brain-mode -- --ws <ws> --stage challenger --mode shadow --apply
npm run platina:brain-mode -- --ws <ws> --stage surprise --mode shadow --apply
npm run platina:brain-mode -- --ws <ws> --stage grading --mode shadow --apply
npm run platina:brain-mode -- --ws <ws>              # show the result
```

In `waters-gcc-internal` before 27 Oct, use `shadow` for every stage instead.
Each step that touches the database needs the owner's yes.

### 14.4 What each demo screen needs

| Screen | Shows | Needs |
|---|---|---|
| Plan → roadmap | "How we'll know if this plan is wrong" | Nothing (any mode) |
| Same roadmap | "Counter-evidence the planner weighed" | `retrieval` on, and an insight pointing the other way |
| Freshness banner | "N new validated signals… worth re-planning" | New gated insights after the plan was written |
| Evidence badges | "Held up when tested" / "Proved wrong on …" | Grades (30/90-day windows — not on fresh data) |
| Findings | Testable insight with its test; "Held: <reason>" | `interrogation` on (`gate` on for "Held"), a signal analysed after the flip |
| Admin → Health | Objection rate, gate holds, skip share, spot-check hit rate | Any stage in shadow/on plus a day of job runs |

### 14.5 Checklist

- [ ] Readiness OK; `npm run dev:all` running; Inngest dev server healthy.
- [ ] Demo workspace chosen (respecting the 27 Oct freeze) and snapshot taken.
- [ ] Seeded: client with own domains confirmed, 2–3 competitors, one upcoming
      event, Brain insights with tests, at least one "Ruled out" finding.
- [ ] A saved plan, plus a results set ready to enter that will mark down at
      least one insight (guarantees the peak).
- [ ] One topic deliberately below the evidence floor.
- [ ] One insight pointing the other way, so counter-evidence appears.
- [ ] Model provider keys valid; know the fallback if one throttles.
- [ ] Screen recordings of every step as backup.
- [ ] Browser tabs open in order: Cockpit, Live flow, Competitors, Events,
      Brain map, Findings, Opportunities, Plan, Results, Learning.
- [ ] Rehearse steps 8–11 three times; they carry the pitch.
- [ ] After the demo: roll stages back with `--mode off`, or restore the
      snapshot.

### 14.6 Roll back

- One stage: `npm run platina:brain-mode -- --ws <ws> --stage <s> --mode off --apply`
- All Brain state: `npm run platina:brain-snapshot -- --restore backups/<file>.json --archive-new --apply`
- Writes by one stage since a time: `npm run platina:brain-undo -- --ws <ws> --cause <stage> --since <ISO time> --apply`

---

## 15. Questions and objections

| Question | Answer |
|---|---|
| Isn't this just RAG (retrieval-augmented generation)? | Retrieval is one step of five. Platina interrogates before it stores, stores the test with the claim, challenges it blind, checks it with code, and grades itself later. That is *metacognitive* retrieval: it knows how much to trust what it retrieves. |
| Can it learn the wrong lesson? | Four guardrails: memory capped, opposing view, evidence floor, human confirmation. Refuted claims are kept, and every Brain state change is journaled, so a wrong lesson can be traced and undone. |
| What if there isn't enough data yet? | It says so: "Insufficient baseline" or "not enough data to test yet". Plans in a new workspace are told to plan from the brief alone and not claim past evidence. |
| Why should we trust the outputs? | Every number has a source; deterministic checks override the models; a person approves every output; the model's own confidence is never scored. |
| Is it reinforcement learning? | It is a feedback loop plus bandit re-weighting (Thompson sampling) over your own confirmed results, gated by sample size. Deep reinforcement learning needs thousands of outcomes; a marketing team has tens. |
| Which AI models? | One router across Groq, Gemini, NVIDIA and AWS Bedrock with fallback and budget caps. Changing provider is configuration. The challenger always uses a different provider from the proposer. |
| How expensive is it to run all day? | The cascade stops most items before any model call; a three-month LinkedIn backfill for six companies cost about $0.30 in collection. Every stage reports how much volume it removed. |
| Do you touch our ad accounts or post for us? | No. Ad insight comes from public ad libraries; account metrics are read-only; Platina never posts or schedules. |
| What about competitor data — is it legal / ethical? | Only public sources, through Apify and Firecrawl, tagged public, never cited as proof, never mixed with your own data. |
| What happens if something breaks? | Every new stage can be switched off per workspace in seconds; five recovery levels down to table restore; nothing in the Brain is ever deleted. |
| What about data isolation between clients? | Every query is filtered by workspace and tests assert it in the SQL. |
| Does it measure revenue or ROI? | No. Sales impact is measured from logged campaign results. We do not claim a revenue or ROI figure. |

---

## 16. What we must not claim, and what is still open

### 16.1 Do not claim

- A revenue or ROI figure.
- Any number the platform did not report.
- Ad-account connections, posting or scheduling.
- "Deep reinforcement learning" or "self-training model".
- That the system decides on its own — a person approves every output.
- Graded "proved wrong / held up" results on fresh data (windows are 30/90 days).
- A Client Portal or client-facing views (out of scope until unblocked).

### 16.2 Open items (honest roadmap)

- **Grading the plan's own stated test** is deferred until there is a per-plan
  measure (leads, click-through, engagement) for each plan.
- The surprise filter compares a page with one previous version, not the last
  five; acceptable for now.
- Date detection for the "always proceed" rule catches year-qualified dates
  only.
- An own-code web adapter may replace Apify for some fetches later without a
  schema change.
- The embedding model stays at 768 dimensions; a larger model is a separate
  re-embed decision.
- Client Portal and org-admin / client-viewer views remain out of scope.

---

## 17. Appendices

### Appendix A — Internal names and what the operator sees

| Internal | Shown in the product |
|---|---|
| Hash stop | "Unchanged since last read" |
| Surprise filter skip | "Nothing unusual compared with this page's normal changes" |
| Audit sample | "Checked anyway (spot check)" |
| Falsifier | "How we'll know if this is wrong" |
| Refuted | "Proved wrong on <date>: <metric> was <value>" |
| Promoted | "Held up when tested" |
| Insufficient | "Not enough data to test yet" |
| Blind challenger | "Second opinion" |
| Disconfirming slot | "Counter-evidence" |
| Derived cap | (not shown) |
| Explore slot | "Trying something new" |

### Appendix B — Route map (Platina, `/p/<ws>`)

| Group | Page | Route |
|---|---|---|
| — | Cockpit | `/p/<ws>` |
| Watch | Live flow | `/live` |
| Watch | Brain map | `/brain-map` |
| Watch | Events | `/events` |
| Watch | Competitors | `/competitors` |
| Watch | Ads | `/ads` |
| Watch | Clients | `/brands` |
| Decide | Opportunities | `/opportunities` |
| Decide | Plan | `/plan`, `/plan/<planId>` |
| Learn | Results | `/results`, `/results/<id>` |
| Learn | Learning | `/learning` |
| Learn | Outcomes | `/outcomes` |
| Review | Audits | `/audits` |
| Review | Findings | `/findings` |
| Review | Solutions | `/solutions` |
| Admin | Admin, Health | `/admin`, `/admin/health` |
| Onboarding | Start | `/start`, `/start/<brandId>` |

### Appendix C — Module map (for technical readers)

| Concern | Module(s) under `src/lib/platina/` |
|---|---|
| Fetch registry, Firecrawl, probes, budgets, schedule | `fetch/*` |
| Value triage, surprise, significance | `signal-value.ts`, `surprise.ts`, `significance.ts` |
| Interrogation and falsifier registry | `interrogation.ts`, `falsifier-metrics.ts` |
| Debate and blind challenger | `debate.ts`, `challenger.ts`, `objection-rate.ts` |
| Deterministic gate | `insight-gate.ts`, `contradiction.ts` |
| Brain, state journal, modes, telemetry | `brain.ts`, `brain-state.ts`, `brain-modes.ts`, `brain-telemetry.ts` |
| Retrieval, fusion, diversity, budget | `retrieval.ts`, `retrieve.ts`, `fusion.ts`, `diversify.ts`, `rerank.ts`, `context-budget.ts` |
| Interest, events, opportunities | `interest.ts`, `events.ts`, `opportunities.ts` |
| Planner | `plan/agent.ts`, `plan/context.ts`, `plan/flow.ts`, `plan/falsifier.ts`, `plan/freshness.ts`, `plan/usecases.ts` |
| Grading and demotion | `falsifier-grade.ts`, `demote.ts` |
| Learning and credit | `learning.ts`, `credit.ts`, `consolidate.ts` |
| Claims and gates | `claims.ts`, `claims-gate.ts`, `gates.ts` |
| Recovery | `brain-recovery.ts`, `brain-readiness.ts` |

### Appendix D — Brain quality metrics (Admin → Health)

| Metric | Healthy |
|---|---|
| Share of fetched documents reaching a model call | Falling after the surprise filter |
| Volume stopped at each stage | Every stage removes volume |
| Spot checks that found something | Under 20% |
| Claims with a valid test | Toward 100% when on |
| Objection rate | 20–70% |
| Agreement gap between proposer models | Under 15 points |
| Later-refuted share of accepted claims | Tracked month on month |
| Derived share of context | ≤ 40% |
| Self-citation rate | 0 when on |
| Counter-evidence fill rate | Rising as grades land |
| Proxy vs outcome correlation | ≥ 0.3 |

No metric is shown below its minimum N; below it, the card reads "not enough
data yet".
