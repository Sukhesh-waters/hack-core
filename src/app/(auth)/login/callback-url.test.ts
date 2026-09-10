import { describe, expect, it } from "vitest";
import { safeCallbackUrl } from "./callback-url";

describe("safeCallbackUrl", () => {
  it("passes through a bare relative path", () => {
    expect(safeCallbackUrl("/w/ws_1/production")).toBe("/w/ws_1/production");
  });

  it("keeps the query string on a relative path", () => {
    expect(safeCallbackUrl("/calendar?m=2026-08")).toBe("/calendar?m=2026-08");
  });

  it("strips the host from an absolute same-origin URL — what NextAuth's own redirect passes", () => {
    expect(safeCallbackUrl("http://localhost:3000/w/ws_1/production")).toBe(
      "/w/ws_1/production",
    );
  });

  /** The open-redirect case: an attacker-supplied external host must never
   *  survive — only the harmless path portion does. */
  it("collapses an attacker-supplied external host to just its path", () => {
    expect(safeCallbackUrl("https://evil.com/steal")).toBe("/steal");
  });

  it("collapses a protocol-relative host to just its path", () => {
    expect(safeCallbackUrl("//evil.com/steal")).toBe("/steal");
  });

  it("falls back to /hub for null, undefined, or empty input", () => {
    expect(safeCallbackUrl(null)).toBe("/hub");
    expect(safeCallbackUrl(undefined)).toBe("/hub");
    expect(safeCallbackUrl("")).toBe("/hub");
  });

  /** Anything that isn't a bare path or an absolute URL is treated as a
   *  relative path against this app's own origin — still harmless, since
   *  only the resulting path is ever kept. */
  it("resolves arbitrary text as a relative path rather than throwing", () => {
    expect(safeCallbackUrl("not a url")).toBe("/not%20a%20url");
  });
});
