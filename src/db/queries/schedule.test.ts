import { describe, expect, it } from "vitest";
import {
  approvalQueueQuery,
  dueRemindersQuery,
  planGridQuery,
  scheduledSlotsQuery,
  scheduledSopStepsQuery,
  updatePlanCellQuery,
} from "./schedule";

describe("approval queue query", () => {
  it("is workspace-scoped (isolation rule)", () => {
    const { sql, params } = approvalQueueQuery("ws_1").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });

  it("only surfaces review and approved content", () => {
    const { params } = approvalQueueQuery("ws_1").toSQL();
    expect(params).toContain("review");
    expect(params).toContain("approved");
    expect(params).not.toContain("draft");
    expect(params).not.toContain("published");
  });
});

describe("scheduled slots query", () => {
  it("is workspace-scoped (isolation rule)", () => {
    const { sql, params } = scheduledSlotsQuery("ws_1").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });

  it("selects content status so Calendar can derive the publish checklist", () => {
    const { sql } = scheduledSlotsQuery("ws_1").toSQL();
    expect(sql).toContain('"status"');
  });
});

describe("due reminders sweep", () => {
  it("only picks unsent reminders due before the horizon", () => {
    const horizon = new Date("2026-07-06T00:00:00Z");
    const { sql, params } = dueRemindersQuery(horizon).toSQL();
    expect(sql).toContain('"scheduled_for" <=');
    expect(sql).toContain('"reminder_sent_at" is null');
    expect(params).toContain(horizon.toISOString());
  });

  it("selects workspace_id so recipients resolve per workspace", () => {
    const { sql } = dueRemindersQuery(new Date()).toSQL();
    expect(sql).toContain('"workspace_id"');
  });
});

/**
 * The plan grid reads content-first. scheduledSlotsQuery reads schedule-first
 * and INNER JOINs, which structurally cannot return a post that has no date
 * yet — and an undated post is precisely the row a planner opens the grid to
 * fix. These assertions pin that inversion.
 */
describe("plan grid query (S2)", () => {
  const range = {
    from: new Date("2026-07-01T00:00:00Z"),
    to: new Date("2026-08-01T00:00:00Z"),
  };

  it("is workspace-scoped (isolation rule)", () => {
    const { sql, params } = planGridQuery("ws_1", range).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });

  it("LEFT JOINs schedule so undated content still appears", () => {
    const { sql } = planGridQuery("ws_1", range).toSQL();
    expect(sql.toLowerCase()).toContain("left join");
    // the undated escape hatch on the range filter
    expect(sql.toLowerCase()).toContain("is null");
  });

  it("LEFT JOINs users so unassigned content still appears", () => {
    const { sql } = planGridQuery("ws_1", range).toSQL();
    expect(sql.toLowerCase().match(/left join/g)?.length ?? 0).toBeGreaterThan(
      1,
    );
  });

  it("bounds the range", () => {
    const { params } = planGridQuery("ws_1", range).toSQL();
    // drizzle serializes timestamps before they reach params
    const serialized = params.map((p) => String(p));
    expect(serialized.some((p) => p.includes("2026-07-01"))).toBe(true);
    expect(serialized.some((p) => p.includes("2026-08-01"))).toBe(true);
  });

  it("is never unbounded and caps a caller asking for too much", () => {
    expect(planGridQuery("ws_1", range).toSQL().sql.toLowerCase()).toContain(
      "limit",
    );
    const { params } = planGridQuery("ws_1", range, { limit: 5000 }).toSQL();
    expect(params).toContain(500);
    expect(params).not.toContain(5000);
  });

  it("orders undated rows last rather than dropping them", () => {
    const { sql } = planGridQuery("ws_1", range).toSQL();
    expect(sql.toLowerCase()).toContain("nulls last");
  });

  it("narrows by client when asked", () => {
    const { params } = planGridQuery("ws_1", range, {
      clientId: "client_1",
    }).toSQL();
    expect(params).toContain("client_1");
  });
});

describe("updatePlanCellQuery (S2)", () => {
  it("is scoped to workspace AND content id (isolation rule)", () => {
    const { sql, params } = updatePlanCellQuery({
      workspaceId: "ws_1",
      contentId: "content_1",
      values: { pillar: "Education" },
    }).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("content_1");
  });
});

describe("plan grid scope filters (U2)", () => {
  const range = {
    from: new Date("2026-07-01T00:00:00Z"),
    to: new Date("2026-08-01T00:00:00Z"),
  };

  it("narrows to one assignee", () => {
    const { params } = planGridQuery("ws_1", range, {
      assigneeId: "user_2",
    }).toSQL();
    expect(params).toContain("user_2");
  });

  it("surfaces unowned rows without needing an id", () => {
    const { sql } = planGridQuery("ws_1", range, {
      unassignedOnly: true,
    }).toSQL();
    // assignee_id IS NULL, on top of the schedule-date null escape hatch
    expect((sql.toLowerCase().match(/is null/g) ?? []).length).toBeGreaterThan(
      1,
    );
  });

  it("stays workspace-scoped under every filter", () => {
    for (const opts of [
      { clientId: "c_1" },
      { assigneeId: "u_1" },
      { unassignedOnly: true },
    ]) {
      const { sql, params } = planGridQuery("ws_1", range, opts).toSQL();
      expect(sql).toContain('"workspace_id" =');
      expect(params).toContain("ws_1");
    }
  });
});

describe("scheduledSopStepsQuery (E2)", () => {
  const range = {
    from: new Date("2026-07-01T00:00:00Z"),
    to: new Date("2026-08-01T00:00:00Z"),
  };

  it("is workspace-scoped and active-run scoped", () => {
    const { sql, params } = scheduledSopStepsQuery("ws_1", range).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("active");
  });

  it("filters for open statuses (ready, in_progress, blocked)", () => {
    const { params } = scheduledSopStepsQuery("ws_1", range).toSQL();
    expect(params).toContain("ready");
    expect(params).toContain("in_progress");
    expect(params).toContain("blocked");
  });

  it("filters by clientId and assigneeId when provided", () => {
    const { sql, params } = scheduledSopStepsQuery("ws_1", range, {
      clientId: "c_1",
      assigneeId: "u_1",
    }).toSQL();
    expect(sql).toContain('"client_id" =');
    expect(sql).toContain('"assignee_id" =');
    expect(params).toContain("c_1");
    expect(params).toContain("u_1");
  });
});
