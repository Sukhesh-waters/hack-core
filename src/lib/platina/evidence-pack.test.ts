import { describe, expect, it } from "vitest";
import { evidenceSourceName, packSchema, quoteHolds, triageItem, type PackBrand, type PackItem } from "./evidence-pack";

const brands: PackBrand[] = [
  { id: "w", name: "Waters", kind: "own_brand", homepageUrl: "https://www.waters.com" },
  { id: "a", name: "Agilent Technologies", kind: "competitor", homepageUrl: "https://www.agilent.com" },
];

const item = (over: Partial<PackItem> = {}): PackItem => ({
  url: "https://www.agilent.com/en/news/pfas-solutions",
  quote: "new PFAS testing workflow for water labs",
  why: "Competitor push on PFAS",
  subject: null,
  kind: "press_release",
  ...over,
});

describe("evidence pack (C8.0 F0.6)", () => {
  it("refuses the client's own pages: they are first-party, never public data", () => {
    const out = triageItem(item({ url: "https://www.waters.com/nextgen/us/en/events.html" }), brands);
    expect(out).toMatchObject({ action: "refuse", reason: expect.stringContaining("own-site pass") });
  });

  it("files a competitor's page under that competitor by its site", () => {
    expect(triageItem(item(), brands)).toMatchObject({ action: "read", brandId: "a", kind: "press_release" });
  });

  it("files a trade article by its stated subject", () => {
    const out = triageItem(item({ url: "https://www.labmate-online.com/news/x", subject: "agilent technologies", kind: "trade_editorial" }), brands);
    expect(out).toMatchObject({ action: "read", brandId: "a", brandName: "Agilent Technologies" });
  });

  it("refuses an untracked company rather than guessing", () => {
    const out = triageItem(item({ url: "https://www.example-lab.com/a", subject: "PerkinElmer" }), brands);
    expect(out).toMatchObject({ action: "refuse", reason: expect.stringContaining("not a tracked company") });
  });

  it("keeps a market page with no subject as workspace-wide", () => {
    const out = triageItem(item({ url: "https://www.selectscience.net/x", subject: null, kind: "trade_editorial" }), brands);
    expect(out).toMatchObject({ action: "read", brandId: null });
    expect(evidenceSourceName(null)).toBe("Market · operator evidence");
  });

  it("repairs a pasted URL before judging it", () => {
    expect(triageItem(item({ url: "www.agilent.com/en/news/x?utm_source=li" }), brands)).toMatchObject({
      action: "read",
      url: "https://www.agilent.com/en/news/x",
    });
  });

  it("keeps an item only when the quote is on the page as read", () => {
    const page = { title: "Agilent news", markdown: "Agilent announces a  new PFAS testing workflow\nfor water labs in the Gulf." };
    expect(quoteHolds("new PFAS testing workflow for water labs", page)).toBe(true);
    expect(quoteHolds("new PFAS testing workflow for food labs", page)).toBe(false);
  });

  it("rejects a pack without who gathered it, or with a too-short quote", () => {
    expect(packSchema.safeParse({ gatheredAt: "2026-09-23", items: [item()] }).success).toBe(false);
    expect(packSchema.safeParse({ gatheredBy: "Claude", gatheredAt: "2026-09-23", items: [item({ quote: "PFAS" })] }).success).toBe(false);
  });
});
