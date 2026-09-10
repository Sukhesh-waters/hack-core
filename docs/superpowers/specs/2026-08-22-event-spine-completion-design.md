# Design Spec: Event Spine Completion & Cascade Loop Closure

**Date**: 2026-08-22  
**Status**: Approved & In-Flight  

---

## 1. Problem Statement & Architecture Context

1. **DB Column Drift (Blocker)**:
   `src/db/schema.ts` added 5 columns (`sop_run_steps.completes_when`, `sop_run_steps.linked_type`, `sop_run_steps.linked_id`, `sop_suggestions.scoped_run_hash`, and `sop_suggestions.reason`/`suggested_changes`). Without a corresponding Drizzle migration (0050), real database inserts in the Sprint Engine and SOP reverse-sync will fail and roll back transactions.
2. **Provenance Asymmetry (The Split Spine)**:
   New actions emit domain events via `emitDomainEvent`, but legacy mutation boundaries (`approvals/actions.ts`, `calendar/actions.ts`, `sop/actions.ts`, `tickets/actions.ts`) still call `broadcastSignal` directly and manually invoke `recordActivity`. This creates duplicate activity logs or missed Inngest triggers depending on provenance.
3. **Unreachable Cascade Loop**:
   `CascadeProposalDrawer` and `createCascadeProposalAction` currently have zero UI mount points, leaving the schedule drift cascade and `scopedRunHash` concurrency protection inaccessible to users.

---

## 2. Wave Plan

### Wave 0 — Unblock: Schema Migration 0050 & Clean Separation
1. **Migration 0050**: Generate `drizzle/0050_sop_cascade_and_reverse_sync.sql` adding:
   - `sop_run_steps.completes_when` (`jsonb DEFAULT '{"kind":"manual"}'::jsonb NOT NULL`)
   - `sop_run_steps.linked_type` (`text`)
   - `sop_run_steps.linked_id` (`text`)
   - `sop_suggestions.scoped_run_hash` (`text`)
   - `sop_suggestions.reason` (`text`)
   - `sop_suggestions.suggested_changes` (`jsonb`)
2. Update `drizzle/meta/_journal.json` to register migration `0050`.
3. Separate marketing commits cleanly.

---

### Wave 1 — Complete the Spine & Lint Guard
1. **Mutation Boundary Conversions**:
   - `approvals/actions.ts`: Replace direct `recordActivity` + `broadcastSignal` with `emitDomainEvent({ verb: "approval.decided", ... })` and `emitDomainEvent({ verb: "content.state_changed", ... })`.
   - `calendar/actions.ts`: Replace direct `recordActivity` / `broadcastSignal` in cell updates, scheduled posts, and publish triggers with `emitDomainEvent`.
   - `tickets/actions.ts`: In `advanceTicketStatusAction`, emit `ticket.closed` when moving to `done`, and `ticket.reopened` when reopening.
   - `sop/actions.ts`: In `completeStepAction` and `decideGateStepAction`, emit `sop_step.completed` / `approval.decided`.
2. **ESLint Guard**:
   - Add ESLint rule `no-restricted-imports` restricting direct import of `broadcastSignal` from `@/lib/realtime` outside authorized allowlisted infrastructure (`src/lib/events/dispatch.ts`, `src/lib/realtime.ts`, chat, kb, inngest reconciliation).
3. **Event Automations**:
   - Wire `case "event"` in `src/lib/automation.ts` and `src/inngest/functions/automation.ts` to process domain event triggers.

---

### Wave 2 — Close the Cascade Loop
1. Mount `CascadeProposalDrawer` into the **Sprint Command Deck** SOP Stepper and the **SOP Run Detail page** (`/w/[ws]/sop/runs/[runId]`).
2. Add interactive slip detection trigger: when a step is overdue or edited with an actual completion date, offer 1-click **"⚡ Propose Cascade"** opening the drawer with predicted downstream date adjustments and breach warnings.

---

### Wave 3 — Full Verification
1. Run `npm run typecheck`
2. Run `npm run lint`
3. Run `npm run test`
4. Run `npm run build`
