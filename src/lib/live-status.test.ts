import { describe, expect, it } from "vitest";
import { formatUpdatedAgo, isRecentlyUpdated } from "./live-status";

describe("isRecentlyUpdated", () => {
  it("is false when nothing has signaled yet", () => {
    expect(isRecentlyUpdated(null, 10_000)).toBe(false);
  });

  it("is true just after a signal", () => {
    expect(isRecentlyUpdated(10_000, 10_500)).toBe(true);
  });

  it("is false once the recent window has passed", () => {
    expect(isRecentlyUpdated(10_000, 15_000)).toBe(false);
  });
});

describe("formatUpdatedAgo", () => {
  it("returns empty when nothing has signaled yet", () => {
    expect(formatUpdatedAgo(null, 10_000)).toBe("");
  });

  it("reads as just now inside the first 5 seconds", () => {
    expect(formatUpdatedAgo(10_000, 13_000)).toBe("updated just now");
  });

  it("counts seconds between 5s and 60s", () => {
    expect(formatUpdatedAgo(0, 42_000)).toBe("updated 42s ago");
  });

  it("counts minutes between 60s and an hour", () => {
    expect(formatUpdatedAgo(0, 5 * 60_000)).toBe("updated 5m ago");
  });

  it("counts hours past an hour", () => {
    expect(formatUpdatedAgo(0, 3 * 60 * 60_000)).toBe("updated 3h ago");
  });

  it("never reports negative time for a clock that hasn't advanced", () => {
    expect(formatUpdatedAgo(10_000, 10_000)).toBe("updated just now");
  });
});
