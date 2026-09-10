import { describe, expect, it } from "vitest";
import { resolvePlanWrite } from "./apply-fields";

const current = { type: "reel", durationSec: 30 };

describe("resolvePlanWrite — partial apply", () => {
  it("applies only the selected subset, not everything proposed", () => {
    const result = resolvePlanWrite({
      current,
      proposed: {
        pillar: "Education",
        strategyNote: "Lead with the benefit",
        title: "New title",
      },
      selected: ["pillar", "title"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.write.applied).toEqual(["pillar", "title"]);
    expect(result.write.values.pillar).toBe("Education");
    expect(result.write.values.title).toBe("New title");
    expect(result.write.values.strategyNote).toBeUndefined();
  });

  it("ignores a selected field the revision never proposed", () => {
    const result = resolvePlanWrite({
      current,
      proposed: { pillar: "Education" },
      selected: ["pillar", "title"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.write.applied).toEqual(["pillar"]);
  });

  it("treats an empty selection as nothing to apply", () => {
    const result = resolvePlanWrite({
      current,
      proposed: { pillar: "Education" },
      selected: [],
    });
    expect(result.ok).toBe(false);
  });
});

/**
 * An AI suggestion must not be able to write a value a human couldn't type.
 * These reuse the same invariant the per-cell path enforces.
 */
describe("resolvePlanWrite — an AI value cannot bypass validation", () => {
  it("rejects a duration the row's type cannot carry", () => {
    const result = resolvePlanWrite({
      current: { type: "static", durationSec: null },
      proposed: { durationSec: 30 },
      selected: ["durationSec"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/video/i);
  });

  it("catches a type+duration pair that is only invalid together", () => {
    // Each field looks fine alone: `static` is a valid type, and 30 is a
    // valid duration for the row's CURRENT type of reel. Only the resulting
    // pair is a violation.
    const result = resolvePlanWrite({
      current,
      proposed: { type: "static", durationSec: 30 },
      selected: ["type", "durationSec"],
    });
    expect(result.ok).toBe(false);
  });

  /**
   * Caught in the browser, not by a unit test: every layer was individually
   * correct, but a reel carrying a duration could not be switched to static
   * at all. The planner got an error about a field they never touched.
   */
  it("clears the duration when moving to a non-video type", () => {
    const result = resolvePlanWrite({
      current,
      proposed: { type: "static" },
      selected: ["type"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.write.values.type).toBe("static");
    expect(result.write.values.durationSec).toBeNull();
  });

  it("clears the duration when moving to carousel too", () => {
    const result = resolvePlanWrite({
      current,
      proposed: { type: "carousel" },
      selected: ["type"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.write.values.durationSec).toBeNull();
  });

  it("keeps the duration when moving between video types", () => {
    const result = resolvePlanWrite({
      current,
      proposed: { type: "talking_head" },
      selected: ["type"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.write.values.durationSec).toBeUndefined();
  });

  it("allows switching to static when the duration is cleared with it", () => {
    const result = resolvePlanWrite({
      current,
      proposed: { type: "static", durationSec: null },
      selected: ["type", "durationSec"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.write.values.durationSec).toBeNull();
  });

  it("rejects an empty title", () => {
    const result = resolvePlanWrite({
      current,
      proposed: { title: "   " },
      selected: ["title"],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an unparseable due date", () => {
    const result = resolvePlanWrite({
      current,
      proposed: { dueAt: "not-a-date" },
      selected: ["dueAt"],
    });
    expect(result.ok).toBe(false);
  });

  it("never resolves a workflow-state field, even if one is proposed", () => {
    const result = resolvePlanWrite({
      current,
      proposed: {
        pillar: "Education",
        // a malformed or malicious revision payload
        status: "approved",
        productionStage: "done",
      } as never,
      selected: ["status", "productionStage", "pillar"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.write.applied).toEqual(["pillar"]);
    expect(result.write.values).not.toHaveProperty("status");
    expect(result.write.values).not.toHaveProperty("productionStage");
  });
});

describe("resolvePlanWrite — schedule moves stay off the content table", () => {
  it("routes scheduledFor separately from column writes", () => {
    const result = resolvePlanWrite({
      current,
      proposed: { scheduledFor: "2026-08-01T10:00:00.000Z" },
      selected: ["scheduledFor"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.write.scheduledFor).toBeInstanceOf(Date);
    expect(Object.keys(result.write.values)).toHaveLength(0);
  });
});
