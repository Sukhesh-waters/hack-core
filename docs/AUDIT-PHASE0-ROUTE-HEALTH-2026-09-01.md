# Phase 0 — Route Health Audit

**Date:** 2026-09-01
**Branch:** `main` @ `1dc6917`
**Environment:** local `next dev` (:3000), live Supabase DB (`aws-1-ap-south-1.pooler.supabase.com`)
**Workspace under test:** `aurora-skincare-client-work` (`d89220ec-…e11918`) — 8 content, 4 runs, 12 steps, 1 client, 2 templates
**Auth:** `AUTH_DEV_BYPASS=true` → `Dev Bypass User <dev@localhost.test>`
**Method:** gstack `/browse` headless Chromium, authenticated session, per-route text + console capture

---

## Verdict

**28 of 30 routes render real content. 2 are soft 404s.** No route crashes, no unhandled client
exceptions. The app is in materially better shape than the branch history suggested.

Three defects found, one of them a methodology trap that would have poisoned the E2E suite had it
not been caught here. That alone justified running Phase 0 before writing any Playwright code.

---

## Route inventory (30)

| Result | Count | Routes |
|---|---|---|
| ✅ Renders | 28 | overview, my-work, sprint, hub, sop, plan, production, tickets, docs, approvals, calendar, brand-gene, ideation, studio, kb, decisions, drift, ads, reports, cockpit, accounts, clients, rules, workflows, automations, fields, analytics, patterns |
| ❌ Soft 404 | 2 | **`ask`**, **`chat`** |

Both 404s are in the set of four routes that exist on disk but are absent from `NAV_SECTIONS`
(`analytics`, `ask`, `chat`, `patterns`). `analytics` and `patterns` render; `ask` and `chat` do
not. This is direct input to Slice 4's keep/nest/archive inventory: two of those four are already
dead and should be archived rather than re-surfaced.

---

## Findings

### F1 — `[ws]` route param is the workspace UUID, not the slug (severity: low, by design)

`/w/aurora-skincare-client-work/sop` returns **HTTP 200 with a 404 body**.
`/w/d89220ec-…e11918/sop` renders correctly.

Not a bug, but two consequences that matter:

1. **HTTP status is not a health signal here.** Next.js `notFound()` returns 200 with a 404 body.
   Any audit or test asserting on status code alone reports false green. This audit's first pass
   did exactly that — all 30 routes reported "200 OK" while every one was a 404 body.
2. E2E fixtures must resolve workspace UUIDs, not hardcode slugs.

### F2 — Invalid workspace id triggers a DB write before validation (severity: medium)

Hitting `/w/<invalid-id>/plan` produced:

```
Failed query: insert into "work_types" (...) values (...)
PostgresError: insert or update on table "work_types" violates foreign key
constraint "work_types_workspace_id_workspaces_id_fk"
```

The `/plan` route attempts to **seed** `work_types` using the URL-supplied `workspace_id` before
confirming the workspace exists. The FK constraint blocks it, so it fails safely and no bad row is
written — but the ordering is inverted. Membership/existence validation should precede any seeding
write. Currently any unauthenticated-but-shaped request can provoke a write attempt.

**Fix:** move the workspace existence + membership check ahead of `ensureWorkTypes`-style seeding in
the `/plan` route path.

### F3 — Realtime WebSocket: false negative from test methodology (severity: none — but critical lesson)

The console sweep reported on `my-work`, `sop`, and `cockpit`:

```
WebSocket connection to 'wss://<project>.supabase.co/realtime/v1/websocket?...' failed:
WebSocket is closed before the connection is established.
```

**This is not a real failure.** Verified independently:

| Check | Result |
|---|---|
| Broadcast POST (`/realtime/v1/api/broadcast`) — the server-side `broadcastSignal` path | **202 Accepted** ✅ |
| Direct WS connect from node with the same publishable key | **WS OPEN** ✅ |

The warning was caused by the audit script navigating to the next route before the WS handshake
completed. Both halves of the realtime path are healthy.

**Why this matters more than the finding itself:** this is the inverse of the trap identified in the
test plan. The plan warned that the 30s poll fallback hides realtime *failure* (false green). This
run produced a false *red* from premature navigation. Both directions are live risks, and both are
methodology problems, not app problems.

**Binding constraint for Phase 3:** realtime specs must explicitly await WS `open` (or subscription
`SUBSCRIBED`) before performing the mutation being asserted on. A spec that navigates, mutates, and
asserts without that wait will be flaky in both directions and its results will be worthless.

---

## Blockers for the E2E plan

### B1 — Every workspace has exactly one member

| workspace | content | runs | steps | clients | templates | **members** |
|---|---|---|---|---|---|---|
| internal-sales | 24 | 1 | 4 | 3 | 4 | **1** |
| aurora-skincare-client-work | 8 | 4 | 12 | 1 | 2 | **1** |
| team-1 | 0 | 0 | 0 | 0 | 0 | **1** |

Phase 3's dual-context realtime tests need **two members in one workspace** (user A mutates, user B
observes). The seed script must create a second member before any realtime spec can run.

### B2 — Dev-bypass user's workspace ≠ richest workspace

`Dev Bypass User` is a member only of `aurora-skincare-client-work` (8 content). `internal-sales`
has 3× the content but is unreachable via dev bypass. Seed should either add the dev user to
`internal-sales` or build a purpose-made fixture workspace. **Prefer the fixture** — asserting
against a workspace holding real client data makes tests order-dependent and destructive.

### B3 — Test infrastructure gaps (unchanged, restated)

- No Playwright / Cypress / Puppeteer.
- `vitest.config.ts`: `environment: "node"`, `include: ["src/**/*.test.ts"]` — **`.tsx` excluded**,
  so no component test can exist today.
- 3 integration tests, all gated behind `INTEGRATION_DB=1`.

---

## Revisions to the E2E plan

Phase 0 changes three things in the plan it was meant to validate:

1. **Assertion contract changes.** "HTTP 200" is not a pass condition (F1). Every route spec must
   assert on rendered content, and explicitly assert *absence* of the 404 body.
2. **Phase 1 grows a prerequisite.** Seeding is no longer "nice to have" — B1 and B2 make it a hard
   gate. A fixture workspace with ≥2 members must exist before Phase 2 or 3 can be written.
3. **Phase 3 gains a mandatory wait.** Per F3, every realtime spec awaits WS establishment before
   mutating. This goes in the shared fixture, not in individual specs, so it cannot be forgotten.

---

## Gate decision

Plan gate was: *stop if >20% of routes error.* Actual error rate is **2/30 = 6.7%**, and both
failures are routes already outside the navigation.

**Gate: PASS.** Proceed to Phase 1 (harness + seed), with B1/B2 folded in as prerequisites.

---

## Not covered by this audit

- Interactive flows (nothing was clicked beyond dev-bypass sign-in)
- Mutations — no run started, step assigned, or gate decided
- Realtime propagation between two users (requires B1)
- AI-dependent paths — no sprint launched, no provider called, no key liveness tested
- Route-level performance (first-hit numbers here are dev-mode compile time, not signal)
