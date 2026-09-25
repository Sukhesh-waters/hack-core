import { describe, expect, it } from "vitest";
import { DAILY_ANALYSIS_CAP } from "../analysis";
import { MAX_PAGES_CEILING } from "./actors";
import {
  DAILY_CAP_REASON,
  DEFAULT_FIRST_PASS_PAGES,
  DEFAULT_WORKSPACE_DAY_CAP,
  MAX_PAGES_PER_TARGET,
  PAGES_PER_SOURCE_DAY,
  SOURCE_CAP_REASON,
  budgetForRun,
  describeBudget,
  firstPassRemaining,
} from "./budget";

/**
 * These are the relationships round 3 broke. They are assertions, not
 * documentation: an edit that starves the pipeline fails here.
 */
describe("the caps compose", () => {
  it("a client's first pass can cover several competitors at full depth", () => {
    // One client + four competitors, 25 pages each.
    expect(DEFAULT_FIRST_PASS_PAGES).toBeGreaterThanOrEqual(5 * MAX_PAGES_PER_TARGET);
  });

  it("the daily cap can still feed a full day of analysis", () => {
    // Collection must be able to produce what analysis is allowed to consume,
    // counting the first pass: a cap the pipeline can never reach is fiction.
    expect(DEFAULT_FIRST_PASS_PAGES).toBeGreaterThanOrEqual(DAILY_ANALYSIS_CAP);
  });

  it("one source cannot outspend the whole workspace's day", () => {
    expect(PAGES_PER_SOURCE_DAY).toBeLessThanOrEqual(DEFAULT_WORKSPACE_DAY_CAP * 2);
  });

  it("the per-target ceiling matches the actor module's", () => {
    expect(MAX_PAGES_PER_TARGET).toBe(MAX_PAGES_CEILING);
  });
});

describe("budgetForRun", () => {
  const full = { specRemaining: 48, workspaceRemaining: 40, firstPassRemaining: 150 };

  it("spends the first-pass allowance first, bypassing the daily cap", () => {
    const out = budgetForRun({ ...full, workspaceRemaining: 0 });
    expect(out.charge).toBe("first_pass");
    expect(out.pages).toBe(48);
    expect(out.reason).toContain("first pass");
  });

  it("is still bounded by the source's own daily cap during the first pass", () => {
    expect(budgetForRun({ ...full, specRemaining: 10 }).pages).toBe(10);
  });

  it("is bounded by what is left of the allowance", () => {
    const out = budgetForRun({ ...full, firstPassRemaining: 5 });
    expect(out.pages).toBe(5);
    expect(out.charge).toBe("first_pass");
  });

  it("falls back to the daily cap once the allowance is used up", () => {
    const out = budgetForRun({ ...full, firstPassRemaining: 0, workspaceRemaining: 12 });
    expect(out.charge).toBe("daily");
    expect(out.pages).toBe(12);
  });

  it("stops with the daily reason when the workspace is out for today", () => {
    const out = budgetForRun({ specRemaining: 48, workspaceRemaining: 0, firstPassRemaining: 0 });
    expect(out.pages).toBe(0);
    expect(out.reason).toBe(DAILY_CAP_REASON);
  });

  it("an operator seed grant bypasses the spent daily cap, within the source cap (C8.0)", () => {
    const out = budgetForRun({ specRemaining: 48, workspaceRemaining: 0, firstPassRemaining: 0, seedPages: 5 });
    expect(out).toEqual({ pages: 5, charge: "seed", reason: "operator seed run" });
    expect(budgetForRun({ specRemaining: 3, workspaceRemaining: 0, firstPassRemaining: 0, seedPages: 25 }).pages).toBe(3);
  });

  it("a seed grant never overrides the source cap, and the first pass still pays first", () => {
    expect(budgetForRun({ ...full, specRemaining: 0, seedPages: 10 }).reason).toBe(SOURCE_CAP_REASON);
    expect(budgetForRun({ ...full, seedPages: 10 }).charge).toBe("first_pass");
  });

  it("stops with the source reason when that one source is out", () => {
    const out = budgetForRun({ ...full, specRemaining: 0 });
    expect(out.pages).toBe(0);
    expect(out.reason).toBe(SOURCE_CAP_REASON);
  });

  it("treats negative input as zero rather than collecting backwards", () => {
    expect(budgetForRun({ specRemaining: -5, workspaceRemaining: -5, firstPassRemaining: -5 }).pages).toBe(0);
  });
});

describe("firstPassRemaining", () => {
  it("counts down from the allowance", () => {
    expect(firstPassRemaining(0)).toBe(DEFAULT_FIRST_PASS_PAGES);
    expect(firstPassRemaining(40)).toBe(DEFAULT_FIRST_PASS_PAGES - 40);
  });

  it("never goes below zero, and treats null as unused", () => {
    expect(firstPassRemaining(9999)).toBe(0);
    expect(firstPassRemaining(null)).toBe(DEFAULT_FIRST_PASS_PAGES);
  });

  it("respects a workspace-level allowance override", () => {
    expect(firstPassRemaining(10, 50)).toBe(40);
  });
});

describe("describeBudget", () => {
  it("tells the operator what a new client will cost before they approve it", () => {
    const line = describeBudget(150, 40);
    expect(line).toContain("150 pages");
    expect(line).toContain("40 a day");
  });

  it("says only the steady rate once the first pass is spent", () => {
    expect(describeBudget(0, 40)).not.toContain("first picture");
  });
});
