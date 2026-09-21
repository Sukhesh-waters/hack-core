/**
 * Ad Library fixes from the live Waters onboarding (2026-09-21): a keyword
 * search for "Waters" returned charter boats and cruises, and every ad was
 * stored without its text because Meta sends `snapshot.body` as `{ text }`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApprovedScanSpec } from "./registry";
import { adSearchTerm, adText, advertiserMatches, fetchViaWaters } from "./waters";

const SEARCH =
  "https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&search_type=keyword_unordered&media_type=all&q=Waters";

const ad = (page: string, body: string, id: string) => ({
  ad_archive_id: id,
  page_name: page,
  snapshot: { body: { text: body }, title: null, cta_text: "Learn more", cards: [] },
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("advertiser relevance", () => {
  it("reads the search term from the Ad Library URL", () => {
    expect(adSearchTerm(SEARCH)).toBe("Waters");
    expect(adSearchTerm("https://www.facebook.com/ads/library/?view_all_page_id=123")).toBeNull();
  });

  it("keeps the brand's own pages and drops pages that merely contain the word", () => {
    expect(advertiserMatches("Waters Corporation", "Waters")).toBe(true);
    expect(advertiserMatches("Waters", "Waters")).toBe(true);
    expect(advertiserMatches("waters india", "Waters")).toBe(true);
    expect(advertiserMatches("Blue Dolphin Charters", "Waters")).toBe(false);
    expect(advertiserMatches("Kauai Waters Tours", "Waters")).toBe(false);
    expect(advertiserMatches("Watershed Labs", "Waters")).toBe(false);
  });
});

describe("ad text", () => {
  it("reads body.text, headline, link description, cards and the CTA", () => {
    expect(
      adText({
        title: "Alliance iS HPLC",
        body: { text: "Fewer errors, more uptime." },
        link_description: "See the system",
        cards: [{ title: "Card", body: "Card body" }],
        cta_text: "Learn more",
      }),
    ).toBe("Alliance iS HPLC\n\nFewer errors, more uptime.\n\nSee the system\n\nCard\n\nCard body\n\nCall to action: Learn more");
  });

  it("drops dynamic-product placeholders and empty parts", () => {
    expect(adText({ body: { text: "{{product.brand}}" }, title: null })).toBe("");
  });
});

describe("fetchViaWaters on a keyword ad search", () => {
  const spec: ApprovedScanSpec = {
    id: "s1",
    workspaceId: "w1",
    status: "approved",
    targets: [{ kind: "ad_library", value: SEARCH }],
  };

  it("stores only the brand's ads, with their words", async () => {
    vi.stubEnv("APIFY_TOKEN", "t");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => [
          ad("Blue Dolphin Charters", "30 years of navigating Kauaʻi's waters", "1"),
          ad("Waters Corporation", "Meet the Alliance iS Bio HPLC System.", "2"),
        ],
      })),
    );
    const outcome = await fetchViaWaters(spec);
    expect(outcome.docs).toHaveLength(1);
    expect(outcome.docs[0].title).toBe("Waters Corporation · 2");
    expect(outcome.docs[0].body).toContain("Alliance iS Bio HPLC");
  });

  it("when none of the advertisers is the brand, says exactly that", async () => {
    vi.stubEnv("APIFY_TOKEN", "t");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [ad("Peony Cruises", "Sail the waters", "3")] })),
    );
    await expect(fetchViaWaters(spec)).rejects.toThrow(/no active ads by an advertiser named "Waters"/);
  });
});
