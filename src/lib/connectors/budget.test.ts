import { describe, expect, it } from "vitest";
import {
  checkBudget,
  estimateCredits,
  type BudgetRecord,
} from "./budget";

const baseBudget: BudgetRecord = {
  workspaceId: "ws_1",
  orgId: "org_1",
  dailyCreditsUsed: 0,
  monthlyCreditsUsed: 0,
};

describe("checkBudget", () => {
  it("allows scraping when under both caps", () => {
    const result = checkBudget(baseBudget);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("ok");
  });

  it("soft-warns when daily cap exceeded but still allows", () => {
    const result = checkBudget({ ...baseBudget, dailyCreditsUsed: 55 });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("daily_soft_cap_exceeded");
  });

  it("hard-blocks when monthly ceiling exceeded", () => {
    const result = checkBudget({ ...baseBudget, monthlyCreditsUsed: 1001 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("monthly_hard_ceiling_exceeded");
  });

  it("monthly ceiling takes precedence over daily soft cap", () => {
    const result = checkBudget({
      ...baseBudget,
      dailyCreditsUsed: 999,
      monthlyCreditsUsed: 1001,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("monthly_hard_ceiling_exceeded");
  });

  it("respects custom limits", () => {
    const result = checkBudget(
      { ...baseBudget, dailyCreditsUsed: 15 },
      { dailySoftCap: 10, monthlyHardCeiling: 500 },
    );
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("daily_soft_cap_exceeded");
    expect(result.dailyCap).toBe(10);
    expect(result.monthlyCap).toBe(500);
  });
});

describe("estimateCredits", () => {
  it("estimates credits for known actor types", () => {
    expect(estimateCredits("posts", 100)).toBe(3);
    expect(estimateCredits("profile", 10)).toBe(1);
    expect(estimateCredits("tiktok_posts", 50)).toBe(2);
  });

  it("falls back to default rate for unknown actor", () => {
    expect(estimateCredits("unknown_actor", 100)).toBe(3);
  });

  it("returns at least 1 credit for any non-zero result count", () => {
    expect(estimateCredits("posts", 1)).toBeGreaterThanOrEqual(1);
  });
});
