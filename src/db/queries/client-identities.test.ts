import { describe, expect, it } from "vitest";
import {
  brandScanTargetsQuery,
  buildKnownParties,
  clientIdentitiesQuery,
  competitorBrandsQuery,
  removeClientIdentityQuery,
  workspaceIdentitiesQuery,
} from "./client-identities";

describe("client identity queries filter workspace_id in the generated SQL", () => {
  it("clientIdentitiesQuery scopes workspace and client", () => {
    const { sql, params } = clientIdentitiesQuery("ws_a", "c1").toSQL();
    expect(sql).toContain('"client_identities"."workspace_id" =');
    expect(sql).toContain('"client_identities"."client_id" =');
    expect(params).toEqual(expect.arrayContaining(["ws_a", "c1"]));
  });

  it("workspaceIdentitiesQuery", () => {
    const { sql, params } = workspaceIdentitiesQuery("ws_a").toSQL();
    expect(sql).toContain('"client_identities"."workspace_id" =');
    expect(params).toContain("ws_a");
  });

  it("removeClientIdentityQuery can only delete inside its workspace and client", () => {
    const { sql, params } = removeClientIdentityQuery("ws_a", "c1", "id1").toSQL();
    expect(sql).toContain('"client_identities"."workspace_id" =');
    expect(sql).toContain('"client_identities"."client_id" =');
    expect(params).toEqual(expect.arrayContaining(["ws_a", "c1", "id1"]));
  });

  it("competitor brands and scan targets are workspace scoped", () => {
    const brands = competitorBrandsQuery("ws_a").toSQL();
    expect(brands.sql).toContain('"platina_brands"."workspace_id" =');
    expect(brands.params).toEqual(expect.arrayContaining(["ws_a", "competitor"]));
    const specs = brandScanTargetsQuery("ws_a").toSQL();
    expect(specs.sql).toContain('"platina_scan_specs"."workspace_id" =');
  });
});

describe("buildKnownParties", () => {
  it("names a competitor from its homepage, handles and LinkedIn scan targets", () => {
    const parties = buildKnownParties(
      [{ id: "t", name: "Thermo Fisher Scientific", homepageUrl: "https://www.thermofisher.com", handles: {} }],
      [
        {
          brandId: "t",
          targets: [
            { kind: "social_posts", value: "linkedin:@thermo-fisher-scientific" },
            { kind: "ad_library", value: "https://www.facebook.com/ads/library/?q=thermo" },
          ],
        },
        { brandId: "other", targets: [{ kind: "social_posts", value: "linkedin:@agilent-technologies" }] },
      ],
    );
    expect(parties).toEqual([
      {
        name: "Thermo Fisher Scientific",
        identities: [
          { kind: "domain", value: "thermofisher.com" },
          { kind: "linkedin", value: "company/thermo-fisher-scientific" },
        ],
      },
    ]);
  });
});
