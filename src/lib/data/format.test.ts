import { describe, expect, it } from "vitest";
import { formatDue, formatHubTime } from "./format";

const NOW = new Date("2026-07-08T12:00:00");

describe("formatHubTime", () => {
  it("returns 'just now' under a minute", () => {
    expect(formatHubTime(new Date("2026-07-08T11:59:30"), NOW)).toBe(
      "just now",
    );
  });
  it("returns HH:MM same day", () => {
    expect(formatHubTime(new Date("2026-07-08T09:16:00"), NOW)).toBe("09:16");
  });
  it("returns month + day otherwise", () => {
    expect(formatHubTime(new Date("2026-07-01T09:00:00"), NOW)).toBe("Jul 1");
  });
});

describe("formatDue", () => {
  it("labels today and tomorrow", () => {
    expect(formatDue(new Date("2026-07-08T15:00:00"), NOW)).toBe(
      "Today 15:00",
    );
    expect(formatDue(new Date("2026-07-09T10:00:00"), NOW)).toBe(
      "Tomorrow 10:00",
    );
  });
  it("falls back to weekday + time", () => {
    expect(formatDue(new Date("2026-07-10T17:00:00"), NOW)).toBe("Fri 17:00");
  });
});
