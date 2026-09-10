import { describe, expect, it } from "vitest";
import { parsePostsCsv } from "./csv-import";

const META_HEADER =
  "Post ID,Description,Publish time,Reach,Likes,Comments,Shares,Saves";

describe("parsePostsCsv", () => {
  it("parses Meta-style export headers into canonical fields", () => {
    const { rows, skipped } = parsePostsCsv(
      `${META_HEADER}\n17890,Summer launch reel,2026-05-01,12000,900,40,25,60\n`,
    );
    expect(skipped).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      externalId: "17890",
      caption: "Summer launch reel",
      reach: 12000,
      likes: 900,
      comments: 40,
      shares: 25,
      saves: 60,
    });
    expect(rows[0].postedAt.getUTCFullYear()).toBe(2026);
  });

  it("handles quoted captions containing commas", () => {
    const { rows } = parsePostsCsv(
      `${META_HEADER}\n1,"Hello, world — big news",2026-05-01,100,10,1,0,2\n`,
    );
    expect(rows[0].caption).toBe("Hello, world — big news");
  });

  it("parses thousands separators in numeric columns", () => {
    const { rows } = parsePostsCsv(
      `${META_HEADER}\n1,post,2026-05-01,"12,345","1,000",5,0,0\n`,
    );
    expect(rows[0].reach).toBe(12345);
    expect(rows[0].likes).toBe(1000);
  });

  it("skips rows with an unparseable date, reporting the CSV line number", () => {
    const { rows, skipped } = parsePostsCsv(
      `${META_HEADER}\n1,good,2026-05-01,100,10,1,0,2\n2,bad,not-a-date,100,10,1,0,2\n`,
    );
    expect(rows).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].line).toBe(3);
  });

  it("treats blank numeric cells as absent, not zero", () => {
    const { rows } = parsePostsCsv(
      `${META_HEADER}\n1,post,2026-05-01,,10,1,0,2\n`,
    );
    expect(rows[0].reach).toBeUndefined();
  });

  it("returns empty results for an empty file", () => {
    expect(parsePostsCsv("")).toEqual({ rows: [], skipped: [] });
  });
});
