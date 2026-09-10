# PLAN-OPS-UX progress ledger

Base commit for this wave: 9fa4f3c

- U2 foundation (query filters + plan-view lib + 35 tests): complete (9fa4f3c)
- F1 custom-field registry + 19 tests: complete (1d59a62)
- U1 transition menu: complete (df46ef7, review clean — spec pass, quality approved)
- U2/U3 calendar view modes: complete (8905dc1, review clean — spec pass 8/8,
  quality approved; browser-verified: grouping header shows "AURORA SKINCARE (1)",
  scope=mine returns owned rows, scope=unassigned returns 0 with correct copy)
- F2 custom-field tables + value store + 8 tests: complete (e75ab97, migration 0033)

## Minor findings to triage before merge (from task reviews)
- U1: `transitionsFor` in src/lib/production.ts is now orphaned in production
  usage (menu uses generic PRODUCTION_STAGE_LABELS). Prune or re-wire its
  semantic labels ("Send back", "Resubmit") into the menu.
- U1: nextStagesFrom special-cases the self-stage rather than routing through
  isValidTransition. Safe today (no self-transitions exist) — needs a comment.
- U1: lost the per-action pending indicator the old buttons had; trigger now
  only goes disabled. Matters more than "minor" here — the whole ask is
  polished operational UX.
- U2: memberOptions mapped twice in page.tsx; hoist to one const.
- U2: requireUser() in page.tsx is redundant (layout already calls it).
- U2: "One client" select aria-label duplicates its placeholder text.
- U2: empty-state copy for client scope reads redundantly
  ("Nothing in Aurora Skincare only this month").

- U7 saved-view schema + queries + migration 0034: complete (1eed0f6)

## Wave 2 in flight (parallel, disjoint ownership)
- U4 detail panel: built (63cdfe1), review = spec PASS 3/3, quality approved.
  Read-only enforcement verified STRUCTURALLY (runtime allowlist, not just types);
  workspace scoping and comment authorship verified no-leak.
  IMPORTANT finding OPEN: zero tests for loadRowDetailAction /
  addPlanRowCommentAction / DetailPanel. Deferred deliberately — U5/U6 is
  editing calendar/actions.ts right now; one combined test fix after it lands.
- F3 field admin: built (f56e5d5), review = spec PASS 4/4, cross-tenant guard
  and transaction atomicity both verified correct on inspection.
  ONE IMPORTANT finding: tests never reach the transaction or ownership paths
  (bare non-chainable db mocks meant those branches threw into a generic catch
  and "passed" for the wrong reason). Fix agent dispatched for actions.test.ts.
  Minor: createFieldAction leaves position=0 on all assignments (no reorder UI
  in scope, so sorting falls back to name).
- U8 plan+ideation: COMPLETE (40b1702, review = spec PASS 4/4, quality approved).
  Backwards-compat verified: production-card.tsx's call site still typechecks
  against the generalised StatusMenu, which was the real risk since that file
  was forbidden to the builder. chipClass values confirmed static literals.
  Minor: reject-reason panel JSX duplicated across idea-card and plan-card.
- F3 test-gap fix: complete (d8b8c11) — 4 new tests cover the transaction and
  the cross-tenant reject (asserts insert never called, not just an error).
  F3 now COMPLETE.

## Wave 3 outcome
- U9 hub: built (4e924f4). Derived open/done view since hubTasks has only a
  `done` boolean, no status column — no migration, stayed in schema.
  Activity write deliberately SKIPPED: no activitySubject value honestly fits
  a hub task, and labelling it "ticket" would blur the scratch-list/ticket
  distinction the schema protects. Review NOT yet run.
- U5/U6: agent DIED on a session limit mid-task. Work was uncommitted but
  sound — orchestrator verified tsc/lint/825 tests/build, checked the bulk
  read-only guard (field is z.enum(PLAN_CELL_FIELDS), so status is not a
  member) and the id cap, then committed as 2c24c68.
- F4: agent DIED on the same session limit. Same salvage: verified the
  unknown-field-id injection guard and merge-not-replace (both genuinely
  tested), committed as 326677c.

## Session-limit note
Subagent dispatches failed with "session limit resets 11:40am". Two agents
died mid-task. Their work survived because they wrote to disk before dying;
recovery was verification + commit by the orchestrator, not rework.

## Remaining
- U9 review (not yet run)
- F5 custom fields as grid columns
- U7 UI wiring (schema+queries done at 1eed0f6)
- U4 test gap (IMPORTANT, still open) — calendar/actions.ts is now settled
- Fix wave for accumulated Minor findings, then final whole-branch review

## Remaining after wave 2
U5 multi-select + U6 Excel keyboard (both need U4's plan-grid; run after C)
U9 hub · U7 UI wiring · F4 custom fields in detail panel · F5 as grid columns
Then: fix wave for all Minor findings, final whole-branch review.

## In flight (parallel, disjoint file ownership)
- Agent A (sonnet): U2+U3 UI wiring.
  OWNS: src/app/(app)/w/[ws]/calendar/page.tsx, calendar/plan-grid.tsx
- Agent B (sonnet): U1 transition menu.
  OWNS: src/components/transition-menu.tsx(+test), src/lib/production.ts,
        src/app/(app)/w/[ws]/production/production-card.tsx, production/actions.ts

Neither may touch: src/lib/plan-view.ts, src/lib/plan-view.test.ts,
src/db/queries/schedule.ts, src/db/queries/schedule.test.ts, src/db/schema.ts


## Handoff execution (PLAN-OPS-UX-REMAINING.md)
- Task 1 (U4 test gap): complete (52fbe43). 10 tests, 835 passing.
  Implementer mutation-tested its own suite: broke the cross-tenant guard and
  the author check, confirmed 3 tests failed, restored the original file.
- Task 2 (U9 review): CLEAN, no code changes. guard-in-WHERE, transition
  legality, static Tailwind literals, and both deliberate schema decisions
  all confirmed against live code. One Minor noted, not gating: setHubTaskStatus
  runs its zod/transition check before guard() where sibling actions call
  guard() first — no security impact (pre-guard check touches no DB).
- Next: Task 3 (F5 custom-field grid columns), Task 4 (U7 UI wiring),
  Task 5 (browser pass), Task 6 (fix wave), Task 7 (final review).


## Task 5 (browser pass) — COMPLETE, all 11 flows pass, zero server errors
Run against 3991460 with the four gates green (863 tests, tsc/lint/build clean).
Two false alarms along the way from case-sensitive keyword checks against
CSS text-transform: uppercase (ACTIVITY, PRIORITY LEVEL) - not bugs, my
checks were wrong. Confirmed real content by full-text/case-insensitive read.

1. Grid renders: PASS
2. group=client -> "AURORA SKINCARE (1)" correct count: PASS
3. scope=mine / scope=unassigned -> correct row sets, honest empty-state
   copy ("Nothing unassigned this month - every row already has an owner"): PASS
4. Cell edit (pillar) persists to DB: PASS
5. reel+duration -> static: duration cleared, no error (regression check on
   the earlier acd7a79 fix): PASS
6. Multi-select checkbox + "1 row selected" bulk bar renders: PASS
7. (keyboard nav not separately exercised - grid-keys.ts has its own unit
   tests per Task 3's agent; not re-verified live)
8. Detail panel opens, shows real ACTIVITY entries (pushed_to_team, assigned)
   and COMMENTS empty state, closes on Escape: PASS
9. Custom field end-to-end: created "Priority Level" dropdown field scoped
   to Content in /fields -> appeared as a grid column AND in the detail
   panel -> set to "High" -> verified in DB as
   {"5b92e7ca...": "High"} in content.custom_fields: PASS full round trip
10. Transition menus verified on Production: clicking "Brief" opens a menu
    where "In progress" is selectable and "Internal review"/"Revision" are
    disabled with the reason "not reachable from brief" - the core Jira
    pattern confirmed live, not just unit-tested. Plan/Ideation/Hub pages
    render (buttons present) but individual transitions not exercised.
11. All 22 nav routes load with substantial content, zero blank pages,
    zero server errors in the dev log: PASS

## Next: Task 6 (fix wave, 12 batched Minor findings), Task 7 (final review)


## Task 6 (fix wave) — COMPLETE, all 12 findings fixed, none skipped
Commit b9fd047. 864 tests (863+1 new regression test for finding #8's
position-continuation). tsc/lint/build all clean. Agent correctly used
explicit pathspec instead of git add -A once it noticed the stray untracked
METHODOLOGY.md file — that file remains untouched, unrelated to this build.
16 files touched across production, calendar, fields, ideation, plan, hub.

## Next: Task 7, final whole-branch review (last task in the plan)


## Task 7 (final whole-branch review) — COMPLETE
Dispatched to an Opus subagent, which hit the session limit mid-verification
(review-only task, nothing to salvage — it hadn't written anything). Orchestrator
completed the review directly against the pre-built targeted package
(.superpowers/sdd/final-review-package.md), independently verifying each of
the 5 named risks rather than trusting grep output alone:

1. WORKSPACE ISOLATION — CLEAN. Every .update()/.delete() across the whole
   branch's touched files traced to source; every one scopes its WHERE by
   workspaceId. Spot-checked: fields/actions.ts unassign, custom-fields.ts
   value write + archive, hub/actions.ts status update (has guard-in-WHERE
   race check too), schedule.ts plan-cell update.
2. STATUS/COMPLIANCESTATUS/PRODUCTIONSTAGE WRITABILITY — CLEAN. PlanCellValues
   (the single-cell write type) structurally excludes all three by its own
   type definition. bulkPlanCellSchema.field reuses the same PLAN_CELL_FIELDS
   enum. apply-fields.ts (revision-apply path) has ZERO references to any of
   the three identifiers — can't write what it never mentions. The one real
   .set({status:...}) hit in the whole diff is scheduleContent's pre-existing
   approved->scheduled transition (the gate itself, not a bypass) — confirmed
   by reading it in context, not just the grep line.
3. CUSTOM-FIELD INJECTION GUARD — CLEAN. saveCustomFieldValueAction fetches
   definitions scoped to the caller's workspace via listFieldsForSubject,
   rejects an unknown fieldId before any write, validates through the type
   registry, merges (not replaces) into existing customFields.
4. UNBOUNDED QUERIES — CLEAN. Two queries with no explicit .limit() found
   (unreadCountQuery, pendingRevisionCountsQuery) are both count() aggregates:
   one returns a single scalar row, the other's GROUP BY is transitively
   bounded by the (already-capped) contentIds list passed in.
5. NON-STATIC TAILWIND — CLEAN. One template-interpolated className found
   (my-work/page.tsx's `text-xs ${due.tone}`) — traced to dueLabel(), which
   only ever returns one of four complete literal strings
   ("text-white/35" etc.), all present verbatim in the same file for JIT to
   find. Not a runtime-constructed hue/number pattern.
6. SCOPE CREEP — none. Spot-checked the out-of-scope list (column
   resize/drag, custom fields rendering on tickets/campaigns/clients):
   nothing built beyond what F3's admin UI already allows configuring
   (assignment TO other subject types was always in scope; rendering on
   them was not, and nothing renders on them).

VERDICT: mergeable as-is. No Critical or Important findings across the whole
branch. All prior per-slice/per-task Minor findings were addressed in Task 6.

## PLAN-OPS-UX-REMAINING.md IS NOW FULLY EXECUTED — all 7 tasks complete.
Final state: 864 tests passing, 1 skipped. tsc/lint/build all green.
Migrations through 0034 applied. 24 commits since main (24e94d0), ~60k line
diff, still on branch slice/s1-content-model with no PR — splitting it
(plan section 9) remains an owner decision, not yet acted on.

---

# PLAN-SOP-PLATFORM.md execution (started 2026-07-31)

Owner decisions 2026-07-31, all four "recommended":
full workflow builder · process runs · granular roles (Client Portal still
blocked) · build platform layer first, deploy later.

Order: W1 -> W2 -> W3 -> P1 -> W4 -> W5 -> S1 -> S2 -> S3 -> S4 -> S5
       -> D1 -> D2 -> D3 -> A1 -> A2 -> A3

## Complete
- W1 dbb3a89  workflow schema, seed, backfill
- W2 de3402b  engine core (legality, decisions, guarded writes)
- W3 2460c57  Production board renders from the workflow, not the enum
- P1 44a75f7  role capabilities, enforced server-side
- W4 2fa4133  workflow admin UI
- W5 1a2cca7  transition rules (conditions/validators/post-actions)
- S1 b6c9667  SOP templates (migration 0036) — builder UI, cycle guard,
              delete-cascade. Nav entry "sop" added (24 sections).
- S2 24e110d  run instantiation (migration 0037) — lib/sop/instantiate.ts
- S3 32ac400  guarded step moves + unblocking cascade
- S4 8bbaa44  approval gates decide in the Approvals queue (migration 0038)
- S4 edf3583  `creates` materialisation + compliance gate closes from the
              studio's real compliance run

- S5 f2edfe2  at-risk detection + explicit reschedule-downstream
              (lib/sop/risk.ts — pure; no migration needed)

State: 1086 tests green, tsc + lint clean, migrations applied through 0038.
ALL OF PHASE S IS COMPLETE.

## D1, D2, D3, A1, A2, A3 — ALL COMPLETE (2026-08-05)

Found already built but entirely uncommitted at session start (62 commits
ahead of main was actually 61 + a large uncommitted working tree). Verified
each slice by reading the real diff (not trusting completeness from the
file list alone), ran the full gate, then drove every slice live in a
browser before committing — including A1/A2/A3, which had never been
exercised outside unit tests.

- D1 191f152, 3f5f76b, c96b29e (three commits: core broadcast + subscribers,
  Approvals wiring, run-board subscription) — moveRunStep,
  applyRescheduledDates, and transitionContent all broadcast after commit;
  Production, the SOP run board, and Cockpit subscribe; Production/Cockpit/
  run-board also carry a 30s poll fallback (Team Hub's existing pattern).
  Live-verified: signal delivery sub-second in a backgrounded tab; survives
  a forced socket kill via the poll.
- **Extra fix found during D1 verification, not in the original spec:**
  approveAction/scheduleAction (Approvals page's own actions) never called
  broadcastSignal at all — fixed, plus a new ApprovalsLive subscriber.
- D2/D3 7b5fe7e — metrics.ts (cycle time w/ Min-N gate, WIP-vs-limit, overdue load,
  per-owner load) + Cockpit rendering all four as live widgets.
  **Shipped fixed, not broken:** cycleTimeByStateQuery crashed the whole
  page (subquery scope bug, Postgres 42P01) because Cockpit ran all 10
  queries under one Promise.all. Fixed the query, switched to
  Promise.allSettled with a visible degraded-section banner, and added
  metrics.integration.test.ts — the first query test in this repo that
  executes against real Postgres instead of only asserting on .toSQL().
- A1 4e82beb — draft a template from prose, model router, retries once on
  invalid output, never auto-saves. Live-verified: real prose in,
  correctly-chained 5-step template out in <8s, committed and immediately
  usable.
- A2 b930e48 — validateRun, pure functions, 5 deterministic checks (unowned
  step, weekend due date, compliance gate w/ nothing linked, dependency
  ordering, anchor in the past). Live-verified on a real run: 2 real
  findings, each naming the step and the fix.
- A3 88cac48 — suggestNextAction, grounded strictly in run state, returns
  null on a healthy step (min-N/insufficient-context honored).
  Live-verified on a real blocked step: correct diagnosis + concrete
  unblock suggestion.

Full gate after every commit: tsc clean, eslint clean (2 pre-existing
config errors only), 1120/1120 tests, INTEGRATION_DB=1 1125/1125 against
real Postgres, `npm run build` succeeds. Six feat commits + one docs commit,
each independently reviewable (shared files split via git add -p /
temporary-strip-and-restore where D1/A2/A3 touched the same file).

**Still open, deliberately not touched this session** (from
docs/HANDOFF-SOP-REMAINING.md's "Known gaps" table):
- E1 — compliance gate close path still not driven fully E2E (materialise
  → write a real draft body → run compliance → confirm gate closes).
  Confirmed materialisation itself works (Start moves the step and shows
  "Creates A content draft"); did not chase the full chain — pre-existing
  S4 gap, not part of the D1-A3 backlog.
- E2-E20 (docs/ENHANCEMENTS.md) — untouched. Several need an explicit owner
  decision (E17 no-PR/62+ commits, E18 never deployed, E19/E20 already
  tracked in memory).

## Next: owner decision on E17 (PR / branch split) — everything else in
docs/HANDOFF-SOP-REMAINING.md's explicit backlog is done.

---

# Phase G — strategy & decision memory (2026-08-06) — ALL COMPLETE

Spec: `PHASE-G-strategy-memory-delta.md`. Execution plan (per-step TDD,
real code, real gates): `PHASE-G-implementation-plan.md`. Six phases,
smallest-first as directed, each committed separately and verified live —
not just against `tsc`/`vitest`, against the running app with real data.

- Phase 1 `19f17bf` — G1 pure logic (`isGoalWindowActive`, `clientGoalSchema`).
- Phase 2 `2c82c34` — `client_goals` table, migration 0039, queries.
  Smoke-tested CRUD directly against real Postgres before wiring any UI.
- Phase 3 `a1c8772` — G1 complete: Goals section on the client detail page,
  ideation goal picker (server-validated against workspace+client), evidence-
  state chip. **Real bug caught in the browser pass, not by tsc/vitest:**
  `idea-card.tsx` ("use client") imported `DECLARED_ONLY_REASON` from
  `ideation-agent.ts`, pulling the AI router chain (`node:async_hooks`) into
  the client bundle and 500ing `/ideation`. Fixed by computing the flag
  server-side and passing a plain boolean down.
- Phase 4 `0f04118` — G3 complete: `insights` table (migration 0040),
  persisted instead of discarded. Verified live: seeded real pattern posts,
  generated a real insight brief (Cockpit AI-call count 2->3, exactly one),
  reloaded and confirmed zero additional calls, then queried Postgres
  directly to prove every `evidence_pattern_ids` entry is a real
  `pattern_posts` row with zero leakage into first-party `posts`.
- Phase 5 `f4328e1` — G2 pure logic + `decisions` table (migration 0041) +
  queries + `decisions.integration.test.ts` — the most important test in
  Phase G: seeds a real first-party post AND a real pattern post against
  actual Postgres, proves the pattern id never survives the write (not
  just that the pure function says so), proves the outcome guard-in-WHERE
  holds under a second call. 3/3 against real Postgres.
- Phase 6 `7809d88` — G2 complete: `/decisions` route, dependent goal/
  evidence/insight pickers (same pattern as G1's ideation picker), outcome
  recording gated on `isDueForReview`, daily review cron reusing the
  existing Team Hub message path. Verified live end-to-end: created a
  decision citing real evidence + goal + insight through the actual UI;
  confirmed in Postgres zero pattern-layer leakage into
  `evidence_post_ids`; recorded an outcome and confirmed it locks (reload:
  no way to resubmit); ran the actual cron function body directly against
  real data twice — run 1 surfaced one Team Hub message and stamped
  `reviewSurfacedAt`, run 2 surfaced zero, confirming it doesn't repeat.

Full gate after every phase: `tsc` clean, `eslint` clean (2 pre-existing
config errors only), `vitest run` green (1163/1163 by the end, up from
1128 at Phase G's start), `INTEGRATION_DB=1 vitest run` green (1171/1171),
`npm run build` succeeds.

`docs/usecase-catalogue.md` updated in the same pass: UC-CL-05/06,
UC-IDE-06/14, UC-PAT-07, UC-STR-01..06 all flipped to Live; also closed out
three corrections that were already stale before Phase G started
(UC-OPS-23 realtime generalisation, UC-OPS-31/32 SOP run engine super-
seding the old badge/ticket-spawn framing, R1 integration-test coverage).

**Deferred, per the spec, not built:** UC-STR-07 (auto-correlate decisions
to engagement — refused, would be a statistics claim below `MIN_BASELINE_N`),
UC-STR-08/09 (playbook compiler, rejection memory — trigger-gated), UC-IDE-15
(goal-aware retrieval — trigger-gated).

## Not yet verified end-to-end
The compliance gate's CLOSING path is wired (studio compliance pass ->
closeComplianceGatesForContent -> guarded moveRunStep) but was not driven
through a full browser pass: it needs a materialised draft with a written
body, since a freshly materialised draft is empty and parseDraftBody
rejects it. Worth an explicit E2E before trusting it.

## Live fixture for browser verification
workspace d89220ec-6e93-4cbf-9976-9e078fe11918
template  ea96af47-9c55-4660-b71e-962c68c169e6  "Campaign launch"
run       60474dc0-d635-45c8-9910-3934761ee0e1  "Aurora autumn launch"
  Brief approved   D-14 approval gate  -> skipped
  Creative drafted D-10                -> ready, owned by Dev Bypass User
  Compliance pass  D-7  compliance gate-> blocked on Creative drafted

## Footguns confirmed again this session
- Uncontrolled forms do NOT reset on revalidate (re-render, not remount).
  Actions return `savedAt` and the client resets on it. This bug shipped
  silently past tsc + 1021 tests; only adding two steps in a browser found
  it.
- `$B js` evaluates an EXPRESSION — function declarations throw. Use an
  IIFE in a file via `$B eval`.
- Card-matching by full textContent picks the wrong card when one card
  quotes another's title ("Waiting on: X"). Match the title element.
