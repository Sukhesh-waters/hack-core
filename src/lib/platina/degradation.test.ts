import { describe, expect, it } from "vitest";
import { buildDegradationNotices, KB_STALE_DAYS } from "./degradation";

const NOW = new Date("2026-09-20T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

const base = {
  now: NOW,
  workspaceId: "ws1",
  specs: [{ cadenceMinutes: 15, probeCapable: true, lastProbeAt: minutesAgo(5), lastRunAt: null }],
  latestRunEventAt: null,
  devMode: true,
  pagesToday: 3,
  dailyCap: 40,
  lastDocumentAt: minutesAgo(30),
  latestRun: { status: "completed", degradedReason: null, errorReason: null },
};

describe("buildDegradationNotices", () => {
  it("is silent when everything is healthy", () => {
    expect(buildDegradationNotices(base)).toEqual([]);
  });

  it("says collection stopped, and links to the fix, when the scheduler is silent", () => {
    const notices = buildDegradationNotices({
      ...base,
      specs: [{ ...base.specs[0], lastProbeAt: minutesAgo(400) }],
    });
    expect(notices.map((n) => n.id)).toContain("scheduler");
    expect(notices.find((n) => n.id === "scheduler")?.href).toBe("/p/ws1/admin/health");
  });

  it("explains a cap pause instead of going quiet", () => {
    const n = buildDegradationNotices({ ...base, pagesToday: 40 }).find((x) => x.id === "cap");
    expect(n?.text).toContain("daily limit of 40 pages");
  });

  it("does not claim a pause when nothing is being watched", () => {
    expect(buildDegradationNotices({ ...base, specs: [], pagesToday: 99 })).toEqual([]);
  });

  it("surfaces a degraded or failed latest run with its reason", () => {
    const n = buildDegradationNotices({
      ...base,
      latestRun: { status: "degraded", degradedReason: "targets failed: x", errorReason: null },
    }).find((x) => x.id === "run");
    expect(n?.tone).toBe("warn");
    expect(n?.text).toContain("targets failed: x");
    const failed = buildDegradationNotices({
      ...base,
      latestRun: { status: "failed", degradedReason: null, errorReason: "boom" },
    }).find((x) => x.id === "run");
    expect(failed?.tone).toBe("error");
  });

  it("flags stale knowledge rather than serving it silently", () => {
    const n = buildDegradationNotices({ ...base, lastDocumentAt: daysAgo(KB_STALE_DAYS + 2) }).find(
      (x) => x.id === "stale",
    );
    expect(n?.text).toContain(`${KB_STALE_DAYS + 2} days`);
    expect(buildDegradationNotices({ ...base, lastDocumentAt: daysAgo(2) })).toEqual([]);
  });
});

describe("provider fallback notice", () => {
  it("names the provider that failed and how often, instead of hiding the swap", () => {
    const n = buildDegradationNotices({
      ...base,
      providerFailures: [{ provider: "groq", model: "openai/gpt-oss-120b", failures: 3 }],
    }).find((x) => x.id === "provider");
    expect(n?.tone).toBe("warn");
    expect(n?.text).toContain("groq (openai/gpt-oss-120b) failed 3 times");
    expect(n?.href).toBe("/p/ws1/admin/health");
  });

  it("is silent with no failures, and singular for one", () => {
    expect(buildDegradationNotices({ ...base, providerFailures: [] })).toEqual([]);
    expect(buildDegradationNotices({ ...base, providerFailures: [{ provider: "gemini", model: "m", failures: 0 }] })).toEqual([]);
    const one = buildDegradationNotices({ ...base, providerFailures: [{ provider: "gemini", model: "m", failures: 1 }] });
    expect(one[0].text).toContain("failed 1 time.");
  });
});

describe("dev server and quota wording", () => {
  it("shows collection stopped when the dev server is down, even before any source is approved", () => {
    const n = buildDegradationNotices({ ...base, specs: [], devServer: "down" }).find((x) => x.id === "scheduler");
    expect(n?.tone).toBe("error");
    expect(n?.text).toContain("Inngest dev server is not running");
  });

  it("says a provider's daily quota is used up, so nobody waits for a retry that cannot help", () => {
    const n = buildDegradationNotices({
      ...base,
      providerFailures: [{ provider: "gemini", model: "gemini-3.6-flash", failures: 9, lastError: "Gemini request failed (429) — daily quota used up" }],
    }).find((x) => x.id === "provider");
    expect(n?.text).toContain("daily free-tier quota is used up");
  });

  it("does not claim a quota problem for an ordinary failure", () => {
    const n = buildDegradationNotices({
      ...base,
      providerFailures: [{ provider: "groq", model: "m", failures: 2, lastError: "Groq request failed (500)" }],
    }).find((x) => x.id === "provider");
    expect(n?.text).not.toContain("quota");
  });
});
