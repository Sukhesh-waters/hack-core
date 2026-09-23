import { describe, expect, it } from "vitest";
import { ago, dailyStrip } from "./ops-view";

const NOW = new Date("2026-09-23T12:00:00Z");

describe("dailyStrip", () => {
  it("keeps the worst status per day, oldest first, null for days without a run", () => {
    const strip = dailyStrip(
      [
        { checkId: "budgets", status: "ok", checkedAt: new Date("2026-09-23T09:15:00Z") },
        { checkId: "budgets", status: "down", checkedAt: new Date("2026-09-23T10:15:00Z") },
        { checkId: "budgets", status: "ok", checkedAt: new Date("2026-09-23T11:15:00Z") },
        { checkId: "budgets", status: "degraded", checkedAt: new Date("2026-09-21T05:15:00Z") },
        { checkId: "budgets", status: "ok", checkedAt: new Date("2026-09-10T05:15:00Z") },
      ],
      NOW,
    );
    expect(strip.get("budgets")).toEqual([null, null, null, null, "degraded", null, "down"]);
  });
});

describe("ago", () => {
  it("says how long ago in plain words", () => {
    expect(ago(new Date(NOW.getTime() - 20_000), NOW)).toBe("just now");
    expect(ago(new Date(NOW.getTime() - 5 * 60_000), NOW)).toBe("5 min ago");
    expect(ago(new Date(NOW.getTime() - 3 * 3_600_000), NOW)).toBe("3 h ago");
    expect(ago(new Date(NOW.getTime() - 26 * 3_600_000), NOW)).toBe("yesterday");
  });
});
