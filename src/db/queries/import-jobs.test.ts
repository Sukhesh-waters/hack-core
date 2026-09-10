import { describe, expect, it } from "vitest";
import { IMPORT_TIMEOUT_ERROR, failStalledImportJobsQuery } from "./import-jobs";

describe("failStalledImportJobsQuery (cron sweep, cross-workspace by design)", () => {
  const cutoff = new Date("2026-07-20T00:00:00.000Z");
  const { sql, params } = failStalledImportJobsQuery(cutoff).toSQL();

  it("sets status to failed with the re-upload error text", () => {
    expect(sql).toContain('set "status" =');
    expect(sql).toContain('"error" =');
    expect(params).toContain("failed");
    expect(params).toContain(IMPORT_TIMEOUT_ERROR);
  });

  it("guards on status='processing' so it can't race a job that just finished", () => {
    expect(sql).toContain('"status" =');
    expect(params).toContain("processing");
  });

  it("compares created_at against the cutoff timestamp", () => {
    expect(sql).toContain('"created_at" <');
    expect(params).toContain(cutoff.toISOString());
  });

  it("returns the flipped row ids", () => {
    expect(sql).toContain("returning");
  });
});
