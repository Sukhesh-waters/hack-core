import { describe, expect, it } from "vitest";
import { hostMatches, normaliseIngestUrl, registrableDomain } from "./url";

describe("normaliseIngestUrl", () => {
  it("repairs a single-slash scheme and adds https to a bare host", () => {
    expect(normaliseIngestUrl("https:/www.waters.com")).toBe("https://www.waters.com/");
    expect(normaliseIngestUrl("waters.com/nextgen/us/en.html")).toBe("https://waters.com/nextgen/us/en.html");
    expect(normaliseIngestUrl("  HTTPS://WWW.Waters.com/  ")).toBe("https://www.waters.com/");
  });

  it("drops tracking parameters the live vault stored as duplicates", () => {
    expect(
      normaliseIngestUrl(
        "https://www.waters.com/nextgen/in/en.html?srsltid=AU7gw4XnTdQk7La07b5Fb8KXI-vXriQRGtOLLEYR1F4zX3vWYSI3JdbL",
      ),
    ).toBe("https://www.waters.com/nextgen/in/en.html");
    expect(normaliseIngestUrl("https://www.linkedin.com/company/agilent-technologies?trk=similar-pages")).toBe(
      "https://www.linkedin.com/company/agilent-technologies",
    );
    expect(normaliseIngestUrl("https://x.com/a?utm_source=li&utm_medium=x&gclid=1&fbclid=2&id=7#top")).toBe(
      "https://x.com/a?id=7",
    );
  });

  it("keeps meaningful query parameters and the path as written", () => {
    expect(normaliseIngestUrl("https://example.com/search?q=pfas&page=2")).toBe("https://example.com/search?q=pfas&page=2");
    expect(normaliseIngestUrl("https://www.linkedin.com/company/waters/")).toBe("https://www.linkedin.com/company/waters");
  });

  it("rejects what is not an http(s) URL", () => {
    expect(normaliseIngestUrl("")).toBeNull();
    expect(normaliseIngestUrl("javascript:alert(1)")).toBeNull();
    expect(normaliseIngestUrl("ftp://files.example.com/x")).toBeNull();
    expect(normaliseIngestUrl("file:///etc/passwd")).toBeNull();
    expect(normaliseIngestUrl("not a url at all")).toBeNull();
  });
});

describe("registrableDomain", () => {
  it("strips subdomains down to the name a company registers", () => {
    expect(registrableDomain("www.waters.com")).toBe("waters.com");
    expect(registrableDomain("ir.waters.com")).toBe("waters.com");
    expect(registrableDomain("www.thermofisher.com")).toBe("thermofisher.com");
    expect(registrableDomain("shop.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("www.company.com.au")).toBe("company.com.au");
    expect(registrableDomain("localhost")).toBe("localhost");
  });
});

describe("hostMatches", () => {
  it("matches the domain itself and its subdomains, never a lookalike", () => {
    expect(hostMatches("www.waters.com", "waters.com")).toBe(true);
    expect(hostMatches("waters.com", "www.waters.com")).toBe(true);
    expect(hostMatches("ir.waters.com", "waters.com")).toBe(true);
    expect(hostMatches("notwaters.com", "waters.com")).toBe(false);
    expect(hostMatches("waters.com.evil.io", "waters.com")).toBe(false);
  });
});
