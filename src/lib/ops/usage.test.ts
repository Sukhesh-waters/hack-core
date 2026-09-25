import { describe, expect, it } from "vitest";
import { readApifyUsage, readFirecrawlUsage } from "./usage";

const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

describe("readApifyUsage", () => {
  it("reads this month's USD usage and cap (live shape, 2026-09-23)", async () => {
    const r = await readApifyUsage(
      "t",
      reply(200, {
        data: {
          monthlyUsageCycle: { startAt: "2026-09-01T00:00:00.000Z", endAt: "2026-09-30T23:59:59.999Z" },
          limits: { maxMonthlyUsageUsd: 5 },
          current: { monthlyUsageUsd: 0.876713969081313 },
        },
      }),
    );
    expect(r).toMatchObject({ name: "Apify", used: 0.876713969081313, cap: 5, unit: "usd" });
  });
  it("no token, an error status or an odd answer become a readable error", async () => {
    expect(await readApifyUsage(undefined)).toEqual({ name: "Apify", error: "no APIFY_TOKEN" });
    expect(await readApifyUsage("t", reply(401, {}))).toEqual({ name: "Apify", error: "HTTP 401" });
    expect(await readApifyUsage("t", reply(200, { data: {} }))).toEqual({ name: "Apify", error: "unexpected answer" });
  });
});

describe("readFirecrawlUsage", () => {
  it("spent = plan - remaining, never negative when bonus credits exist (live: 1094 of 1000 left)", async () => {
    const r = await readFirecrawlUsage(
      "k",
      reply(200, {
        success: true,
        data: {
          remainingCredits: 1094,
          planCredits: 1000,
          billingPeriodStart: "2026-09-21T08:23:39.791Z",
          billingPeriodEnd: "2026-10-21T08:23:39.791Z",
        },
      }),
    );
    expect(r).toMatchObject({ name: "Firecrawl", used: 0, cap: 1000, remaining: 1094, unit: "credits" });
    const spent = await readFirecrawlUsage(
      "k",
      reply(200, { data: { remainingCredits: 700, planCredits: 1000, billingPeriodStart: "2026-09-21T00:00:00Z", billingPeriodEnd: "2026-10-21T00:00:00Z" } }),
    );
    expect(spent).toMatchObject({ used: 300 });
  });
});
