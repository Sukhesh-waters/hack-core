# Platina AI for Waters — Real-Time Full-Suite Rebuild Plan

**Date:** 2026-09-11  
**Status:** Proposed — implementation requires owner approval  
**Product surface:** `/p/[ws]` only  
**Primary reference:** `platina-waters-dataflow-revised.html`  

## Goal

Turn the current Platina prototype into a Waters-specific executive operating
surface that detects meaningful changes, validates them, explains their
business impact, recommends a governed response, supports internal execution,
and verifies the result.

The product pathway is:

> Detect → Validate → Explain → Recommend → Approve → Execute → Verify

The full suite covers five Waters use cases:

1. Competitor and market-change audits.
2. Conference and event campaign readiness.
3. Brand and terminology drift.
4. Claims and compliance review.
5. Campaign outcome and lead-quality optimization.

Implementation remains one reviewable vertical slice at a time. “Full suite”
defines the destination; it does not authorize one large unreviewable rewrite.

---

## Validated owner decisions

- Build the full suite, then deliver it step by step.
- Redesign the full Platina shell before completing all feature pathways.
- Use an executive, report-first blue-and-white visual system.
- Make the Cockpit the main action surface, with drill-down pages.
- Use outcome-oriented navigation:
  - Cockpit
  - Audits
  - Findings
  - Solutions
  - Outcomes
  - Admin
- Define “real time” as:
  - immediate run creation and visible progress;
  - public-source scans on a configurable 5–15 minute cadence;
  - live UI invalidation when state changes;
  - alerts when findings or approval work arrive;
  - a polling fallback when Realtime is unavailable.
- Scan competitor sites, product pages, trade press, conference sources, and
  ad libraries through Apify in V1. The operator chooses the sites and handles;
  the adapter registry selects the actor. An own-code scraper is a later
  registry swap, not a V1 path.
- Default probe cadence is 5 minutes (10/15 opt-in). Tier-2 actor fetches are
  change-triggered, not cadence-driven. Source kinds with no cheap probe
  signal (JS-rendered pages, ad libraries) use adaptive cadence: 6-hour start,
  tightening toward the configured interval as observed change frequency rises,
  backing off after a configurable run of unchanged fetches. Per-source change
  frequency is recorded.
- Build a slim Waters-native execution layer under `/p`:
  - campaign work board;
  - event-anchored calendar;
  - assignments and due dates;
  - claims review;
  - final approval;
  - exportable action packet.
- Keep all four safeguards, but present them in plain business language.
- Do not write to any Waters production, test, or QA system.
- Remove from the Platina experience:
  - “Open InstaMedia” and `/w/*` references;
  - Instagram, reels, hashtags, engagement, and social-publishing concepts;
  - technical S1–S12, Plane A/B/C, generation, and Gate 1–4 labels from the
    normal operator UI.
- Preserve core features. Remove or redirect additional features only after a
  manual owner review of the replacement.

Planning defaults already decided by the owner (2026-09-11):

- `workspace_id` is the only security boundary. A Platina workspace profile
  stores Waters division and region as metadata on that same id. Do not add a
  second tenant key, a concatenated division-region id, or Postgres RLS.
- One Platina workspace is one Waters division × region operating boundary.
  Cross-division rollups stay out of scope.
- V1 public fetch is Apify-only. The operator picks URLs/handles; the registry
  maps source kind → actor. The model router may classify a target and choose
  an actor key. It never fetches, never writes first-party evidence, and never
  spawns another agent. Custom APIs and an own-code web adapter land later as
  additional registered adapters with no schema change.
- Default cadence is 5 minutes, with 10/15 as opt-in.
- V1 alerts are in-app Platina alerts only.
- The V1 action packet is a printable HTML view plus a versioned JSON download.
  A browser can save the printable view as PDF without adding a PDF service.
- Team chat, InstaMedia tickets, and InstaMedia SOP runs are not part of the
  slim Platina execution layer. The two latent bridges
  (`platina_campaigns.sop_run_id` and alert actions `hub_message` / `ticket` /
  `email`) are archived: never read, never written, never executed. Drop them
  after a data inspection, do not keep them as live integration points.

---

## Audit findings that drive this plan

The current implementation is not yet the product described by the revised
Waters map.

- The Cockpit renders five counts, but cannot start, monitor, or inspect work.
- Scan targets look like competitor URLs, but the registered Apify adapter
  invokes an Instagram-post connector.
- Scan status and `lastRunAt` are not maintained through the job lifecycle.
- Raw signals, debate transcripts, contested findings, and human rulings have
  no operator-facing workflow.
- The Brain page exposes internal storage concepts instead of actionable
  findings.
- Ideation uses all rows, hardcodes a minimum sample of one, and does not call
  the semantic retrieval module.
- Saved workspace thresholds are not consumed by the runtime paths they are
  intended to govern.
- Publishing records an approval event but does not change campaign state or
  create executable work.
- Claims rules are hardcoded and disconnected from the Brand Gene and final
  approval.
- Receipt grading does not write measured outcomes into the authoritative
  first-party layer or demote contradicted hypotheses.
- Most background functions count rows rather than move the workflow.
- Platina has no Realtime subscriber, live status grammar, or polling fallback.
- Several current labels and links expose InstaMedia or implementation details
  instead of Waters user outcomes.
- No verified Apify actor inventory currently proves coverage for competitor
  sites, trade press, conference sources, and public ad libraries.
- Division and region are described by the Waters reference but are absent
  from the Platina data model.
- `platina_campaigns.sop_run_id` and current alert action names can invite
  accidental writes into InstaMedia execution surfaces unless explicitly
  prohibited.

The existing schema, gate-event ledger, contradiction code, model router,
workspace checks, and Inngest registration are useful foundations and should
be extended rather than discarded.

---

## Document precedence and scope boundary

Use documents in this order when they conflict:

1. `CLAUDE.md` — build constitution and non-negotiable architecture.
2. This approved plan.
3. `platina-waters-dataflow-revised.html` — Waters product/dataflow reference.
4. Platina code and tests.
5. InstaMedia architecture, audits, catalogues, and historical plans — useful
   implementation precedent only, not Platina product requirements.

Important conflict resolution:

- The revised HTML says an own-code public fetch. The constitution says Platina
  public fetches must use Apify until an own-code adapter is explicitly shipped.
  This plan uses Apify in V1 and keeps the adapter registry so an own-code
  adapter can replace it later without a schema change. A header-only change
  probe that retrieves no content is permitted as own code under the
  constitution; Tier-2 content fetches remain Apify-only.
- InstaMedia docs refuse own scrapers and define social engagement workflows.
  Those decisions remain valid for `/w`, but social product behavior is not
  carried into `/p`.
- Existing InstaMedia real-time code is a useful pattern, but Platina remains a
  separate product. Platina gets its own topic, scopes, hooks, and event names.
- Nothing in this plan removes, redirects, or rewrites `/w/*`, InstaMedia
  tables, or InstaMedia business behavior.
- Platina code may import shared auth, workspace membership, the model router,
  database connection/schema identity tables, and Inngest infrastructure. It
  may not call InstaMedia ticket, Hub, SOP, content, calendar, campaign, or
  notification query/action modules.
- Existing `platina_campaigns.sop_run_id` is archived. Application code must
  not read or write it. Removal of the column is a separate migration after
  inspecting existing rows.
- Existing Platina alert actions named `hub_message`, `ticket`, or `email` are
  archived and must not execute. V1 replaces them with Platina-local `in_app`
  routing.

---

## Product promise and success criteria

An operator must be able to:

1. Open the Cockpit and understand what changed, what matters, what is blocked,
   and what needs approval without navigating through technical stores.
2. Start an approved audit and receive immediate client acknowledgement, then
   see its durable queued/running state within a 15-second operational target.
   This target does not promise completed external scan results in 15 seconds.
3. Receive new data from scheduled public scans within the selected 5–15 minute
   cadence, subject to Apify execution latency and rate limits.
4. Open a finding and trace it to public source snapshots, contradiction
   reasoning, and any human ruling.
5. Distinguish verified first-party evidence from unvalidated market
   hypotheses without seeing storage-plane jargon.
6. Turn a finding into a concrete solution with owner, due date, expected
   outcome, measurement plan, risk, and approval state.
7. Execute approved work in Platina without writing to Waters systems.
8. Export an approved action packet for execution elsewhere.
9. Import or ingest consented outcome data and see whether the solution worked.
10. See stale, degraded, insufficient-sample, and provider-failure states
    honestly; no placeholder “live” data and no fabricated confidence.

Operational targets:

- Every user-facing query and mutation is workspace scoped.
- Every async run is resumable/idempotent and has a visible terminal state.
- Realtime transport carries signal-only payloads; authenticated refetch loads
  the data.
- Realtime failure falls back to polling without failing the write.
- No recommendation is presented as validated when it lacks the required
  first-party baseline.
- No external Waters write endpoint or credential is introduced.
- Each shipped slice passes typecheck, lint, unit/integration tests, build, and
  its relevant Playwright path.

---

## Target information architecture

### 1. Cockpit — `/p/[ws]`

The executive command center.

- Health row:
  - data freshness;
  - last successful scan;
  - active/degraded sources;
  - live connection state;
  - unresolved critical findings.
- Decision row:
  - findings requiring validation;
  - solutions awaiting approval;
  - work at risk;
  - outcomes due for review.
- Live activity:
  - audit started/completed;
  - new finding;
  - human validation;
  - solution approval;
  - outcome recorded.
- Use-case portfolio:
  - competitive intelligence;
  - event readiness;
  - brand drift;
  - claims;
  - campaign performance.
- Primary actions:
  - start approved audit;
  - review critical finding;
  - approve solution;
  - review due outcome.

No fake KPI is shown. Empty states explain the exact setup action required.

### 2. Audits — `/p/[ws]/audits`

Defines and runs what Platina observes.

- Saved audit definitions and source targets.
- Source type, URL, cadence, region/division, and enabled state.
- Scope approval before the first network request or after a material change.
- Manual “Run now.”
- Run history with queued/running/validating/completed/degraded/failed states.
- Run detail with per-source progress, fetched document count, dedupe count,
  failure reason, retry, timestamps, and freshness.
- Public source snapshots remain raw and non-citable.

### 3. Findings — `/p/[ws]/findings`

Turns raw observations into governed business findings.

- Severity, use case, status, source count, freshness, and business impact.
- States:
  - needs validation;
  - validated;
  - needs human decision;
  - dismissed;
  - superseded.
- Detail:
  - concise executive summary;
  - what changed;
  - why it matters;
  - strongest objection or uncertainty;
  - source snapshots;
  - reasoning audit trail;
  - human ruling.
- Technical plane, generation, model, and raw score data live in an expandable
  audit/provenance panel, not in primary copy.

### 4. Solutions — `/p/[ws]/solutions`

Converts findings into approved, executable responses.

- Recommended response.
- Linked finding(s) and evidence summary.
- Expected business effect and measurement plan.
- Risk and claims implications.
- Owner, reviewers, due date, event anchor, region, division, and status.
- Plain-language approvals:
  - Brand standard confirmed.
  - Audit scope approved.
  - Direction approved.
  - Ready for external execution.
- Solution detail tabs:
  - Summary;
  - Work board;
  - Calendar;
  - Claims;
  - Decision history;
  - Export.

### 5. Outcomes — `/p/[ws]/outcomes`

Closes the slow learning loop.

- Review queue for due hypotheses.
- Campaign outcomes:
  - reach/response where relevant;
  - leads;
  - qualified leads;
  - conversion rate;
  - pipeline contribution;
  - lead-quality score.
- Outcome source and import provenance.
- Worked / did not work / inconclusive verdict with note.
- Comparison to expected outcome.
- Explicit write-back:
  - measured outcome becomes first-party evidence;
  - contradicted derived findings are demoted;
  - future recommendations reflect the new evidence.
- Minimum-N states replace unsupported scores.

### 6. Admin — `/p/[ws]/admin/*`

Configuration is available to authorized users without occupying the main
workflow navigation.

- Brand standard and declared sources.
- Workspace division and region profile.
- Audit sources and cadence defaults.
- Claims and terminology rules.
- Thresholds.
- Prompt versions and analysis sequence.
- Alert routing.
- Approval roles.
- Audit/event ledger.

---

## Existing-route transition

Current routes stay reachable until the owner manually verifies their
replacement:

- `/brand` → future `/admin/brand`
- `/scans` → future `/audits`
- `/brain` → future `/findings`
- `/ideation` → future `/solutions/new`
- `/campaigns` → future `/solutions`
- `/claims` → future solution Claims tab and `/admin/claims`
- `/receipts` → future `/outcomes` and solution Decision history
- `/config` → future `/admin`

Transition policy:

1. Build and test the replacement.
2. Place a temporary “Moved to…” notice on the old page.
3. Run owner comparison against the old and new route.
4. Record keep/merge/remove decision.
5. Redirect only after approval.
6. Delete old components only after redirects and E2E coverage are green.

No route or feature is deleted merely because it looks redundant.

---

## Waters use-case pathways

### Competitive and market-change audit

1. Operator defines competitor/product/press/ad-library sources.
2. Audit-scope approval permits Apify fetches.
3. A scheduled or manual run snapshots changed public content.
4. Content hashes suppress unchanged duplicates.
5. Contradiction evaluates each material change once.
6. Resolved changes become findings; contested changes enter human review.
7. A solution proposes messaging, campaign, event, or research actions.
8. Direction approval creates the execution plan.
9. Final approval creates an exportable action packet.
10. Imported outcome data grades the hypothesis.

### Conference and event readiness

1. Operator creates an event anchor, region, audience, and objective.
2. Platina audits conference pages, abstracts, competitor presence, and trade
   coverage.
3. Findings identify topic movement, competitor claims, gaps, and risks.
4. A solution proposes pre-event, at-event, and post-event phases.
5. The work board materializes tasks at fixed offsets from the event.
6. Claims review runs before final approval.
7. Platina exports the approved plan without publishing to a Waters system.
8. Post-event lead and pipeline data grades the plan.

### Brand and terminology drift

1. Authorized users declare and approve the Waters/division standard.
2. Consented documents are chunked and embedded as first-party evidence.
3. Approved public or uploaded campaign artifacts are compared with the
   standard.
4. Deterministic terminology rules run before model interpretation.
5. Drift findings show the exact mismatch, affected asset, and remediation.
6. Approved remediation creates tasks and an exportable correction packet.
7. Re-audit verifies closure.

### Claims and compliance

1. Claims rules are sourced from the approved brand/claims configuration.
2. Deterministic banned/regulated-term checks run first.
3. AI may explain context and propose wording through the model router.
4. A deterministic failure remains a failure regardless of model opinion.
5. The operator can accept, edit, or reject the proposed correction.
6. Final execution approval is unavailable until blocking claims are closed or
   a named approver records an allowed exception with reason.

### Campaign performance and lead-quality optimization

1. Consented campaign outcome files or approved read-only sources are ingested.
2. Source and import provenance are stored.
3. Lead-quality weighted scoring applies only when the sample threshold passes.
4. Platina relates outcomes to the recorded solution hypothesis.
5. Outcome review records worked, did not work, or inconclusive.
6. Measured evidence overrides conflicting derived confidence.
7. The next solution uses the updated evidence while keeping public market
   hypotheses separately labelled.

---

## Recommendation contract

Every proposed solution must contain:

- problem/finding;
- affected division, region, product, event, or campaign;
- severity and urgency;
- “What our approved evidence supports”;
- “What public market signals suggest, not yet validated”;
- strongest uncertainty or counterargument;
- recommended action steps;
- owner and due date;
- expected outcome;
- measurement method and review date;
- claims/compliance implications;
- approval status;
- provenance links.

Rules:

- Raw public documents never become direct evidence citations.
- Derived findings cannot be the sole validated support for a recommendation.
- If first-party support is absent, label the response “unvalidated direction”
  and do not display a fabricated confidence number.
- All model calls use the shared model router.
- Models propose; deterministic checks and humans govern.

---

## Real-time and asynchronous architecture

“Real time” has two separate layers.

### Reliable workflow layer

- Inngest owns scans, contradiction, compaction, outcome ingest, receipt
  review, event windows, and alert sweeps.
- Each run writes durable status before and after every meaningful step.
- Retries are idempotent and do not duplicate signal documents, findings,
  tasks, alerts, or outcome writes.
- A failed source does not erase successful source results from the same run.

### Fast UI layer

- Add a Platina-specific signal-only Supabase Realtime channel.
- Do not expose a guessable workspace topic. A membership-checked server
  component derives an opaque HMAC topic token from `workspaceId` and a
  server-only `PLATINA_REALTIME_SECRET`; the browser receives only that token.
  If the secret is absent, the feature visibly degrades to polling.
- Suggested topic: `platina:<opaqueTopicToken>:live`.
- Suggested scopes:
  - `audits`
  - `findings`
  - `solutions`
  - `outcomes`
  - `alerts`
- Broadcast only after the database write commits.
- Payload contains only the scope and optional entity identifier; no tenant
  content is sent over the channel.
- Subscribers refetch through authenticated, workspace-scoped server paths.
- A 15–30 second polling fallback remains active.
- The shell displays:
  - Live / reconnecting / polling;
  - last update time;
  - last successful source refresh;
  - stale/degraded state.

### Cadence

- Default interval is 5 minutes. Audit definitions may choose 10 or 15 minutes
  where Apify actor cost and source policy permit.
- A coordinator runs every five minutes and selects due approved specs.
- The coordinator emits one `platina/scan.requested` event per due spec with
  workspace/spec identifiers and an idempotency key.
- The worker re-reads the workspace-scoped spec, rechecks approval and due
  state, creates one audit run, and uses per-spec concurrency keys so two ticks
  cannot overlap the same source.
- Ten- and fifteen-minute schedules are represented as due times, not separate
  cron functions.
- Use jitter, per-source concurrency limits, and a circuit breaker.
- Manual “Run now” creates a run immediately but does not bypass approval,
  rate limits, or source policy.
- “Real-time” copy must never promise instant external-world detection.

### Degradation

- Realtime unavailable → polling continues.
- Apify unavailable/rate-limited → run becomes degraded or failed with retry
  time; prior data is visibly marked stale.
- AI provider throttled → model router changes provider.
- All model providers unavailable → raw observations remain stored and the run
  waits in validation; no fabricated finding.
- Outcome source unavailable → keep the receipt due and show the missing source.

---

## Data model evolution

Keep the current `platina_*` schema and add only the workflow entities required
to make it operable.

### Extend existing entities

- `platina_scan_specs`
  - validated source types;
  - cadence minutes;
  - enabled state;
  - scope version/hash;
  - last success/failure timestamps.
- `platina_signal_documents`
  - source kind;
  - canonical URL;
  - content hash;
  - observed/published timestamp;
  - processing state;
  - immutable raw snapshot;
  - still no embedding column.
- `platina_brain_chunks`
  - preserve as internal derived-memory storage;
  - maintain embedding, provenance, generation, and demotion behavior.
- `platina_campaigns`
  - editable plan fields;
  - solution/use-case type;
  - approval state;
  - external export timestamp;
  - lifecycle status transitions.
- `platina_receipts`
  - solution/campaign link;
  - measurement definition;
  - review history;
  - outcome write-back state.
- `platina_workspace_config`
  - runtime paths must consume the stored values;
  - authorization required on every change.
  - the orchestrator snapshots the effective analysis sequence, prompt version,
    and thresholds onto each run so later config edits cannot rewrite history.

### Add workflow entities

- `platina_workspace_profiles`
  - unique `workspace_id`;
  - Waters division and region;
  - optional business-unit label;
  - one workspace is one division × region boundary unless checkpoint A
    explicitly chooses another model.
- `platina_brand_sources`
  - declared URL/document source registry;
  - content hash and freshness;
  - approved version.
- `platina_audit_runs`
  - definition, trigger, status, timestamps, counters, error/degraded reason.
- `platina_audit_run_events`
  - append-only run timeline for monitoring and audit.
- `platina_findings`
  - user-facing finding linked to signal, transcript, and optional Brain chunk;
  - use case, severity, validation status, impact, owner, ruling.
- `platina_solutions`
  - recommendation, evidence buckets, expected outcome, owner, review date,
    approval status, and linked campaign/event.
- `platina_solution_tasks`
  - workspace-local work board items with status, owner, due date, event phase,
    dependency, and claims-blocked state.
- `platina_outcome_imports`
  - source, file/hash, status, row counts, and errors.
- `platina_alert_deliveries`
  - rule, finding/run, severity, route, sent/suppressed/failed status.

Boundary migrations:

- Replace executable Platina alert action kinds with `in_app` for V1.
  `hub_message`, `ticket`, and `email` become archived enum values: present in
  historical rows if any, rejected by new writes, never dispatched.
- Stop reading and writing `sop_run_id`. Do not add a foreign key into
  InstaMedia. Drop the column after Slice 0 inspects existing rows.
- Remove `"web"` from user-selectable adapter values and reject it in the
  runtime registry until the constitution is explicitly updated.

All tables include `workspace_id`. Every read, update, and delete query includes
it explicitly, and query tests assert it in generated SQL.

---

## Visual system

Direction: executive dashboard, not a generic AI app.

- White canvas and surfaces.
- One Waters blue primary token with navy/slate text.
- Pale blue section backgrounds and selected states.
- Green, amber, and red only for operational status.
- Compact, readable tables and filters.
- Dense KPI rows with clear labels and freshness.
- Charts only when they communicate trend, comparison, or progress.
- No decorative gradients, glass effects, floating AI ornaments, or social
  media visual language.
- No static inline styles; Tailwind and shadcn only.
- Responsive behavior supports executive laptop/tablet use first.
- Loading, empty, stale, degraded, insufficient-baseline, unauthorized, and
  failed states are designed as first-class states.

Primary wording is business language:

- “Brand standard confirmed,” not “Gate 1.”
- “Audit scope approved,” not “Gate 2.”
- “Direction approved,” not “Gate 3.”
- “Ready for external execution,” not “Gate 4.”
- “Approved evidence,” not “Plane A.”
- “Public observation,” not “Plane B.”
- “Derived market hypothesis,” not “Plane C.”

Technical terms remain available in the Audit details drawer for traceability.

---

## Keep, retool, remove

### Keep as core

- `/p/[ws]` workspace boundary and membership check.
- All `platina_*` tables and explicit workspace isolation.
- Model router and provider fallback.
- Apify adapter registry.
- Inngest orchestration.
- Four immutable human-approval events.
- Three-category evidence separation.
- Contradiction before derived-memory embedding.
- Min-N honesty.
- Brain provenance and additive compaction.
- Decision receipts and slow-loop concept.
- Claims deterministic-first rule.

### Retool

- Current Cockpit counts → live executive command center.
- Scan specs → Audits.
- Brain → Findings plus hidden technical provenance.
- Ideation → evidence-grounded Solutions.
- Campaigns → solution execution workspace.
- Receipts → decision history plus Outcomes.
- Claims screen → integrated Claims tab plus Admin rules.
- Config → authorized Admin.
- Instagram-oriented Apify fetch → Waters public-source Apify actors chosen by
  the operator and selected through the adapter registry.
- Existing analysis-sequence JSON → a run-orchestrator snapshot that controls
  actual stage order.

### Remove from Platina after replacement verification

- “Open InstaMedia” sidebar link.
- `/w/*` references in Cockpit copy.
- Instagram, reels, hashtags, comments, engagement-rate, and social publishing
  language or code paths used by Platina.
- Technical stage codes and storage-plane labels in primary UI.
- Dead controls that write no workflow state.
- Count-only claims of monitoring where no run status exists.
- Duplicate old Platina page components after approved redirects.
- Legacy `sop_run_id` and non-Platina alert action values after data inspection
  and an approved migration.

### Do not remove

- InstaMedia `/w/*` routes or features.
- Shared auth, workspace membership, or model router.
- Audit history, raw public snapshots, debate transcripts, gen-0 sources, gate
  events, or measured outcomes.

---

## Implementation roadmap

Every slice follows: spec confirmation → failing tests → minimal implementation
→ CI gates → browser verification → review → owner approval.

### Slice 0 — Baseline, safety, and product contract

**Purpose:** Lock a green review baseline and the product contract before the
shell redesign.

- Platina typecheck was red on `main` after the 2026-09-11 commit. The 2026-09-15
  compile fix is part of this baseline; do not treat those errors as acceptable
  pre-existing debt.
- Run current Platina-focused tests and full typecheck/lint/build.
- Record any remaining pre-existing failures separately.
- Add a Platina route/use-case inventory with Live / Partial / Gap / Deferred /
  Refused status.
- Record the document-precedence rules above.
- Confirm no `/p` code writes to an external Waters system.
- Add an automated dependency-boundary test that fails if Platina imports
  InstaMedia ticket, Hub, SOP, content, campaign, calendar, or notification
  query/action modules.
- Inspect existing `sop_run_id` and alert-action data before any migration.
- Confirm the one-workspace = one-division × region model with the owner.
- Inventory candidate Apify actors for each V1 source kind, run a small
  non-production feasibility sample, document output shape/cost/rate limits,
  and mark unsupported sources as blocked rather than substituting social data.
- Define the exact V1 action-packet JSON schema and printable layout.
- Add a Platina Playwright authentication/workspace fixture and route smoke
  baseline.
- Add owner-approved copy glossary and old-route transition checklist.

**Done when:** the current state is reproducible, the test baseline is known,
the actor feasibility matrix and division/region model are approved, the
Platina/InstaMedia dependency test is green, and the target contract is
approved without changing product behavior.

### Slice 1 — Full blue/white shell and information architecture

**Purpose:** Deliver the selected full-shell redesign without fake functionality.

- Replace the current narrow page wrapper and sidebar.
- Build desktop/tablet shell, executive page header, breadcrumbs, search/filter
  slots, live/freshness status, and Admin entry.
- Register Cockpit, Audits, Findings, Solutions, Outcomes, and Admin.
- Remove visible InstaMedia links/copy from the Platina shell.
- Hide S-stage, Plane, Gate, and generation terms from primary copy.
- Map existing real data into the new destinations.
- For unavailable behavior, use honest empty/setup states rather than enabled
  controls.
- Keep old routes available for comparison.

**Done when:** every primary route renders in the Waters visual system, all
navigation works, old data remains reachable, and no button pretends to perform
an unwired action.

**Owner checkpoint A:** approve visual direction, wording, route map, and
old-to-new feature mapping.

### Slice 2 — Durable audit runs and Platina live event spine

**Purpose:** Create the shared workflow foundation for all use cases.

- Add audit run and run-event schema/migration.
- Add the Platina workspace-profile schema/migration.
- Add workspace-scoped queries with generated-SQL isolation assertions.
- Add Platina-specific Realtime types, server broadcaster, client multiplexer,
  opaque membership-issued topic token, and poll fallback.
- Add status/freshness pure logic and tests.
- Emit run status only after commits.
- Add idempotency keys and terminal-state rules.
- Add a run orchestrator that snapshots and executes the configured analysis
  sequence with bounded stage transitions.
- Wire Cockpit and Audits to live invalidation.

**Done when:** a synthetic audit run moves through every state and two browser
tabs converge without refresh; disabling Realtime still converges by polling.

### Slice 3 — Waters public-source audits through Apify

**Purpose:** Replace the incorrect social adapter with real Waters audit inputs.

- Block this slice until Slice 0 approves at least one feasible actor for each
  source kind claimed in the release.
- Operators choose the sites, handles, and URLs. No hardcoded Instagram set.
- Define actor adapters for:
  - competitor/product pages;
  - press/trade editorial;
  - conference pages/abstracts;
  - approved public ad libraries.
- The registry maps source kind → Apify actor. The model router may classify a
  target and recommend an actor key; it does not fetch and does not spawn
  another agent.
- Validate URLs and source types.
- Add 5/10/15-minute cadence options.
- Add the five-minute due-spec coordinator and per-spec event fan-out.
- Add per-source circuit breaking, retry, jitter, concurrency, and cost caps.
- Update scan/run state and `lastRunAt`/last-success fields correctly.
- Canonicalize URLs and hash content to suppress unchanged documents.
- Store failures as run events, not fake signal documents.
- Mark every fetched document public/raw and keep Plane B structurally
  non-embeddable.
- Reject and test the unshipped `"web"` adapter path.

**Done when:** an approved source can run manually and on cadence, changed
content creates one raw snapshot, unchanged content creates none, and failures
are visible and retryable.

### Slice 4 — Findings and human validation

**Purpose:** Make contradiction output operational.

- Process only unprocessed signal documents.
- Trigger contradiction from a new signal batch, not a blind global reread.
- Persist proposer, challenger, deterministic result, and source links.
- Create user-facing findings for agreed/qualified results.
- Route contested results to a named human-review queue.
- Retain refuted transcripts without creating retrievable findings.
- Add ruling, dismiss, supersede, and validate actions with permissions.
- Embed eligible Brain content through the existing embedding path.
- Broadcast Findings updates and show them on Cockpit.
- Add the initial in-app “new finding / human decision required” notification
  path; configurable alert rules remain Slice 10.

**Done when:** each signal is processed once, all four resolution states have a
visible and correct path, and a human ruling is immutable/auditable.

### Slice 5 — Evidence-grounded Solutions

**Purpose:** Convert validated findings into effective, honest responses.

- Wire semantic retrieval for approved evidence and derived hypotheses as
  separate buckets.
- Read the workspace minimum-N value instead of hardcoding one.
- Add the recommendation contract defined above.
- Support all five use-case types.
- Validate all persisted citation identifiers against workspace-scoped source
  rows.
- Create/edit/reject/approve solution actions.
- Write the Direction-approved immutable event.
- Create a decision receipt and expected-outcome review date.
- Broadcast Solutions and approval updates.

**Done when:** a finding can become an editable solution, unsupported evidence
is refused or explicitly marked unvalidated, and approval creates one receipt
without duplicate submissions.

### Slice 6 — Slim execution workspace

**Purpose:** Give approved solutions a Waters-native place to become work.

- Add solution work board:
  - To do;
  - In progress;
  - Blocked;
  - Review;
  - Done.
- Add assignee, due date, dependency, event phase, and risk.
- Add event-anchored calendar.
- Materialize pre-event, at-event, and post-event task templates.
- Integrate claims review into the solution.
- Prevent final approval while blocking claims or required work remain open.
- Final approval changes the local campaign/solution state.
- Generate downloadable/shareable action packet.
- V1 export contract:
  - printable HTML summary suitable for browser Save as PDF;
  - versioned JSON containing solution, approved-evidence references,
    unvalidated-market-signal references, owners, dates, tasks, claims status,
    approvals, expected outcome, and provenance identifiers.
- Do not publish, schedule, email, or mutate any Waters system.

**Done when:** an approved direction can be planned, assigned, claims-checked,
approved for external execution, and exported entirely under `/p`.

### Slice 7 — Conference and event readiness pack

**Purpose:** Complete the event-specific pathway on the shared platform.

- Event setup and anchor date.
- Conference source presets.
- Competitor/event finding filters.
- Readiness summary and missing-work alerts.
- Pre/at/post-event task generation.
- Event calendar and risk view.
- Post-event measurement checklist.

**Done when:** one event runs from source audit through an approved/exported
execution packet with due outcome review.

### Slice 8 — Brand drift and claims pack

**Purpose:** Complete declared-standard governance.

- Add brand source registry, freshness, extraction, chunking, and embedding.
- Add extract → author → reconcile → confirm workflow.
- Add daily `platina-brand-refresh` orchestration: due approved sources are
  re-fetched through the allowed source path, content-hash changes are
  re-chunked/re-embedded, and unchanged sources produce no duplicate chunks.
- Build business-readable brand standard summary.
- Move claims lists from hardcoded constants to approved workspace rules.
- Add asset/copy audit input without external writes.
- Produce drift and claims findings.
- Re-audit approved remediation to verify closure.

**Done when:** changing an approved rule changes future audits, exact violations
are traceable, and passing a re-audit closes the finding.

### Slice 9 — Outcomes and slow-loop verification

**Purpose:** Make “effective solution” measurable rather than rhetorical.

- Add consented outcome file import. Any future direct read-only Waters
  connector requires a separate owner-approved contract and is not part of
  this plan.
- Validate schema, source, campaign/solution link, and dedupe hash.
- Compute lead-quality weighting.
- Apply minimum-N before direction/magnitude output.
- Surface due reviews.
- Grade receipts with outcome note and measurement provenance.
- Write measured outcomes into the authoritative first-party layer.
- Demote conflicting Brain chunks immediately.
- Broadcast Outcomes and refresh future solution retrieval.
- Seed clearly labelled synthetic history for demos only. Synthetic seeds carry
  a source marker that excludes them from evidence write-back, min-N baselines,
  and retrieval.

**Done when:** a recorded result changes the related receipt, evidence layer,
conflicting hypotheses, and next recommendation exactly once.

### Slice 10 — Rules, alerts, and operational Admin

**Purpose:** Make the system configurable without exposing implementation noise.

- Authorize Admin actions server-side.
- Extend the capability matrix with explicit Platina capabilities:
  - `platina.audit.run`;
  - `platina.audit.manage`;
  - `platina.finding.review`;
  - `platina.solution.edit`;
  - `platina.solution.approve`;
  - `platina.execution.approve`;
  - `platina.outcome.import`;
  - `platina.config.manage`.
- Default role policy:
  - owner/admin: all Platina capabilities;
  - member: run already-approved audits, review/triage findings, edit solutions,
    and work assigned execution tasks;
  - member cannot change config, approve scope/direction/execution, or import
    authoritative outcomes.
- Wire stored thresholds into contradiction, retrieval, scoring, compaction,
  and alerts.
- Add analysis-sequence and versioned-prompt controls.
- Add alert rule CRUD and delivery ledger.
- Route critical findings, due approvals, execution risk, and overdue outcomes
  to the in-app Cockpit.
- Keep email off unless separately approved and configured.
- Show configuration history and effective version.

**Done when:** changing an authorized setting changes only future runs,
unauthorized changes fail before DB access, and every alert is sent,
suppressed, or failed with a recorded reason.

### Slice 11 — Cockpit completion

**Purpose:** Make the action Cockpit the trustworthy entry point for the whole
suite.

- Replace provisional shell summaries with real composed metrics.
- Add use-case portfolio health.
- Add priority inbox ordered by severity, due date, and freshness.
- Add live activity timeline.
- Add source and model-provider health.
- Add direct deep links to the action surface.
- Ensure Cockpit mutations are limited to safe workflow commands such as
  starting an already-approved audit; configuration remains in Admin.

**Done when:** an executive can identify the highest-priority issue and reach
the correct action in two clicks, with no stale or unsupported KPI.

### Slice 12 — Manual feature-elimination checkpoint

**Purpose:** Remove only what the owner has verified is replaced.

For each old route/component:

- Demonstrate the old behavior.
- Demonstrate the new replacement.
- Confirm data/history parity.
- Choose:
  - keep;
  - merge;
  - redirect;
  - remove.
- Record the decision.
- Add redirects and update E2E tests.
- Delete approved dead code and social adapter imports from Platina.
- Search `/p` code and rendered copy for InstaMedia/social terminology.

**Done when:** the owner signs the route matrix and all approved removals land
without changing `/w`.

**Owner checkpoint B:** explicit approval is required before deletion.

### Slice 13 — Hardening and Vercel release

**Purpose:** Make the full suite client-facing and supportable.

- Accessibility pass on the new Platina shell and workflows.
- Keyboard/focus/semantic table and dialog checks.
- Error, empty, degraded, stale, and unauthorized browser paths.
- Cross-workspace isolation integration tests.
- Concurrency/double-submit tests for approvals and grading.
- Inngest idempotency/retry tests.
- Realtime plus poll-fallback browser test.
- Apify budget/rate-limit test.
- Verify no Waters external write clients or credentials exist.
- Vercel Pro environment and migration runbook.
- Feature-flagged rollout and rollback procedure.
- Production observability for job failures, provider fallback, and stale data.

**Done when:** all quality gates pass, migrations are reviewed, staging proves
the five use cases, and owner acceptance is recorded.

---

## Test strategy

Every slice runs:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Relevant slices also run:

```bash
npm run test:e2e
```

Required test categories:

- Pure policy/state-machine tests.
- Workspace-scoped SQL shape tests for every query.
- Real Postgres integration tests for cross-workspace denial and write-back.
- Server-action guard-order and capability tests.
- Model output validation and citation allow-list tests.
- Minimum-N and no-fabricated-score tests.
- Idempotency and retry tests for scans, findings, alerts, imports, and grading.
- Realtime signal plus polling degradation tests.
- Playwright journeys for each use case.
- Visual checks for loading/empty/stale/degraded/error states.

No slice is complete with a red gate.

---

## Manual acceptance journeys

### Journey A — competitor change

Approve scope → run competitor audit → watch progress → open qualified finding
→ inspect source and objection → approve solution → assign work → pass claims
→ approve external action packet → import result → grade outcome.

### Journey B — conference

Create event → add conference sources → receive readiness findings → approve
pre/at/post plan → verify calendar/tasks → export → record post-event leads.

### Journey C — brand drift

Confirm brand standard → audit a copy asset → see exact drift → approve
remediation → re-audit → verify closure.

### Journey D — claims

Submit copy → deterministic block → inspect rule → apply/edit suggestion →
recheck → record exception or pass → final approval becomes available.

### Journey E — performance

Import consented outcomes → pass/fail minimum-N → compare expected and measured
result → grade receipt → verify derived hypothesis demotion → generate the next
solution with updated evidence.

---

## Explicitly out of scope

- Any write to a Waters production, QA, test, CRM, marketing-automation, DAM,
  CMS, email, ad, or event system.
- Instagram/reels/hashtag/comment-mining features in Platina.
- Social publishing or engagement optimization.
- Client portal/client-viewer access.
- Autonomous approval, publishing, budget spending, or claims override.
- Agent-spawned agents.
- Cross-workspace executive views.
- Google-Docs-style collaborative co-editing.
- A second Python/FastAPI service.
- Celery or non-Inngest background workers.

---

## Approval requested

Approval of this document authorizes **Slice 0 only**. Each later slice receives
its own implementation-ready task plan and reviewable diff. Destructive removal
remains blocked until Owner checkpoint B.


---

## Revision addendum — 2026-09-15

**Status:** Proposed amendments to the approved plan above. Each revision is
scoped to an existing slice unless it explicitly adds one.

**Precedence:** This addendum sits at the same level as the approved plan. Where
it amends a specific clause, the amendment wins. Where it is silent, the plan
above stands unchanged. Nothing here authorizes work beyond Slice 0.

---

### R1 — Add a change-detection tier before actor invocation

**Amends:** Cadence section; Slice 3.

**Problem.** A 5-minute default is 288 runs per source per day. Twenty sources is
5,760 actor invocations daily, roughly 173,000 per month. Content hashing
suppresses duplicate *processing* but the fetch is already paid for. Competitor
product pages, trade press and conference sources change on a scale of days to
weeks, so the overwhelming majority of those invocations return unchanged
content at full cost.

The plan already concedes the value ceiling: *"real-time copy must never promise
instant external-world detection."* The cadence should reflect that.

**Revision.** Split the scan into two tiers.

- **Tier 1 — change probe.** Conditional `GET` with `If-Modified-Since` and
  `ETag`, sitemap `lastmod` comparison, and RSS/Atom where published. Runs at
  the configured cadence. Cost is negligible relative to an actor run.
- **Tier 2 — actor fetch.** Fires only when Tier 1 reports a change, or when the
  probe is unavailable for that source kind.

Sources with no usable cheap signal — JS-rendered pages, ad libraries — use
**adaptive cadence** instead: start at 6 hours, tighten toward the configured
floor as observed change frequency rises, and back off after a configurable run
of unchanged fetches. Store observed change frequency per source.

Manual "Run now" bypasses Tier 1 and invokes the actor directly, subject to
existing approval, rate limits and cost caps.

**Copy implication.** The UI continues to state detection latency honestly. A
5-minute probe cadence with change-triggered fetch is a truthful "checked 5
minutes ago"; it must not be presented as "scanned every 5 minutes."

**Done when:** daily actor invocations are proportional to observed source
changes rather than to cadence × source count, per-source change frequency is
recorded, and a source that never changes measurably reduces its own fetch rate.

---

### R2 — Insert Slice 3.5: thin vertical proof

**Amends:** Implementation roadmap.

**Problem.** No complete user path exists until Slice 5, and the differentiating
loop does not close until Slice 9. Slice 1 ships a full shell where, correctly,
*"no button pretends to perform an unwired action"* — so the most visible
milestone for several slices is a finished-looking surface that performs no
work. That is the wrong state to be in at any review, demo, or stakeholder
checkpoint.

**Revision.** After Slice 3, before Slice 4 breadth, build one narrow vertical
path end to end.

Scope, deliberately minimal:

- one use case only — competitor and market change;
- one source kind only — whichever Slice 0 proved most reliable;
- one finding path — agreed and contested only; qualified, dismissed and
  superseded deferred to Slice 4;
- one solution with the full recommendation contract, but no work board;
- one receipt, graded against clearly labelled seeded synthetic outcome data.
- Synthetic outcome imports are labelled AND structurally excluded from
  first-party evidence write-back, minimum-N baselines, and retrieval.
  Labelling alone is not sufficient — the write-back path must refuse synthetic
  sources.

Hard constraint: this slice uses the **real schema, real orchestrator, real
workspace scoping and real gate events**. No mocked data path, no parallel
prototype tables. Slices 4, 5 and 9 widen this path; they do not replace it.

**Done when:** a single competitor change can be traced in a browser from
scheduled scan through finding, human ruling, approved solution, and graded
receipt, with every step persisted through the production schema.

---

### R3 — Make the cross-division deferral explicit

**Amends:** Product promise; target information architecture.

**Problem.** One workspace is one division × region, and cross-division rollups
are out of scope. That is defensible for V1. But the stated business case
includes leadership visibility across divisions, and a Cockpit that silently
shows one division while implying organisational coverage will be read as a
defect the first time it reaches a leadership audience.

**Revision.**

- Add cross-division visibility to a named **Deferred** list in the Slice 0
  route/use-case inventory, with the reason recorded.
- The Cockpit header must state the active division and region explicitly, so
  scope is visible without navigation (lands in Slice 2 with the
  workspace-profile migration; Slice 1 shows the workspace name only).
- Where a metric is division-scoped, label it as such. No unqualified
  organisation-level phrasing in Platina copy.
- A future read-only cross-workspace executive view requires its own
  owner-approved contract covering authorization, aggregation rules and minimum
  sample suppression. It is not implied by this plan.

**Done when:** the active scope is visible on every primary surface and no copy
implies coverage the data model does not provide.

---

### R4 — Retrieval quality gates

**Amends:** Slice 2 (migration); Slice 5 (retrieval).

Four gaps in the current retrieval design, ordered by return on effort.

**R4.1 — Embedding model version column.** *(Slice 2)*
Add `embedding_model_version` to every table holding vectors. Mixed-generation
vectors in one index produce meaningless similarity scores and throw no error.
Retrieval must filter on the active version; a version change requires an
explicit backfill rather than silent coexistence. This is a trivial migration
now and an unrecoverable data-quality incident later.

**R4.2 — Similarity floor and `insufficient_relevance`.** *(Slice 5)*
Minimum-N checks baseline *size*. It does not check retrieved *relevance*. A
workspace can hold 200 qualifying records, retrieve five at 0.31 similarity, and
generate confidently on unrelated evidence. Add a configurable similarity floor;
when the best retrieved chunk falls below it, return `insufficient_relevance` as
a distinct state. The two states require different operator action — one means
"more data is needed", the other means "the question does not match the
evidence" — so they must not share a message.

**R4.3 — Reranking stage.** *(Slice 5)*
Bi-encoder similarity optimizes topical resemblance, not answer relevance.
Retrieve a wider candidate set, then rerank to the final set with a cross-encoder
or a bounded model-router scoring pass before generation. Reranking runs inside
the existing router and budget enforcement.

**R4.4 — Hybrid lexical search.** *(Slice 5)*
Pure vector search misses exact strings: instrument model numbers, method codes,
catalogue references, product names. For Waters content this is a frequent
failure, not an edge case. Add BM25 alongside vector retrieval and fuse with
reciprocal rank fusion. Hybrid retrieval applies to Planes A and C only;
Plane B remains structurally unsearchable — no vector index, no lexical index.

**R4.5 — Record-boundary chunking.** *(Slice 5)*
Fixed-size chunking splits structured campaign and outcome records mid-record,
so retrieval returns fragments of two unrelated records. Chunk campaign and
outcome data by record boundary — one record and its outcome as an atomic unit.
Prose sources keep semantic chunking.

**Done when:** retrieval filters on embedding version, both insufficiency states
are distinguishable in the UI, an exact model-number query returns the correct
record, and retrieval evaluation (R5.2) shows no regression against the
pre-rerank baseline.

---

### R5 — Contradiction layer instrumentation

**Amends:** Slice 4.

**R5.1 — Objection rate telemetry.**
A model instructed to challenge will always find something. If the challenger
objects to nearly everything, `qualified` stops carrying information and the
layer becomes cost without signal. Record per-workspace objection rate, add an
explicit "no material objection" challenger output, and surface the rate in the
audit drawer. An objection rate above a configurable ceiling raises an
operational finding against the prompt version, not against the claims.

**R5.2 — Retrieval evaluation set.**
Add 30–50 hand-labelled query → expected-record pairs, workspace-scoped, run in
CI against a named CI fixture workspace, not production workspace data. Without
this, every chunking, prompt or threshold change is unverifiable and
improvement cannot be distinguished from regression. This gates R4.3 and R4.4.

**R5.3 — Refutation memory.**
Compaction handles redundancy. Nothing currently handles *"this was tried and it
did not work."* When a measured outcome contradicts a derived finding, link the
contradicting evidence, floor the confidence, and exclude the finding from
retrieval — but retain the record. A recorded failure is what prevents the system
re-proposing the same direction in six months.

**Done when:** objection rate is visible and alarmed, the evaluation set runs in
CI, and a contradicted finding is demoted and excluded from future retrieval
without being deleted.

---

### Revision-to-slice mapping

| Revision | Lands in | Blocking | Effort |
|---|---|---|---|
| R1 — change-detection tier | Slice 3 | No | Medium |
| R2 — thin vertical proof | New Slice 3.5 | Reorders 4–9 breadth | Medium |
| R3 — cross-division deferral | Slice 0 inventory, Slice 2 header copy | No | Low |
| R4.1 — embedding version column | Slice 2 migration | Yes, before any embedding | Trivial |
| R4.2 — similarity floor | Slice 5 | No | Low |
| R4.3 — reranking | Slice 5 | Gated by R5.2 | Medium |
| R4.4 — hybrid lexical search | Slice 5 | Gated by R5.2 | Low |
| R4.5 — record-boundary chunking | Slice 5 | No | Low |
| R5.1 — objection rate | Slice 4 | No | Low |
| R5.2 — evaluation set | Slice 4 | Gates R4.3, R4.4 | Medium |
| R5.3 — refutation memory | Slice 9 | No | Medium |

**R4.1 is the only revision that must land before the slice it sits in
completes.** Once vectors exist without a version column, adding one requires
either a full re-embed or an unverifiable assumption about which model produced
which row.

---

### Approval requested for the addendum

Approval of this addendum amends the roadmap to include Slice 3.5 and the
revisions listed above. It does not authorize implementation beyond Slice 0.
Each amended slice still receives its own implementation-ready task plan and
reviewable diff, and Owner checkpoint B continues to block all destructive
removal.