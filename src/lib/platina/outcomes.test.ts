import { describe, expect, it } from "vitest";
import {
  leadQualityScore,
  outcomeRowHash,
  parseOutcomeCsv,
} from "./outcomes";

const HEADER =
  "leads,qualified_leads,conversion_rate,pipeline_contribution,receipt_id";

describe("parseOutcomeCsv", () => {
  it("parses a valid sheet", () => {
    const result = parseOutcomeCsv(
      `${HEADER}\n42,17,0.40,185000,rec-1\n10,2,0.20,5000,`,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      leads: 42,
      qualifiedLeads: 17,
      conversionRate: 0.4,
      pipelineContribution: 185000,
      receiptId: "rec-1",
    });
  });

  it("rejects a bad header with the missing columns named", () => {
    const result = parseOutcomeCsv("leads,conversion_rate\n42,0.4");
    expect(result.rows).toEqual([]);
    expect(result.errors[0]).toContain("qualified_leads");
  });

  it("rejects unknown columns rather than guessing", () => {
    const result = parseOutcomeCsv(`${HEADER},mystery\n42,17,0.4,1000,,x`);
    expect(result.errors[0]).toContain("mystery");
  });

  it("reports bad rows with line numbers and keeps the good ones", () => {
    const result = parseOutcomeCsv(
      `${HEADER}\n42,17,0.40,185000,\noops,2,0.20,5000,\n10,99,0.20,5000,`,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain("line 3");
    expect(result.errors[1]).toContain("line 4");
  });

  it("qualified cannot exceed leads", () => {
    const result = parseOutcomeCsv(`${HEADER}\n10,50,0.2,1000,`);
    expect(result.rows).toEqual([]);
    expect(result.errors[0]).toContain("qualified_leads");
  });
});

describe("outcomeRowHash", () => {
  it("is stable for identical rows and differs on any field", () => {
    const row = { leads: 42, qualifiedLeads: 17, conversionRate: 0.4 };
    expect(outcomeRowHash(row)).toBe(outcomeRowHash({ ...row }));
    expect(outcomeRowHash(row)).not.toBe(
      outcomeRowHash({ ...row, leads: 43 }),
    );
  });
});

describe("leadQualityScore", () => {
  it("weights qualified ratio at half", () => {
    const score = leadQualityScore({ leads: 10, qualifiedLeads: 10 });
    expect(score).toBe(0.5);
  });

  it("caps conversion and pipeline contributions", () => {
    const score = leadQualityScore({
      leads: 10,
      qualifiedLeads: 10,
      conversionRate: 2, // >100% input is capped
      pipelineContribution: 500_000,
    });
    expect(score).toBe(1);
  });

  it("zero leads scores zero, not NaN", () => {
    expect(leadQualityScore({ leads: 0, qualifiedLeads: 0 })).toBe(0);
  });
});
