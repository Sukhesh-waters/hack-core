import { describe, expect, it } from "vitest";
import { expectationQuery, upsertExpectationQuery } from "./platina-expectations";

describe("B4 expectation queries filter workspace_id in the generated SQL", () => {
  it("expectationQuery filters by workspace AND key, and reads only n/mean/m2", () => {
    const { sql, params } = expectationQuery("ws_a", "nov:https://example.com/news").toSQL();
    expect(sql).toContain('"platina_expectations"."workspace_id" = ');
    expect(sql).toContain('"platina_expectations"."key" = ');
    expect(sql).toMatch(/select\s+"n",\s*"mean",\s*"m2"/i);
    expect(params).toEqual(expect.arrayContaining(["ws_a", "nov:https://example.com/news"]));
  });

  it("upsertExpectationQuery is an insert with ON CONFLICT (workspace_id, key) DO UPDATE", () => {
    const { sql, params } = upsertExpectationQuery("ws_a", "eng:brand-1", { n: 6, mean: 1.2, m2: 0.4 }).toSQL();
    expect(sql).toMatch(/^insert into/i);
    expect(sql).toMatch(/on conflict/i);
    expect(sql).toMatch(/do update/i);
    expect(sql).toContain('"workspace_id"');
    expect(sql).toContain('"key"');
    expect(params).toEqual(expect.arrayContaining(["ws_a", "eng:brand-1", 6, 1.2, 0.4]));
  });

  it("upsertExpectationQuery targets exactly the (workspace_id, key) unique index, not just key", () => {
    const { sql } = upsertExpectationQuery("ws_a", "ads:brand-1", { n: 1, mean: 10, m2: 0 }).toSQL();
    // drizzle renders the conflict target columns in order inside the ON CONFLICT clause.
    expect(sql.toLowerCase()).toMatch(/on conflict \("workspace_id","key"\)/);
  });
});
