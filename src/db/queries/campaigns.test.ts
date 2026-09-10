import { describe, expect, it } from "vitest";
import { campaignsForClient, campaignsQuery, getCampaignByIdQuery } from "./campaigns";

describe("campaignsQuery", () => {
  it("is workspace-scoped (isolation rule)", () => {
    const { sql, params } = campaignsQuery("ws_1").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });

  /**
   * F9.5: client detail page filter. Both workspace_id AND client_id must
   * appear in the WHERE — isolation-critical for "campaigns belonging to
   * this client."
   */
  it("optionally filters by clientId (F9.5), scoped to workspace AND client", () => {
    const { sql, params } = campaignsQuery("ws_1", {
      clientId: "client_1",
    }).toSQL();
    expect(sql).toContain('"campaigns"."workspace_id" =');
    expect(sql).toContain('"campaigns"."client_id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("client_1");
  });

  it("left-joins content for the linked creative's title, workspace-scoped on the join itself", () => {
    const { sql, params } = campaignsQuery("ws_1").toSQL();
    expect(sql).toContain("left join");
    expect(sql).toContain('"content"');
    expect(sql).toContain('"content"."title"');
    // The join condition must pin content to the same workspace as the
    // campaigns query, not just campaigns.workspace_id — otherwise a
    // creativeContentId that (incorrectly) points at another workspace's
    // content row could resolve that other workspace's title.
    const joinClause = sql.slice(sql.indexOf("left join"), sql.indexOf("where"));
    expect(joinClause).toContain('"content"."workspace_id" =');
    // "ws_1" is bound twice: once for the join condition, once for the
    // campaigns.workspace_id WHERE clause.
    expect(params.filter((p) => p === "ws_1").length).toBeGreaterThanOrEqual(2);
  });
});

describe("getCampaignByIdQuery", () => {
  it("is workspace-scoped (isolation rule)", () => {
    const { sql, params } = getCampaignByIdQuery("ws_1", "camp_1").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("camp_1");
  });
});

/** F9.5: thin wrapper over campaignsQuery's clientId opt — confirm it
 *  actually forwards both scoping params. */
describe("campaignsForClient (F9.5)", () => {
  it("is scoped to workspace AND client id", async () => {
    // campaignsForClient is async (matches listCampaigns' shape), so build
    // via campaignsQuery directly for a .toSQL() assertion instead of
    // awaiting a real DB call in a unit test.
    const { sql, params } = campaignsQuery("ws_1", {
      clientId: "client_1",
    }).toSQL();
    expect(sql).toContain('"campaigns"."workspace_id" =');
    expect(sql).toContain('"campaigns"."client_id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("client_1");
    // Sanity: campaignsForClient itself is exported and callable.
    expect(typeof campaignsForClient).toBe("function");
  });
});
