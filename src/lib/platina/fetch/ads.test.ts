/**
 * Ad Library fixes from the live Waters onboarding (2026-09-21): a keyword
 * search for "Waters" returned charter boats and cruises, and every ad was
 * stored without its text because Meta sends `snapshot.body` as `{ text }`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApprovedScanSpec } from "./registry";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adCountries, adEndedAt, adStartedAt } from "../interest-extract";
import { LINKEDIN_AD_LIBRARY_ACTOR, linkedInAdSearchUrl, planTarget } from "./actors";
import { adSearchTerm, adText, advertiserMatches, fetchViaWaters, mapLinkedInAdItem } from "./waters";

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

  it("when none of the advertisers is the brand, that is an answer (0 active ads), not a failure", async () => {
    // C7.1 found it live: counted as a failure, the daily Waters ad-library
    // source looked due again at once and ran 6 paid times in 30 minutes.
    vi.stubEnv("APIFY_TOKEN", "t");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [ad("Peony Cruises", "Sail the waters", "3")] })),
    );
    const outcome = await fetchViaWaters(spec);
    expect(outcome.docs).toEqual([]);
    expect(outcome.failures).toEqual([]);
    expect(outcome.empty).toEqual([
      { target: SEARCH, reason: 'no active ads by an advertiser named "Waters" (other advertisers matching the word were ignored)' },
    ]);
  });
});

describe("LinkedIn Ad Library (C8.3)", () => {
  const LI_SEARCH = "https://www.linkedin.com/ad-library/search?accountOwner=Waters%20Corporation";
  const live = JSON.parse(
    readFileSync(join(__dirname, "fixtures", "linkedin-ad-library-detail-live-2026-09-24.json"), "utf8"),
  ) as Record<string, unknown>[];
  const spec: ApprovedScanSpec = {
    id: "s2",
    workspaceId: "w1",
    status: "approved",
    targets: [{ kind: "ad_library", value: LI_SEARCH, maxPages: 20 }],
  };

  it("plans the LinkedIn actor with details, one ad per page of budget", () => {
    const plan = planTarget({ kind: "ad_library", value: LI_SEARCH }, 20);
    expect(plan.actor).toBe(LINKEDIN_AD_LIBRARY_ACTOR);
    expect(plan.input).toEqual({ startUrls: [{ url: LI_SEARCH }], resultsLimit: 20, skipDetails: false });
    expect(adSearchTerm(LI_SEARCH)).toBe("Waters Corporation");
    expect(linkedInAdSearchUrl("Thermo Fisher Scientific")).toBe(
      "https://www.linkedin.com/ad-library/search?accountOwner=Thermo%20Fisher%20Scientific",
    );
  });

  it("keeps only the searched advertiser's ads, keyed by their library URL, with dates and countries", async () => {
    vi.stubEnv("APIFY_TOKEN", "t");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => [...live, { ...live[0], adId: "9", adLibraryUrl: "https://www.linkedin.com/ad-library/detail/9", advertiserName: "Kumulus Water" }],
      })),
    );
    const outcome = await fetchViaWaters(spec);
    expect(outcome.docs).toHaveLength(2);
    const [first] = outcome.docs;
    expect(first.canonicalUrl).toContain("linkedin.com/ad-library/detail/1559183094");
    expect(first.body).toContain("GLP-1 aggregation");
    expect(adStartedAt(first.raw)?.toISOString().slice(0, 10)).toBe("2026-09-10");
    expect(adEndedAt(first.raw)?.toISOString().slice(0, 10)).toBe("2026-09-11");
    expect(adCountries(first.raw)).toEqual(["US", "DE", "GB", "CH"]);
    expect(adCountries(outcome.docs[1].raw)).toContain("KR");
  });

  it("a re-read with a new end date is a new snapshot of the same ad", () => {
    const target = spec.targets[0];
    const a = mapLinkedInAdItem(live[0], target)!;
    const b = mapLinkedInAdItem({ ...live[0], availability: { start: "2026-09-10", end: "2026-09-20" } }, target)!;
    expect(a.canonicalUrl).toBe(b.canonicalUrl);
    expect(a.contentHash).not.toBe(b.contentHash);
  });
});
