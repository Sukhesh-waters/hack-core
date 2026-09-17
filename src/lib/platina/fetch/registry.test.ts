import { beforeEach, describe, expect, it } from "vitest";
import {
  assertApproved,
  getAdapter,
  listAdapterKeys,
  registerAdapter,
  runApprovedScan,
  type ScanSpecCandidate,
} from "./registry";

const spec = (
  status: ScanSpecCandidate["status"] = "approved",
): ScanSpecCandidate => ({
  id: "s1",
  workspaceId: "w1",
  status,
  targets: [{ kind: "competitor_site", value: "https://example.com" }],
});

describe("signal adapter registry", () => {
  beforeEach(() => {
    registerAdapter({
      key: "apify",
      fetch: async (s) => ({
        docs: [
          {
            sourceUrl: s.targets[0]?.value ?? "",
            body: "public page",
            adapter: "apify",
          },
        ],
        failures: [],
      }),
    });
  });

  it("refuses a fetch without an approved spec", async () => {
    expect(() => assertApproved(spec("draft"))).toThrow(/not approved/);
    await expect(runApprovedScan(spec("draft"))).rejects.toThrow(/not approved/);
  });

  it("runs through the registered adapter", async () => {
    const outcome = await runApprovedScan(spec("approved"));
    expect(outcome.docs).toHaveLength(1);
    expect(outcome.docs[0].adapter).toBe("apify");
    expect(outcome.failures).toEqual([]);
  });

  it("can swap adapters without a schema change", () => {
    registerAdapter({
      key: "test-adapter",
      fetch: async () => ({
        docs: [{ sourceUrl: "x", body: "own-code", adapter: "test-adapter" }],
        failures: [],
      }),
    });
    expect(listAdapterKeys()).toEqual(
      expect.arrayContaining(["apify", "test-adapter"]),
    );
    expect(getAdapter("test-adapter")?.key).toBe("test-adapter");
  });

  it("rejects the unshipped web adapter at registration and at run time", async () => {
    expect(() =>
      registerAdapter({
        key: "web",
        fetch: async () => ({ docs: [], failures: [] }),
      }),
    ).toThrow(/not shipped/);
    await expect(runApprovedScan(spec("approved"), "web")).rejects.toThrow(
      /not shipped/,
    );
  });
});
