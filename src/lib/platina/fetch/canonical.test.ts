import { describe, expect, it } from "vitest";
import { canonicalizeUrl, contentHash } from "./canonical";

describe("canonicalizeUrl", () => {
  it("strips tracking params and fragments", () => {
    expect(
      canonicalizeUrl(
        "https://Example.com/page/?utm_source=newsletter&utm_medium=email&id=42#section",
      ),
    ).toBe("https://example.com/page?id=42");
  });

  it("sorts remaining params so ordering cannot defeat dedupe", () => {
    const a = canonicalizeUrl("https://example.com/p?b=2&a=1");
    const b = canonicalizeUrl("https://example.com/p?a=1&b=2");
    expect(a).toBe(b);
  });

  it("keeps meaningful params and path case", () => {
    expect(canonicalizeUrl("https://example.com/Products/LC?q=x")).toBe(
      "https://example.com/Products/LC?q=x",
    );
  });
});

describe("contentHash", () => {
  it("is stable for identical input", () => {
    expect(contentHash("https://example.com", "hello world")).toBe(
      contentHash("https://example.com", "hello world"),
    );
  });

  it("ignores whitespace-only changes", () => {
    expect(contentHash("https://example.com", "hello   world")).toBe(
      contentHash("https://example.com", "hello world"),
    );
  });

  it("changes when content changes", () => {
    expect(contentHash("https://example.com", "v1")).not.toBe(
      contentHash("https://example.com", "v2"),
    );
  });

  it("changes when the canonical URL changes", () => {
    expect(contentHash("https://a.example.com", "same")).not.toBe(
      contentHash("https://b.example.com", "same"),
    );
  });
});
