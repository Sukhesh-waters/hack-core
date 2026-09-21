import { describe, expect, it } from "vitest";
import { SHELL_BODY_CHARS, looksJsRendered, shouldEscalate } from "./render";

const real = (n = 800) => ({ body: "Bluebird roasts to order for wholesale buyers. ".repeat(n / 46) });
const thin = { body: "Loading…" };

describe("looksJsRendered", () => {
  it("treats an empty crawl as a shell", () => {
    expect(looksJsRendered([])).toBe(true);
  });

  it("spots a page with almost no text", () => {
    expect(looksJsRendered([thin])).toBe(true);
    expect(looksJsRendered([{ body: "x".repeat(SHELL_BODY_CHARS - 1) }])).toBe(true);
  });

  it("spots an explicit enable-JavaScript notice however long the page is", () => {
    expect(
      looksJsRendered([
        { body: `${"padding ".repeat(200)} You need to enable JavaScript to run this app.` },
      ]),
    ).toBe(true);
  });

  it("leaves a real page alone", () => {
    expect(looksJsRendered([real()])).toBe(false);
  });

  it("does not escalate on one thin page among real ones", () => {
    // A cookie stub next to nine real pages is a thin page, not a broken crawl:
    // escalating would multiply the bill for nothing.
    expect(looksJsRendered([real(), thin, real()])).toBe(false);
  });
});

describe("shouldEscalate", () => {
  const base = { alreadyRendering: false, docs: [real()], error: null, remainingPages: 10 };

  it("escalates a shell", () => {
    const out = shouldEscalate({ ...base, docs: [thin] });
    expect(out.escalate).toBe(true);
    expect(out.reason).toContain("browser");
  });

  it("escalates an outright failure", () => {
    expect(shouldEscalate({ ...base, error: "Apify run failed (500)" }).escalate).toBe(true);
  });

  it("never escalates an account-level refusal — a heavier crawl cannot help", () => {
    const out = shouldEscalate({
      ...base,
      error: "Apify refused the run (402): the account's memory or usage limit was reached",
    });
    expect(out.escalate).toBe(false);
    expect(out.reason).toContain("account");
  });

  it("never escalates twice", () => {
    expect(shouldEscalate({ ...base, alreadyRendering: true, docs: [thin] }).escalate).toBe(false);
  });

  it("never escalates without budget", () => {
    expect(shouldEscalate({ ...base, docs: [thin], remainingPages: 0 }).escalate).toBe(false);
  });

  it("leaves a healthy fetch alone", () => {
    const out = shouldEscalate(base);
    expect(out.escalate).toBe(false);
    expect(out.reason).toContain("real content");
  });
});
