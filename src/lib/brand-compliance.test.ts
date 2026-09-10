import { describe, expect, it } from "vitest";
import { evaluateBrandCompliance } from "./brand-compliance";
import type { BrandContext } from "@/db/schema";

const mockBrand: BrandContext = {
  brandType: "educational_authority",
  mission: "Empowering developers to build real-time AI tools.",
  showcaseTheme: "Modern Dark",
  colors: ["#10B981", "#6366F1"],
  tones: ["authoritative", "visionary", "concise"],
  pillars: ["realtime", "agents"],
  bannedWords: ["guarantee", "cheap", "click here"],
  avoidTopics: ["competitor prices", "gambling"],
  typography: "Display Serif",
  logoUrl: null,
  links: {},
};

describe("evaluateBrandCompliance", () => {
  it("returns 100% score for clean text without violations", () => {
    const text = "Discover modern AI agents designed to automate agency workflows.";
    const result = evaluateBrandCompliance(text, mockBrand);
    expect(result.score).toBe(100);
    expect(result.violations).toHaveLength(0);
  });

  it("detects banned words and deducts score", () => {
    const text = "We guarantee you will love our cheap solutions. Click here to buy!";
    const result = evaluateBrandCompliance(text, mockBrand);
    expect(result.violations).toHaveLength(3);
    expect(result.score).toBeLessThan(50);
    expect(result.violations.map((v) => v.matchedText)).toEqual(
      expect.arrayContaining(["guarantee", "cheap", "click here"]),
    );
  });

  it("detects avoid topics", () => {
    const text = "Check out our competitor prices comparison for better deals.";
    const result = evaluateBrandCompliance(text, mockBrand);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].type).toBe("avoid_topic");
    expect(result.score).toBe(80);
  });

  it("handles null or undefined brand gracefully", () => {
    const text = "Some random text";
    const result = evaluateBrandCompliance(text, null);
    expect(result.score).toBe(100);
    expect(result.violations).toHaveLength(0);
  });
});
