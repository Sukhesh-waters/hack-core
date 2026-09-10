import { describe, expect, it } from "vitest";
import {
  emailsForUsersQuery,
  immediateMemberEmailsQuery,
  workspaceMembersQuery,
} from "./memberships";

/**
 * listWorkspaceMembers powers the ticket assignee picker and the
 * assign-to-member isolation check (an assigneeId must actually be a member
 * of the target workspace) — proven workspace-scoped here.
 */
describe("workspaceMembersQuery (listWorkspaceMembers)", () => {
  it("is workspace-scoped (isolation rule)", () => {
    const { sql, params } = workspaceMembersQuery("ws_1").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });

  it("selects userId, name, and email", () => {
    const { sql } = workspaceMembersQuery("ws_1").toSQL();
    expect(sql).toContain('"id"');
    expect(sql).toContain('"name"');
    expect(sql).toContain('"email"');
  });
});

/**
 * S10 — the whole-workspace email blast. Both senders used to resolve
 * recipients with listMemberEmails(workspaceId), so a reminder about one
 * person's post went to everyone. At a real client roster that makes the
 * product unusable.
 */
describe("emailsForUsersQuery (S10)", () => {
  const { sql, params } = emailsForUsersQuery("ws_1", ["user_1"]).toSQL();

  it("is workspace-scoped, never cross-workspace", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });

  it("resolves only the named users", () => {
    expect(params).toContain("user_1");
  });

  it("excludes anyone who turned email off", () => {
    // filtered in the query so no call site can forget it
    expect(params).toContain("immediate");
  });
});

describe("immediateMemberEmailsQuery (S10)", () => {
  const { sql, params } = immediateMemberEmailsQuery("ws_1").toSQL();

  it("is workspace-scoped", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });

  it("sends only to members who still want immediate email", () => {
    expect(params).toContain("immediate");
  });
});
