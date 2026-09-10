# Real-time flow QA — live browser test

**Date:** 2026-08-04
**Branch:** `slice/s1-content-model`
**Method:** Headless Chromium (Playwright via gstack browse), two tabs against a real dev server
on `localhost:3001`, real Supabase Realtime, real Postgres (Aurora Skincare workspace
`d89220ec-6e93-4cbf-9976-9e078fe11918`), dev-bypass auth.
**Scope:** core real-time flows only. No cosmetic, copy, or a11y findings.

---

## Verdict

**The real-time layer works.** Signal delivery is sub-second on every scope that is wired up,
survives a forced socket kill, and drives the observer tab without any manual reload.

One page is hard-broken (Cockpit, 500), and real-time coverage is thinner than the code
comments claim. Details below.

**Update 2026-08-05 — Findings 1-3 fixed.** See `counterattack-11-realtime-qa.md` for the full
plan and verification evidence. Summary:

- **Finding 1 (Cockpit 500):** fixed. The `cycleTimeByStateQuery` subquery-scope bug is corrected,
  `cockpit/page.tsx` now uses `Promise.allSettled` with a visible degraded-section banner instead
  of one failing query killing the whole page, and `src/db/queries/metrics.integration.test.ts`
  runs the query against real Postgres (`INTEGRATION_DB=1`) so this class of bug can't ship silently
  again. Re-verified live: Cockpit renders full content (was 0 chars, now 2283+).
- **Finding 2 (no poll fallback):** fixed. Production, Cockpit, and the SOP run board now carry
  the same unconditional 30s `setInterval(() => router.refresh(), ...)` Team Hub already shipped.
  Verified live: killed the WebSocket on every connection attempt, mutated the DB directly
  (bypassing the app, so no broadcast fired), and confirmed the board updated within the poll
  window anyway.
- **Finding 3 (Approvals not wired):** fixed, and worse than originally diagnosed. The original
  finding assumed Hub actions already broadcast `approvals` for this page — re-checked during
  planning and that's wrong on the specific point that matters: `approveAction`/`scheduleAction`
  in `approvals/actions.ts` (this page's own content-approve and scheduling actions) never called
  `broadcastSignal` at all. Fixed both call sites, added the `ApprovalsLive` subscriber (scopes
  `approvals` + `sop`, since gate decisions broadcast under `sop`), and verified live: both a gate
  decision and a schedule action landed in a backgrounded observer tab in under 1s.
- **Finding 4 (presence `|| 1` masking):** still deferred, per the original reasoning — presence is
  confirmed working, so this is a masked-failure risk, not a live bug.

---

## How this was measured

Naive checks give false answers here, so the method matters:

- A sentinel DOM attribute is **not** a valid refresh detector — React reconciliation preserves
  manually-added attributes across `router.refresh()`. An early pass using this produced a false
  "no refresh" reading.
- Polling the observer tab with `tab-each` is also invalid — activating a tab can itself trigger
  a refetch, so the measurement creates the result.

What was actually used: the observer tab was instrumented to **self-record timestamped
WebSocket frames and DOM mutations**, then left untouched and backgrounded. Its log was read
once at the end. The timestamps are independent of when the log was read.

---

## Results — signal delivery

| Scope | Trigger | Action → WS frame | Observer updated | Status |
|---|---|---|---|---|
| `workflow` | Card transition on Production board | **689 ms** | DOM at 952 ms | PASS |
| `workflow` | Repeat, after forced socket kill | **785 ms** | yes | PASS |
| `sop` | "Start" a step on a SOP run board | **425 ms** | yes ("Start" → "Mark done") | PASS |
| `messages` | Post a Team Hub message | **593 ms** | yes (message text present) | PASS |
| presence | Two sessions on Team Hub | `track` → `presence_state` → `presence_diff` | "1 ONLINE" | PASS |
| `cockpit` | — | not reachable | — | **BLOCKED** (page 500s) |

Observer tab was backgrounded and never focused during the workflow test. Delivery still landed
in under a second, so background tab throttling does not break signal receipt.

### Resilience

Forcibly closing the WebSocket mid-session:

```
17:23:52.479  CLOSE code=1005
17:23:53.753  OPEN            ← supabase-js auto-reconnect, 1.3s
17:23:53.836  re-subscribed
17:24:13.965  BROADCAST-IN    ← next transition delivered normally
```

Reconnect and re-subscribe are automatic and the channel resumes delivering. No stuck state.

### Workflow engine correctness (observed in passing)

The transition dropdown returns per-option allow/deny with reasons from the engine —
`Footage in` offered, `Client sign-off / Revision / Done` each labelled
"not reachable from shoot day". Gating is enforced at the UI, not just server-side.

---

## Finding 1 — Cockpit page is completely down (blocker)

`/w/<ws>/cockpit` renders **nothing**: zero body text, no `<title>`, `notFound()` boundary hit.

Root cause is invalid SQL in a new query, [`src/db/queries/metrics.ts:36-68`](../src/db/queries/metrics.ts#L36-L68):

```
PostgresError: missing FROM-clause entry for table "activity"  (code 42P01)
  at getCycleTimeByState (src/db/queries/metrics.ts:48)
  at Promise.all (index 9)
  at CockpitPage (w/[ws]/cockpit/page.tsx:39)
```

`cycleTimeByStateQuery` selects `.from(<subquery aliased "transitions">)`, but the outer
`select` and `groupBy` still reference `activity.meta` / `activity.createdAt`, which render as
`"activity"."meta"` and `"activity"."created_at"`. The `activity` table is not in the outer
query's FROM clause, so Postgres rejects it. The outer references need to point at the
subquery's own columns.

Two consequences beyond the blank page:

- The whole page dies rather than the one card. All ten queries run under a single
  `Promise.all` in [`cockpit/page.tsx:41-63`](<../src/app/(app)/w/[ws]/cockpit/page.tsx#L41-L63>),
  so one failing metric takes down SOP runs, WIP, gates, workload, and AI spend with it.
- `CockpitLive` never mounts, so the `cockpit` scope subscription does not exist in practice.

### Why the test suite missed it

`src/db/queries/metrics.test.ts` passes (12/12). Every test calls `.toSQL()` and asserts on the
**generated string** — nothing executes against Postgres. Invalid-but-well-formed SQL passes
clean. This class of bug is invisible to the current test shape.

---

## Finding 2 — the degradation ladder is not implemented where it is claimed

[`src/lib/realtime.ts:28-31`](../src/lib/realtime.ts#L28-L31) states a Realtime outage is safe
because "clients fall back to the 30s poll". That fallback exists on exactly one surface:

| Surface | Realtime | Poll fallback |
|---|---|---|
| Team Hub (`team-hub-canvas.tsx:120`) | yes | yes, 30s |
| Production board | yes | **none** |
| SOP run board | yes | **none** |
| Cockpit | mounted but dead | **none** |

If Supabase Realtime is down or the publishable key is missing, `useWorkspaceRealtime` returns
early and the Production and SOP boards go permanently stale with no indication to the user —
they simply show old data until someone reloads. That is the exact silent-staleness the
constitution's degradation ladder is meant to prevent.

---

## Finding 3 — real-time coverage gaps

Only four surfaces subscribe at all. Notably absent:

- **Approvals page** — no subscription, even though `approvals` is a broadcast scope and Team Hub
  already listens for it. Approving in one tab leaves another approver's queue stale.
- **SOP list page** (`/sop`) — only the individual run board is live; the run list is not.
- **Tickets**, **My work**, **Plan**, **Calendar** — no subscription.

`broadcastSignal` is only called from three places (`hub/actions.ts:47`, `workflow.ts:240`,
`sop.ts:506` and `:728`), so scopes `tasks`, `reminders`, and `plan` are declared and subscribed
but **never broadcast by anything**.

---

## Finding 4 — minor

- **Presence failure is masked.** [`team-hub-canvas.tsx:208`](<../src/app/(app)/w/[ws]/hub/team-hub-canvas.tsx#L208>)
  computes `...filter(...).length || 1`, and the avatar ring falls back to `mb.id === me.id`.
  If presence silently stopped syncing the UI would still read "1 ONLINE" with your own ring lit.
  Presence *is* working today (verified at the frame level) — the concern is that its failure
  would be undetectable.
- **Channel is joined twice per mount** in dev (`phx_join` ref 6, then `phx_leave` + re-join ref 10).
  This is React StrictMode double-invoke; cleanup does run correctly. Dev-only, no action needed.

---

## Also checked, no issues

All other core pages return 200 and render real content: Overview, My work, Team Hub, SOPs,
Plan & Validate, Production, Tickets, Approvals, Calendar, Workflows.

Note: Calendar and Workflows briefly measure as empty if sampled immediately after navigation —
that is hydration timing in the harness, not a defect. Both render fully.

---

## Suggested order for the counterattack

1. Fix `cycleTimeByStateQuery` outer-reference bug — unblocks Cockpit entirely.
2. Make the metrics tests execute against a real database, or the next SQL bug ships the same way.
3. Isolate the ten Cockpit queries so one failure degrades one card, not the page.
4. Either implement the poll fallback on Production and SOP boards, or drop the claim from the
   `realtime.ts` comment and surface a visible "live updates unavailable" state.
5. Decide on the unwired scopes: subscribe Approvals, or remove `tasks`/`reminders`/`plan` from
   `RealtimeScope` until something broadcasts them.
