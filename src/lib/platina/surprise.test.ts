import { describe, expect, it } from "vitest";
import {
  updateExpectation,
  sd,
  novelty,
  expectationKey,
  hasDateOrPrice,
  decideSurprise,
  type Expectation,
} from "./surprise";
import { words, similarity } from "./consolidate";

describe("Welford running expectation", () => {
  it("matches the classic two-pass mean and sum-of-squares example", () => {
    const data = [2, 4, 4, 4, 5, 5, 7, 9]; // population mean 5, sum of squared deviations 32
    let e: Expectation | null = null;
    for (const x of data) e = updateExpectation(e, x);
    expect(e!.n).toBe(8);
    expect(e!.mean).toBeCloseTo(5, 10);
    expect(e!.m2).toBeCloseTo(32, 8);
    expect(sd(e!)).toBeCloseTo(Math.sqrt(32 / 7), 10);
  });

  it("agrees with a fresh two-pass computation for an untidy series", () => {
    const data = [12.5, 7.25, -3, 42, 8.1, 0, 15.75, 22.2, -9.4, 31];
    let e: Expectation | null = null;
    for (const x of data) e = updateExpectation(e, x);
    const n = data.length;
    const mean = data.reduce((a, b) => a + b, 0) / n;
    const m2 = data.reduce((sum, x) => sum + (x - mean) ** 2, 0);
    expect(e!.n).toBe(n);
    expect(e!.mean).toBeCloseTo(mean, 9);
    expect(e!.m2).toBeCloseTo(m2, 6);
  });

  it("sd is 0 (not NaN) for fewer than 2 observations", () => {
    expect(sd({ n: 0, mean: 0, m2: 0 })).toBe(0);
    expect(sd(updateExpectation(null, 7))).toBe(0);
  });
});

describe("novelty", () => {
  it("is 1 when there is no previous version to compare against", () => {
    expect(novelty("brand new content here", [])).toBe(1);
  });

  it("is 1 minus the Jaccard similarity against the closest-matching previous text (reusing consolidate.ts words()/similarity())", () => {
    const added = "Waters announces a new PFAS analysis workflow for regulated laboratories";
    const prevClose = "Waters announces a new PFAS testing workflow for regulated laboratories";
    const prevFar = "Completely unrelated careers page about benefits and holiday leave policy";
    const expected = 1 - similarity(words(added), words(prevClose));
    const result = novelty(added, [prevFar, prevClose]);
    expect(result).toBeCloseTo(expected, 10);
    expect(result).toBeLessThan(0.5); // nearly the same words as prevClose
  });

  it("is close to 1 when nothing in history shares vocabulary with the new text", () => {
    const result = novelty(
      "a wholly unrelated announcement about regulatory conferences in the gulf region",
      ["our careers page lists open roles in sales and support"],
    );
    expect(result).toBeGreaterThan(0.8);
  });
});

describe("hasDateOrPrice", () => {
  it("is true for a year-qualified date range (reuses events.ts findDateRanges)", () => {
    expect(hasDateOrPrice("Join us 26-28 October 2026 in Dubai for the show")).toBe(true);
  });

  it("is true for a price in common currency notations", () => {
    expect(hasDateOrPrice("Now available from $499 per month")).toBe(true);
    expect(hasDateOrPrice("Pricing starts at €1,250 per seat")).toBe(true);
    expect(hasDateOrPrice("Now £75 for the annual plan")).toBe(true);
  });

  it("is false for ordinary prose with neither a dated announcement nor a price", () => {
    expect(hasDateOrPrice("Our new workflow improves throughput for regulated laboratories")).toBe(false);
  });
});

describe("expectationKey", () => {
  it("builds the three documented key shapes", () => {
    expect(expectationKey.novelty("https://example.com/news")).toBe("nov:https://example.com/news");
    expect(expectationKey.engagement("brand-1")).toBe("eng:brand-1");
    expect(expectationKey.ads("brand-1")).toBe("ads:brand-1");
  });
});

describe("decideSurprise — cold start", () => {
  it("analyses when there is no expectation at all", () => {
    const result = decideSurprise({ expectation: null, observed: 5, floorSd: 0.05, docId: "doc-cold" });
    expect(result.action).toBe("analyse");
    expect(result.reason).toContain("not enough history");
    expect(result.deviation).toBeNull();
    expect(result.next).toEqual({ n: 1, mean: 5, m2: 0 });
  });

  it("analyses below minN however extreme the observation looks", () => {
    const e: Expectation = { n: 2, mean: 0, m2: 0 }; // below default minN (5)
    const result = decideSurprise({ expectation: e, observed: 1000, floorSd: 0.05, docId: "doc-extreme" });
    expect(result.action).toBe("analyse");
    expect(result.deviation).toBeNull();
  });

  it("never skips during cold start, across many ids (rules out the audit-sample path leaking in)", () => {
    for (let i = 0; i < 200; i += 1) {
      const result = decideSurprise({ expectation: null, observed: 5, floorSd: 0.05, docId: `doc-${i}` });
      expect(result.action).toBe("analyse");
    }
  });
});

describe("decideSurprise — rule overrides", () => {
  const warmUnsurprising: Expectation = { n: 50, mean: 0.1, m2: 0.02 }; // sd ~0.02: tight, low-deviation history

  it("firstSeen always analyses even against a warm, low-deviation expectation", () => {
    const result = decideSurprise({
      expectation: warmUnsurprising,
      observed: 0.1,
      floorSd: 0.05,
      firstSeen: true,
      docId: "x",
    });
    expect(result.action).toBe("analyse");
    expect(result.reason).toContain("first time");
  });

  it("a date or price in the change always analyses even against a warm, low-deviation expectation", () => {
    const result = decideSurprise({
      expectation: warmUnsurprising,
      observed: 0.1,
      floorSd: 0.05,
      hasDateOrPrice: true,
      docId: "y",
    });
    expect(result.action).toBe("analyse");
    expect(result.reason).toContain("date or a price");
  });
});

describe("decideSurprise — deviation math", () => {
  it("deviation is |observed - mean| / max(sd, floorSd), against the PRIOR expectation, and next folds the new observation in", () => {
    const e: Expectation = { n: 10, mean: 2, m2: 10 * 0.5 ** 2 };
    const result = decideSurprise({
      expectation: e,
      observed: 3,
      floorSd: 0.1,
      floor: 0.5,
      auditShare: 0,
      docId: "calc",
    });
    const expectedSd = Math.sqrt(e.m2 / (e.n - 1));
    const expectedDeviation = Math.abs(3 - 2) / Math.max(expectedSd, 0.1);
    expect(result.deviation).toBeCloseTo(expectedDeviation, 10);
    expect(result.action).toBe("analyse");
    expect(result.next.n).toBe(11);
    expect(result.next).not.toEqual(e); // the prior expectation itself is never mutated into the decision
  });

  it("stays below the floor and skips when the observation matches history closely", () => {
    const e: Expectation = { n: 20, mean: 0.5, m2: 19 * 0.05 ** 2 }; // sd = 0.05
    const result = decideSurprise({ expectation: e, observed: 0.51, floorSd: 0.02, auditShare: 0, docId: "close" });
    expect(result.deviation).toBeLessThan(1);
    expect(result.action).toBe("skip");
  });
});

describe("decideSurprise — the newsroom vs. the rotating widget", () => {
  it("NEWSROOM: real topic-to-topic spread in novelty still catches a genuinely unprecedented release", () => {
    // Six prior releases on a busy page: every one changed "a lot" in raw
    // text, which is why a magnitude filter would never flag anything here.
    // Novelty (word overlap with recent versions) has real spread instead —
    // some releases reuse more of the page's own boilerplate than others.
    const history = [0.55, 0.7, 0.6, 0.65, 0.58, 0.72];
    let e: Expectation | null = null;
    for (const n of history) e = updateExpectation(e, n);

    const result = decideSurprise({
      expectation: e,
      observed: 0.97, // a story unlike anything this page has recently covered
      floorSd: 0.05,
      auditShare: 0,
      docId: "newsroom-today",
    });
    expect(result.action).toBe("analyse");
    expect(result.reason).toBe("bigger than this page's usual change");
  });

  it("WIDGET: a rotating 'latest posts' block converges to low, tight novelty and is skipped once warm", () => {
    // The same handful of post titles reshuffled release after release:
    // novelty stays low and barely varies.
    const history = [0.04, 0.06, 0.03, 0.05, 0.04, 0.05, 0.06];
    let e: Expectation | null = null;
    for (const n of history) e = updateExpectation(e, n);

    const result = decideSurprise({
      expectation: e,
      observed: 0.05,
      floorSd: 0.05,
      auditShare: 0, // this test is about the skip, not the audit sample (see below)
      docId: "widget-today",
    });
    expect(result.action).toBe("skip");
    expect(result.reason).toBe("nothing unusual compared with this page's normal changes");
  });
});

describe("decideSurprise — audit sample", () => {
  it("is ~10% of would-skip documents over 10k ids, and deterministic per id", () => {
    const e: Expectation = { n: 50, mean: 0, m2: 0 }; // warm, zero variance: every call below is a would-skip case
    const total = 10_000;
    let audits = 0;
    for (let i = 0; i < total; i += 1) {
      const result = decideSurprise({ expectation: e, observed: 0, floorSd: 0.05, docId: `doc-${i}` });
      expect(["skip", "audit"]).toContain(result.action);
      if (result.action === "audit") audits += 1;
    }
    const share = audits / total;
    expect(share).toBeGreaterThan(0.1 - 0.015);
    expect(share).toBeLessThan(0.1 + 0.015);
  });

  it("gives the same id the same action every time (and audit documents still say nothing is wrong)", () => {
    const e: Expectation = { n: 50, mean: 0, m2: 0 };
    const first = decideSurprise({ expectation: e, observed: 0, floorSd: 0.05, docId: "doc-42" });
    const second = decideSurprise({ expectation: e, observed: 0, floorSd: 0.05, docId: "doc-42" });
    expect(first.action).toBe(second.action);
    if (first.action === "audit") expect(first.reason).toBe("checked anyway (spot check)");
  });

  it("respects a custom auditShare, including 0 (never audits)", () => {
    const e: Expectation = { n: 50, mean: 0, m2: 0 };
    for (let i = 0; i < 500; i += 1) {
      const result = decideSurprise({ expectation: e, observed: 0, floorSd: 0.05, auditShare: 0, docId: `z-${i}` });
      expect(result.action).toBe("skip");
    }
  });
});

describe("decideSurprise — never contains the internal vocabulary CLAUDE.md reserves", () => {
  it("no reason string anywhere uses the words 'surprise', 'predictive' or 'falsifier'", () => {
    const banned = /surprise|predictive|falsifier/i;
    const e: Expectation = { n: 50, mean: 0.5, m2: 50 * 0.1 ** 2 * 49 };
    const scenarios = [
      decideSurprise({ expectation: null, observed: 1, floorSd: 0.05, docId: "a" }),
      decideSurprise({ expectation: e, observed: 1, floorSd: 0.05, firstSeen: true, docId: "b" }),
      decideSurprise({ expectation: e, observed: 1, floorSd: 0.05, hasDateOrPrice: true, docId: "c" }),
      decideSurprise({ expectation: e, observed: 5, floorSd: 0.05, auditShare: 0, docId: "d" }),
      decideSurprise({ expectation: e, observed: 0.5, floorSd: 0.05, auditShare: 0, docId: "e" }),
    ];
    for (const s of scenarios) expect(s.reason).not.toMatch(banned);
  });
});
