import { describe, expect, it } from "vitest";
import { decideIngest, refreshAllowed } from "./guard";

describe("refreshAllowed", () => {
  it("re-reads own pages only, once the client has an own list", () => {
    const own: Identity[] = [{ kind: "domain", value: "waters.com" }];
    expect(refreshAllowed("https://www.waters.com/x", own)).toBe(true);
    expect(refreshAllowed("https://www.thermofisher.com/in/en/home.html", own)).toBe(false);
    expect(refreshAllowed("https://www.thermofisher.com/", [])).toBe(true);
  });
});
import type { Identity, KnownParty } from "./ownership";

const own: Identity[] = [
  { kind: "domain", value: "waters.com" },
  { kind: "linkedin", value: "company/waters" },
];
const known: KnownParty[] = [{ name: "Thermo Fisher Scientific", identities: [{ kind: "domain", value: "thermofisher.com" }] }];
const base = { clientName: "Waters", own, known, confirmOwn: false };

describe("decideIngest", () => {
  it("proceeds with the clean URL for an own page", () => {
    expect(decideIngest({ ...base, url: "https:/www.waters.com/?srsltid=abc" })).toEqual({
      action: "proceed",
      url: "https://www.waters.com/",
      addIdentity: null,
    });
  });

  it("refuses a known competitor's page, even when the person says it's theirs", () => {
    for (const confirmOwn of [false, true]) {
      const d = decideIngest({ ...base, confirmOwn, url: "https://www.thermofisher.com/in/en/home.html" });
      expect(d.action).toBe("refuse");
      if (d.action === "refuse") {
        expect(d.message).toContain("Thermo Fisher Scientific");
        expect(d.refusal).toEqual({ url: "https://www.thermofisher.com/in/en/home.html", ownerName: "Thermo Fisher Scientific", suggestion: null });
      }
    }
  });

  it("asks before accepting an unknown page, and adds it to the own list once confirmed", () => {
    const ask = decideIngest({ ...base, url: "https://www.linkedin.com/company/pfizer?trk=similar-pages" });
    expect(ask).toMatchObject({ action: "refuse", refusal: { suggestion: { kind: "linkedin", value: "company/pfizer" } } });
    if (ask.action === "refuse") expect(ask.message).toContain('tick "Belongs to Waters"');

    expect(decideIngest({ ...base, confirmOwn: true, url: "https://www.linkedin.com/showcase/bdbiosciences/" })).toEqual({
      action: "proceed",
      url: "https://www.linkedin.com/showcase/bdbiosciences",
      addIdentity: { kind: "linkedin", value: "showcase/bdbiosciences" },
    });
  });

  it("a brand-new client with no own list is asked once for its first site", () => {
    expect(decideIngest({ ...base, own: [], url: "https://www.waters.com/" })).toMatchObject({
      action: "refuse",
      refusal: { suggestion: { kind: "domain", value: "waters.com" } },
    });
  });

  it("refuses a page that says nothing about its owner, and a non-web address", () => {
    expect(decideIngest({ ...base, confirmOwn: true, url: "https://www.linkedin.com/feed/" }).action).toBe("refuse");
    expect(decideIngest({ ...base, url: "javascript:alert(1)" })).toMatchObject({ action: "refuse", refusal: { url: null } });
  });
});
