import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePostsCsv } from "./csv-import";
import { buildImportPlan } from "./import-pipeline";

/**
 * End-to-end (offline) proof over the checked-in demo fixture: parse →
 * plan → score, exercising the skip, unscored, and min-N paths the manual
 * verification checklist relies on.
 */
describe("fixtures/sample-posts.csv", () => {
  const csv = readFileSync(
    join(__dirname, "../../fixtures/sample-posts.csv"),
    "utf8",
  );
  const { rows, skipped } = parsePostsCsv(csv);
  const planned = buildImportPlan({
    workspaceId: "ws_demo",
    clientId: "client_demo",
    importJobId: "job_demo",
    rows,
    meta: rows.map(() => null),
    existingBaseline: [],
    now: new Date("2026-07-04T00:00:00Z"),
  });

  it("imports 23 rows and skips the bad-date row", () => {
    expect(rows).toHaveLength(23);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toContain("postedAt");
  });

  it("scores 22 rows and leaves the reach-less row unscored", () => {
    expect(planned.filter((p) => p.scoreStatus === "scored")).toHaveLength(22);
    expect(planned.filter((p) => p.scoreStatus === "unscored")).toHaveLength(1);
    expect(
      planned.filter((p) => p.scoreStatus === "insufficient_baseline"),
    ).toHaveLength(0);
  });

  it("produces both up and down directions across the fixture", () => {
    const directions = new Set(
      planned.map((p) => p.direction).filter(Boolean),
    );
    expect(directions.has("up")).toBe(true);
    expect(directions.has("down")).toBe(true);
  });
});
