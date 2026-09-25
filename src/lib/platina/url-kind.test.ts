import { describe, expect, it } from "vitest";
import { classifyUrl, ownerOf } from "./url-kind";

describe("classifyUrl (C8.2)", () => {
  it.each([
    ["https://www.linkedin.com/company/agilent-technologies/posts/", "social_posts", "linkedin:@agilent-technologies", "Apify"],
    ["linkedin.com/showcase/bdbiosciences", "social_posts", "linkedin:@bdbiosciences", "Apify"],
    ["https://www.facebook.com/ads/library/?q=Agilent", "ad_library", null, "Apify"],
    ["https://www.linkedin.com/ad-library/search?accountOwner=Thermo%20Fisher%20Scientific", "ad_library", null, "Apify"],
    ["https://www.terrapinn.com/exhibition/arablab-live/", "conference", null, "Firecrawl"],
    ["https://www.cphi.com/middle-east/", "conference", null, "Firecrawl"],
    ["https://www.thermofisher.com/us/en/home/about-us/news-gallery/press-releases.html", "competitor_site", null, "Firecrawl"],
    ["https://www.agilent.com/about/newsroom/2026/pfas.html", "press_release", null, "Firecrawl"],
    ["https://www.shimadzu.com/an/products/liquid-chromatography/index.html?utm_source=x", "competitor_site", null, "Firecrawl"],
  ])("%s -> %s", (url, kind, value, reader) => {
    const out = classifyUrl(url);
    expect(out).toMatchObject({ ok: true, kind, reader });
    if (value && out.ok) expect(out.value).toBe(value);
  });

  it("drops tracking parameters from a pasted page", () => {
    const out = classifyUrl("https://www.shimadzu.com/an/products/lc.html?utm_source=li&gclid=1");
    expect(out.ok && out.value).toBe("https://www.shimadzu.com/an/products/lc.html");
  });

  it.each([
    ["https://www.linkedin.com/posts/bruker-corporation_bruker-at-arablab-live-2026-activity-75", "company page"],
    ["https://www.linkedin.com/ad-library/search?companyIds=1", "by advertiser"],
    ["https://www.instagram.com/agilent", "not read yet"],
    ["not a url at all", "not a web address"],
  ])("refuses %s with a reason", (url, reason) => {
    const out = classifyUrl(url);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain(reason);
  });
});

describe("ownerOf", () => {
  const brands = [
    { id: "a", name: "Agilent Technologies", kind: "competitor", homepageUrl: "https://www.agilent.com", handles: { linkedin: "agilent-technologies" } },
    { id: "t", name: "Thermo Fisher Scientific", kind: "competitor", homepageUrl: "https://www.thermofisher.com", handles: {} },
  ];
  it("finds the company by its site, a subdomain of it, or its LinkedIn page", () => {
    const page = classifyUrl("https://investor.agilent.com/news/x");
    const li = classifyUrl("https://www.linkedin.com/company/agilent-technologies/");
    expect(page.ok && ownerOf(page, brands)?.id).toBe("a");
    expect(li.ok && ownerOf(li, brands)?.id).toBe("a");
  });
  it("files a LinkedIn Ad Library search under the advertiser it names", () => {
    const ads = classifyUrl("https://www.linkedin.com/ad-library/search?accountOwner=Thermo%20Fisher%20Scientific");
    expect(ads.ok && ownerOf(ads, [...brands, { id: "tf", name: "Thermo Fisher", kind: "competitor", homepageUrl: null }])?.id).toBe("t");
    const short = classifyUrl("https://www.linkedin.com/ad-library/search?accountOwner=Agilent%20Technologies");
    expect(short.ok && ownerOf(short, [{ id: "ag", name: "Agilent", kind: "competitor", homepageUrl: null }])?.id).toBe("ag");
  });
  it("returns nothing for a trade site, so the person picks the company", () => {
    const trade = classifyUrl("https://www.labmate-online.com/news/x");
    expect(trade.ok && ownerOf(trade, brands)).toBeNull();
  });
});
