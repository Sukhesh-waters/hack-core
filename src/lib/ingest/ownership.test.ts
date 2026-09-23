import { describe, expect, it } from "vitest";
import { identityOfUrl, ownershipOf, parseIdentity, type Identity } from "./ownership";

const WATERS: Identity[] = [
  { kind: "domain", value: "waters.com" },
  { kind: "linkedin", value: "company/waters" },
  { kind: "linkedin", value: "showcase/bdbiosciences" },
];
const KNOWN = [
  { name: "Thermo Fisher Scientific", identities: [{ kind: "domain", value: "thermofisher.com" }, { kind: "linkedin", value: "company/thermo-fisher-scientific" }] as Identity[] },
  { name: "Agilent Technologies", identities: [{ kind: "domain", value: "agilent.com" }, { kind: "linkedin", value: "company/agilent-technologies" }] as Identity[] },
];
const verdict = (url: string) => ownershipOf(url, { own: WATERS, known: KNOWN }).verdict;

describe("ownershipOf on the URLs the live Waters vault actually held", () => {
  it("Waters' own site, LinkedIn page and BD Biosciences are own", () => {
    for (const url of [
      "https://www.waters.com/",
      "https://www.waters.com/nextgen/in/en/products.html",
      "https://www.waters.com/nextgen/in/en.html?srsltid=AU7gw4Wm10",
      "https:/www.waters.com",
      "https://ir.waters.com/news",
      "https://www.linkedin.com/company/waters",
      "https://www.linkedin.com/company/waters/posts/?feedView=all",
      "https://www.linkedin.com/showcase/bdbiosciences/",
      "https://www.linkedin.com/posts/waters_the-26th-international-mass-spectrometry-activity-7497963264073715712-9udB",
    ]) {
      expect(verdict(url), url).toBe("own");
    }
  });

  it("names a known competitor", () => {
    const thermo = ownershipOf("https://www.thermofisher.com/in/en/home.html", { own: WATERS, known: KNOWN });
    expect(thermo).toMatchObject({ verdict: "third_party", name: "Thermo Fisher Scientific" });
    expect(
      ownershipOf("https://www.linkedin.com/company/agilent-technologies?trk=similar-pages", { own: WATERS, known: KNOWN }),
    ).toMatchObject({ verdict: "third_party", name: "Agilent Technologies" });
    expect(verdict("https://www.linkedin.com/company/thermo-fisher-scientific?trk=similar-pages")).toBe("third_party");
  });

  it("anything else is unknown, never own: Pfizer, BD as a whole, lookalikes, people", () => {
    for (const url of [
      "https://www.linkedin.com/company/pfizer?trk=similar-pages",
      "https://www.bd.com/en-us",
      "https://notwaters.com/",
      "https://waters.com.evil.io/",
      "https://www.linkedin.com/company/waters-india",
      "https://www.linkedin.com/in/someone",
      "https://www.instagram.com/waters_corp/",
    ]) {
      expect(verdict(url), url).toBe("unknown");
    }
  });

  it("offers the identity to add when a person says 'it's ours'", () => {
    expect(ownershipOf("https://shop.newbrand.co.uk/p/1", { own: [], known: [] })).toEqual({
      verdict: "unknown",
      suggestion: { kind: "domain", value: "newbrand.co.uk" },
    });
    expect(ownershipOf("https://www.linkedin.com/showcase/waters-empower/", { own: WATERS, known: [] })).toEqual({
      verdict: "unknown",
      suggestion: { kind: "linkedin", value: "showcase/waters-empower" },
    });
    expect(ownershipOf("https://www.linkedin.com/feed/", { own: WATERS, known: [] })).toEqual({
      verdict: "unknown",
      suggestion: null,
    });
  });

  it("an unusable URL is unknown with nothing to add", () => {
    expect(ownershipOf("javascript:alert(1)", { own: WATERS, known: [] })).toEqual({ verdict: "unknown", suggestion: null });
  });
});

describe("identityOfUrl", () => {
  it("reads each platform's handle", () => {
    expect(identityOfUrl("https://www.instagram.com/waters_corp/")).toEqual({ kind: "instagram", value: "waters_corp" });
    expect(identityOfUrl("https://www.tiktok.com/@waters")).toEqual({ kind: "tiktok", value: "waters" });
    expect(identityOfUrl("https://www.youtube.com/@WatersCorporation/videos")).toEqual({ kind: "youtube", value: "waterscorporation" });
    expect(identityOfUrl("https://twitter.com/WatersCorp")).toEqual({ kind: "x", value: "waterscorp" });
    expect(identityOfUrl("https://www.facebook.com/WatersCorporation")).toEqual({ kind: "facebook", value: "waterscorporation" });
    expect(identityOfUrl("https://www.waters.com/x")).toEqual({ kind: "domain", value: "waters.com" });
  });
});

describe("parseIdentity", () => {
  it("accepts what a person types in the own-sites list", () => {
    expect(parseIdentity("waters.com")).toEqual({ kind: "domain", value: "waters.com" });
    expect(parseIdentity("https://www.waters.com/nextgen")).toEqual({ kind: "domain", value: "waters.com" });
    expect(parseIdentity("https://www.linkedin.com/company/waters/")).toEqual({ kind: "linkedin", value: "company/waters" });
    expect(parseIdentity("linkedin.com/showcase/bdbiosciences")).toEqual({ kind: "linkedin", value: "showcase/bdbiosciences" });
    expect(parseIdentity("not a thing")).toBeNull();
  });
});
