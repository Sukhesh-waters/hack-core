# Phase B · Slice 1 — Team Hub Live (Supabase Realtime) + Overview Live

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Team Hub and Overview demo providers with real database-backed logic and true real-time delivery over Supabase Realtime.

**Architecture:** Four new workspace-scoped tables back the hub. Server Actions (zod + requireUser + requireMembership) perform all writes, then fire a **signal-only** broadcast (`{scope}` — no tenant content) to channel `ws:{workspaceId}:hub`. Clients subscribe via `@supabase/supabase-js`, and on any signal refetch the full hub state through an authenticated server action; a 30s fallback poll covers Realtime outages (degradation ladder). Presence tracks user ids only. The hub's Plan quick-view reads/writes the existing `ideas` table. Overview aggregates real `schedule`/`content`/`ideas`/hub rows.

**Tech Stack:** Drizzle + Postgres (Supabase), Supabase Realtime (broadcast + presence), Next.js Server Actions, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-08-final-shell-ui-first-design.md` (Phase B, first wiring wave)

## Global Constraints

- workspace_id on every new table; every list/update query filters by it. New tables join `workspaceScopedTables` (schema.test.ts enforces).
- Realtime payloads NEVER carry tenant content — signal-only `{ scope }`. Content moves exclusively through authenticated server actions.
- Broadcast failures must not fail the action (degradation ladder) — fire-and-forget with 2s timeout; 30s client poll fallback.
- Zod-validate every action input; `requireUser()` + `requireMembership()` before any DB touch; errors via `actionErrorMessage`.
- UI layout unchanged (Phase A contract): providers swap under the same `TeamHubData` / `OverviewData` types. Allowed UI deltas this slice: add-reminder input, remove DemoBadge, wire handlers.
- Done = `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` all pass + migration applied.

---

### Task 1: Schema — hub tables, enums, isolation registry, migration

**Files:**
- Modify: `src/db/schema.ts` (append after `comments` table; extend `workspaceScopedTables`)

**Interfaces:**
- Produces: `hubMessages`, `hubApprovals`, `hubTasks`, `hubReminders` tables; enums `hubMessageKind`, `hubApprovalStatus`, `hubPriority`. Consumed by Task 2 queries.

- [ ] **Step 1: Append schema (before the `workspaceScopedTables` export)**

```ts
// ---------------------------------------------------------------------------
// Team Hub (Phase B). Workspace channel: chat, ad-hoc sign-offs, shared
// tasks and reminders. Realtime is signal-only broadcast; these rows are
// the source of truth. hub_approvals.content_id stays null until the
// Plan/Production slices link sign-offs to content items.
// ---------------------------------------------------------------------------

export const hubMessageKind = pgEnum("hub_message_kind", [
  "system",
  "text",
  "approval",
]);
export const hubApprovalStatus = pgEnum("hub_approval_status", [
  "pending",
  "approved",
  "rejected",
]);
export const hubPriority = pgEnum("hub_priority", ["high", "medium", "low"]);

export const hubApprovals = pgTable(
  "hub_approvals",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    requestedById: text("requested_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: hubApprovalStatus("status").notNull().default("pending"),
    decidedById: text("decided_by_id").references(() => users.id),
    decidedAt: timestamp("decided_at", { mode: "date" }),
    contentId: text("content_id").references(() => content.id),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("hub_approvals_workspace_id_idx").on(table.workspaceId),
  }),
);

export const hubMessages = pgTable(
  "hub_messages",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: hubMessageKind("kind").notNull().default("text"),
    authorId: text("author_id").references(() => users.id, {
      onDelete: "cascade",
    }), // null for system lines
    body: text("body"), // text/system messages
    approvalId: text("approval_id").references(() => hubApprovals.id, {
      onDelete: "cascade",
    }), // approval cards
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("hub_messages_workspace_id_idx").on(table.workspaceId),
    createdIdx: index("hub_messages_created_at_idx").on(table.createdAt),
  }),
);

export const hubTasks = pgTable(
  "hub_tasks",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    done: boolean("done").notNull().default(false),
    priority: hubPriority("priority").notNull().default("medium"),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("hub_tasks_workspace_id_idx").on(table.workspaceId),
  }),
);

export const hubReminders = pgTable(
  "hub_reminders",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    dueAt: timestamp("due_at", { mode: "date" }).notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("hub_reminders_workspace_id_idx").on(table.workspaceId),
    dueIdx: index("hub_reminders_due_at_idx").on(table.dueAt),
  }),
);
```

Check `boolean` is already imported from `drizzle-orm/pg-core` at the top of
schema.ts — add it to the import list if missing.

- [ ] **Step 2: Register in `workspaceScopedTables`**

Add to the object (after `comments`):

```ts
  hubMessages,
  hubApprovals,
  hubTasks,
  hubReminders,
```

- [ ] **Step 3: Run schema isolation test**

Run: `npx vitest run src/db/schema.test.ts`
Expected: PASS (registry test now covers the 4 new tables)

- [ ] **Step 4: Generate + apply migration**

Run: `npm run db:generate` → new file in `drizzle/`
Run: `npm run db:migrate`
Expected: migration applies cleanly against DATABASE_URL

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts drizzle
git commit -m "feat: hub tables — messages, approvals, tasks, reminders (workspace-scoped)"
```

---

### Task 2: Hub queries with isolation tests

**Files:**
- Create: `src/db/queries/hub.ts`
- Create: `src/db/queries/hub.test.ts`

**Interfaces:**
- Consumes: Task 1 tables.
- Produces (used by Tasks 4/6):
  - `hubMessagesQuery/hubApprovalsQuery/hubTasksQuery/hubRemindersQuery/workspaceMembersQuery(workspaceId)` — query builders (exported for toSQL tests)
  - `getHubState(workspaceId)` → `{ messages, approvals, tasks, reminders, members }`
  - `addHubTextMessage({workspaceId, authorId, body})`
  - `addHubSystemMessage({workspaceId, body})`
  - `createHubApproval({workspaceId, requestedById, title})` → `approvalId`
  - `decideHubApproval({workspaceId, approvalId, deciderId, status})`
  - `addHubTask({workspaceId, createdById, title})`
  - `setHubTaskDone({workspaceId, taskId, done})`
  - `setHubTaskPriority({workspaceId, taskId, priority})`
  - `addHubReminder({workspaceId, ownerId, title, dueAt})`
  - `ideasQuickViewQuery(workspaceId)` + `setIdeaStatus({workspaceId, ideaId, status})`

- [ ] **Step 1: Write the failing test**

```ts
// src/db/queries/hub.test.ts
import { describe, expect, it } from "vitest";
import {
  hubApprovalsQuery,
  hubMessagesQuery,
  hubRemindersQuery,
  hubTasksQuery,
  ideasQuickViewQuery,
  workspaceMembersQuery,
} from "./hub";

const WS = "ws_isolation_test";

describe("hub queries (workspace isolation)", () => {
  const builders = {
    hubMessagesQuery,
    hubApprovalsQuery,
    hubTasksQuery,
    hubRemindersQuery,
    workspaceMembersQuery,
    ideasQuickViewQuery,
  };

  for (const [name, build] of Object.entries(builders)) {
    it(`${name} is scoped to workspace_id`, () => {
      const { sql, params } = build(WS).toSQL();
      expect(sql).toContain('"workspace_id" =');
      expect(params).toContain(WS);
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/queries/hub.test.ts`
Expected: FAIL — `Cannot find module './hub'`

- [ ] **Step 3: Implement queries**

```ts
// src/db/queries/hub.ts
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  hubApprovals,
  hubMessages,
  hubReminders,
  hubTasks,
  ideas,
  memberships,
  users,
} from "@/db/schema";

// ---- list builders (exported for isolation tests) ----

export function hubMessagesQuery(workspaceId: string) {
  return db
    .select({
      id: hubMessages.id,
      kind: hubMessages.kind,
      body: hubMessages.body,
      approvalId: hubMessages.approvalId,
      createdAt: hubMessages.createdAt,
      authorId: hubMessages.authorId,
      authorName: users.name,
      authorEmail: users.email,
    })
    .from(hubMessages)
    .leftJoin(users, eq(users.id, hubMessages.authorId))
    .where(eq(hubMessages.workspaceId, workspaceId))
    .orderBy(asc(hubMessages.createdAt))
    .limit(200);
}

export function hubApprovalsQuery(workspaceId: string) {
  return db
    .select({
      id: hubApprovals.id,
      title: hubApprovals.title,
      status: hubApprovals.status,
      createdAt: hubApprovals.createdAt,
      requestedByName: users.name,
      requestedByEmail: users.email,
      decidedById: hubApprovals.decidedById,
    })
    .from(hubApprovals)
    .leftJoin(users, eq(users.id, hubApprovals.requestedById))
    .where(eq(hubApprovals.workspaceId, workspaceId))
    .orderBy(desc(hubApprovals.createdAt))
    .limit(25);
}

export function hubTasksQuery(workspaceId: string) {
  return db
    .select()
    .from(hubTasks)
    .where(eq(hubTasks.workspaceId, workspaceId))
    .orderBy(asc(hubTasks.createdAt))
    .limit(100);
}

export function hubRemindersQuery(workspaceId: string) {
  return db
    .select({
      id: hubReminders.id,
      title: hubReminders.title,
      dueAt: hubReminders.dueAt,
      ownerName: users.name,
      ownerEmail: users.email,
    })
    .from(hubReminders)
    .leftJoin(users, eq(users.id, hubReminders.ownerId))
    .where(eq(hubReminders.workspaceId, workspaceId))
    .orderBy(asc(hubReminders.dueAt))
    .limit(50);
}

export function workspaceMembersQuery(workspaceId: string) {
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.workspaceId, workspaceId));
}

/** Hub Plan quick-view rows — live ideas, newest first. */
export function ideasQuickViewQuery(workspaceId: string) {
  return db
    .select({
      id: ideas.id,
      topic: ideas.topic,
      format: ideas.format,
      status: ideas.status,
    })
    .from(ideas)
    .where(eq(ideas.workspaceId, workspaceId))
    .orderBy(desc(ideas.createdAt))
    .limit(3);
}

export async function getHubState(workspaceId: string) {
  const [messages, approvals, tasks, reminders, members] = await Promise.all([
    hubMessagesQuery(workspaceId),
    hubApprovalsQuery(workspaceId),
    hubTasksQuery(workspaceId),
    hubRemindersQuery(workspaceId),
    workspaceMembersQuery(workspaceId),
  ]);
  return { messages, approvals, tasks, reminders, members };
}

// ---- writes (every one workspace-scoped) ----

export async function addHubTextMessage(input: {
  workspaceId: string;
  authorId: string;
  body: string;
}) {
  await db.insert(hubMessages).values({ ...input, kind: "text" });
}

export async function addHubSystemMessage(input: {
  workspaceId: string;
  body: string;
}) {
  await db.insert(hubMessages).values({ ...input, kind: "system" });
}

export async function createHubApproval(input: {
  workspaceId: string;
  requestedById: string;
  title: string;
}): Promise<string> {
  const [row] = await db
    .insert(hubApprovals)
    .values(input)
    .returning({ id: hubApprovals.id });
  await db.insert(hubMessages).values({
    workspaceId: input.workspaceId,
    kind: "approval",
    authorId: input.requestedById,
    approvalId: row.id,
  });
  return row.id;
}

export async function decideHubApproval(input: {
  workspaceId: string;
  approvalId: string;
  deciderId: string;
  status: "approved" | "rejected";
}) {
  await db
    .update(hubApprovals)
    .set({
      status: input.status,
      decidedById: input.deciderId,
      decidedAt: new Date(),
    })
    .where(
      and(
        eq(hubApprovals.workspaceId, input.workspaceId),
        eq(hubApprovals.id, input.approvalId),
        eq(hubApprovals.status, "pending"),
      ),
    );
}

export async function addHubTask(input: {
  workspaceId: string;
  createdById: string;
  title: string;
}) {
  await db.insert(hubTasks).values(input);
}

export async function setHubTaskDone(input: {
  workspaceId: string;
  taskId: string;
  done: boolean;
}) {
  await db
    .update(hubTasks)
    .set({ done: input.done })
    .where(
      and(
        eq(hubTasks.workspaceId, input.workspaceId),
        eq(hubTasks.id, input.taskId),
      ),
    );
}

export async function setHubTaskPriority(input: {
  workspaceId: string;
  taskId: string;
  priority: "high" | "medium" | "low";
}) {
  await db
    .update(hubTasks)
    .set({ priority: input.priority })
    .where(
      and(
        eq(hubTasks.workspaceId, input.workspaceId),
        eq(hubTasks.id, input.taskId),
      ),
    );
}

export async function addHubReminder(input: {
  workspaceId: string;
  ownerId: string;
  title: string;
  dueAt: Date;
}) {
  await db.insert(hubReminders).values(input);
}

export async function setIdeaStatus(input: {
  workspaceId: string;
  ideaId: string;
  status: "drafted" | "archived";
}) {
  await db
    .update(ideas)
    .set({ status: input.status })
    .where(
      and(
        eq(ideas.workspaceId, input.workspaceId),
        eq(ideas.id, input.ideaId),
      ),
    );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/db/queries/hub.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/db/queries/hub.ts src/db/queries/hub.test.ts
git commit -m "feat: hub queries — state reads + writes, all workspace-scoped"
```

---

### Task 3: Realtime signal lib + time formatting

**Files:**
- Create: `src/lib/realtime.ts`
- Create: `src/lib/realtime.test.ts`
- Create: `src/lib/data/format.ts`
- Create: `src/lib/data/format.test.ts`

**Interfaces:**
- Produces: `hubChannelName(workspaceId)`, `HubScope`, `broadcastHubSignal(workspaceId, scope)` (server, never throws); `formatHubTime(date, now?)`, `formatDue(date, now?)`. Used by Tasks 4/6/7.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/realtime.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { broadcastHubSignal, hubChannelName } from "./realtime";

describe("hubChannelName", () => {
  it("builds the per-workspace topic", () => {
    expect(hubChannelName("abc123")).toBe("ws:abc123:hub");
  });
});

describe("broadcastHubSignal", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("never throws when the fetch fails (degradation ladder)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    await expect(
      broadcastHubSignal("abc123", "messages"),
    ).resolves.toBeUndefined();
  });

  it("posts a signal-only payload — no tenant content fields", async () => {
    const spy = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", spy);
    await broadcastHubSignal("abc123", "tasks");
    const body = JSON.parse(spy.mock.calls[0][1].body as string);
    expect(body.messages[0].topic).toBe("ws:abc123:hub");
    expect(body.messages[0].payload).toEqual({ scope: "tasks" });
  });
});
```

```ts
// src/lib/data/format.test.ts
import { describe, expect, it } from "vitest";
import { formatDue, formatHubTime } from "./format";

const NOW = new Date("2026-07-08T12:00:00");

describe("formatHubTime", () => {
  it("returns 'just now' under a minute", () => {
    expect(formatHubTime(new Date("2026-07-08T11:59:30"), NOW)).toBe(
      "just now",
    );
  });
  it("returns HH:MM same day", () => {
    expect(formatHubTime(new Date("2026-07-08T09:16:00"), NOW)).toBe("09:16");
  });
  it("returns month + day otherwise", () => {
    expect(formatHubTime(new Date("2026-07-01T09:00:00"), NOW)).toBe("Jul 1");
  });
});

describe("formatDue", () => {
  it("labels today and tomorrow", () => {
    expect(formatDue(new Date("2026-07-08T15:00:00"), NOW)).toBe(
      "Today 15:00",
    );
    expect(formatDue(new Date("2026-07-09T10:00:00"), NOW)).toBe(
      "Tomorrow 10:00",
    );
  });
  it("falls back to weekday + time", () => {
    expect(formatDue(new Date("2026-07-10T17:00:00"), NOW)).toBe("Fri 17:00");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/realtime.test.ts src/lib/data/format.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement**

```ts
// src/lib/realtime.ts
/**
 * Supabase Realtime signaling. Payloads are signal-only ({scope}) — tenant
 * content never crosses the broadcast channel; clients refetch through
 * authenticated server actions.
 */

export type HubScope = "messages" | "approvals" | "tasks" | "reminders";

export function hubChannelName(workspaceId: string) {
  return `ws:${workspaceId}:hub`;
}

/** Server-side broadcast via Realtime REST. Fire-and-forget: a Realtime
 *  outage must never fail the action — clients fall back to the 30s poll. */
export async function broadcastHubSignal(
  workspaceId: string,
  scope: HubScope,
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return;
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          {
            topic: hubChannelName(workspaceId),
            event: "hub",
            payload: { scope },
          },
        ],
      }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // degradation ladder: poll fallback covers missed signals
  }
}
```

```ts
// src/lib/data/format.ts
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function hhmm(d: Date) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Chat timestamps: "just now" → "HH:MM" (today) → "Mon d". */
export function formatHubTime(date: Date, now: Date = new Date()): string {
  if (now.getTime() - date.getTime() < 60_000) return "just now";
  if (sameDay(date, now)) return hhmm(date);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/** Reminder due labels: "Today HH:MM" / "Tomorrow HH:MM" / "Fri HH:MM". */
export function formatDue(date: Date, now: Date = new Date()): string {
  if (sameDay(date, now)) return `Today ${hhmm(date)}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay(date, tomorrow)) return `Tomorrow ${hhmm(date)}`;
  return `${DAYS[date.getDay()]} ${hhmm(date)}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/realtime.test.ts src/lib/data/format.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/realtime.ts src/lib/realtime.test.ts src/lib/data/format.ts src/lib/data/format.test.ts
git commit -m "feat: realtime signal lib (signal-only broadcast) + hub time formatting"
```

---

### Task 4: Live providers — Team Hub + Overview mappers, registry flip

**Files:**
- Create: `src/lib/data/live/team-hub.ts`
- Create: `src/lib/data/live/overview.ts`
- Create: `src/lib/data/live/live-mappers.test.ts`
- Modify: `src/lib/data/team-hub.ts` (live branch)
- Modify: `src/lib/data/overview.ts` (live branch)
- Modify: `src/lib/data/registry.ts` (remove demo rows)
- Modify: `src/lib/data/registry.test.ts` (expectations flip)
- Modify: `src/lib/data/types.ts` (approval message carries `approvalId`; plan item carries idea id)
- Modify: `src/lib/data/demo/team-hub.ts` (add `approvalId: "ap1"` to msg3 so demo matches the type)

**Interfaces:**
- Consumes: Task 2 queries, Task 3 formatters.
- Produces: `liveTeamHub(workspaceId): Promise<TeamHubData>`, `liveOverview(workspaceId): Promise<OverviewData>`; pure `mapTeamHub(...)` and `mapOverview(...)` exported for tests. Task 6 actions return `liveTeamHub` results.

- [ ] **Step 1: Type adjustments**

In `src/lib/data/types.ts`, change the approval variant of `HubMessage` to
include the linking id (insert `approvalId: string;` after `kind: "approval";`
— demo data supplies `"ap1"`), i.e. the variant becomes:

```ts
  | {
      id: string;
      kind: "approval";
      approvalId: string;
      time: string;
      author: string;
      initial: string;
      title: string;
      status: "pending" | "approved" | "rejected";
      decidedBy?: string;
    };
```

In `demo/team-hub.ts` add `approvalId: "ap1",` to the `msg3` object.

- [ ] **Step 2: Failing mapper test**

```ts
// src/lib/data/live/live-mappers.test.ts
import { describe, expect, it } from "vitest";
import { mapTeamHub } from "./team-hub";
import { mapOverview } from "./overview";

const NOW = new Date("2026-07-08T12:00:00");

describe("mapTeamHub", () => {
  it("maps rows into TeamHubData with resolved names and priorities", () => {
    const data = mapTeamHub(
      {
        workspaceName: "Aurora Skincare",
        members: [{ id: "u1", name: "Priya Shah", email: "p@x.com" }],
        messages: [
          {
            id: "m1", kind: "text" as const, body: "hello",
            approvalId: null, createdAt: new Date("2026-07-08T09:12:00"),
            authorId: "u1", authorName: "Priya Shah", authorEmail: "p@x.com",
          },
          {
            id: "m2", kind: "approval" as const, body: null,
            approvalId: "ap1", createdAt: new Date("2026-07-08T09:16:00"),
            authorId: "u1", authorName: "Priya Shah", authorEmail: "p@x.com",
          },
        ],
        approvals: [
          {
            id: "ap1", title: "Reel v2", status: "pending" as const,
            createdAt: new Date("2026-07-08T09:16:00"),
            requestedByName: "Priya Shah", requestedByEmail: "p@x.com",
            decidedById: null,
          },
        ],
        tasks: [
          {
            id: "t1", workspaceId: "ws1", title: "Approve reel",
            done: false, priority: "high" as const,
            createdById: "u1", createdAt: NOW,
          },
        ],
        reminders: [
          {
            id: "r1", title: "Report due",
            dueAt: new Date("2026-07-08T17:00:00"),
            ownerName: "Priya Shah", ownerEmail: "p@x.com",
          },
        ],
        ideas: [
          { id: "i1", topic: "Myth-busting", format: "carousel", status: "new" as const },
        ],
      },
      NOW,
    );

    expect(data.channel).toBe("# aurora-skincare");
    expect(data.members[0]).toEqual({
      id: "u1", name: "Priya Shah", initial: "P", online: false,
    });
    expect(data.messages[0]).toMatchObject({
      kind: "text", author: "Priya Shah", time: "09:12", text: "hello",
    });
    expect(data.messages[1]).toMatchObject({
      kind: "approval", approvalId: "ap1", title: "Reel v2", status: "pending",
    });
    expect(data.tasks[0].priority).toBe("High");
    expect(data.reminders[0].due).toBe("Today 17:00");
    expect(data.planQuickView[0]).toEqual({
      id: "i1", title: "Myth-busting", format: "carousel", status: "proposed",
    });
  });
});

describe("mapOverview", () => {
  it("builds stats and boards from real counts", () => {
    const data = mapOverview({
      slotsThisMonth: 4,
      pendingApprovals: 2,
      overdueSlots: 1,
      newIdeas: 5,
      board: [
        { id: "c1", title: "Reel v2", status: "review" as const },
      ],
      upcoming: [
        {
          id: "s1", title: "Founder post", type: "post",
          scheduledFor: new Date("2026-07-09T10:00:00"),
          status: "scheduled" as const,
        },
      ],
    });
    expect(data.stats.map((s) => s.value)).toEqual(["4", "2", "1", "5"]);
    expect(data.productionBoard[0].stage).toBe("Internal review");
    expect(data.upcoming[0]).toMatchObject({ day: 9, platform: "Post" });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/data/live/live-mappers.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 4: Implement live providers**

```ts
// src/lib/data/live/team-hub.ts
import { getHubState, ideasQuickViewQuery } from "@/db/queries/hub";
import { getWorkspaceById } from "@/db/queries/workspaces";
import { formatDue, formatHubTime } from "@/lib/data/format";
import type {
  HubMessage,
  HubPriority,
  TeamHubData,
} from "@/lib/data/types";

type HubRows = Awaited<ReturnType<typeof getHubState>>;
type IdeaRows = Awaited<ReturnType<ReturnType<typeof ideasQuickViewQuery>["execute"]>>;

const PRIORITY_UP: Record<"high" | "medium" | "low", HubPriority> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

function displayName(name: string | null, email: string | null) {
  return name ?? email ?? "Member";
}

function initialOf(label: string) {
  return (label[0] ?? "?").toUpperCase();
}

export function mapTeamHub(
  input: {
    workspaceName: string;
    members: HubRows["members"];
    messages: HubRows["messages"];
    approvals: HubRows["approvals"];
    tasks: HubRows["tasks"];
    reminders: HubRows["reminders"];
    ideas: IdeaRows;
  },
  now: Date = new Date(),
): TeamHubData {
  const approvalById = new Map(input.approvals.map((a) => [a.id, a]));
  const memberById = new Map(input.members.map((m) => [m.id, m]));

  const messages: HubMessage[] = input.messages.flatMap((m) => {
    const time = formatHubTime(m.createdAt, now);
    if (m.kind === "system") {
      return [{ id: m.id, kind: "system" as const, time, text: m.body ?? "" }];
    }
    const author = displayName(m.authorName, m.authorEmail);
    if (m.kind === "text") {
      return [
        {
          id: m.id,
          kind: "text" as const,
          time,
          author,
          initial: initialOf(author),
          text: m.body ?? "",
        },
      ];
    }
    const approval = m.approvalId ? approvalById.get(m.approvalId) : undefined;
    if (!approval) return []; // orphaned card — skip rather than crash
    const decider = approval.decidedById
      ? memberById.get(approval.decidedById)
      : undefined;
    return [
      {
        id: m.id,
        kind: "approval" as const,
        approvalId: approval.id,
        time,
        author,
        initial: initialOf(author),
        title: approval.title,
        status: approval.status,
        decidedBy: decider
          ? displayName(decider.name, decider.email)
          : undefined,
      },
    ];
  });

  return {
    channel: `# ${input.workspaceName.toLowerCase().replace(/\s+/g, "-")}`,
    members: input.members.map((m) => {
      const label = displayName(m.name, m.email);
      return { id: m.id, name: label, initial: initialOf(label), online: false };
    }),
    messages,
    approvals: input.approvals.map((a) => {
      const decider = a.decidedById ? memberById.get(a.decidedById) : undefined;
      return {
        id: a.id,
        title: a.title,
        requestedBy: displayName(a.requestedByName, a.requestedByEmail),
        time: formatHubTime(a.createdAt, now),
        status: a.status,
        decidedBy: decider
          ? displayName(decider.name, decider.email)
          : undefined,
      };
    }),
    tasks: input.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      done: t.done,
      priority: PRIORITY_UP[t.priority],
    })),
    reminders: input.reminders.map((r) => ({
      id: r.id,
      title: r.title,
      due: formatDue(r.dueAt, now),
      owner: displayName(r.ownerName, r.ownerEmail),
    })),
    planQuickView: input.ideas
      .filter((i) => i.status !== "archived")
      .map((i) => ({
        id: i.id,
        title: i.topic,
        format: i.format ?? "Post",
        status: i.status === "new" ? ("proposed" as const) : ("accepted" as const),
      })),
  };
}

export async function liveTeamHub(workspaceId: string): Promise<TeamHubData> {
  const [ws, state, ideas] = await Promise.all([
    getWorkspaceById(workspaceId),
    getHubState(workspaceId),
    ideasQuickViewQuery(workspaceId),
  ]);
  return mapTeamHub({ workspaceName: ws?.name ?? "workspace", ...state, ideas });
}
```

```ts
// src/lib/data/live/overview.ts
import { and, count, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { db } from "@/db";
import { content, hubApprovals, ideas, schedule } from "@/db/schema";
import type { OverviewData } from "@/lib/data/types";

const STAGE_LABEL: Record<string, string> = {
  draft: "Brief",
  review: "Internal review",
  approved: "Approved",
  scheduled: "Scheduled",
  published: "Published",
};

export function mapOverview(input: {
  slotsThisMonth: number;
  pendingApprovals: number;
  overdueSlots: number;
  newIdeas: number;
  board: { id: string; title: string; status: string }[];
  upcoming: {
    id: string;
    title: string;
    type: string;
    scheduledFor: Date;
    status: string;
  }[];
}): OverviewData {
  return {
    stats: [
      {
        label: "Slots this month",
        value: String(input.slotsThisMonth),
        sub: "scheduled publishes",
      },
      {
        label: "Open approvals",
        value: String(input.pendingApprovals),
        sub: "content + hub sign-offs",
      },
      {
        label: "Overdue slots",
        value: String(input.overdueSlots),
        sub: "past due, not published",
      },
      {
        label: "Ideas ready",
        value: String(input.newIdeas),
        sub: "awaiting plan review",
      },
    ],
    productionBoard: input.board.map((row) => ({
      id: row.id,
      title: row.title,
      stage: STAGE_LABEL[row.status] ?? row.status,
    })),
    upcoming: input.upcoming.map((slot) => ({
      id: slot.id,
      title: slot.title,
      platform: slot.type[0].toUpperCase() + slot.type.slice(1),
      day: slot.scheduledFor.getDate(),
      status: STAGE_LABEL[slot.status] ?? slot.status,
    })),
  };
}

export async function liveOverview(workspaceId: string): Promise<OverviewData> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const [
    [slots],
    [reviewCount],
    [hubPending],
    [overdue],
    [newIdeas],
    board,
    upcoming,
  ] = await Promise.all([
    db
      .select({ n: count() })
      .from(schedule)
      .where(
        and(
          eq(schedule.workspaceId, workspaceId),
          gte(schedule.scheduledFor, monthStart),
          lt(schedule.scheduledFor, monthEnd),
        ),
      ),
    db
      .select({ n: count() })
      .from(content)
      .where(
        and(eq(content.workspaceId, workspaceId), eq(content.status, "review")),
      ),
    db
      .select({ n: count() })
      .from(hubApprovals)
      .where(
        and(
          eq(hubApprovals.workspaceId, workspaceId),
          eq(hubApprovals.status, "pending"),
        ),
      ),
    db
      .select({ n: count() })
      .from(schedule)
      .innerJoin(content, eq(content.id, schedule.contentId))
      .where(
        and(
          eq(schedule.workspaceId, workspaceId),
          lte(schedule.scheduledFor, now),
          inArray(content.status, ["approved", "scheduled"]),
        ),
      ),
    db
      .select({ n: count() })
      .from(ideas)
      .where(and(eq(ideas.workspaceId, workspaceId), eq(ideas.status, "new"))),
    db
      .select({ id: content.id, title: content.title, status: content.status })
      .from(content)
      .where(
        and(
          eq(content.workspaceId, workspaceId),
          inArray(content.status, ["draft", "review", "approved"]),
        ),
      )
      .limit(5),
    db
      .select({
        id: schedule.id,
        title: content.title,
        type: content.type,
        scheduledFor: schedule.scheduledFor,
        status: content.status,
      })
      .from(schedule)
      .innerJoin(content, eq(content.id, schedule.contentId))
      .where(
        and(
          eq(schedule.workspaceId, workspaceId),
          gte(schedule.scheduledFor, now),
        ),
      )
      .orderBy(schedule.scheduledFor)
      .limit(3),
  ]);

  return mapOverview({
    slotsThisMonth: slots.n,
    pendingApprovals: reviewCount.n + hubPending.n,
    overdueSlots: overdue.n,
    newIdeas: newIdeas.n,
    board,
    upcoming,
  });
}
```

- [ ] **Step 5: Flip facades and registry**

`src/lib/data/team-hub.ts` becomes:

```ts
import { dataMode } from "./registry";
import { demoTeamHub } from "./demo/team-hub";
import { liveTeamHub } from "./live/team-hub";
import type { TeamHubData } from "./types";

/** Single entry point for Team Hub data. */
export async function getTeamHubData(
  workspaceId: string,
): Promise<TeamHubData> {
  if (dataMode("hub") === "demo") return demoTeamHub();
  return liveTeamHub(workspaceId);
}
```

`src/lib/data/overview.ts` becomes:

```ts
import { dataMode } from "./registry";
import { demoOverview } from "./demo/overview";
import { liveOverview } from "./live/overview";
import type { OverviewData } from "./types";

/** Single entry point for Overview data. */
export async function getOverviewData(
  workspaceId: string,
): Promise<OverviewData> {
  if (dataMode("overview") === "demo") return demoOverview();
  return liveOverview(workspaceId);
}
```

`src/lib/data/registry.ts`: `DEMO_SECTIONS` becomes empty:

```ts
/** Sections still on seeded demo data. Wiring a section = delete its row. */
const DEMO_SECTIONS: Record<string, true> = {};
```

`src/lib/data/registry.test.ts`: update the first test:

```ts
  it("hub and overview are live after Phase B slice 1", () => {
    expect(dataMode("overview")).toBe("live");
    expect(dataMode("hub")).toBe("live");
  });
```

Also update `src/lib/nav.ts`: `overview` and `hub` entries change
`status: "demo"` → `status: "live"`.

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/lib/data`
Expected: PASS (mappers, registry, demo datasets, format)

- [ ] **Step 7: Commit**

```bash
git add src/lib/data src/lib/nav.ts
git commit -m "feat: live Team Hub + Overview providers over real hub/schedule/ideas rows"
```

---

### Task 5: Supabase client dep + realtime hook

**Files:**
- Modify: `package.json` (add `@supabase/supabase-js`)
- Create: `src/app/(app)/w/[ws]/hub/use-hub-realtime.ts`

**Interfaces:**
- Produces: `useHubRealtime({ workspaceId, userId, onSignal })` → `{ onlineIds: Set<string> }`. Task 7 canvas consumes it.

- [ ] **Step 1: Install dependency**

Run: `npm install @supabase/supabase-js`
Expected: added to package.json dependencies

- [ ] **Step 2: Implement the hook**

```ts
// src/app/(app)/w/[ws]/hub/use-hub-realtime.ts
"use client";

import { useEffect, useRef, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { hubChannelName, type HubScope } from "@/lib/realtime";

let client: SupabaseClient | null = null;

function supabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  client ??= createClient(url, key, {
    realtime: { params: { eventsPerSecond: 5 } },
  });
  return client;
}

/**
 * Subscribes to the workspace hub channel. Signals trigger onSignal(scope);
 * presence tracks user ids only (no names/content on the wire).
 */
export function useHubRealtime({
  workspaceId,
  userId,
  onSignal,
}: {
  workspaceId: string;
  userId: string;
  onSignal: (scope: HubScope) => void;
}) {
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const onSignalRef = useRef(onSignal);
  onSignalRef.current = onSignal;

  useEffect(() => {
    const sb = supabase();
    if (!sb) return;

    const channel = sb.channel(hubChannelName(workspaceId), {
      config: { presence: { key: userId } },
    });

    channel
      .on("broadcast", { event: "hub" }, (msg) => {
        const scope = (msg.payload as { scope?: HubScope }).scope;
        if (scope) onSignalRef.current(scope);
      })
      .on("presence", { event: "sync" }, () => {
        setOnlineIds(new Set(Object.keys(channel.presenceState())));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") channel.track({});
      });

    return () => {
      sb.removeChannel(channel);
    };
  }, [workspaceId, userId]);

  return { onlineIds };
}
```

- [ ] **Step 3: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors

```bash
git add package.json package-lock.json "src/app/(app)/w/[ws]/hub/use-hub-realtime.ts"
git commit -m "feat: supabase realtime hook — hub channel subscribe + presence (ids only)"
```

---

### Task 6: Hub server actions

**Files:**
- Create: `src/app/(app)/w/[ws]/hub/actions.ts`

**Interfaces:**
- Consumes: Task 2 queries, Task 3 `broadcastHubSignal`, Task 4 `liveTeamHub`.
- Produces (Task 7 canvas calls these): every action validates with zod, guards with `requireUser` + `requireMembership`, writes, broadcasts a signal, and returns `{ data: TeamHubData }` or `{ error }`:
  - `fetchHubState(workspaceId)`
  - `sendHubMessage(workspaceId, body)`
  - `requestHubApproval(workspaceId, title)`
  - `decideApproval(workspaceId, approvalId, decision)`
  - `createTask(workspaceId, title)`
  - `setTaskDone(workspaceId, taskId, done)`
  - `setTaskPriority(workspaceId, taskId, priority)` (lower-case enum)
  - `createReminder(workspaceId, title, dueAtIso)`
  - `decidePlanIdea(workspaceId, ideaId, decision)`

- [ ] **Step 1: Implement actions**

```ts
// src/app/(app)/w/[ws]/hub/actions.ts
"use server";

import { z } from "zod";
import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import {
  addHubReminder,
  addHubTask,
  addHubTextMessage,
  createHubApproval,
  decideHubApproval,
  setHubTaskDone,
  setHubTaskPriority,
  setIdeaStatus,
} from "@/db/queries/hub";
import { liveTeamHub } from "@/lib/data/live/team-hub";
import { broadcastHubSignal, type HubScope } from "@/lib/realtime";
import { actionErrorMessage } from "@/lib/action-errors";
import type { TeamHubData } from "@/lib/data/types";

export type HubActionResult =
  | { data: TeamHubData; error?: undefined }
  | { data?: undefined; error: string };

const ws = z.string().min(1);

async function guard(workspaceId: string) {
  const user = await requireUser();
  await requireMembership(workspaceId, user.id);
  return user;
}

async function stateAfter(
  workspaceId: string,
  scope: HubScope,
): Promise<HubActionResult> {
  await broadcastHubSignal(workspaceId, scope);
  return { data: await liveTeamHub(workspaceId) };
}

export async function fetchHubState(
  workspaceId: string,
): Promise<HubActionResult> {
  try {
    const parsed = ws.parse(workspaceId);
    await guard(parsed);
    return { data: await liveTeamHub(parsed) };
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}

const messageSchema = z.object({
  workspaceId: ws,
  body: z.string().trim().min(1).max(2000),
});

export async function sendHubMessage(
  workspaceId: string,
  body: string,
): Promise<HubActionResult> {
  try {
    const input = messageSchema.parse({ workspaceId, body });
    const user = await guard(input.workspaceId);
    await addHubTextMessage({
      workspaceId: input.workspaceId,
      authorId: user.id,
      body: input.body,
    });
    return await stateAfter(input.workspaceId, "messages");
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}

const approvalSchema = z.object({
  workspaceId: ws,
  title: z.string().trim().min(1).max(300),
});

export async function requestHubApproval(
  workspaceId: string,
  title: string,
): Promise<HubActionResult> {
  try {
    const input = approvalSchema.parse({ workspaceId, title });
    const user = await guard(input.workspaceId);
    await createHubApproval({
      workspaceId: input.workspaceId,
      requestedById: user.id,
      title: input.title,
    });
    return await stateAfter(input.workspaceId, "approvals");
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}

const decideSchema = z.object({
  workspaceId: ws,
  approvalId: z.string().min(1),
  decision: z.enum(["approved", "rejected"]),
});

export async function decideApproval(
  workspaceId: string,
  approvalId: string,
  decision: "approved" | "rejected",
): Promise<HubActionResult> {
  try {
    const input = decideSchema.parse({ workspaceId, approvalId, decision });
    const user = await guard(input.workspaceId);
    await decideHubApproval({
      workspaceId: input.workspaceId,
      approvalId: input.approvalId,
      deciderId: user.id,
      status: input.decision,
    });
    return await stateAfter(input.workspaceId, "approvals");
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}

const taskSchema = z.object({
  workspaceId: ws,
  title: z.string().trim().min(1).max(300),
});

export async function createTask(
  workspaceId: string,
  title: string,
): Promise<HubActionResult> {
  try {
    const input = taskSchema.parse({ workspaceId, title });
    const user = await guard(input.workspaceId);
    await addHubTask({
      workspaceId: input.workspaceId,
      createdById: user.id,
      title: input.title,
    });
    return await stateAfter(input.workspaceId, "tasks");
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}

const taskDoneSchema = z.object({
  workspaceId: ws,
  taskId: z.string().min(1),
  done: z.boolean(),
});

export async function setTaskDone(
  workspaceId: string,
  taskId: string,
  done: boolean,
): Promise<HubActionResult> {
  try {
    const input = taskDoneSchema.parse({ workspaceId, taskId, done });
    await guard(input.workspaceId);
    await setHubTaskDone(input);
    return await stateAfter(input.workspaceId, "tasks");
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}

const taskPrioritySchema = z.object({
  workspaceId: ws,
  taskId: z.string().min(1),
  priority: z.enum(["high", "medium", "low"]),
});

export async function setTaskPriority(
  workspaceId: string,
  taskId: string,
  priority: "high" | "medium" | "low",
): Promise<HubActionResult> {
  try {
    const input = taskPrioritySchema.parse({ workspaceId, taskId, priority });
    await guard(input.workspaceId);
    await setHubTaskPriority(input);
    return await stateAfter(input.workspaceId, "tasks");
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}

const reminderSchema = z.object({
  workspaceId: ws,
  title: z.string().trim().min(1).max(300),
  dueAtIso: z.string().refine((v) => !Number.isNaN(Date.parse(v)), {
    message: "Invalid date",
  }),
});

export async function createReminder(
  workspaceId: string,
  title: string,
  dueAtIso: string,
): Promise<HubActionResult> {
  try {
    const input = reminderSchema.parse({ workspaceId, title, dueAtIso });
    const user = await guard(input.workspaceId);
    await addHubReminder({
      workspaceId: input.workspaceId,
      ownerId: user.id,
      title: input.title,
      dueAt: new Date(input.dueAtIso),
    });
    return await stateAfter(input.workspaceId, "reminders");
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}

const planSchema = z.object({
  workspaceId: ws,
  ideaId: z.string().min(1),
  decision: z.enum(["accepted", "rejected"]),
});

export async function decidePlanIdea(
  workspaceId: string,
  ideaId: string,
  decision: "accepted" | "rejected",
): Promise<HubActionResult> {
  try {
    const input = planSchema.parse({ workspaceId, ideaId, decision });
    await guard(input.workspaceId);
    await setIdeaStatus({
      workspaceId: input.workspaceId,
      ideaId: input.ideaId,
      status: input.decision === "accepted" ? "drafted" : "archived",
    });
    return await stateAfter(input.workspaceId, "messages");
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}
```

- [ ] **Step 2: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors

```bash
git add "src/app/(app)/w/[ws]/hub/actions.ts"
git commit -m "feat: hub server actions — guarded writes + signal broadcast + fresh state"
```

---

### Task 7: Wire the canvas live + Overview page cleanup

**Files:**
- Modify: `src/app/(app)/w/[ws]/hub/page.tsx` (pass workspaceId + current user; drop DemoBadge)
- Modify: `src/app/(app)/w/[ws]/hub/team-hub-canvas.tsx` (server-action mutations, realtime subscription, poll fallback, reminder-add UI, presence-driven online dots)
- Modify: `src/app/(app)/w/[ws]/overview/page.tsx` (drop DemoBadge)

**Interfaces:**
- Consumes: Task 5 hook, Task 6 actions.
- Canvas props become `{ initial: TeamHubData; workspaceId: string; me: { id: string; name: string } }`.

- [ ] **Step 1: Update the server page**

```tsx
// src/app/(app)/w/[ws]/hub/page.tsx
import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import { getTeamHubData } from "@/lib/data/team-hub";
import { TeamHubCanvas } from "./team-hub-canvas";

export const metadata = { title: "Team Hub" };
export const dynamic = "force-dynamic";

export default async function TeamHubPage({
  params,
}: {
  params: { ws: string };
}) {
  const user = await requireUser();
  await requireMembership(params.ws, user.id);
  const data = await getTeamHubData(params.ws);

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-display text-3xl">Team Hub</h1>
      <p className="mt-1 text-sm text-white/50">
        Workspace channel — chat, sign-offs, shared tasks and reminders in one
        canvas.
      </p>
      <div className="mt-6">
        <TeamHubCanvas
          initial={data}
          workspaceId={params.ws}
          me={{ id: user.id, name: user.name ?? user.email ?? "You" }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Rewire the canvas**

Full replacement of `team-hub-canvas.tsx`. Structure and classes stay exactly
as Phase A; the state layer changes:

- `const [data, setData] = useState(initial)` — single source, all panels render from it.
- `refresh()` calls `fetchHubState(workspaceId)`, applies `res.data` when present.
- `useHubRealtime({ workspaceId, userId: me.id, onSignal: () => refresh() })`
  → `onlineIds` drives the member dot: `online = onlineIds.has(member.id)`.
- `useEffect` 30s `setInterval(refresh)` fallback poll + cleanup.
- Mutations call the Task 6 actions and `setData(res.data)` on success; text
  send does an optimistic append first (temp id `tmp-${Date.now()}`), replaced
  by the returned state. Failures set an `error` string rendered as a slim
  banner above the composer (`text-red-400 text-xs`).
- Priority cycle sends the *next lower-case* priority:
  `{ High: "medium", Medium: "low", Low: "high" }[current]`.
- Plan quick-view buttons call `decidePlanIdea(workspaceId, id, "accepted" | "rejected")`.
- Approval buttons (chat cards and queue) call
  `decideApproval(workspaceId, approvalId, decision)` — no more title matching;
  chat approval cards use `m.approvalId` directly.
- Shared reminders panel gains an add row (matching the task add row):
  text input + `<input type="datetime-local">` + ADD button →
  `createReminder(workspaceId, title, new Date(value).toISOString())`.
- Delete the `messageApprovals` prop from `MessageRow` — decisions go through
  `m.approvalId`; `matchingApproval` lookup is removed.

- [ ] **Step 3: Overview page cleanup**

In `overview/page.tsx`: remove the `DemoBadge` import and usage (header
becomes just the `<h1>`). Everything else unchanged — data is live via the
provider swap.

- [ ] **Step 4: Verify in the running app (two browsers)**

Run: `npm run dev`, open `/w/<real-workspace-id>/hub` in two sessions.
Expected: message sent in one appears in the other without reload (Realtime);
task toggles, priority cycles, reminders, and approval decisions propagate;
member avatar dot lights up while the other session is on the page; Overview
shows real counts.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/w/[ws]/hub" "src/app/(app)/w/[ws]/overview/page.tsx"
git commit -m "feat: Team Hub live — realtime signals, presence, guarded mutations"
```

---

### Task 8: Full verification gate

- [ ] **Step 1:** `npm test` — expect all suites green (new: hub queries, realtime, format, live mappers; updated: registry).
- [ ] **Step 2:** `npm run typecheck && npm run lint && npm run build` — all pass.
- [ ] **Step 3:** Manual dev sweep per Task 7 Step 4.
- [ ] **Step 4:** Commit fixups if any.
