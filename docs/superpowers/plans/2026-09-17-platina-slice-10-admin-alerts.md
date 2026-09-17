# Platina AI OS for Waters — Slice 10 Task Plan: Rules, Alerts, and Operational Admin

**Date:** 2026-09-17
**Status:** Proposed — authorizes Slice 10 execution only
**Governing plan:** [2026-09-11-platina-waters-realtime-full-suite.md](./2026-09-11-platina-waters-realtime-full-suite.md) (+ 2026-09-15 addendum)
**Predecessor:** [Slice 9](./2026-09-17-platina-slice-9-outcomes.md) (done, `a424a3d`)

## Purpose

Make the system configurable without exposing implementation noise: an
explicit Platina capability set, stored thresholds consumed by the runtime
paths they govern, alert rules with a delivery ledger, and configuration
history.

## Capability matrix (the Slice 10 role policy, enforced server-side)

New capabilities in `src/lib/permissions.ts`:

- `platina.audit.run` — run an already-approved audit (member+)
- `platina.audit.manage` — create/approve audit scopes (owner/admin)
- `platina.finding.review` — review and triage findings (member+)
- `platina.solution.edit` — edit draft solutions (member+)
- `platina.solution.approve` — approve a direction (owner/admin)
- `platina.execution.approve` — final approval, rejection, claims exceptions
  (owner/admin)
- `platina.outcome.import` — import outcomes and grade receipts
  (owner/admin)
- `platina.config.manage` — thresholds, profile, claims rules, analysis
  sequence, prompts, alert rules (owner/admin)

Action re-mapping (the four gate events keep their names — capabilities
govern who, gates record what):

| Action | Was | Now |
|---|---|---|
| runAuditNowAction | gate.confirm | platina.audit.run |
| createScanSpecAction / confirmScanAction | gate.confirm | platina.audit.manage |
| reviewFindingAction / reauditDriftAction | gate.approve | platina.finding.review |
| editSolutionAction | gate.approve | platina.solution.edit |
| approveDirectionAction | gate.approve | platina.solution.approve |
| publishCampaignAction / rejectSolutionAction / claimsExceptionAction | gate.publish / gate.approve | platina.execution.approve |
| importOutcomesAction / gradeReceiptAction | gate.approve | platina.outcome.import |
| saveConfigAction / saveProfileAction / claims-rule actions | gate.approve | platina.config.manage |
| declareBrandAction / brand-source actions | gate.declare | gate.declare (unchanged — gate 1 is a safeguard, not config) |

## Threshold wiring (stored values consumed, not constants)

- `contradiction.resolve()` takes optional contested/qualified floors; the
  sweep reads them from the workspace config snapshot.
- `alert-sweep` reads `minBaselineN` from the rule's workspace config instead
  of the hardcoded 5.
- `brain-maintenance` reads compaction stale-days / near-dupes / cosine from
  config.

## Alerts (in-app only in V1)

- `platina_alert_deliveries` (migration): `id`, `workspace_id`, `rule_id`,
  `severity`, `route` (`in_app`), `status` (`sent` | `suppressed` |
  `failed`), `reason` nullable, `created_at`. Workspace index.
- Alert sweep: on a rule match, write one delivery (`in_app`, sent) and
  broadcast the `alerts` scope; at most one delivery per rule per 24 h
  (suppressed repeats are recorded as `suppressed` with the reason).
- Admin: alert rule add (name, metric field, op, threshold, severity),
  enable/disable toggle, and the delivery ledger with per-delivery status.
- Cockpit: recent alert deliveries surface in the activity timeline.

## Admin controls

- Analysis sequence: checkboxes over the four known steps (order preserved
  from the stored array; toggling writes the filtered sequence).
- Prompt version: integer input (bumps are deliberate and recorded).
- Similarity floor: number input (R4.2's floor becomes operator-visible).
- Every config save writes a gate event (`subjectType: "workspace_config"`)
  — configuration history is the gate ledger filtered to config changes,
  shown on the Admin page with the effective version.

## Test specification

- Permissions matrix: the new capabilities exist with labels and messages;
  member holds exactly the four member-level ones.
- `resolve()` honors injected floors.
- Alert sweep: match → one `sent` delivery; repeat within 24 h →
  `suppressed`; no match → nothing.
- Config save writes the gate event; analysis-sequence toggle filters the
  stored array.
- All existing gates stay green.

## Done when

Changing an authorized setting changes only future runs; unauthorized
changes fail before DB access; every alert is sent, suppressed, or failed
with a recorded reason; the capability policy above is enforced and tested.

## Explicit non-goals for Slice 10

- No email delivery route (separately approved only).
- No custom per-workspace roles (the matrix stays fixed by design).
- No Cockpit composition (Slice 11).
