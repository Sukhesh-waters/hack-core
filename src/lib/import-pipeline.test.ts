import { describe, expect, it } from "vitest";
import {
  buildImportPlan,
  IMPORT_STALE_MS,
  importJobDisplayStatus,
} from "./import-pipeline";
import { MIN_BASELINE_N, type BaselinePoint } from "./scoring";
import type { ParsedPostRow } from "./csv-import";

const NOW = new Date("2026-07-04T00:00:00Z");
const IDS = { workspaceId: "ws_1", clientId: "client_1", importJobId: "job_1" };

function row(overrides: Partial<ParsedPostRow> = {}): ParsedPostRow {
  return {
    caption: "a post",
    postedAt: new Date("2026-06-01T00:00:00Z"),
    reach: 1000,
    likes: 100,
    ...overrides,
  };
}

function plan(rows: ParsedPostRow[], existingBaseline: BaselinePoint[] = []) {
  return buildImportPlan({
    ...IDS,
    rows,
    meta: rows.map(() => null),
    existingBaseline,
    now: NOW,
  });
}

describe("buildImportPlan", () => {
  it("stamps workspace, client, job, and first_party source on every row", () => {
    const [planned] = plan([row()]);
    expect(planned).toMatchObject({
      workspaceId: "ws_1",
      clientId: "client_1",
      importJobId: "job_1",
      source: "first_party",
      engagementRate: 0.1,
    });
  });

  it("min-N gate: below threshold every row is insufficient_baseline, never scored", () => {
    const planned = plan(
      Array.from({ length: MIN_BASELINE_N - 1 }, () => row()),
    );
    for (const p of planned) {
      expect(p.scoreStatus).toBe("insufficient_baseline");
      expect(p.zScore).toBeNull();
      expect(p.direction).toBeNull();
    }
  });

  it("scores rows once incoming + existing baseline clears the gate", () => {
    const planned = plan(
      Array.from({ length: MIN_BASELINE_N }, (_, i) =>
        row({ likes: 50 + i * 10 }),
      ),
    );
    expect(planned.every((p) => p.scoreStatus === "scored")).toBe(true);
  });

  it("rows without positive reach are unscored — no metric, no fake score", () => {
    const planned = plan([
      row({ reach: undefined }),
      ...Array.from({ length: MIN_BASELINE_N }, () => row()),
    ]);
    expect(planned[0].scoreStatus).toBe("unscored");
    expect(planned[0].engagementRate).toBeNull();
  });

  it("attaches normalization meta by row position", () => {
    const rows = [row(), row()];
    const planned = buildImportPlan({
      ...IDS,
      rows,
      meta: [null, { format: "reel", topics: ["launch"] }],
      existingBaseline: [],
      now: NOW,
    });
    expect(planned[0].format).toBeNull();
    expect(planned[1].format).toBe("reel");
    expect(planned[1].topics).toEqual(["launch"]);
  });
});

describe("importJobDisplayStatus", () => {
  const now = new Date("2026-07-04T12:00:00Z");

  it("shows processing while inside the stale window", () => {
    const createdAt = new Date(now.getTime() - IMPORT_STALE_MS + 1000);
    expect(importJobDisplayStatus({ status: "processing", createdAt }, now)).toBe(
      "processing",
    );
  });

  it("reports stalled once processing exceeds the stale window", () => {
    const createdAt = new Date(now.getTime() - IMPORT_STALE_MS - 1000);
    expect(importJobDisplayStatus({ status: "processing", createdAt }, now)).toBe(
      "stalled",
    );
  });

  it("passes complete and failed through unchanged regardless of age", () => {
    const old = new Date(now.getTime() - IMPORT_STALE_MS - 60_000);
    expect(importJobDisplayStatus({ status: "complete", createdAt: old }, now)).toBe(
      "complete",
    );
    expect(importJobDisplayStatus({ status: "failed", createdAt: old }, now)).toBe(
      "failed",
    );
  });
});
