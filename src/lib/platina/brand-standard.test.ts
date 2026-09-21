import { describe, expect, it } from "vitest";
import { profileIsConfirmable, profileToStandard } from "./brand-standard";

const profile = {
  summary: "a wholesale coffee roaster for independent cafés",
  offers: ["subscription roasting", "barista training"],
  audience: "independent café owners",
  tone: "plain, practical, no hype",
  keywords: ["roasting", "wholesale"],
  claims: ["roasted within 48 hours", "carbon neutral shipping"],
};

describe("profileToStandard", () => {
  it("produces one chunk per facet, each naming the client", () => {
    const chunks = profileToStandard("Northwind Coffee", profile);
    expect(chunks).toHaveLength(4);
    for (const chunk of chunks) {
      expect(chunk.title).toContain("Northwind Coffee");
      expect(chunk.content).toContain("Northwind Coffee");
    }
    expect(chunks[0].content).toContain("wholesale coffee roaster");
    expect(chunks[1].content).toContain("barista training");
    expect(chunks[2].content).toContain("independent café owners");
    expect(chunks[2].content).toContain("no hype");
    expect(chunks[3].content).toContain("roasted within 48 hours");
  });

  it("skips facets the profile does not have", () => {
    const chunks = profileToStandard("Acme", {
      summary: "a toolmaker",
      offers: [],
      audience: "",
      tone: "",
      keywords: [],
      claims: [],
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].title).toContain("what it does");
  });

  it("returns nothing for a missing profile rather than an empty heading", () => {
    expect(profileToStandard("Acme", null)).toEqual([]);
    expect(profileToStandard("Acme", undefined)).toEqual([]);
    expect(profileIsConfirmable(null)).toBe(false);
  });

  it("drops blank list entries instead of writing 'claims: ; ;'", () => {
    const chunks = profileToStandard("Acme", { ...profile, claims: ["", "  ", "real claim"] });
    const claims = chunks.find((c) => c.title.includes("claims"))!;
    expect(claims.content).toBe("Acme claims: real claim.");
  });

  it("collapses whitespace so a scraped profile does not carry layout with it", () => {
    const chunks = profileToStandard("Acme", {
      ...profile,
      summary: "a  toolmaker\n\n  with   presses",
    });
    expect(chunks[0].content).toContain("a toolmaker with presses");
  });

  it("falls back to a neutral name rather than an empty subject", () => {
    expect(profileToStandard("  ", profile)[0].content.startsWith("This client")).toBe(true);
  });

  it("is confirmable when there is something to confirm", () => {
    expect(profileIsConfirmable(profile)).toBe(true);
  });
});
