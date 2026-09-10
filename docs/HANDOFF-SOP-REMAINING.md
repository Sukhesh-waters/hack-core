# HANDOFF-SOP-REMAINING.md

**For:** an agent continuing `PLAN-SOP-PLATFORM.md` from a cold start.
**State:** phases W1–W5, P1 and S1–S5 are **complete and merged to the
branch**. Six slices remain: **D1, D2, D3, A1, A2, A3.**

## Read these first, in this order

1. `docs/ENGINEERING-RULES.md` — binding rules + footguns. Non-optional.
2. `docs/ARCHITECTURE-SOP.md` — what already exists. Extend it, don't
   duplicate it.
3. `PLAN-SOP-PLATFORM.md` — the original plan and its recorded decisions.
4. `.superpowers/sdd/progress.md` — the ledger. Trust it and `git log` over
   any recollection.

## Ground truth

```
branch   slice/s1-content-model   (62 commits ahead of main, NO PR)
tests    1086 passing, 1 skipped
migrations applied through 0038
never deployed
```

Live fixture for browser verification:
```
workspace d89220ec-6e93-4cbf-9976-9e078fe11918
template  ea96af47-9c55-4660-b71e-962c68c169e6   "Campaign launch" (3 steps)
runs      several, incl. one with a deliberately late step
```

Every slice: `tsc` + `vitest` + `eslint` green, migration read line by
line, **and driven in a browser**. Then update the ledger.

---

# Phase D — real-time dashboards

## D1 — broadcast workflow + SOP events

**Done when:** a change made in one tab appears in another without a
refresh, on the run board and the Production board.

### What exists
`src/lib/realtime.ts` and `hub/use-hub-realtime.ts` already implement
Supabase Realtime channels with presence — used **only** by Team Hub.

### Build
1. Generalise the channel helper: add scopes alongside the existing hub
   ones, e.g. `sop`, `workflow`.
2. Broadcast after the writes that change shared state:
   - `moveRunStep` (step moved / unblocked / run completed)
   - `applyRescheduledDates`
   - the workflow transition write in `db/queries/workflow.ts`
   - `decideGateStepAction`
3. Subscribe on the run board and the Production board; on signal, call
   `router.refresh()`.

### Constraints
- **Do not add a second realtime mechanism.** Extend the existing one.
- Broadcast **ids and a scope only** — never row contents. The existing hub
  channel deliberately puts no user names or content on the wire.
- Broadcast **after** the transaction commits, never inside it. A signal
  for a write that then rolls back makes every client show a lie.
- A dropped signal must be survivable: the page is still correct on reload.
  Realtime is an optimisation, not the source of truth.

---

## D2 — metrics queries

**Done when:** cycle time, WIP-vs-limit, overdue load and per-owner load
are available as workspace-scoped, bounded queries with tests.

### Build (`src/db/queries/metrics.ts`, new)
- **Cycle time per state** — average time a content row sat in each
  workflow state. Requires state-entry timestamps; if `activity` rows
  (`verb: 'transitioned'`) carry enough, derive from those rather than
  adding a column.
- **WIP vs limit** — count per `workflow_state_id` against
  `workflow_states.wip_limit`. Reuse `isOverWipLimit` from
  `lib/workflow/engine.ts`.
- **Overdue load** — open `sop_run_steps` past `due_at`, grouped by run and
  by assignee.
- **Per-owner load** — open steps + open tickets + assigned content per
  member.

### Constraints
- Every query workspace-scoped and `.limit()`-ed. Tests assert both via
  `.toSQL()`, following `db/queries/sop.test.ts`.
- **Min-N gate applies.** Do not render an average cycle time computed from
  a handful of rows — show "insufficient data" instead of a confident
  number built on three samples.
- Aggregate in SQL (`count(*) filter (where ...)`), not by loading rows and
  counting in JS. `sopRunProgressQuery` is the pattern.

---

## D3 — Cockpit as live command centre

**Done when:** `/cockpit` shows real workspace state and updates without a
refresh.

### Build
Widgets over D2's queries: active runs with progress and at-risk counts,
overdue steps by owner, WIP breaches, approval + gate queue depth. Subscribe
via D1.

### Constraints
- Every widget links to the thing it describes. A number nobody can act on
  is decoration.
- Empty states say what would populate them.
- No new nav entry — Cockpit already exists.

---

# Phase A — AI assist

**All three go through the model router** (`src/lib/ai/`), wrapped in
`runWithAiCost`. No provider SDK anywhere else. Follow the shape of
`lib/ai/ideation-agent.ts` and `compliance-agent.ts`.

## A1 — draft a template from prose

**Done when:** "our monthly content cycle for a skincare client" produces
an **editable draft template** the user can accept, edit, or discard.

### Constraints
- **Never auto-save.** Render the proposed steps as a reviewable form; the
  user commits. An AI writing directly into the process definition is
  exactly the trust failure the gate design exists to prevent.
- Output must validate against `sopStepSchema` before it is shown. Reject
  and retry once on malformed output rather than rendering junk.
- Offsets must be within `MAX_OFFSET_DAYS`; dependencies must reference
  steps in the same proposal and must be acyclic — reuse
  `wouldCreateCycle`.
- Two-layer rule: ground prompts in first-party context only.

## A2 — validate a run

**Done when:** opening a run surfaces concrete, checkable problems.

Checks worth having (most need **no AI at all** — prefer deterministic):
- steps with no owner and no role
- due dates landing on a weekend
- a compliance gate with nothing linked to check (**already implemented**
  in the run board — extend, don't duplicate)
- offsets that put a dependent **before** its dependency
- a run whose anchor is in the past at start

### Constraints
- Deterministic checks are not "AI features" — implement them as pure
  functions in `lib/sop/validate.ts` with tests. Only use the router for
  genuinely judgement-shaped advice.
- Findings must name the step and the fix. "This run looks risky" is not a
  finding.

## A3 — next-action suggestion

**Done when:** a blocked or at-risk step can offer grounded advice on what
would unblock it.

### Constraints
- Ground strictly in the run's own state (what it waits on, who owns that,
  how late it is). Never invent facts about the client or the work.
- Suggestion only — never mutates the run.
- Respect the min-N/insufficient-context principle: with nothing useful to
  say, say nothing rather than filler.

---

# Known gaps and enhancements

See `docs/ENHANCEMENTS.md` for the full backlog. The items most likely to
bite whoever works next:

| # | Gap | Why it matters |
|---|---|---|
| 1 | **Compliance gate close path not verified E2E** | Wired (`closeComplianceGatesForContent`) but never driven in a browser: a freshly materialised draft is empty and `parseDraftBody` rejects it, so the flow needs draft → write body → run compliance. Verify before trusting. |
| 2 | **No cancel-run action** | `sop_run_status` has `cancelled` but nothing sets it. A mistaken run can only be abandoned. |
| 3 | **Reject reasons are write-only** | Stored in `activity`, never displayed. The person who must fix the work cannot read why it was sent back. |
| 4 | **Run steps are invisible outside the run** | Not in My Work, notifications, or the calendar. Someone assigned a step has no way to be told. |
| 5 | **Only `content` has a real workflow** | Tickets and ideas still use hardcoded graphs. |
| 6 | **62 commits, no PR, never deployed** | An owner decision, not an oversight — but it is accumulating risk. |

---

# Working agreement

- One slice = one branch = one reviewable diff.
- Do not start a slice you cannot finish and commit; a half-built slice
  left uncommitted is worse than a clean stopping point.
- Update `.superpowers/sdd/progress.md` the moment a slice lands.
- If a plan item conflicts with `CLAUDE.md` or with a decision recorded in
  `PLAN-SOP-PLATFORM.md`, **stop and ask the owner** which governs. Do not
  silently resolve it.
