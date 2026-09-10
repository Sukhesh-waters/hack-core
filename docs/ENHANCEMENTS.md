# ENHANCEMENTS.md

Known gaps, deferred work, and improvements — **not** part of
`PLAN-SOP-PLATFORM.md`'s remaining slices (those are in
`docs/HANDOFF-SOP-REMAINING.md`).

Each item says *why it matters*, so whoever picks it up can judge priority
rather than inheriting a flat list.

Status key: 🔴 correctness/trust · 🟠 product gap · 🟡 polish · ⚪ deferred by decision

---

## 🔴 Correctness and trust

### E1. Compliance gate close path is not verified end-to-end
`closeComplianceGatesForContent` is wired into the studio's compliance
action and shares the guarded `moveRunStep` with every other close, but the
full path was never driven in a browser. A freshly materialised draft is
empty, and `parseDraftBody` rejects it — so the real flow is
*create draft → write body (`startDraftAction`) → run compliance → gate
closes*.

**Do:** drive that sequence and confirm the gated step closes and its
dependents unblock. Until then, treat the compliance gate as unproven.

### E2. A step assigned to someone never tells them [RESOLVED]
Run steps now create notifications on assignment (enriched with step title), on
`blocked → ready` unblocking, and on gate rejection. Open run steps appear in
the unified **My Work** query (`mySopStepsQuery`) and render on the **Calendar**
(`scheduledSopStepsQuery`) with milestone chips and client/assignee filter support.

### E3. Reject reasons are write-only [RESOLVED]
Rejection reasons are now prominently rendered on the Step Card in the Run Board
as a return feedback callout, and in the new **Run Activity & Decisions** timeline
at the bottom of the run page with actor name, timestamp, and feedback quote.

### E4. No way to cancel a run [RESOLVED]
Implemented via `cancelRunAction` and `cancelSopRun`, which sets run status to
`cancelled`, cancels all pending non-done steps to `skipped`, removes pending gates
from the Approvals queue, and logs the audit event.

### E5. `production_stage` dual-write is still live
The strangler-fig migration is intentionally unfinished: the engine writes
both `workflow_state_id` and the legacy enum. ~22 files still read the
enum.

**Why it matters:** every new writer of `content` must remember to set
`workflow_state_id` too, or the row is invisible on the Production board.
That has already caused one bug (S4).

**Do (later, deliberately):** migrate remaining readers one at a time, then
retire the column. Explicitly out of scope until nothing reads it.

---

## 🟠 Product gaps

### E6. Only `content` has a real workflow
W1–W5 built a general engine, but only the content workflow is seeded and
wired. **Tickets** (`ticketStatus`) and **ideas** (`idea-workflow.ts`) are
still hardcoded graphs.

**Why it matters:** the platform claim is "define your own process". It is
currently half-true — true for production, false for everything else.

**Do:** seed workflows for ticket and idea work types; migrate their
surfaces to render from `workflow_states` the way the Production board
does (W3 is the template for this).

### E7. Automation is cadence-based, not event-driven
`automationRules` fires on a daily sweep. Jira-class automation is
"**when** transition X happens, **then** do Y".

**Do:** add an event trigger kind (`{kind:'event', event:'transition'|
'sop_step_done', ...}`) and fire it from the transition/step writes. The
post-action registry in `lib/workflow/rules.ts` already has the shape to
reuse.

### E8. No template versioning
A run snapshots its template, which is correct. But there is no record of
*which version* it snapshotted, so "what did this process look like in
March?" is unanswerable.

**Do:** either a `sop_template_versions` row written on publish, or store
the resolved step set on the run. Low urgency until someone audits.

### E9. Runs cannot be re-anchored [RESOLVED]
Implemented whole-run re-anchoring via `reanchoredDates` pure date calculation,
`reanchorSopRun` atomic database mutation, and `reanchorRunAction`. Operators
can re-anchor active runs from the Run Board header dialog, shifting all open
steps by the delta while preserving historical closed steps.

### E10. `creates: task` links nowhere useful [RESOLVED]
Implemented back-linking and bidirectional status sync via `origin_run_step_id`
on `hubTasks` (migration 0056). Tasks materialized from SOP steps now display
an interactive `SOP: [Step Title]` badge linking directly to the parent run, and
completing the task automatically advances the origin run step to `done`.

### E11. No SOP metrics or history view
**Resolved:** Implemented per-template performance and execution history view (`src/app/(app)/w/[ws]/sop/[templateId]/template-metrics-view.tsx`). Includes KPI cards for total runs, cycle times (avg days/hours), on-time completion rates (with 24h grace window), slowest step identification, step bottleneck analysis (turnaround time and rejection counts), and full historical runs listing. Enforces the Min-N gate ($N \ge 3$ completed runs) in `src/lib/sop/metrics.ts` before surfacing aggregate statistics.

---

## 🟡 Polish

### E12. Run board re-renders whole cards on every action
Each `StepCard` holds five `useFormState` hooks. Fine at current scale;
worth revisiting if runs routinely exceed ~50 steps.

### E13. No bulk actions on a run
No "assign all unassigned to me", no multi-select skip. The calendar grid
already has a bulk-edit pattern worth copying.

### E14. Template builder has no reorder-by-drag
Up/down buttons only. Adequate, not delightful.

### E15. `docs` still has a prose `sop` kind
`workspace_docs.kind = 'sop'` predates the executable SOP tables. Two
things called SOP is confusing.

**Do:** rename the doc kind to `runbook`, or add copy distinguishing them.
(The SOP page already links to Docs and explains the split.)

### E16. Nav is at 24 entries
Discoverability is degrading. Worth a grouping/collapse pass, or promoting
a genuine "home" surface.

---

## ⚪ Deferred by explicit owner decision

Do **not** pick these up without asking — they were ruled out on purpose.

| Item | Decision |
|---|---|
| **Client Portal / external stakeholder access** | Blocked. Owner decision 2026-07-31 unblocked *granular roles* but kept the portal out. |
| **Custom per-workspace roles** | Fixed capability matrix only. Custom roles turn every permission question into an unauditable runtime lookup. |
| **Sub-checklists inside SOP steps** | Owner chose process runs, not checklists-in-runs. |
| **Cross-workspace / org-level templates** | Workspace-scoped only. |
| **Retiring `production_stage`** | See E5 — deliberate, not yet. |
| **Deploy** | Owner chose to build the platform layer first. |

---

## Operational debt

### E17. 62 commits on one branch, no PR
`slice/s1-content-model` carries the entire W/P/S programme plus the
earlier ops-layer work. No PR has been opened and nothing has been pushed.

**Options:** split into per-slice PRs (expensive, rewrites history), open
one large PR as-is, or keep building. **Owner decision — unresolved.**

### E18. Never deployed
Migrations are applied to the Supabase dev database, but the app has never
run on Vercel. The longer this waits, the more env/build surprises pile up.

### E19. Secrets were committed to git history
Recorded previously: real keys were committed in `.env.example` (private
repo). Rotation still pending. **Rotate before any public deployment or
repo visibility change.**

### E20. Repo is iCloud-synced
`~/Documents/GitHub/...` is inside iCloud Drive — a known source of
`.git` corruption and file-watcher flakiness. Consider moving the working
copy outside iCloud.

---

## 🟠 Workspace assets — shipped and remaining

**Shipped (Slice 1, 2026-09-03):** `assets` table + private Supabase Storage
bucket, `/w/[ws]/assets` page, upload/archive/signed-download actions,
`asset.upload` + `asset.delete` capabilities, 10 MB per file and 250 MB per
workspace. Spec: `docs/superpowers/specs/2026-09-03-assets-and-saas-gap-audit-design.md`.

**Shipped (Slice 2, 2026-09-05):** Knowledge Base Ingest from Uploaded Files.
`getObject` server download adapter, migration 0055 adding `asset_id` (foreign
key to `assets.id`) and nullable `url` to `knowledge_sources`, pure text extraction
for PDF (`unpdf`), CSV (`papaparse`), text/markdown (`src/lib/asset-extract.ts`),
vector retrieval attribution (`sourceKind` / `assetId`), server action
`ingestAssetToKnowledgeBaseAction` (download -> extract -> chunk -> embed -> record),
and UI integration in Asset Library (`Add to KB` client picker) and Brand Gene
(`FILE` badge). Spec: `docs/superpowers/specs/2026-09-03-assets-and-saas-gap-audit-design.md`.

**Shipped (Slice 3, 2026-09-05):** File Attachments on Work Surfaces.
Wired `assets.linked_type` and `linked_id` polymorphic links across Tickets,
Studio Drafts, and Direct Messages. Added `listLinkedAssets`, `linkAsset`, and
`unlinkAsset` queries, updated `uploadAssetAction` with linking and path revalidation,
added `uploadChatAttachmentAction` and `direct_messages.attachments` persistence with
live download links, and added `TicketAttachments` and `DraftAttachments` UI components.
Spec: `docs/superpowers/specs/2026-09-03-assets-and-saas-gap-audit-design.md`.

**A3. Quota is a constant, not a plan.** `MAX_WORKSPACE_BYTES` in
`src/lib/assets.ts` is 250 MB for every workspace. When plan tiers land it
becomes a per-workspace value; every caller already goes through
`checkAssetUpload()`, so that is a one-file change.

**A4. SVG is deliberately not accepted.** An SVG can carry inline script and
we serve files from a signed URL on a real origin. Re-enabling it is an
owner decision — add `"image/svg+xml": "image"` to `MIME_KIND` in
`src/lib/assets.ts` and the test that asserts its absence will tell you.
