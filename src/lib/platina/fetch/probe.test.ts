import { describe, expect, it } from "vitest";
import { probeSource, type ProbeFetch } from "./probe";

const fakeFetch = (
  status: number,
  headers: Record<string, string> = {},
): ProbeFetch => {
  return async () => ({
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  });
};

const failingFetch: ProbeFetch = async () => {
  throw new Error("network down");
};

describe("probeSource", () => {
  it("304 means unchanged — no fetch, no spend", async () => {
    const result = await probeSource(
      "https://example.com/page",
      { etag: '"v1"', lastModified: null },
      fakeFetch(304),
    );
    expect(result.outcome).toBe("unchanged");
  });

  it("a new ETag means changed, and returns the fresh validators", async () => {
    const result = await probeSource(
      "https://example.com/page",
      { etag: '"v1"', lastModified: null },
      fakeFetch(200, { etag: '"v2"' }),
    );
    expect(result).toEqual({
      outcome: "changed",
      etag: '"v2"',
      lastModified: null,
    });
  });

  it("a newer Last-Modified means changed", async () => {
    const result = await probeSource(
      "https://example.com/page",
      { etag: null, lastModified: "Mon, 01 Sep 2026 00:00:00 GMT" },
      fakeFetch(200, { "last-modified": "Thu, 17 Sep 2026 00:00:00 GMT" }),
    );
    expect(result.outcome).toBe("changed");
  });

  it("identical validators mean unchanged", async () => {
    const result = await probeSource(
      "https://example.com/page",
      { etag: '"v1"', lastModified: "Mon, 01 Sep 2026 00:00:00 GMT" },
      fakeFetch(200, {
        etag: '"v1"',
        "last-modified": "Mon, 01 Sep 2026 00:00:00 GMT",
      }),
    );
    expect(result.outcome).toBe("unchanged");
  });

  it("no validators means unsupported — the adaptive cadence takes over", async () => {
    const result = await probeSource(
      "https://example.com/page",
      { etag: null, lastModified: null },
      fakeFetch(200),
    );
    expect(result.outcome).toBe("unsupported");
  });

  it("the first probe with null priors reports changed so the baseline fetch runs", async () => {
    const result = await probeSource(
      "https://example.com/page",
      { etag: null, lastModified: null },
      fakeFetch(200, { etag: '"v1"' }),
    );
    expect(result.outcome).toBe("changed");
  });

  it("a network failure never blocks fetching — unsupported", async () => {
    const result = await probeSource(
      "https://example.com/page",
      { etag: '"v1"', lastModified: null },
      failingFetch,
    );
    expect(result.outcome).toBe("unsupported");
  });

  it("server errors are unsupported, never a fetch blocker", async () => {
    const result = await probeSource(
      "https://example.com/page",
      { etag: null, lastModified: null },
      fakeFetch(500),
    );
    expect(result.outcome).toBe("unsupported");
  });
});
