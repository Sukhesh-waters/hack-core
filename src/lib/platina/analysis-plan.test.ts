import { describe, expect, it, vi } from "vitest";
import { routeChatWithProvenance } from "@/lib/ai/router";
import { OWN_BRAND_SKIP, planAnalysis, type SurpriseDeps } from "./analysis-plan";
import { runContradictionRound } from "./debate";
import type { Expectation } from "./surprise";

vi.mock("@/lib/ai/router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/router")>();
  return { ...actual, routeChatWithProvenance: vi.fn() };
});
const routeMock = routeChatWithProvenance as unknown as ReturnType<typeof vi.fn>;

const prose =
  "Bluebird Roasters has introduced a 48-hour roast guarantee for wholesale buyers across the country. ".repeat(
    8,
  );

const signal = {
  title: "Roast guarantee",
  body: prose,
  sourceUrl: "https://bluebird.example/news/roast-guarantee",
  canonicalUrl: "https://bluebird.example/news/roast-guarantee",
  sourceKind: "competitor_site",
  fetchedAt: new Date("2026-09-21T09:00:00Z"),
};

const competitor = {
  kind: "competitor",
  brandName: "Bluebird Roasters",
  clientName: "Northwind Coffee",
  sourceKind: "competitor_site",
};

const noPrevious = () => Promise.resolve(null);

describe("the cost guarantee", () => {
  it("skips a client's own page without reading anything else", async () => {
    const loadPrevious = vi.fn(noPrevious);
    const plan = await planAnalysis({
      signal,
      subject: { ...competitor, kind: "own_brand" },
      loadPrevious,
    });

    expect(plan).toEqual({ action: "skip", reason: OWN_BRAND_SKIP, cause: "own_brand" });
    expect(loadPrevious).not.toHaveBeenCalled();
  });

  it("skips a boilerplate page BEFORE the previous-version query", async () => {
    const loadPrevious = vi.fn(noPrevious);
    const plan = await planAnalysis({
      signal: {
        ...signal,
        canonicalUrl: "https://bluebird.example/privacy",
        sourceUrl: "https://bluebird.example/privacy",
      },
      subject: competitor,
      loadPrevious,
    });

    expect(plan.action).toBe("skip");
    expect(plan.action === "skip" && plan.cause).toBe("low_value");
    expect(plan.action === "skip" && plan.reason).toContain("privacy policy");
    // The guarantee: nothing was queried and no input was built, so the caller
    // cannot reach a provider for this document.
    expect(loadPrevious).not.toHaveBeenCalled();
  });

  it("skips a thin page the same way", async () => {
    const loadPrevious = vi.fn(noPrevious);
    const plan = await planAnalysis({
      signal: { ...signal, body: "Call us." },
      subject: competitor,
      loadPrevious,
    });
    expect(plan.action).toBe("skip");
    expect(loadPrevious).not.toHaveBeenCalled();
  });

  it("a skip plan never reaches the debate, so the router is never called (generalised across own_brand, low_value and thin pages)", async () => {
    routeMock.mockReset();
    const plans = await Promise.all([
      planAnalysis({ signal, subject: { ...competitor, kind: "own_brand" }, loadPrevious: noPrevious }),
      planAnalysis({
        signal: { ...signal, canonicalUrl: "https://bluebird.example/privacy", sourceUrl: "https://bluebird.example/privacy" },
        subject: competitor,
        loadPrevious: noPrevious,
      }),
      planAnalysis({ signal: { ...signal, body: "Call us." }, subject: competitor, loadPrevious: noPrevious }),
    ]);
    for (const plan of plans) {
      expect(plan.action).toBe("skip");
      // signal-analyze.ts's own branch: runContradictionRound (and so the
      // router) is only ever called once a plan survives to "analyse".
      if (plan.action === "analyse") await runContradictionRound(plan.input);
    }
    expect(routeMock).not.toHaveBeenCalled();
  });
});

describe("the input a surviving document produces", () => {
  it("names the competitor and the client it is watched for", async () => {
    const plan = await planAnalysis({ signal, subject: competitor, loadPrevious: noPrevious });
    expect(plan.action).toBe("analyse");
    if (plan.action !== "analyse") return;
    expect(plan.input).toContain("Competitor: Bluebird Roasters");
    expect(plan.input).toContain("Watched for client: Northwind Coffee");
    expect(plan.changed).toBe(false);
  });

  it("includes what changed when there is a previous version", async () => {
    const plan = await planAnalysis({
      signal,
      subject: competitor,
      loadPrevious: async () => ({
        title: "Roast guarantee",
        body: "Bluebird Roasters roasts to order for wholesale buyers across the country.",
        fetchedAt: new Date("2026-09-14T09:00:00Z"),
      }),
    });

    expect(plan.action).toBe("analyse");
    if (plan.action !== "analyse") return;
    expect(plan.changed).toBe(true);
    expect(plan.input).toContain("WHAT CHANGED — this is the signal");
    expect(plan.input).toContain("since 7 days ago");
  });

  it("treats a cosmetic-only change as no change", async () => {
    const stable = "Trusted by 1,024 roasters worldwide, with a full wholesale range. ".repeat(8);
    const plan = await planAnalysis({
      signal: { ...signal, body: stable.replace("1,024", "1,031") },
      subject: competitor,
      loadPrevious: async () => ({
        title: "Roast guarantee",
        body: stable,
        fetchedAt: new Date("2026-09-14T09:00:00Z"),
      }),
    });

    expect(plan.action === "analyse" && plan.changed).toBe(false);
  });

  it("says a source is unlinked rather than inventing a competitor", async () => {
    const plan = await planAnalysis({ signal, subject: null, loadPrevious: noPrevious });
    expect(plan.action === "analyse" && plan.input).toContain("not linked to a client");
  });

  it("keeps a social document with measurements even when its caption is short", async () => {
    const plan = await planAnalysis({
      signal: {
        ...signal,
        title: "instagram @bluebird",
        body: "New roast out now.",
        canonicalUrl: "https://instagram.com/p/xyz",
        sourceUrl: "instagram:@bluebird",
        sourceKind: "social_posts",
        metrics: { likes: 412, comments: 18 },
      },
      subject: competitor,
      loadPrevious: noPrevious,
    });

    expect(plan.action).toBe("analyse");
    expect(plan.action === "analyse" && plan.input).toContain("MEASURED ENGAGEMENT");
  });
});

// ---------------------------------------------------------------------------
// B4 — the surprise filter, wired (plan §5 B4; continuation handoff §2,3)
// ---------------------------------------------------------------------------

/** A fake Postgres-backed expectation store, keyed like db/queries/platina-expectations.ts. */
function fakeSurprise(mode: SurpriseDeps["mode"], opts: Partial<SurpriseDeps> & { seed?: Record<string, Expectation> } = {}) {
  const store = new Map<string, Expectation>(Object.entries(opts.seed ?? {}));
  const loadExpectation = vi.fn(async (key: string) => store.get(key) ?? null);
  const saveExpectation = vi.fn(async (key: string, next: Expectation) => {
    store.set(key, next);
  });
  const deps: SurpriseDeps = {
    mode,
    loadExpectation,
    saveExpectation,
    docId: opts.docId ?? "doc-1",
    floor: opts.floor,
    auditShare: opts.auditShare ?? 0,
  };
  return { deps, store, loadExpectation, saveExpectation };
}

// A warm, near-zero-variance history of cosmetic-only changes (novelty 0
// every time) — the realistic shape of a page that rarely says anything new.
const warmQuietNovelty: Expectation = { n: 30, mean: 0, m2: 29 * 0.01 ** 2 };

describe("B4 surprise filter — mode off / absent (byte-identical today)", () => {
  it("absent `surprise`: no extra field on the plan, today's exact shape", async () => {
    const plan = await planAnalysis({ signal, subject: competitor, loadPrevious: noPrevious });
    expect(plan.action).toBe("analyse");
    expect(plan).not.toHaveProperty("surprise");
    expect(plan).not.toHaveProperty("audit");
  });

  it("mode 'off': the dependency is supplied but never touched — no expectation read or write", async () => {
    const { deps, loadExpectation, saveExpectation } = fakeSurprise("off", { seed: { [`nov:${signal.canonicalUrl}`]: warmQuietNovelty } });
    const plan = await planAnalysis({
      signal,
      subject: competitor,
      loadPrevious: () => Promise.resolve({ title: signal.title, body: signal.body, fetchedAt: new Date("2026-09-14T09:00:00Z") }),
      surprise: deps,
    });
    expect(plan.action).toBe("analyse");
    expect(plan).not.toHaveProperty("surprise");
    expect(plan).not.toHaveProperty("audit");
    expect(loadExpectation).not.toHaveBeenCalled();
    expect(saveExpectation).not.toHaveBeenCalled();
  });

  it.each(["on", "shadow"] as const)(
    "mode '%s' fails open: a broken expectation store (table not migrated) analyses as if the stage were off",
    async (mode) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { deps } = fakeSurprise(mode);
      deps.loadExpectation = vi.fn(async () => {
        throw new Error('relation "platina_expectations" does not exist');
      });
      const plan = await planAnalysis({
        signal,
        subject: competitor,
        loadPrevious: () => Promise.resolve({ title: signal.title, body: signal.body, fetchedAt: new Date("2026-09-14T09:00:00Z") }),
        surprise: deps,
      });
      expect(plan.action).toBe("analyse");
      expect(plan).not.toHaveProperty("surprise");
      expect(plan).not.toHaveProperty("audit");
      warn.mockRestore();
    },
  );
});

describe("B4 surprise filter — novelty (web/press/trade pages)", () => {
  const previousBody = signal.body; // one unchanged "line" (no \n) once collapsed

  it("mode 'on': a cosmetic-only change against a warm, quiet history skips, cause 'surprise', and NEVER calls the provider", async () => {
    routeMock.mockReset();
    const { deps, saveExpectation } = fakeSurprise("on", {
      seed: { [`nov:${signal.canonicalUrl}`]: warmQuietNovelty },
      auditShare: 0,
    });
    const plan = await planAnalysis({
      signal: { ...signal, body: previousBody.replace("48-hour", "49-hour") }, // cosmetic only -> change-diff.ts returns null
      subject: competitor,
      loadPrevious: () => Promise.resolve({ title: signal.title, body: previousBody, fetchedAt: new Date("2026-09-14T09:00:00Z") }),
      surprise: deps,
    });
    expect(plan.action).toBe("skip");
    expect(plan.action === "skip" && plan.cause).toBe("surprise");
    expect(plan.action === "skip" && plan.reason).toBe("nothing unusual compared with this page's normal changes");
    // The expectation is saved even on a skip — see surprise.ts's file header.
    expect(saveExpectation).toHaveBeenCalledWith(`nov:${signal.canonicalUrl}`, expect.objectContaining({ n: 31 }));
    if (plan.action === "analyse") await runContradictionRound(plan.input);
    expect(routeMock).not.toHaveBeenCalled();
  });

  it("mode 'on': a genuinely new paragraph (unlike this page's own history) still analyses, reason 'more new than usual'", async () => {
    const newLine = "An entirely unprecedented quantum thermal micro-roasting breakthrough redefines wholesale logistics.";
    const current = `${previousBody}\n${newLine}`;
    const { deps } = fakeSurprise("on", { seed: { [`nov:${signal.canonicalUrl}`]: warmQuietNovelty }, auditShare: 0 });
    const plan = await planAnalysis({
      signal: { ...signal, body: current },
      subject: competitor,
      loadPrevious: () => Promise.resolve({ title: signal.title, body: previousBody, fetchedAt: new Date("2026-09-14T09:00:00Z") }),
      surprise: deps,
    });
    expect(plan.action).toBe("analyse");
  });

  it("mode 'on', below minN (cold start): always analyses regardless of the statistic", async () => {
    const { deps, saveExpectation } = fakeSurprise("on", { seed: { [`nov:${signal.canonicalUrl}`]: { n: 2, mean: 0, m2: 0 } } });
    const plan = await planAnalysis({
      signal: { ...signal, body: previousBody.replace("48-hour", "49-hour") },
      subject: competitor,
      loadPrevious: () => Promise.resolve({ title: signal.title, body: previousBody, fetchedAt: new Date("2026-09-14T09:00:00Z") }),
      surprise: deps,
    });
    expect(plan.action).toBe("analyse");
    expect(saveExpectation).toHaveBeenCalled(); // still persisted, cold start or not
  });

  it("mode 'on', first sighting (no previous version at all): always analyses", async () => {
    const { deps } = fakeSurprise("on", { seed: { [`nov:${signal.canonicalUrl}`]: warmQuietNovelty } });
    const plan = await planAnalysis({ signal, subject: competitor, loadPrevious: noPrevious, surprise: deps });
    expect(plan.action).toBe("analyse");
  });

  it("mode 'on', audit share 1: a would-skip document is analysed anyway and labelled `audit: true`", async () => {
    const { deps } = fakeSurprise("on", {
      seed: { [`nov:${signal.canonicalUrl}`]: warmQuietNovelty },
      auditShare: 1,
    });
    const plan = await planAnalysis({
      signal: { ...signal, body: previousBody.replace("48-hour", "49-hour") },
      subject: competitor,
      loadPrevious: () => Promise.resolve({ title: signal.title, body: previousBody, fetchedAt: new Date("2026-09-14T09:00:00Z") }),
      surprise: deps,
    });
    expect(plan.action).toBe("analyse");
    expect(plan.action === "analyse" && plan.audit).toBe(true);
  });

  it("mode 'shadow': a would-skip document is still analysed, and carries `surprise.wouldSkip = true` for the job to log", async () => {
    const { deps } = fakeSurprise("shadow", { seed: { [`nov:${signal.canonicalUrl}`]: warmQuietNovelty } });
    const plan = await planAnalysis({
      signal: { ...signal, body: previousBody.replace("48-hour", "49-hour") },
      subject: competitor,
      loadPrevious: () => Promise.resolve({ title: signal.title, body: previousBody, fetchedAt: new Date("2026-09-14T09:00:00Z") }),
      surprise: deps,
    });
    expect(plan.action).toBe("analyse"); // shadow NEVER skips
    expect(plan.action === "analyse" && plan.surprise?.wouldSkip).toBe(true);
    expect(plan.action === "analyse" && plan.surprise?.reason).toBe("nothing unusual compared with this page's normal changes");
  });

  it("mode 'shadow': a genuinely new paragraph carries `wouldSkip = false`", async () => {
    const newLine = "An entirely unprecedented quantum thermal micro-roasting breakthrough redefines wholesale logistics.";
    const { deps } = fakeSurprise("shadow", { seed: { [`nov:${signal.canonicalUrl}`]: warmQuietNovelty } });
    const plan = await planAnalysis({
      signal: { ...signal, body: `${previousBody}\n${newLine}` },
      subject: competitor,
      loadPrevious: () => Promise.resolve({ title: signal.title, body: previousBody, fetchedAt: new Date("2026-09-14T09:00:00Z") }),
      surprise: deps,
    });
    expect(plan.action === "analyse" && plan.surprise?.wouldSkip).toBe(false);
  });
});

describe("B4 surprise filter — social posts (engagement)", () => {
  const socialSignal = {
    ...signal,
    title: "instagram @bluebird",
    body: "New roast out now, announced to our wholesale partners this morning across every region.",
    canonicalUrl: "https://instagram.com/p/xyz",
    sourceUrl: "instagram:@bluebird",
    sourceKind: "social_posts",
  };

  it("computable engagement: reads/writes the eng:<brandId> key", async () => {
    const { deps, loadExpectation, saveExpectation } = fakeSurprise("on", {
      seed: { "eng:brand-1": { n: 20, mean: 50, m2: 19 * 5 ** 2 } },
    });
    const plan = await planAnalysis({
      signal: { ...socialSignal, metrics: { likes: 412, comments: 18 } },
      subject: { ...competitor, brandId: "brand-1" },
      loadPrevious: noPrevious,
      surprise: deps,
    });
    expect(loadExpectation).toHaveBeenCalledWith("eng:brand-1");
    expect(saveExpectation).toHaveBeenCalledWith("eng:brand-1", expect.objectContaining({ n: 21 }));
    expect(plan.action).toBe("analyse"); // 430 is wildly above a mean of 50 -> would trigger, not skip
  });

  it("no metrics at all: the filter is skipped (never invented) — no read or write, analyses exactly as mode='off' would", async () => {
    const { deps, loadExpectation, saveExpectation } = fakeSurprise("on", {});
    // Long enough prose to pass scoreSignal's thinness gate on its own (no
    // metricsPresent bypass to confuse what this test is isolating): the
    // point is the surprise filter's OWN "no metrics -> skip the filter"
    // behaviour, not the earlier low-value triage.
    const longCaption = "New roast out now, announced to our wholesale partners this morning. ".repeat(8);
    const plan = await planAnalysis({
      signal: { ...socialSignal, body: longCaption, metrics: null },
      subject: { ...competitor, brandId: "brand-1" },
      loadPrevious: noPrevious,
      surprise: deps,
    });
    expect(loadExpectation).not.toHaveBeenCalled();
    expect(saveExpectation).not.toHaveBeenCalled();
    expect(plan.action).toBe("analyse");
  });

  it("no brandId (unlinked source): the filter is skipped — cannot form a per-brand key", async () => {
    const { deps, loadExpectation } = fakeSurprise("on", {});
    const plan = await planAnalysis({
      signal: { ...socialSignal, metrics: { likes: 412, comments: 18 } },
      subject: { ...competitor, brandId: null },
      loadPrevious: noPrevious,
      surprise: deps,
    });
    expect(loadExpectation).not.toHaveBeenCalled();
    expect(plan.action).toBe("analyse");
  });
});

describe("B4 surprise filter — ad library (ad_days_running)", () => {
  const adSignal = {
    ...signal,
    // No metricsPresent bypass for ad_library, so this needs real length to
    // pass scoreSignal's thinness gate on its own merits.
    body: "Sponsored: Bluebird Roasters wholesale starter kit now available for new cafe partners everywhere. ".repeat(
      6,
    ),
    canonicalUrl: "https://www.linkedin.com/ad-library/detail/12345",
    sourceKind: "ad_library",
    fetchedAt: new Date("2026-09-21T09:00:00Z"),
    raw: { availability: { start: "2026-08-01" } },
  };

  it("ad_days_running available: reads/writes the ads:<brandId> key", async () => {
    const { deps, loadExpectation, saveExpectation } = fakeSurprise("on", {
      seed: { "ads:brand-1": { n: 10, mean: 5, m2: 9 * 2 ** 2 } },
    });
    const plan = await planAnalysis({
      signal: adSignal,
      subject: { ...competitor, brandId: "brand-1" },
      loadPrevious: noPrevious,
      surprise: deps,
    });
    expect(loadExpectation).toHaveBeenCalledWith("ads:brand-1");
    expect(saveExpectation).toHaveBeenCalled();
    expect(plan.action).toBe("analyse");
  });

  it("no start date on the ad (ad_days_running not available): the filter is skipped, never invented", async () => {
    const { deps, loadExpectation } = fakeSurprise("on", {});
    const plan = await planAnalysis({
      signal: { ...adSignal, raw: {} },
      subject: { ...competitor, brandId: "brand-1" },
      loadPrevious: noPrevious,
      surprise: deps,
    });
    expect(loadExpectation).not.toHaveBeenCalled();
    expect(plan.action).toBe("analyse");
  });
});
