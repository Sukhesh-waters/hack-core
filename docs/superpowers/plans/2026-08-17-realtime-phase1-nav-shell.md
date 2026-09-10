# Real-Time Phase 1 — Unified Nav Shell & Visible Real-Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the Calendar real-time gap, make working real-time visible everywhere (presence + a "live" indicator), and fix the notification bell to use the real channel instead of a disconnected poll — Phase 1 of the approved real-time collaboration roadmap.

**Architecture:** Extend the existing, proven `broadcastSignal` / `useWorkspaceRealtime` primitive (Supabase Realtime, one channel per workspace, signal-only payloads) rather than building new transport. Calendar gets a dedicated scope and joins the same write → broadcast → subscribe → poll-fallback chain every other surface already uses. Presence and the "live" indicator are additive, presentation-layer pieces built on that same primitive — pure formatting/mapping logic lives in `src/lib/*.ts` (unit-tested), thin client components wire it to the DOM (not unit-tested, matching this repo's existing convention for realtime-wiring components).

**Tech Stack:** Next.js 14 App Router, Supabase Realtime (broadcast + presence), Drizzle ORM, Tailwind + shadcn/ui, Vitest (`node` environment, no jsdom/React Testing Library configured — see Global Constraints).

**Spec:** `docs/superpowers/specs/2026-08-17-realtime-collab-roadmap-design.md` (Phase 1 section). Findings this plan closes: `docs/REALTIME-ARCHITECTURE-AUDIT-2026-08.md`.

## Global Constraints

- **workspace_id isolation on every query, no exceptions.** Every new/modified query in this plan is already scoped by an existing, audited call path — no new query is introduced that bypasses `requireMembership`.
- **`broadcastSignal` MUST be called after the write commits, never inside a transaction**, and never for a write that then rolls back (`src/lib/realtime.ts`'s own doc comment — unchanged rule, just extended to Calendar).
- **Never call `broadcastSignal` inside a per-row loop.** Calendar's bulk-edit path can touch up to 200 rows in one request (`BULK_MAX_IDS`) — broadcast once per user-facing action, not once per row, or a bulk edit adds up to 200 sequential awaited fetches to its own response time.
- **Styling: Tailwind/shadcn only.** No static inline styles. (No dynamic runtime value in this plan needs an exception.)
- **Testing approach (repo-verified, not assumed):** `vitest.config.ts` sets `environment: "node"` and `include: ["src/**/*.test.ts"]` — there is no jsdom, no `@testing-library/react`, and zero existing `.tsx` component test files anywhere in this codebase (confirmed: `production-live.tsx`, `approvals-live.tsx`, `notification-bell.tsx` all currently ship with no test file). This plan follows that established convention rather than inventing a new one: **pure logic goes in `src/lib/*.ts` with full `.test.ts` coverage; thin client-wiring `.tsx` components are not unit-tested** and are verified live instead (Task 8). Do not add `@testing-library/react` or jsdom as part of this plan — that would be an unrequested infrastructure change.
- **CI gates:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` must all be green. Not done until they are.
- **Out of scope for this plan:** personal chat/DM (Phase 2), visual/IA redesign (Phase 3), data-flow hardening on SOP/Cockpit (Phase 4). Do not touch those in this plan.

## Scope notes (deliberate deviations from the spec's exact wording)

The roadmap spec describes two Phase 1 items in terms this plan implements in a narrower, lower-risk form. Both are conscious tradeoffs, not oversights — flagged here so a reviewer isn't left guessing:

1. **"Promote `useWorkspaceRealtime` from page-scoped to shell-scoped"** (spec) is implemented as an **additive** shell-level presence subscription (Task 6), not a consolidation of the 5 existing page-level subscribers (Hub, SOP run board, Cockpit, Production, Approvals) onto shared context. Migrating all 5 working, already-tested-live surfaces onto a new context plumbing path in the same plan as the Calendar fix and the bell fix is a materially bigger blast radius for one slice, and Supabase presence state is keyed by `userId` — multiple channel subscriptions from the same browser tab tracking the same key don't inflate the online count (`Object.keys(presenceState())` still returns one entry per unique user), so the additive approach doesn't double-count. Consolidating into one shared subscription is a reasonable fast-follow, not required for correctness.
2. **The reusable "live" visual grammar** (Task 3/4) is wired into Calendar only — the surface this plan adds real-time to. Retrofitting `LivePulse` onto Production/SOP/Hub/Approvals (all already real-time, per the audit) is straightforward now that the component exists, but is separate, additive work against files this plan doesn't otherwise touch — left as a fast-follow rather than expanding this plan's diff into five more files.

---

## File Structure

**Create:**
- `src/lib/live-status.ts` — pure "is this recent / how long ago" logic for the live indicator
- `src/lib/live-status.test.ts`
- `src/lib/presence.ts` — pure mapping from raw online-ids to displayable members
- `src/lib/presence.test.ts`
- `src/components/live-pulse.tsx` — reusable live indicator (dot + "updated Xs ago")
- `src/app/(app)/w/[ws]/calendar/calendar-live.tsx` — Calendar's realtime subscriber (mirrors `production-live.tsx`)
- `src/app/(app)/w/[ws]/workspace-presence.tsx` — shell-level presence widget

**Modify:**
- `src/lib/realtime.ts` — add `"calendar"` to `RealtimeScope`
- `src/lib/realtime.test.ts` — cover the new scope
- `src/app/(app)/w/[ws]/calendar/actions.ts` — broadcast after the 3 mutation actions
- `src/app/(app)/w/[ws]/calendar/actions.test.ts` — cover the new broadcast behavior
- `src/app/(app)/w/[ws]/calendar/page.tsx` — mount `CalendarLive`
- `src/app/(app)/w/[ws]/layout.tsx` — fetch members, mount `WorkspacePresence`
- `src/components/notification-bell.tsx` — subscribe to the real channel alongside the existing poll

---

### Task 1: Add the `calendar` RealtimeScope

**Files:**
- Modify: `src/lib/realtime.ts:10-18`
- Test: `src/lib/realtime.test.ts`

**Interfaces:**
- Produces: `RealtimeScope` now includes `"calendar"` — every later task in this plan depends on this type existing.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/realtime.test.ts`, inside the existing `describe("broadcastSignal", ...)` block, after the `"accepts new D1 scopes"` test:

```ts
  it("accepts the calendar scope", async () => {
    stubEnv();
    const spy = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", spy);
    await broadcastSignal("ws1", "calendar");
    const body = JSON.parse(spy.mock.calls[0][1].body as string);
    expect(body.messages[0].payload).toEqual({ scope: "calendar" });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/realtime.test.ts`
Expected: FAIL — TypeScript error, `"calendar"` is not assignable to type `RealtimeScope`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/realtime.ts`, change:

```ts
export type RealtimeScope =
  | "messages"
  | "approvals"
  | "tasks"
  | "reminders"
  | "plan"
  | "sop"        // run step moved / unblocked / run completed / gate decided
  | "workflow"   // content transitioned, production board changed
  | "cockpit";   // metrics invalidated
```

to:

```ts
export type RealtimeScope =
  | "messages"
  | "approvals"
  | "tasks"
  | "reminders"
  | "plan"
  | "sop"        // run step moved / unblocked / run completed / gate decided
  | "workflow"   // content transitioned, production board changed
  | "cockpit"    // metrics invalidated
  | "calendar";  // plan-grid cell edited, slot scheduled, AI suggestion applied
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/realtime.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/realtime.ts src/lib/realtime.test.ts
git commit -m "feat: add calendar RealtimeScope"
```

---

### Task 2: Broadcast on calendar mutations

**Files:**
- Modify: `src/app/(app)/w/[ws]/calendar/actions.ts` (`updatePlanCellAction`, `bulkUpdatePlanCellsAction`, `addCalendarPostAction`)
- Test: `src/app/(app)/w/[ws]/calendar/actions.test.ts`

**Interfaces:**
- Consumes: `broadcastSignal(workspaceId: string, scope: RealtimeScope): Promise<void>` from `@/lib/realtime` (Task 1).
- Produces: after this task, a successful `updatePlanCellAction`, `bulkUpdatePlanCellsAction` (with ≥1 row updated), or `addCalendarPostAction` call fires exactly one `broadcastSignal(workspaceId, "calendar")`. `applyRevisionAction`/`restoreRevisionAction`/`discardRevisionAction` are explicitly NOT covered by this task — flagged as a fast-follow, not silently dropped, since they funnel through the same query functions but need their own broadcast-once-per-call review.

- [ ] **Step 1: Write the failing tests**

In `src/app/(app)/w/[ws]/calendar/actions.test.ts`, add to the top-level mocks (after the existing `vi.mock` calls, before the `await import` lines):

```ts
vi.mock("@/db/queries/schedule", () => ({
  updatePlanCellQuery: vi.fn(),
  setPlanSlot: vi.fn(),
  createScheduledPost: vi.fn(),
}));
vi.mock("@/lib/realtime", () => ({ broadcastSignal: vi.fn() }));
```

Change the `vi.mock("@/db/queries/clients", ...)` line to also export `getClientById`:

```ts
vi.mock("@/db/queries/clients", () => ({
  getContentById: vi.fn(),
  getClientById: vi.fn(),
}));
```

Add the new imports after the existing `const { addComment, listComments } = ...` line:

```ts
const { getClientById } = await import("@/db/queries/clients");
const { updatePlanCellQuery, createScheduledPost } = await import(
  "@/db/queries/schedule"
);
const { broadcastSignal } = await import("@/lib/realtime");
```

Change the existing action-import line from:

```ts
const { loadRowDetailAction, addPlanRowCommentAction } = await import(
  "./actions"
);
```

to:

```ts
const {
  loadRowDetailAction,
  addPlanRowCommentAction,
  updatePlanCellAction,
  bulkUpdatePlanCellsAction,
  addCalendarPostAction,
} = await import("./actions");
```

Add the new mock handles after the existing `const listCommentsMock = ...` line:

```ts
const getClientByIdMock = getClientById as unknown as Mock;
const updatePlanCellQueryMock = updatePlanCellQuery as unknown as Mock;
const createScheduledPostMock = createScheduledPost as unknown as Mock;
const broadcastSignalMock = broadcastSignal as unknown as Mock;
```

Change the shared `row` constant from:

```ts
const row = { id: "content_1", workspaceId: "ws_1", title: "Barrier repair basics" };
```

to (adding the fields `writePlanCell`'s schema check requires for every edit, not just type/duration edits):

```ts
const row = {
  id: "content_1",
  workspaceId: "ws_1",
  title: "Barrier repair basics",
  type: "post",
  durationSec: null,
};
```

Add to `beforeEach`, after the existing `addCommentMock.mockResolvedValue(...)` line:

```ts
  updatePlanCellQueryMock.mockResolvedValue([{ id: "content_1" }]);
  createScheduledPostMock.mockResolvedValue("content_2");
  getClientByIdMock.mockResolvedValue({ id: "client_1", name: "Aurora Skincare" });
```

Add these new `describe` blocks at the end of the file:

```ts
describe("updatePlanCellAction — broadcasts on success", () => {
  it("broadcasts the calendar scope after a successful edit", async () => {
    const result = await updatePlanCellAction({
      workspaceId: "ws_1",
      contentId: "content_1",
      field: "title",
      value: "New title",
    });
    expect(result).toEqual({ ok: true });
    expect(broadcastSignalMock).toHaveBeenCalledTimes(1);
    expect(broadcastSignalMock).toHaveBeenCalledWith("ws_1", "calendar");
  });

  it("does not broadcast when the edit fails validation", async () => {
    const result = await updatePlanCellAction({
      workspaceId: "ws_1",
      contentId: "content_1",
      field: "title",
      value: "",
    });
    expect(result.ok).toBe(false);
    expect(broadcastSignalMock).not.toHaveBeenCalled();
  });

  it("does not broadcast when the row is gone", async () => {
    getContentByIdMock.mockResolvedValue(null);
    const result = await updatePlanCellAction({
      workspaceId: "ws_1",
      contentId: "content_1",
      field: "title",
      value: "New title",
    });
    expect(result.ok).toBe(false);
    expect(broadcastSignalMock).not.toHaveBeenCalled();
  });
});

describe("bulkUpdatePlanCellsAction — broadcasts once, not per row", () => {
  it("broadcasts exactly once for a multi-row bulk edit", async () => {
    const result = await bulkUpdatePlanCellsAction({
      workspaceId: "ws_1",
      contentIds: ["content_1", "content_1", "content_1"],
      field: "title",
      value: "Bulk title",
    });
    expect(result.ok).toBe(true);
    expect(broadcastSignalMock).toHaveBeenCalledTimes(1);
    expect(broadcastSignalMock).toHaveBeenCalledWith("ws_1", "calendar");
  });

  it("does not broadcast when every row in the batch fails", async () => {
    getContentByIdMock.mockResolvedValue(null);
    const result = await bulkUpdatePlanCellsAction({
      workspaceId: "ws_1",
      contentIds: ["content_1"],
      field: "title",
      value: "Bulk title",
    });
    expect(result).toEqual({
      ok: true,
      updated: [],
      failed: [{ id: "content_1", error: "That row is no longer available." }],
    });
    expect(broadcastSignalMock).not.toHaveBeenCalled();
  });
});

describe("addCalendarPostAction — broadcasts on success", () => {
  function formData(overrides: Record<string, string> = {}) {
    const fd = new FormData();
    const base = {
      workspaceId: "ws_1",
      clientId: "client_1",
      title: "New post",
      type: "post",
      day: "2026-08-20",
      time: "10:00",
      ...overrides,
    };
    for (const [key, value] of Object.entries(base)) fd.set(key, value);
    return fd;
  }

  it("broadcasts after creating a scheduled post", async () => {
    const result = await addCalendarPostAction(undefined, formData());
    expect(result).toBeUndefined();
    expect(broadcastSignalMock).toHaveBeenCalledTimes(1);
    expect(broadcastSignalMock).toHaveBeenCalledWith("ws_1", "calendar");
  });

  it("does not broadcast when the client isn't in this workspace", async () => {
    getClientByIdMock.mockResolvedValue(null);
    const result = await addCalendarPostAction(undefined, formData());
    expect(result).toEqual({ error: "Client not found in this workspace." });
    expect(broadcastSignalMock).not.toHaveBeenCalled();
  });

  it("does not broadcast on an invalid day/time", async () => {
    const result = await addCalendarPostAction(
      undefined,
      formData({ day: "not-a-date" }),
    );
    expect(result).toEqual({ error: "Pick a valid day and time." });
    expect(broadcastSignalMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/\(app\)/w/\[ws\]/calendar/actions.test.ts`
Expected: FAIL — `broadcastSignalMock` never called (the action code doesn't call it yet).

- [ ] **Step 3: Write minimal implementation**

In `src/app/(app)/w/[ws]/calendar/actions.ts`, add the import (after the existing `import { actionErrorMessage } from "@/lib/action-errors";` line):

```ts
import { broadcastSignal } from "@/lib/realtime";
```

Change `updatePlanCellAction`'s tail from:

```ts
  if (!result.ok) return result;

  revalidatePath(`/w/${workspaceId}/calendar`);
  return { ok: true };
}
```

to:

```ts
  if (!result.ok) return result;

  await broadcastSignal(workspaceId, "calendar");
  revalidatePath(`/w/${workspaceId}/calendar`);
  return { ok: true };
}
```

Change `bulkUpdatePlanCellsAction`'s tail from:

```ts
    revalidatePath(`/w/${workspaceId}/calendar`);
    return { ok: true, updated, failed };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}
```

to:

```ts
    if (updated.length > 0) {
      await broadcastSignal(workspaceId, "calendar");
    }
    revalidatePath(`/w/${workspaceId}/calendar`);
    return { ok: true, updated, failed };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}
```

Change `addCalendarPostAction`'s try block from:

```ts
  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    const client = await getClientById(workspaceId, clientId);
    if (!client) return { error: "Client not found in this workspace." };
    await createScheduledPost({
      workspaceId,
      clientId,
      title,
      type,
      scheduledFor,
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
```

to:

```ts
  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    const client = await getClientById(workspaceId, clientId);
    if (!client) return { error: "Client not found in this workspace." };
    await createScheduledPost({
      workspaceId,
      clientId,
      title,
      type,
      scheduledFor,
    });
    await broadcastSignal(workspaceId, "calendar");
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/\(app\)/w/\[ws\]/calendar/actions.test.ts`
Expected: PASS, all tests in the file green, including the pre-existing `loadRowDetailAction`/`addPlanRowCommentAction` tests (unaffected by this change).

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/w/\[ws\]/calendar/actions.ts src/app/\(app\)/w/\[ws\]/calendar/actions.test.ts
git commit -m "feat: broadcast calendar scope on plan-cell, bulk-edit, and quick-add mutations"
```

---

### Task 3: Pure "live" status logic

**Files:**
- Create: `src/lib/live-status.ts`
- Test: `src/lib/live-status.test.ts`

**Interfaces:**
- Produces: `isRecentlyUpdated(lastSignalAtMs: number | null, nowMs: number): boolean` and `formatUpdatedAgo(lastSignalAtMs: number | null, nowMs: number): string` — Task 4's `LivePulse` component consumes both by exact name.

- [ ] **Step 1: Write the failing test**

Create `src/lib/live-status.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatUpdatedAgo, isRecentlyUpdated } from "./live-status";

describe("isRecentlyUpdated", () => {
  it("is false when nothing has signaled yet", () => {
    expect(isRecentlyUpdated(null, 10_000)).toBe(false);
  });

  it("is true just after a signal", () => {
    expect(isRecentlyUpdated(10_000, 10_500)).toBe(true);
  });

  it("is false once the recent window has passed", () => {
    expect(isRecentlyUpdated(10_000, 15_000)).toBe(false);
  });
});

describe("formatUpdatedAgo", () => {
  it("returns empty when nothing has signaled yet", () => {
    expect(formatUpdatedAgo(null, 10_000)).toBe("");
  });

  it("reads as just now inside the first 5 seconds", () => {
    expect(formatUpdatedAgo(10_000, 13_000)).toBe("updated just now");
  });

  it("counts seconds between 5s and 60s", () => {
    expect(formatUpdatedAgo(0, 42_000)).toBe("updated 42s ago");
  });

  it("counts minutes between 60s and an hour", () => {
    expect(formatUpdatedAgo(0, 5 * 60_000)).toBe("updated 5m ago");
  });

  it("counts hours past an hour", () => {
    expect(formatUpdatedAgo(0, 3 * 60 * 60_000)).toBe("updated 3h ago");
  });

  it("never reports negative time for a clock that hasn't advanced", () => {
    expect(formatUpdatedAgo(10_000, 10_000)).toBe("updated just now");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/live-status.test.ts`
Expected: FAIL — `src/lib/live-status.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/live-status.ts`:

```ts
/**
 * Pure formatting/threshold logic for the "live" visual grammar the
 * 2026-08-17 audit found missing everywhere real-time actually works.
 * Time is passed in explicitly, never read from Date.now() here, so
 * callers (and tests) control the clock.
 */

const RECENT_MS = 4_000;
const JUST_NOW_MS = 5_000;

export function isRecentlyUpdated(
  lastSignalAtMs: number | null,
  nowMs: number,
): boolean {
  if (lastSignalAtMs === null) return false;
  return nowMs - lastSignalAtMs < RECENT_MS;
}

export function formatUpdatedAgo(
  lastSignalAtMs: number | null,
  nowMs: number,
): string {
  if (lastSignalAtMs === null) return "";
  const deltaMs = Math.max(0, nowMs - lastSignalAtMs);
  if (deltaMs < JUST_NOW_MS) return "updated just now";
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return `updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `updated ${hours}h ago`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/live-status.test.ts`
Expected: PASS, all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/live-status.ts src/lib/live-status.test.ts
git commit -m "feat: add pure live-status formatting logic"
```

---

### Task 4: `LivePulse` component + `CalendarLive` subscriber, wired into the Calendar page

**Files:**
- Create: `src/components/live-pulse.tsx`
- Create: `src/app/(app)/w/[ws]/calendar/calendar-live.tsx`
- Modify: `src/app/(app)/w/[ws]/calendar/page.tsx`

**Interfaces:**
- Consumes: `isRecentlyUpdated`, `formatUpdatedAgo` from `@/lib/live-status` (Task 3); `useWorkspaceRealtime` from `../use-workspace-realtime` (existing); `cn` from `@/lib/utils` (existing, already used in `notification-bell.tsx`).
- Produces: `LivePulse({ lastSignalAt: number | null })` — a renderable component any future real-time surface can drop in. `CalendarLive({ workspaceId: string })` — renders `LivePulse` and closes the Calendar real-time gap (subscribes to the `"calendar"` scope from Task 1/2, same 30s poll fallback every other surface has).

No dedicated test file for this task's two `.tsx` files — see Global Constraints' testing-approach note. `live-status.ts`'s logic (Task 3) already has full coverage; these files are thin wiring around it, matching `production-live.tsx`'s existing (untested) shape.

- [ ] **Step 1: Create the LivePulse component**

Create `src/components/live-pulse.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { formatUpdatedAgo, isRecentlyUpdated } from "@/lib/live-status";

/**
 * The "live" visual grammar the 2026-08-17 audit found missing everywhere:
 * even on surfaces where the broadcast pipeline is fully correct, nothing
 * on screen told a user it was live rather than a stale page load. Drop
 * this next to any header on a real-time surface.
 */
export function LivePulse({ lastSignalAt }: { lastSignalAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const recent = isRecentlyUpdated(lastSignalAt, now);
  const label = formatUpdatedAgo(lastSignalAt, now);

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/70">
      <span className="relative flex size-1.5" aria-hidden>
        {recent ? (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-teal opacity-75" />
        ) : null}
        <span
          className={cn(
            "relative inline-flex size-1.5 rounded-full",
            recent ? "bg-brand-teal" : "bg-muted-foreground/40",
          )}
        />
      </span>
      {label || "live"}
    </span>
  );
}
```

- [ ] **Step 2: Create the CalendarLive subscriber**

Create `src/app/(app)/w/[ws]/calendar/calendar-live.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspaceRealtime } from "../use-workspace-realtime";
import { LivePulse } from "@/components/live-pulse";

const POLL_MS = 30_000;

export function CalendarLive({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [lastSignalAt, setLastSignalAt] = useState<number | null>(null);

  useWorkspaceRealtime({
    workspaceId,
    scopes: ["calendar"],
    onSignal: () => {
      setLastSignalAt(Date.now());
      router.refresh();
    },
  });

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [router]);

  return <LivePulse lastSignalAt={lastSignalAt} />;
}
```

- [ ] **Step 3: Wire CalendarLive into the Calendar page**

In `src/app/(app)/w/[ws]/calendar/page.tsx`, add the import (after the existing `import { ViewControls } from "./view-controls";` line):

```ts
import { CalendarLive } from "./calendar-live";
```

Change the header block from:

```tsx
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl">Calendar</h1>
        <div className="flex items-center gap-3 text-sm">
```

to:

```tsx
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-3xl">Calendar</h1>
          <CalendarLive workspaceId={params.ws} />
        </div>
        <div className="flex items-center gap-3 text-sm">
```

- [ ] **Step 4: Verify the build is clean**

Run: `npx tsc --noEmit` and `npx next lint`
Expected: no new errors from these three files.

- [ ] **Step 5: Commit**

```bash
git add src/components/live-pulse.tsx src/app/\(app\)/w/\[ws\]/calendar/calendar-live.tsx src/app/\(app\)/w/\[ws\]/calendar/page.tsx
git commit -m "feat: add LivePulse indicator and wire CalendarLive into the Calendar page"
```

---

### Task 5: Pure presence-resolution logic

**Files:**
- Create: `src/lib/presence.ts`
- Test: `src/lib/presence.test.ts`

**Interfaces:**
- Produces: `WorkspaceMemberOption` (`{ userId: string; name: string | null; email: string }` — matches `workspaceMembersQuery`'s existing return row shape verbatim, `src/db/queries/memberships.ts:138-144`), `OnlineMember` (`{ id: string; label: string }`), and `resolveOnlineMembers(onlineIds: Set<string>, members: WorkspaceMemberOption[]): OnlineMember[]`. Task 6's `WorkspacePresence` component consumes all three by exact name.

- [ ] **Step 1: Write the failing test**

Create `src/lib/presence.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveOnlineMembers } from "./presence";

const members = [
  { userId: "u1", name: "Ada Lovelace", email: "ada@example.com" },
  { userId: "u2", name: null, email: "b@example.com" },
  { userId: "u3", name: "Charlie", email: "c@example.com" },
];

describe("resolveOnlineMembers", () => {
  it("returns an empty list when no one is online", () => {
    expect(resolveOnlineMembers(new Set(), members)).toEqual([]);
  });

  it("resolves online ids to display labels, preferring name over email", () => {
    const result = resolveOnlineMembers(new Set(["u1", "u2"]), members);
    expect(result).toEqual([
      { id: "u1", label: "Ada Lovelace" },
      { id: "u2", label: "b@example.com" },
    ]);
  });

  it("drops a stale presence id with no matching member", () => {
    const result = resolveOnlineMembers(new Set(["u1", "ghost"]), members);
    expect(result).toEqual([{ id: "u1", label: "Ada Lovelace" }]);
  });

  it("sorts by label for a stable render order", () => {
    const result = resolveOnlineMembers(new Set(["u3", "u1"]), members);
    expect(result).toEqual([
      { id: "u1", label: "Ada Lovelace" },
      { id: "u3", label: "Charlie" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/presence.test.ts`
Expected: FAIL — `src/lib/presence.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/presence.ts`:

```ts
export type WorkspaceMemberOption = {
  userId: string;
  name: string | null;
  email: string;
};

export type OnlineMember = {
  id: string;
  label: string;
};

/**
 * Pure mapping from the realtime hook's raw online-id set to something a
 * shell-level widget can render — resolves each id to a display name (or
 * email if unnamed), drops ids with no matching member (a stale presence
 * entry for someone who left the workspace), and sorts for a stable render
 * order across ticks instead of flickering with Set iteration order.
 */
export function resolveOnlineMembers(
  onlineIds: Set<string>,
  members: WorkspaceMemberOption[],
): OnlineMember[] {
  const byId = new Map(members.map((m) => [m.userId, m]));
  const resolved: OnlineMember[] = [];
  for (const id of onlineIds) {
    const member = byId.get(id);
    if (!member) continue;
    resolved.push({ id, label: member.name ?? member.email });
  }
  return resolved.sort((a, b) => a.label.localeCompare(b.label));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/presence.test.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/presence.ts src/lib/presence.test.ts
git commit -m "feat: add pure presence-resolution logic"
```

---

### Task 6: Shell-level `WorkspacePresence` widget, wired into the workspace layout

**Files:**
- Create: `src/app/(app)/w/[ws]/workspace-presence.tsx`
- Modify: `src/app/(app)/w/[ws]/layout.tsx`

**Interfaces:**
- Consumes: `useWorkspaceRealtime` from `./use-workspace-realtime` (existing); `resolveOnlineMembers`, `WorkspaceMemberOption` from `@/lib/presence` (Task 5); `listWorkspaceMembers` from `@/db/queries/memberships` (existing, already used by `calendar/page.tsx`).
- Produces: `WorkspacePresence({ workspaceId: string; userId: string; members: WorkspaceMemberOption[] })` — renders on all 25 workspace sections via the shared layout, addressing UC-OPS-25.

No dedicated test file — thin wiring, same rationale as Task 4 (`resolveOnlineMembers`, the actual logic, is fully covered by Task 5).

- [ ] **Step 1: Create the WorkspacePresence component**

Create `src/app/(app)/w/[ws]/workspace-presence.tsx`:

```tsx
"use client";

import { useWorkspaceRealtime } from "./use-workspace-realtime";
import { resolveOnlineMembers, type WorkspaceMemberOption } from "@/lib/presence";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

/**
 * Shell-level presence — previously only visible inside Hub's own canvas
 * (UC-OPS-21). Mounted once in the workspace layout so "who's online" is
 * visible on all 25 sections, not just one (2026-08-17 audit finding).
 * Positioned bottom-20 LEFT deliberately — NotificationBell and
 * AskInstamediaLazy both stack on the right (see notification-bell.tsx's
 * own comment on that collision), this avoids it entirely.
 */
export function WorkspacePresence({
  workspaceId,
  userId,
  members,
}: {
  workspaceId: string;
  userId: string;
  members: WorkspaceMemberOption[];
}) {
  const { onlineIds } = useWorkspaceRealtime({
    workspaceId,
    userId,
    onSignal: () => {},
  });
  const online = resolveOnlineMembers(onlineIds, members);
  if (online.length === 0) return null;

  return (
    <div className="fixed bottom-20 left-6 z-40 flex items-center gap-2 rounded-full border border-border bg-popover/90 px-3 py-1.5 shadow-lg backdrop-blur">
      <div className="flex -space-x-2">
        {online.slice(0, 5).map((m) => (
          <Avatar key={m.id} className="size-6 border border-popover">
            <AvatarFallback className="bg-brand-teal/30 text-[10px] text-foreground">
              {m.label.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        ))}
      </div>
      <span className="text-xs text-muted-foreground">
        {online.length} online
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the workspace layout**

In `src/app/(app)/w/[ws]/layout.tsx`, change:

```tsx
import { notFound } from "next/navigation";
import { requireUser } from "@/auth";
import { AskInstamediaLazy } from "@/components/ask-instamedia-lazy";
import { NotificationBell } from "@/components/notification-bell";
import { requireMembership } from "@/db/queries/memberships";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { ws: string };
}) {
  const user = await requireUser();
  try {
    await requireMembership(params.ws, user.id);
  } catch {
    notFound();
  }
  return (
    <>
      {children}
      <NotificationBell workspaceId={params.ws} />
      <AskInstamediaLazy workspaceId={params.ws} />
    </>
  );
}
```

to:

```tsx
import { notFound } from "next/navigation";
import { requireUser } from "@/auth";
import { AskInstamediaLazy } from "@/components/ask-instamedia-lazy";
import { NotificationBell } from "@/components/notification-bell";
import {
  listWorkspaceMembers,
  requireMembership,
} from "@/db/queries/memberships";
import { WorkspacePresence } from "./workspace-presence";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { ws: string };
}) {
  const user = await requireUser();
  try {
    await requireMembership(params.ws, user.id);
  } catch {
    notFound();
  }
  const members = await listWorkspaceMembers(params.ws);
  return (
    <>
      {children}
      <NotificationBell workspaceId={params.ws} />
      <WorkspacePresence
        workspaceId={params.ws}
        userId={user.id}
        members={members}
      />
      <AskInstamediaLazy workspaceId={params.ws} />
    </>
  );
}
```

- [ ] **Step 3: Verify the build is clean**

Run: `npx tsc --noEmit` and `npx next lint`
Expected: no new errors from these two files.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/w/\[ws\]/workspace-presence.tsx src/app/\(app\)/w/\[ws\]/layout.tsx
git commit -m "feat: add shell-level workspace presence indicator"
```

---

### Task 7: Fix the notification bell to use the real channel

**Files:**
- Modify: `src/components/notification-bell.tsx`

**Interfaces:**
- Consumes: `useWorkspaceRealtime` from `@/app/(app)/w/[ws]/use-workspace-realtime` (existing hook, new import location for this file since `notification-bell.tsx` lives outside the `w/[ws]/` tree).

No test file — this file has never had one (confirmed: `find src -iname "notification-bell.test*"` returns nothing today), and the change is pure wiring with no new pure logic to extract.

- [ ] **Step 1: Add the realtime subscription**

In `src/components/notification-bell.tsx`, change the doc comment above `POLL_MS` from:

```tsx
/**
 * Polling, not websockets — deliberately. The Hub already established a
 * poll-based degradation ladder, and a second realtime transport would be
 * a new failure mode for a bell that shows at most 20 rows.
 */
const POLL_MS = 60_000;
```

to:

```tsx
/**
 * Subscribes to the same workspace Realtime channel every live surface
 * uses, so notifications land sub-second instead of up to 60s stale
 * (2026-08-17 audit: this bell ran a second, disconnected poll-only
 * system while every other surface used the real channel). The 60s poll
 * stays as the degradation-ladder fallback for a missed broadcast — never
 * removed, just no longer the primary path.
 */
const POLL_MS = 60_000;
```

Add the import (after the existing `import { cn } from "@/lib/utils";` line):

```tsx
import { useWorkspaceRealtime } from "@/app/(app)/w/[ws]/use-workspace-realtime";
```

Add the subscription inside the component, after the existing `refresh` definition and before the existing polling `useEffect`:

```tsx
  useWorkspaceRealtime({
    workspaceId,
    onSignal: () => void refresh(),
  });

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);
```

(Only the `useWorkspaceRealtime` block above is new — the `useEffect` immediately after it is the existing code, unchanged, shown here for placement context.)

- [ ] **Step 2: Verify the build is clean**

Run: `npx tsc --noEmit` and `npx next lint`
Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/components/notification-bell.tsx
git commit -m "fix: wire notification bell onto the real Realtime channel"
```

---

### Task 8: Full gate verification and live confirmation

**Files:** none (verification only)

- [ ] **Step 1: Run the full CI gate suite**

```bash
npx tsc --noEmit
npx next lint
npm test
npm run build
```

Expected: all four green. If any fails, fix before proceeding — do not report this plan complete with a red gate.

- [ ] **Step 2: Live-verify the Calendar fix, using the same methodology as the 2026-08-04 QA report**

A naive tab-switch or DOM-attribute check gives false readings (the original QA report found this the hard way — activating a tab can itself trigger a refetch, and React preserves manually-added DOM attributes across `router.refresh()`). Use two backgrounded tabs and read timestamps after the fact, not during:

```bash
B="$HOME/.claude/skills/gstack/browse/dist/browse"
# Ensure the dev server is running: npm run dev (background), then:
$B goto http://localhost:3000/login
$B click @e5   # dev bypass — re-snapshot first if the ref is stale
$B newtab http://localhost:3000/w/<workspace-id>/calendar?view=grid
# tab 1: instrument the observer, then background it
$B tab 1
$B goto http://localhost:3000/w/<workspace-id>/calendar?view=grid
# tab 2 (active): edit a plan-grid cell (e.g. change a row's title)
$B tab 2
# ... interact with the grid to trigger updatePlanCellAction ...
# back to tab 1: confirm it refreshed within ~1s and the LivePulse text
# reads "updated just now" rather than requiring the 30s poll window
$B tab 1
$B text
```

Expected: the second (backgrounded) tab reflects the edit well under the 30s poll window, and the Calendar header shows the `LivePulse` indicator with a recent timestamp — closing the audit's Critical Calendar finding.

- [ ] **Step 3: Live-verify shell-level presence**

```bash
$B goto http://localhost:3000/w/<workspace-id>/kb
$B text
```

Expected: the presence widget (bottom-left) is visible on a non-Hub page — confirms UC-OPS-25 without needing a second real user (dev-bypass is a single fixed identity; "1 online" is the expected floor in this environment, matching Hub's existing baseline behavior).

- [ ] **Step 4: Live-verify the notification bell still works**

```bash
$B goto http://localhost:3000/w/<workspace-id>/overview
$B snapshot -i
```

Expected: no console errors from the new `useWorkspaceRealtime` call in `notification-bell.tsx`; the bell renders and opens as before.

- [ ] **Step 5: Update the audit doc's status**

In `docs/REALTIME-ARCHITECTURE-AUDIT-2026-08.md`, add a short dated note under the Calendar and navigation-shell findings marking them closed by this plan, with the commit range. This keeps the audit doc accurate rather than describing a gap that no longer exists — the same discipline `usecase-catalogue.md` §18 requires ("when a slice ships, change its status here in the same diff").

- [ ] **Step 6: Commit the doc update**

```bash
git add docs/REALTIME-ARCHITECTURE-AUDIT-2026-08.md
git commit -m "docs: mark Phase 1 real-time findings closed"
```
