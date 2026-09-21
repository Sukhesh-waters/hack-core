import { describe, expect, it } from "vitest";
import {
  checkApifyToken,
  checkCollection,
  checkDatabase,
  checkModelTier,
  checkScheduler,
  redact,
  summarize,
  type HealthCheck,
  type ProbeStatus,
  type SpecActivity,
} from "./health";

const NOW = new Date("2026-09-20T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const probed = (over: Partial<SpecActivity> = {}): SpecActivity => ({
  cadenceMinutes: 5,
  probeCapable: true,
  lastProbeAt: minutesAgo(2),
  lastRunAt: null,
  ...over,
});

describe("checkApifyToken", () => {
  it("reports presence without leaking the value", () => {
    const SECRET = "apify_api_SECRETVALUE12345";
    process.env.APIFY_TOKEN = SECRET;
    const check = checkApifyToken(Boolean(process.env.APIFY_TOKEN));
    delete process.env.APIFY_TOKEN;
    expect(check.status).toBe("ok");
    expect(JSON.stringify(check)).not.toContain(SECRET);
  });

  it("is not_configured with a remedy when absent", () => {
    const check = checkApifyToken(false);
    expect(check.status).toBe("not_configured");
    expect(check.remedy).toContain("APIFY_TOKEN");
  });
});

describe("checkModelTier", () => {
  const base = { tier: "fast", expectedProvider: "groq" } as const;

  it("ok when the expected provider answers", () => {
    const c = checkModelTier({
      ...base,
      probe: { ok: true, provider: "groq", model: "m", latencyMs: 300 },
    });
    expect(c.status).toBe("ok");
    expect(c.detail).toContain("groq (m)");
  });

  it("degraded when the ladder fell back", () => {
    const c = checkModelTier({
      ...base,
      probe: { ok: true, provider: "gemini", model: "g" },
    });
    expect(c.status).toBe("degraded");
    expect(c.remedy).toBeDefined();
  });

  it("down with a retired-model remedy on 404", () => {
    const c = checkModelTier({
      ...base,
      probe: { ok: false, message: "Groq request failed (404)", status: 404 },
    });
    expect(c.status).toBe("down");
    expect(c.remedy).toContain("router.ts");
  });

  it("down with a key remedy on other failures", () => {
    const c = checkModelTier({
      ...base,
      probe: { ok: false, message: "GROQ_API_KEY is not set" },
    });
    expect(c.status).toBe("down");
    expect(c.remedy).toContain("GROQ_API_KEY");
  });
});

describe("checkScheduler", () => {
  const run = (over: Partial<Parameters<typeof checkScheduler>[0]> = {}) =>
    checkScheduler({
      now: NOW,
      specs: [probed()],
      latestRunEventAt: null,
      devMode: true,
      ...over,
    });

  it("is ok when nothing is approved — nothing is expected to run", () => {
    expect(run({ specs: [] }).status).toBe("ok");
  });

  it("is ok on a fresh probe heartbeat", () => {
    expect(run().status).toBe("ok");
  });

  it("is degraded and names the job runner when the heartbeat is stale", () => {
    const c = run({ specs: [probed({ lastProbeAt: minutesAgo(90) })] });
    expect(c.status).toBe("degraded");
    expect(c.remedy).toContain("npm run dev:jobs");
  });

  it("points at the Inngest dashboard outside dev mode", () => {
    const c = run({
      specs: [probed({ lastProbeAt: minutesAgo(90) })],
      devMode: false,
    });
    expect(c.remedy).toContain("INNGEST_SIGNING_KEY");
  });

  it("is degraded when approved sources were never touched", () => {
    expect(run({ specs: [probed({ lastProbeAt: null })] }).status).toBe(
      "degraded",
    );
  });

  it("does not cry wolf for a slow cadence", () => {
    const c = run({
      specs: [probed({ cadenceMinutes: 60, lastProbeAt: minutesAgo(120) })],
    });
    expect(c.status).toBe("ok"); // threshold is 3 x 60 = 180
  });

  it("counts a recent run event as activity", () => {
    const c = run({
      specs: [probed({ lastProbeAt: minutesAgo(600) })],
      latestRunEventAt: minutesAgo(1),
    });
    expect(c.status).toBe("ok");
  });

  it("tolerates hours of silence when only probe-less sources exist", () => {
    const c = run({
      specs: [
        probed({
          probeCapable: false,
          lastProbeAt: null,
          lastRunAt: minutesAgo(600),
        }),
      ],
    });
    expect(c.status).toBe("ok");
  });
});

describe("checkDatabase", () => {
  it("ok / degraded / down by round trip", () => {
    expect(checkDatabase({ ms: 60 }).status).toBe("ok");
    expect(checkDatabase({ ms: 1500 }).status).toBe("degraded");
    expect(checkDatabase({ error: "boom" }).status).toBe("down");
  });
});

describe("checkCollection", () => {
  const stats = {
    approvedSpecs: 3,
    docsToday: 12,
    findingsToday: 2,
    actorCallsToday: 5,
    actorCallCap: null,
  };

  it("is not_configured with no approved sources", () => {
    expect(checkCollection({ ...stats, approvedSpecs: 0 }).status).toBe(
      "not_configured",
    );
  });

  it("is ok and reports counters", () => {
    const c = checkCollection(stats);
    expect(c.status).toBe("ok");
    expect(c.detail).toContain("12 new document(s)");
  });

  it("is degraded and explains the pause once the cap is reached", () => {
    const c = checkCollection({ ...stats, actorCallCap: 5 });
    expect(c.status).toBe("degraded");
    expect(c.detail).toContain("daily collection cap");
  });
});

describe("summarize", () => {
  const mk = (
    id: string,
    status: ProbeStatus,
    required = true,
  ): HealthCheck => ({ id, label: id, status, detail: "", required });

  it("is down when any check is down, and lists required blockers", () => {
    const r = summarize([mk("a", "ok"), mk("b", "down"), mk("c", "degraded")]);
    expect(r.status).toBe("down");
    expect(r.blocking.map((c) => c.id)).toEqual(["b"]);
  });

  it("does not block on a non-required check", () => {
    const r = summarize([mk("a", "ok"), mk("b", "not_configured", false)]);
    expect(r.blocking).toEqual([]);
  });

  it("treats a required not_configured check as blocking", () => {
    expect(summarize([mk("a", "not_configured")]).blocking).toHaveLength(1);
  });

  it("is ok for an empty or all-ok list", () => {
    expect(summarize([]).status).toBe("ok");
    expect(summarize([mk("a", "ok")]).status).toBe("ok");
  });
});

describe("secret hygiene", () => {
  const FAKE = "sk_live_FAKETOKENVALUE987654";

  it("redact strips key= params, bearer tokens and literal secrets", () => {
    const out = redact(
      `GET /x?key=abc123&y=1 Authorization: Bearer tok.en-9 failed for ${FAKE}`,
      [FAKE],
    );
    expect(out).not.toContain("abc123");
    expect(out).not.toContain("tok.en-9");
    expect(out).not.toContain(FAKE);
  });

  it("does not shred ordinary words for short secret values", () => {
    expect(redact("ok fine", ["ok"])).toBe("ok fine");
  });

  it("no evaluator puts a secret in detail or remedy", () => {
    process.env.APIFY_TOKEN = FAKE;
    const checks: HealthCheck[] = [
      checkApifyToken(true),
      checkApifyToken(false),
      checkModelTier({
        tier: "fast",
        expectedProvider: "groq",
        probe: { ok: false, message: redact(`boom key=${FAKE}`, [FAKE]) },
      }),
      checkDatabase({ error: redact(`postgres://u:${FAKE}@h`, [FAKE]) }),
      checkScheduler({
        now: NOW,
        specs: [probed({ lastProbeAt: null })],
        latestRunEventAt: null,
        devMode: true,
      }),
      checkCollection({
        approvedSpecs: 1,
        docsToday: 0,
        findingsToday: 0,
        actorCallsToday: 0,
        actorCallCap: null,
      }),
    ];
    delete process.env.APIFY_TOKEN;
    for (const c of checks) {
      expect(`${c.detail} ${c.remedy ?? ""}`).not.toContain(FAKE);
    }
  });
});

describe("checkScheduler — dev server (definite, not inferred)", () => {
  const args = { now: NOW, specs: [probed()], latestRunEventAt: null, devMode: true };

  it("is DOWN with the one-command fix when the Inngest dev server is not running", () => {
    const c = checkScheduler({ ...args, devServer: "down" });
    expect(c.status).toBe("down");
    expect(c.detail).toContain("nothing will log an error");
    expect(c.remedy).toContain("npm run dev:all");
    expect(c.required).toBe(true);
  });

  it("is down even with no approved sources: the first pass is queued the moment sources are approved", () => {
    expect(checkScheduler({ ...args, specs: [], devServer: "down" }).status).toBe("down");
  });

  it("changes nothing when the server is up, absent from the input, or not applicable", () => {
    expect(checkScheduler({ ...args, devServer: "up" }).status).toBe("ok");
    expect(checkScheduler(args).status).toBe("ok");
    expect(checkScheduler({ ...args, devServer: "not_dev" }).status).toBe("ok");
  });

  it("a down scheduler blocks collection in the summary", () => {
    const c = checkScheduler({ ...args, devServer: "down" });
    expect(summarize([c]).blocking).toHaveLength(1);
  });
});
