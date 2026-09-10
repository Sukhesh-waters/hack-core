import { describe, expect, it } from "vitest";
import {
  hubApprovalsQuery,
  hubMessagesQuery,
  hubRemindersQuery,
  hubTasksQuery,
  ideasQuickViewQuery,
  listDueUnnotifiedReminders,
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

  it("hubTasksQuery filters out done and archived tasks", () => {
    const { sql } = hubTasksQuery(WS).toSQL();
    expect(sql.toLowerCase()).toContain("archived_at");
    expect(sql.toLowerCase()).toContain("is null");
  });

  it("hubMessagesQuery filters out archived messages", () => {
    const { sql } = hubMessagesQuery(WS).toSQL();
    expect(sql.toLowerCase()).toContain("archived_at");
    expect(sql.toLowerCase()).toContain("is null");
  });

  it("hubApprovalsQuery filters out archived approvals", () => {
    const { sql } = hubApprovalsQuery(WS).toSQL();
    expect(sql.toLowerCase()).toContain("archived_at");
    expect(sql.toLowerCase()).toContain("is null");
  });

  it("listDueUnnotifiedReminders filters out notified and archived reminders", () => {
    const { sql } = listDueUnnotifiedReminders().toSQL();
    expect(sql.toLowerCase()).toContain("notified_at");
    expect(sql.toLowerCase()).toContain("archived_at");
    expect(sql.toLowerCase()).toContain("is null");
  });
});
