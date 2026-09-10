import { describe, expect, it } from "vitest";
import {
  markAllReadQuery,
  markReadQuery,
  notificationsQuery,
  unreadCountQuery,
} from "./notifications";

/**
 * Scoping by user alone would leak one workspace's bell into another's for
 * anyone who belongs to both — the normal case for an agency operator.
 */
describe("unreadCountQuery (S9)", () => {
  const { sql, params } = unreadCountQuery("ws_1", "user_1").toSQL();

  it("is scoped by workspace AND user", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"user_id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("user_1");
  });

  it("counts only unread rows", () => {
    expect(sql.toLowerCase()).toContain("is null");
    expect(sql.toLowerCase()).toContain("count");
  });
});

describe("notificationsQuery (S9)", () => {
  const { sql, params } = notificationsQuery("ws_1", "user_1").toSQL();

  it("is scoped by workspace AND user", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"user_id" =');
    expect(params).toContain("user_1");
  });

  it("is bounded and newest-first", () => {
    expect(sql.toLowerCase()).toContain("limit");
    expect(sql.toLowerCase()).toContain("desc");
  });
});

/**
 * Idempotent by construction: the readAt IS NULL predicate means a second
 * call matches nothing rather than overwriting the original timestamp with
 * a later one, so a double-click can't rewrite when something was read.
 */
describe("markReadQuery (S9)", () => {
  const { sql, params } = markReadQuery({
    workspaceId: "ws_1",
    userId: "user_1",
    notificationId: "n_1",
  }).toSQL();

  it("only touches rows that are still unread", () => {
    expect(sql.toLowerCase()).toContain("is null");
  });

  it("cannot mark another user's notification read", () => {
    expect(sql).toContain('"user_id" =');
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("user_1");
    expect(params).toContain("n_1");
  });
});

describe("markAllReadQuery (S9)", () => {
  it("is scoped to one user in one workspace, unread only", () => {
    const { sql, params } = markAllReadQuery("ws_1", "user_1").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"user_id" =');
    expect(sql.toLowerCase()).toContain("is null");
    expect(params).toContain("ws_1");
    expect(params).toContain("user_1");
  });
});
