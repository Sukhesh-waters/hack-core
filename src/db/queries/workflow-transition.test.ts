import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRule } from "@/db/schema";

/**
 * transitionContent is the one place W5's rule evaluation actually runs
 * against a row, so it needs real DB-shaped coverage — not just the pure
 * evaluator tests in rules.test.ts. Everything below the pure engine/rules
 * layer is stubbed: the workflow itself (workflow-seed), the write path
 * (db), activity, and notifications. This file is deliberately separate
 * from workflow.test.ts, which asserts real drizzle .toSQL() output and
 * would break under a mocked db.
 */

const statesFixture = vi.hoisted(() => [
  {
    id: "s_draft",
    key: "draft",
    name: "Draft",
    category: "todo" as const,
    colorKey: "slate",
    position: 0,
    wipLimit: null,
    legacyStage: null,
  },
  {
    id: "s_pub",
    key: "published",
    name: "Published",
    category: "done" as const,
    colorKey: "emerald",
    position: 1,
    wipLimit: null,
    legacyStage: null,
  },
]);

const transitionsFixture = vi.hoisted(() => [
  {
    id: "t_draft_pub",
    fromStateId: "s_draft" as string | null,
    toStateId: "s_pub",
    name: "Publish",
    position: 0,
    conditions: [] as WorkflowRule[],
    validators: [] as WorkflowRule[],
    postActions: [] as WorkflowRule[],
  },
]);

const ensureContentWorkflow = vi.hoisted(() => vi.fn(async () => "wf_1"));
const workflowStatesQuery = vi.hoisted(() => vi.fn(async () => statesFixture));
const workflowTransitionsQuery = vi.hoisted(() =>
  vi.fn(async () => transitionsFixture),
);
vi.mock("./workflow-seed", () => ({
  ensureContentWorkflow,
  workflowStatesQuery,
  workflowTransitionsQuery,
}));

const recordActivity = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/activity", () => ({ recordActivity }));

const notify = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/db/queries/notifications", () => ({ notify }));

const dbState = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  applyResult: [{ id: "c_1" }] as Array<{ id: string }>,
  updateCalls: [] as Array<{ table: string; values: Record<string, unknown> }>,
}));

const dbMock = vi.hoisted(() => ({
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => (dbState.row ? [dbState.row] : []),
      }),
    }),
  }),
  update: (table: unknown) => ({
    set: (values: Record<string, unknown>) => {
      dbState.updateCalls.push({ table: getTableName(table as never), values });
      return {
        where: () => ({
          returning: async () => dbState.applyResult,
          // set_due_offset's update is awaited directly, no .returning() —
          // this makes the same chain awaitable on its own.
          then: (resolve: (v: undefined) => void) => resolve(undefined),
        }),
      };
    },
  }),
}));
vi.mock("@/db", () => ({ db: dbMock }));

const { transitionContent } = await import("./workflow");

function resetFixtures() {
  transitionsFixture[0].conditions = [];
  transitionsFixture[0].validators = [];
  transitionsFixture[0].postActions = [];
  dbState.row = {
    id: "c_1",
    title: "A draft",
    workflowStateId: "s_draft",
    productionStage: null,
    assigneeId: "u_assignee",
    body: "real content",
    complianceStatus: "pending",
  };
  dbState.applyResult = [{ id: "c_1" }];
  dbState.updateCalls = [];
}

beforeEach(() => {
  resetFixtures();
  recordActivity.mockClear();
  notify.mockClear();
});

const move = (over: Partial<Parameters<typeof transitionContent>[0]> = {}) =>
  transitionContent({
    workspaceId: "ws_1",
    contentId: "c_1",
    toStateId: "s_pub",
    actorId: "u_actor",
    actorRole: "member",
    ...over,
  });

describe("transitionContent — no rules attached", () => {
  it("moves the row and records activity", async () => {
    const result = await move();
    expect(result).toEqual({ ok: true, toStateId: "s_pub", toName: "Published" });
    expect(dbState.updateCalls).toHaveLength(1);
    expect(dbState.updateCalls[0].values.workflowStateId).toBe("s_pub");
    expect(recordActivity).toHaveBeenCalledTimes(1);
  });

  it("reports 'already moved' when the guarded write matches zero rows", async () => {
    dbState.applyResult = [];
    const result = await move();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/already moved/i);
  });

  it("reports the row as unavailable when it no longer exists", async () => {
    dbState.row = null;
    const result = await move();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no longer available/i);
  });

  it("refuses a row that was never put on a workflow", async () => {
    dbState.row = { ...dbState.row, workflowStateId: null, productionStage: null };
    const result = await move();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/isn't on a workflow yet/i);
  });
});

describe("transitionContent — conditions", () => {
  it("blocks a move when the actor's role lacks the required capability", async () => {
    transitionsFixture[0].conditions = [
      { kind: "requires_capability", config: { capability: "workflow.edit" } },
    ];
    const result = await move({ actorRole: "member" });
    expect(result.ok).toBe(false);
    expect(dbState.updateCalls).toHaveLength(0);
  });

  it("allows the same gated move for a role that holds the capability", async () => {
    transitionsFixture[0].conditions = [
      { kind: "requires_capability", config: { capability: "workflow.edit" } },
    ];
    const result = await move({ actorRole: "admin" });
    expect(result.ok).toBe(true);
  });

  it("skips condition evaluation entirely for a system-initiated move (no actor)", async () => {
    transitionsFixture[0].conditions = [
      { kind: "requires_capability", config: { capability: "workflow.edit" } },
    ];
    const result = await move({ actorId: null, actorRole: undefined });
    expect(result.ok).toBe(true);
  });
});

describe("transitionContent — validators", () => {
  it("blocks a move when body_required fails", async () => {
    dbState.row = { ...dbState.row, body: "" };
    transitionsFixture[0].validators = [{ kind: "body_required", config: {} }];
    const result = await move();
    expect(result.ok).toBe(false);
    expect(dbState.updateCalls).toHaveLength(0);
  });

  it("allows the move once the validator is satisfied", async () => {
    dbState.row = { ...dbState.row, body: "real content" };
    transitionsFixture[0].validators = [{ kind: "body_required", config: {} }];
    const result = await move();
    expect(result.ok).toBe(true);
  });
});

describe("transitionContent — post-actions", () => {
  it("notifies the assignee after a successful move without changing the result", async () => {
    transitionsFixture[0].postActions = [
      { kind: "notify_assignee", config: { message: "It's live." } },
    ];
    const result = await move();
    expect(result.ok).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws_1",
        userId: "u_assignee",
        subjectId: "c_1",
        body: "It's live.",
      }),
    );
  });

  it("does not notify when the card has no assignee", async () => {
    dbState.row = { ...dbState.row, assigneeId: null };
    transitionsFixture[0].postActions = [
      { kind: "notify_assignee", config: {} },
    ];
    const result = await move();
    expect(result.ok).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  it("sets a due date offset via a second content update", async () => {
    transitionsFixture[0].postActions = [
      { kind: "set_due_offset", config: { days: 3 } },
    ];
    const result = await move();
    expect(result.ok).toBe(true);
    expect(dbState.updateCalls).toHaveLength(2);
    expect(dbState.updateCalls[1].values).toHaveProperty("dueAt");
  });

  it("never lets a post-action failure surface as a failed move", async () => {
    notify.mockRejectedValueOnce(new Error("notification service down"));
    transitionsFixture[0].postActions = [
      { kind: "notify_assignee", config: {} },
    ];
    const result = await move();
    expect(result).toEqual({ ok: true, toStateId: "s_pub", toName: "Published" });
    expect(dbState.updateCalls).toHaveLength(1);
  });

  it("still runs a later post-action after an earlier one throws", async () => {
    notify.mockRejectedValueOnce(new Error("notification service down"));
    transitionsFixture[0].postActions = [
      { kind: "notify_assignee", config: {} },
      { kind: "set_due_offset", config: { days: 2 } },
    ];
    const result = await move();
    expect(result.ok).toBe(true);
    expect(dbState.updateCalls).toHaveLength(2);
    expect(dbState.updateCalls[1].values).toHaveProperty("dueAt");
  });
});
