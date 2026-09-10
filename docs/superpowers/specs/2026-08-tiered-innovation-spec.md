# Specification: Tiered Platform Innovations (2026-08)

This specification defines the implementation contract for Tier 1 (tracked gaps) and Tier 2 (vetted net-new capabilities) across InstaMedia, adhering strictly to the Two-Layer Rule, Signal-Only Realtime, and non-speculative deterministic logic.

---

## 1. Scope Matrix

| Code | Title | Tier | Description & Invariant Check |
|---|---|---|---|
| **UC-MEA-08** | Meta Ads Live Connector | Tier 1 | Ingest real lifetime & 30-day spend, impressions, clicks, CTR, conversions for campaigns. |
| **UC-MEA-09** | Plan ➔ Published Attribution | Tier 1 | Measure post performance rollups attributed back to the plan slot/cell that originated the content. |
| **UC-AUT-07** | Automation Dedupe Ledger | Tier 1 | Prevent duplicate execution of automation rules against the same target object within the deduplication window. |
| **UC-OPS-33** | SOP Staleness Flags | Tier 1 | Deterministic audit of SOP templates with no run activity in >90 days or archived dependencies. |
| **FEAT-RADAR** | SOP Risk Radar | Tier 2 | Deterministic DAG critical-path latency calculation against calendar deadlines (`dayOffset` + step status). |
| **FEAT-NUDGE** | KB ➔ Ideation Live Nudge | Tier 2 | Real-time visual prompt chips in `/ideation` when `"kb"` broadcast signal is received. |
| **FEAT-TREND** | Compliance Trendline | Tier 2 | Historical brand compliance score tracking and visualization via `PerformanceAreaChart`. |
| **FEAT-DIGEST**| Overview Live Digest | Tier 2 | Display-only 24h operational rollup across pillars per `UC-OV-03`. |
| **FEAT-TICKER**| Shell AI-Spend Ticker | Tier 2 | Shell-level indicator in `WorkspaceNav` showing today's spend vs workspace daily cap. |

---

## 2. Wave Breakdown & Architecture

### Wave 1: Closed Feedback Loops (Data Models & Connectors)
1. **Meta Ads Live Ingest**:
   - `src/lib/connectors/meta-ads.ts`: Fetcher pulling campaign performance metrics with graceful mock fallback for sandbox/test environments.
   - `src/db/queries/campaigns.ts`: `syncCampaignMetrics({ workspaceId, campaignId, metrics })`.
   - `src/app/(app)/w/[ws]/ads/sync-action.ts`: Server action triggering manual and scheduled metrics pull.
   - `src/app/(app)/w/[ws]/ads/campaign-row.tsx`: Render real impressions, CTR, CPC, and conversion stats.

2. **Plan ➔ Published Attribution**:
   - `src/db/queries/analytics.ts`: `getPlanSlotPerformance({ workspaceId, clientId, slotId })`.
   - `src/components/calendar/plan-cell.tsx`: Display ROI & engagement badges on published plan slots.

3. **Automation Dedupe Ledger**:
   - `src/lib/automation-ledger.ts`: Persistent check `hasRuleFiredRecently({ workspaceId, ruleId, targetId, windowHours })`.
   - `src/lib/automation.ts`: Integrated into rule evaluation lifecycle.

---

### Wave 2: Risk Graphs & Intelligence Signals
4. **SOP Risk Radar & Staleness**:
   - `src/lib/sop/risk-radar.ts`: Evaluates DAG critical path:
     $$\text{Days Remaining} = \text{Target Date} - \text{Today}$$
     $$\text{Estimated Path Latency} = \sum_{\text{step} \in \text{Unfinished Critical Path}} \text{Step Latency}$$
   - Flags: `On Track` (Green), `At Risk` (Amber), `Overdue / Critical` (Red).
   - `src/app/(app)/w/[ws]/sop/runs/[runId]/run-board.tsx`: Render risk badges on header and at-risk step cards.
   - `src/lib/sop/staleness.ts`: Audits template last-run timestamps and flags inactive SOPs.

5. **KB ➔ Ideation Live Nudge**:
   - `src/app/(app)/w/[ws]/ideation/kb-nudge.tsx`: Listens to `"kb"` scope via `useWorkspaceRealtime` and displays fresh source prompt chips.

6. **Compliance Trendline**:
   - `src/lib/brand-compliance.ts`: Append score snapshot on draft save/approval.
   - `src/app/(app)/w/[ws]/brand-gene/vault-editor.tsx`: Render `PerformanceAreaChart` showing compliance evolution.

---

### Wave 3: Shell Telemetry & Overview Digest
7. **Shell AI-Spend Ticker**:
   - `src/components/shell-spend-ticker.tsx`: Lightweight pill mounted next to the presence avatar bar in `WorkspaceNav`.

8. **Overview Live Digest**:
   - `src/app/(app)/w/[ws]/overview/live-digest.tsx`: Display-only 24-hour activity feed summarizing actions across all 4 pillars.

---

## 3. Invariants & Refusal Adherence Checklist
- ✅ **Two-Layer Rule**: All metrics use first-party data; third-party pattern data is never mixed into client performance scores.
- ✅ **Signal-Only Realtime**: Payloads across `ws:<id>:hub` remain `{ scope }` only; fresh data is always fetched via authenticated server actions.
- ✅ **No Capacity Speculation**: Risk radar uses strictly defined calendar target dates and graph step offsets, without assuming individual workload capacities.
- ✅ **Display-Only Overview**: No mutating buttons in Overview Live Digest per `UC-OV-03`.
