import { describe, expect, it } from "vitest";
import { headerKey, parseCount, parseMetricsSheet, parseSheetDate, refKey, splitCsvLine } from "./metrics-import";

const TODAY = new Date("2026-09-22T00:00:00Z");

describe("cells", () => {
  it("splits quoted CSV and normalises headers", () => {
    expect(splitCsvLine('a,"b, c",d')).toEqual(["a", "b, c", "d"]);
    expect(splitCsvLine('"say ""hi""",x')).toEqual(['say "hi"', "x"]);
    expect(headerKey("﻿Post link")).toBe("post_link");
    expect(headerKey("Video Views")).toBe("video_views");
  });

  it("numbers: separators and percent ok; empty is null, never 0; junk is NaN", () => {
    expect(parseCount("1,234")).toBe(1234);
    expect(parseCount("12.5%")).toBe(12.5);
    expect(parseCount("")).toBeNull();
    expect(parseCount("-")).toBeNull();
    expect(parseCount("lots")).toBeNaN();
    expect(parseCount("-4")).toBeNaN();
  });

  it("dates: ISO and LinkedIn MM/DD/YYYY", () => {
    expect(parseSheetDate("2026-09-20")?.toISOString()).toBe("2026-09-20T00:00:00.000Z");
    expect(parseSheetDate("09/20/2026")?.toISOString()).toBe("2026-09-20T00:00:00.000Z");
    expect(parseSheetDate("20 Sept")).toBeNull();
  });

  it("refKey matches the same URL written two ways", () => {
    expect(refKey("https://www.linkedin.com/feed/update/urn:li:activity:1/?utm=x")).toBe(
      refKey("linkedin.com/feed/update/urn:li:activity:1"),
    );
  });
});

describe("parseMetricsSheet", () => {
  it("Platina layout", () => {
    const r = parseMetricsSheet(
      "creative,captured_at,impressions,engagements,leads\nhttps://x.com/p/1,2026-09-20,1000,30,\nc-2,,500,,2",
      TODAY,
    );
    expect(r.layout).toBe("platina");
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ ref: "https://x.com/p/1", impressions: 1000, engagements: 30, leads: null });
    expect(r.rows[1]).toMatchObject({ ref: "c-2", capturedAt: TODAY, engagements: null, leads: 2 });
  });

  it("LinkedIn export: engagements = reactions + comments + reposts; reposts are shares", () => {
    const r = parseMetricsSheet(
      'Update title,Post link,Created date,Impressions,Clicks,Reactions,Comments,Reposts\n"GLP-1, faster",https://www.linkedin.com/feed/update/urn:li:activity:1,09/18/2026,"2,400",40,55,6,3',
      TODAY,
    );
    expect(r.layout).toBe("linkedin");
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ impressions: 2400, clicks: 40, engagements: 64, shares: 3 });
    expect(r.rows[0].capturedAt.toISOString()).toBe("2026-09-18T00:00:00.000Z");
  });

  it("tab-separated paste from a spreadsheet works", () => {
    const r = parseMetricsSheet("creative\timpressions\tengagements\nc-1\t100\t5", TODAY);
    expect(r.rows[0]).toMatchObject({ ref: "c-1", impressions: 100, engagements: 5 });
  });

  it("bad rows are errors with line numbers; good rows still parse", () => {
    const r = parseMetricsSheet("creative,impressions,captured_at\nc-1,lots,2026-09-01\n,5,\nc-3,7,2026-13-45", TODAY);
    expect(r.rows).toEqual([]);
    expect(r.errors).toEqual([
      'line 2: "lots" in impressions is not a number',
      "line 3: no creative URL or id",
      'line 4: "2026-13-45" is not a date (use YYYY-MM-DD)',
    ]);
  });

  it("refuses a sheet with no creative column or no numbers", () => {
    expect(parseMetricsSheet("impressions\n5", TODAY).errors[0]).toContain("naming the creative");
    expect(parseMetricsSheet("creative,notes\nc-1,hi", TODAY).errors[0]).toContain("No number columns");
    expect(parseMetricsSheet("creative", TODAY).errors[0]).toContain("header row");
  });
});
