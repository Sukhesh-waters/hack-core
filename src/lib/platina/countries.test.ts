import { describe, expect, it } from "vitest";
import { countryCode, countryName } from "./countries";

describe("countryCode", () => {
  it.each([
    ["United Arab Emirates", "AE"],
    ["Saudi Arabia", "SA"],
    ["Germany", "DE"],
    ["United States", "US"],
    ["United Kingdom", "GB"],
    ["South Korea", "KR"],
    ["Turkey", "TR"],
    ["Taiwan", "TW"],
    ["AE", "AE"],
  ])("%s -> %s", (name, code) => expect(countryCode(name)).toBe(code));

  it("returns null for a name it does not know", () => expect(countryCode("Atlantis")).toBeNull());
  it("names a code", () => expect(countryName("QA")).toBe("Qatar"));
});
