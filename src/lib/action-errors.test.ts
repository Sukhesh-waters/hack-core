import { describe, expect, it } from "vitest";
import { actionErrorMessage } from "./action-errors";

function routerError(provider: string, status?: number) {
  const err = new Error(`${provider} request failed (${status})`) as Error & {
    provider: string;
    status?: number;
  };
  err.name = "AIRouterError";
  err.provider = provider;
  err.status = status;
  return err;
}

describe("actionErrorMessage — AIRouterError", () => {
  it("invalid key (401) names the provider and points at .env.local", () => {
    const msg = actionErrorMessage(routerError("groq", 401));
    expect(msg).toContain("groq");
    expect(msg).toContain("401");
    expect(msg).toContain(".env.local");
  });

  it("Gemini's invalid-key shape (400) gets the same key hint", () => {
    const msg = actionErrorMessage(routerError("gemini", 400));
    expect(msg).toContain("gemini");
    expect(msg).toContain("invalid or expired");
  });

  it("429 reads as rate limiting, not a key problem", () => {
    const msg = actionErrorMessage(routerError("groq", 429));
    expect(msg).toContain("rate-limited");
    expect(msg).not.toContain(".env.local");
  });

  it("5xx reads as provider unavailable", () => {
    const msg = actionErrorMessage(routerError("bedrock", 503));
    expect(msg).toContain("unavailable");
    expect(msg).toContain("503");
  });

  it("no status still names the provider", () => {
    const msg = actionErrorMessage(routerError("gemini"));
    expect(msg).toContain("gemini");
    expect(msg).toContain("unavailable");
  });
});

describe("actionErrorMessage — existing mappings unchanged", () => {
  it("unknown errors stay generic", () => {
    expect(actionErrorMessage(new Error("boom"))).toBe(
      "Something went wrong. Please try again.",
    );
  });

  it("unauthenticated maps to session message", () => {
    expect(actionErrorMessage(new Error("Unauthenticated"))).toBe(
      "Your session expired. Sign in again.",
    );
  });

  it("scraping text length failures", () => {
    expect(actionErrorMessage(new Error("Text too short: 0 chars"))).toContain("Extraction failed");
    expect(actionErrorMessage(new Error("Couldn't find enough readable text"))).toContain("Extraction failed");
  });

  it("non-HTML pages", () => {
    expect(actionErrorMessage(new Error("Only HTML pages are supported"))).toContain("Only HTML webpages");
  });

  it("timeouts", () => {
    expect(actionErrorMessage(new Error("aborted due to timeout"))).toContain("Request timed out");
  });

  it("SSL/TLS alerts", () => {
    expect(actionErrorMessage(new Error("ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR"))).toContain("Secure connection failed");
  });
});

describe("actionErrorMessage — scraping says what actually happened", () => {
  it("passes a ScrapeError through verbatim", () => {
    const error = Object.assign(new Error("Firecrawl credits are used up for this billing period (402)."), {
      name: "ScrapeError",
    });
    expect(actionErrorMessage(error)).toBe("Firecrawl credits are used up for this billing period (402).");
  });

  it("names a site's refusal instead of hiding it", () => {
    expect(actionErrorMessage(new Error("Fetch failed with status 403."))).toBe(
      "The website blocked the request (403) — it refuses automated readers.",
    );
    expect(actionErrorMessage(new Error("Fetch failed with status 404."))).toMatch(/doesn't exist \(404\)/);
    expect(actionErrorMessage(new Error("Fetch failed with status 500."))).toMatch(/answered with an error \(500\)/);
  });

  it("an unreachable site is not 'something went wrong'", () => {
    expect(actionErrorMessage(new TypeError("fetch failed"))).toMatch(/Couldn't reach that website/);
  });
});
