# ARCHITECTURE-SOP.md

**What exists today** in the workflow engine + SOP platform, as of
2026-08-01 (phases W1–W5, P1, S1–S5 shipped).

Read this before adding anything, so you extend what's here instead of
building a parallel mechanism beside it.

---

## 1. The problem this solved

Before W1, every workflow in the product was a **hardcoded TypeScript
constant**:

```ts
// src/lib/production.ts — compile-time, developer-only
const TRANSITIONS: Record<ProductionStage, StageTransition[]> = {
  brief: [{ to: "in_progress", label: "Start", incrementsRevision: false }],
  ...
};
```

The software could express exactly one agency's process. Everything below
follows from making states, transitions and processes **data**.

---

## 2. Layer map

```
┌─ AI assist ──────── NOT BUILT (A1–A3)
├─ Dashboards ─────── NOT BUILT (D1–D3)
├─ Automation ─────── partial: automationRules exist but are cadence-based
├─ SOP / runs ─────── BUILT (S1–S5)
├─ Permissions ────── BUILT (P1)
└─ WORKFLOW ENGINE ── BUILT (W1–W5)      ← foundation
```

---

## 3. Workflow engine (W1–W5)

### Tables
```
work_types            per workspace: "Content", "Ticket", custom
workflows             a state machine bound to a work type
workflow_states       key, name, category(todo|doing|done), color,
                      position, wip_limit, legacy_stage
workflow_transitions  from_state_id (null = initial), to_state_id, name,
                      position, conditions[], validators[], post_actions[]
```

Rules are typed **jsonb arrays on the transition**, not a fourth table —
matching the established `automationRules.trigger/action` pattern.

### Modules
| Path | Role |
|---|---|
| `src/lib/workflow/engine.ts` | Pure. `initialState`, `isLegalTransition`, `transitionOptions`, `decideTransition`, `isOverWipLimit`, `orderedStates`. |
| `src/lib/workflow/rules.ts` | Rule registry. Conditions: `requires_capability`, `assignee_only`. Validators: `body_required`, `compliance_passed`. Post-actions: `notify_assignee`, `set_due_offset`. |
| `src/lib/workflow/defaults.ts` | Seed shape + colour keys. |
| `src/db/queries/workflow-seed.ts` | `seedContentWorkflow`, `ensureContentWorkflow`, `backfillContentStates`, `initialStateQuery`, `workflowStatesQuery`, `workflowTransitionsQuery`. |
| `src/db/queries/workflow.ts` | `loadContentWorkflow`, the guarded transition write. |
| `src/app/(app)/w/[ws]/workflows/` | Admin UI (states, transitions, rules). |

### The strangler-fig migration (important)

`production_stage` is read by ~22 files. It was **not** removed. Instead:

1. `content.workflow_state_id` was added **alongside** the enum.
2. Every workspace was seeded a default workflow mirroring the enum exactly
   — same keys, labels, colours, graph. `workflow_states.legacy_stage`
   records the mapping.
3. Existing rows were backfilled.
4. The engine is authoritative and **dual-writes**: always
   `workflow_state_id`, plus `production_stage` when the target state
   carries a `legacy_stage`.
5. The Production board renders from `workflow_states` (W3).

> **If you create a `content` row anywhere, you must set
> `workflow_state_id`** (via `ensureContentWorkflow` + `initialStateQuery`),
> or it will be invisible on the Production board. This already caused one
> bug.

Retiring `production_stage` is explicitly **out of scope** until nothing
reads it.

---

## 4. Permissions (P1)

`src/lib/permissions.ts` — a **static matrix**, deliberately not a table.

```
CAPABILITIES:
  workflow.edit, workflow.force, sop.template.edit, sop.run.start,
  approval.decide, field.edit, member.invite, client.manage

owner  : all
admin  : all
member : sop.run.start   ← does the work, cannot rewrite the process
```

Enforced by `requireCapability(workspaceId, userId, cap)` in
`src/db/queries/memberships.ts`. `userCan(...)` is the non-throwing variant
for deciding whether to *render* a control — hiding a button is a courtesy,
never the enforcement.

Owner and admin are identical today; kept distinct so an owner-only
capability is a one-line change later.

---

## 5. SOP platform (S1–S5)

### Tables (migrations 0036, 0037)
```
sop_templates    name, description, anchor_label, work_type_id?, archived_at
sop_steps        position, title, description, assignee_rule jsonb,
                 due_offset_days, gate, creates, depends_on text[]

sop_runs         template_id (SET NULL), client_id, name, anchor_date,
                 status(active|completed|cancelled), started_by_id
sop_run_steps    template_step_id, position, title, description,
                 assignee_id, assignee_role, due_at,
                 status(blocked|ready|in_progress|done|skipped),
                 gate, creates, depends_on text[],
                 linked_type, linked_id, completed_at, completed_by_id
```

Enums: `sop_step_gate(none|approval|compliance)`,
`sop_step_creates(none|task|content|ticket|doc)`,
`sop_run_status`, `sop_run_step_status`.

### Key invariants

- **A run is a snapshot.** Title, gate, offset and dependencies are copied
  onto run rows. `depends_on` is **remapped** from template-step ids to
  run-step ids, so the run's graph points inside itself. Editing a template
  cannot reroute work in flight. `template_id` is `SET NULL`, not
  `CASCADE`.
- **`blocked` is derived, never chosen.** A step is blocked exactly while
  some dependency is not closed.
- **`skipped` counts as closed** for unblocking and progress, but is not
  `done` — completion metrics stay honest.
- Both tables carry `workspace_id` and are in the workspace-scoped registry
  in `schema.ts`.

### Modules
| Path | Role |
|---|---|
| `src/lib/sop/template.ts` | Vocabulary: `SOP_GATE_META`, `SOP_CREATES_META`, `formatOffset`, `shortOffset`, zod schemas, `MAX_OFFSET_DAYS = 365`. |
| `src/lib/sop/dependencies.ts` | `wouldCreateCycle` (DFS over the *proposed* graph), `unknownDependencies`. |
| `src/lib/sop/instantiate.ts` | `instantiateRun`, `addDays` (DST-safe via `setDate`), `startOfDay`, `unblockedStepIds`, `isRunComplete`. |
| `src/lib/sop/risk.ts` | `runRisk` (overdue vs at-risk), `daysLate`, `downstreamStepIds` (BFS, cycle-safe), `rescheduledDates`. |
| `src/db/queries/sop.ts` | All reads + `moveRunStep` (guarded), `assignRunStep`, `applyRescheduledDates`, `closeComplianceGatesForContent`, `pendingGateStepsQuery`. |
| `src/app/(app)/w/[ws]/sop/` | List, template builder, run board, all actions. |
| `src/app/(app)/w/[ws]/approvals/gate-card.tsx` | Gate decision UI inside the existing Approvals queue. |

### Flow

```
Template (steps: offset, owner-rule, gate, creates, depends_on)
   │  start run + anchor date
   ▼
instantiateRun()  → dates = anchor + offset (DST-safe)
                  → owner: user if still a member; role → assignee_role only
                  → depends_on remapped to run-step ids
                  → status: ready if no deps, else blocked
   ▼
Run board: start / claim / assign / complete / skip / create linked row
   │  every move → moveRunStep (guarded WHERE)
   ▼
Same transaction: unblock dependents + mark run complete if all closed
```

### Gates
- **approval** → surfaces in `/approvals` under "Process gates". Decided
  with `approval.decide`. Approve closes it; reject returns it to
  `in_progress` with a required reason recorded to `activity`
  (`subject_type = 'sop_run_step'`, migration 0038).
- **compliance** → closes from the studio's *existing* compliance action
  via `closeComplianceGatesForContent`, only on a pass, only for steps
  linked to that exact draft. **Not** a SOP-specific copy of the compliance
  logic.
- Manual completion of any gated step is refused.

### `creates`
Materialised **on demand** (a button on the step), never at instantiation.
Idempotent by `linked_id`, with `linked_id IS NULL` in the update's WHERE.
Content and tickets require the run to have a client.

---

## 6. Realtime (existing, underused)

`src/lib/realtime.ts` + `src/app/(app)/w/[ws]/hub/use-hub-realtime.ts`
already implement Supabase Realtime channels + presence — **but only Team
Hub uses them.** D1 extends this. Do not add a second mechanism.

---

## 7. Test coverage

| Area | File |
|---|---|
| Dependency graph | `lib/sop/dependencies.test.ts` (13) |
| Template vocabulary | `lib/sop/template.test.ts` (20) |
| Instantiation | `lib/sop/instantiate.test.ts` (27) |
| Risk + reschedule | `lib/sop/risk.test.ts` (24) |
| SOP queries (isolation, bounds, ordering) | `db/queries/sop.test.ts` (22) |
| Workflow engine | `lib/workflow/engine.test.ts`, `rules.test.ts`, `defaults.test.ts` |
| Permissions matrix | `lib/permissions.test.ts` (walks every role × capability) |

Query tests assert on `.toSQL()` — workspace scoping, `LIMIT`, `ORDER BY`,
and the specific params that encode a decision.
