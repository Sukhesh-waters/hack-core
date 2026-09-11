import { beforeEach, describe, expect, it } from "vitest";
import {
  assertApproved,
  getAdapter,
  listAdapterKeys,
  registerAdapter,
  runApprovedScan,
  type ApprovedScanSpec,
} from "./registry";

const spec = (status: ApprovedScanSpec["status"] = "approved"): ApprovedScanSpec => ({
  id: "s1",
  workspaceId: "w1",
  status,
  targets: [{ kind: "competitor_site", value: "https://example.com" }],
});

describe("signal adapter registry", () => {
  beforeEach(() => {
    registerAdapter({
      key: "apify",
      fetch: async (s) => [
        {
          sourceUrl: s.targets[0]?.value ?? "",
          body: "public page",
          adapter: "apify",
        },
      ],
    });
  });

  it("refuses a fetch without an approved spec", async () => {
    expect(() => assertApproved(spec("draft"))).toThrow(/not approved/);
    await expect(runApprovedScan(spec("draft"))).rejects.toThrow(/not approved/);
  });

  it("runs through the registered adapter", async () => {
    const docs = await runApprovedScan(spec("approved"));
    expect(docs).toHaveLength(1);
    expect(docs[0].adapter).toBe("apify");
  });

  it("can swap adapters without a schema change", () => {
    registerAdapter({
      key: "web",
      fetch: async () => [{ sourceUrl: "x", body: "own-code", adapter: "web" }],
    });
    expect(listAdapterKeys()).toEqual(expect.arrayContaining(["apify", "web"]));
    expect(getAdapter("web")?.key).toBe("web");
  });
});
