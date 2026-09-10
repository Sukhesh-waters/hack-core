import { describe, expect, it } from "vitest";
import {
  brandContextSchema,
  clientGoalSchema,
  clientIntakeSchema,
  decisionSchema,
  contentPlanFieldsSchema,
  clientWithContextSchema,
  connectMetaSchema,
  harnessRuleSchema,
  ingestUrlSchema,
  joinWorkspaceSchema,
  publicPageSchema,
  orgClaimSchema,
  slugify,
  slugSchema,
  workspaceSetupSchema,
} from "./validation";

describe("slugSchema", () => {
  it("accepts clean slugs", () => {
    expect(slugSchema.safeParse("acme-skincare").success).toBe(true);
  });

  it.each(["AB", "Has Spaces", "UPPER", "trailing-", "-leading", "a".repeat(40)])(
    "rejects %s",
    (bad) => {
      expect(slugSchema.safeParse(bad).success).toBe(false);
    },
  );
});

describe("slugify", () => {
  it("normalizes names to valid slugs", () => {
    expect(slugify("Acme Skincare Co.")).toBe("acme-skincare-co");
    expect(slugSchema.safeParse(slugify("Promotizar Digital!")).success).toBe(
      true,
    );
  });

  it("collapses multiple spaces and hyphens into a single hyphen", () => {
    expect(slugify("Onboarding   Runbook")).toBe("onboarding-runbook");
    expect(slugify("Already--Hyphenated---Title")).toBe(
      "already-hyphenated-title",
    );
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  -Leading and trailing-  ")).toBe(
      "leading-and-trailing",
    );
    expect(slugify("---Weird Title---")).toBe("weird-title");
  });
});

describe("form schemas", () => {
  it("orgClaimSchema requires name and slug", () => {
    expect(orgClaimSchema.safeParse({ name: "A", slug: "ok-slug" }).success).toBe(
      false,
    );
    expect(
      orgClaimSchema.safeParse({ name: "Agency", slug: "agency" }).success,
    ).toBe(true);
  });

  it("workspaceSetupSchema requires an orgId", () => {
    expect(
      workspaceSetupSchema.safeParse({ orgId: "", name: "X Y", slug: "x-y" })
        .success,
    ).toBe(false);
  });

  it("joinWorkspaceSchema trims and bounds the code", () => {
    expect(joinWorkspaceSchema.safeParse({ code: "  abc123  " }).success).toBe(
      true,
    );
    expect(joinWorkspaceSchema.safeParse({ code: "ab" }).success).toBe(false);
  });
});

describe("clientIntakeSchema", () => {
  it("accepts a name with optional handle", () => {
    expect(
      clientIntakeSchema.safeParse({
        workspaceId: "ws_1",
        name: "Acme Coffee",
        handle: "@acmecoffee",
      }).success,
    ).toBe(true);
  });

  it("rejects a missing name", () => {
    expect(
      clientIntakeSchema.safeParse({ workspaceId: "ws_1", name: "" }).success,
    ).toBe(false);
  });
});

describe("connector schemas", () => {
  it("connectMetaSchema requires client, ig user id, and token", () => {
    expect(
      connectMetaSchema.safeParse({
        workspaceId: "ws_1",
        clientId: "c_1",
        igUserId: "1789",
        accessToken: "IGQVJtoken",
      }).success,
    ).toBe(true);
    expect(
      connectMetaSchema.safeParse({
        workspaceId: "ws_1",
        clientId: "c_1",
        igUserId: "",
        accessToken: "",
      }).success,
    ).toBe(false);
  });

  it("publicPageSchema normalizes the handle", () => {
    const parsed = publicPageSchema.safeParse({
      workspaceId: "ws_1",
      handle: "  @Competitor.Coffee ",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.handle).toBe("competitor.coffee");
  });
});

describe("ingestUrlSchema", () => {
  it("accepts a valid https URL", () => {
    expect(
      ingestUrlSchema.safeParse({
        workspaceId: "ws_1",
        clientId: "c_1",
        url: "https://example.com/about",
      }).success,
    ).toBe(true);
  });

  it("rejects non-http(s) schemes and malformed URLs", () => {
    expect(
      ingestUrlSchema.safeParse({
        workspaceId: "ws_1",
        clientId: "c_1",
        url: "ftp://example.com/file",
      }).success,
    ).toBe(false);
    expect(
      ingestUrlSchema.safeParse({
        workspaceId: "ws_1",
        clientId: "c_1",
        url: "not-a-url",
      }).success,
    ).toBe(false);
  });
});

describe("brandContextSchema", () => {
  const valid = {
    brandType: "aesthetic_lifestyle",
    mission: "Barrier repair, without the guesswork.",
    showcaseTheme: "Minimal, warm, editorial",
    tones: ["Warm", "Authentic"],
    pillars: ["Education"],
    bannedWords: ["Cure", "  Clinical Claims "],
    avoidTopics: ["competitor comparisons"],
    colors: ["#0d9488", "#F59E0B"],
    typography: "Serif display / clean sans body",
    logoUrl: "https://example.com/logo.png",
    links: { website: "aurora-skincare.com", instagram: "" },
  };

  it("accepts a full valid context and lowercases/trims banned words", () => {
    const parsed = brandContextSchema.parse(valid);
    expect(parsed.brandType).toBe("aesthetic_lifestyle");
    expect(parsed.bannedWords).toEqual(["cure", "clinical claims"]);
    expect(parsed.links.website).toBe("aurora-skincare.com");
    expect(parsed.links.instagram).toBeUndefined();
  });

  it("rejects bad hex colors", () => {
    expect(
      brandContextSchema.safeParse({ ...valid, colors: ["teal"] }).success,
    ).toBe(false);
    expect(
      brandContextSchema.safeParse({ ...valid, colors: ["#0d94"] }).success,
    ).toBe(false);
  });

  it("allows empty tones/pillars and missing optional fields", () => {
    const parsed = brandContextSchema.parse({
      brandType: "personal_brand",
      mission: "Teach in public.",
      showcaseTheme: "Founder voice",
      tones: [],
      pillars: [],
      bannedWords: [],
      avoidTopics: [],
      colors: [],
    });
    expect(parsed.tones).toEqual([]);
    expect(parsed.typography).toBeNull();
    expect(parsed.logoUrl).toBeNull();
    expect(parsed.links).toEqual({});
  });

  it("rejects an unknown brand type", () => {
    expect(
      brandContextSchema.safeParse({ ...valid, brandType: "corporate" })
        .success,
    ).toBe(false);
  });
});

describe("clientWithContextSchema", () => {
  it("wraps client profile + context; empty handle drops out", () => {
    const parsed = clientWithContextSchema.parse({
      workspaceId: "ws1",
      name: "Aurora Skincare",
      handle: "",
      context: {
        brandType: "product_promotion",
        mission: "Skin health made simple.",
        showcaseTheme: "Clean product studio",
        tones: ["Warm"],
        pillars: [],
        bannedWords: [],
        avoidTopics: [],
        colors: [],
      },
    });
    expect(parsed.handle).toBeUndefined();
    expect(parsed.context.brandType).toBe("product_promotion");
  });
});

describe("harnessRuleSchema — A2/A4 segment fields", () => {
  it("round-trips target=reels and mineComments from the UI payload", () => {
    const parsed = harnessRuleSchema.parse({
      workspaceId: "ws_1",
      segments: [
        {
          kind: "competitor_handle",
          value: "@rival",
          target: "reels",
          mineComments: true,
        },
      ],
      maxPostsPerRun: 50,
      cadence: "weekly",
      enabled: true,
    });
    expect(parsed.segments[0].target).toBe("reels");
    expect(parsed.segments[0].mineComments).toBe(true);
  });

  it("defaults target to posts when the field is omitted", () => {
    const parsed = harnessRuleSchema.parse({
      workspaceId: "ws_1",
      segments: [{ kind: "hashtag", value: "#skincare" }],
      maxPostsPerRun: 30,
      cadence: "manual",
      enabled: false,
    });
    expect(parsed.segments[0].target).toBe("posts");
  });

  it("rejects a run cap above the 100 hard cap", () => {
    const result = harnessRuleSchema.safeParse({
      workspaceId: "ws_1",
      segments: [{ kind: "hashtag", value: "#skincare" }],
      maxPostsPerRun: 500,
      cadence: "manual",
      enabled: false,
    });
    expect(result.success).toBe(false);
  });
});

describe("contentPlanFieldsSchema (S1)", () => {
  it("accepts a duration on a reel", () => {
    const result = contentPlanFieldsSchema.safeParse({
      type: "reel",
      durationSec: 30,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a duration on the new video formats", () => {
    for (const type of ["talking_head", "motion_graphic"]) {
      const result = contentPlanFieldsSchema.safeParse({
        type,
        durationSec: 45,
      });
      expect(result.success, `${type} should allow a duration`).toBe(true);
    }
  });

  it("rejects a duration on a static row", () => {
    const result = contentPlanFieldsSchema.safeParse({
      type: "static",
      durationSec: 30,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["durationSec"]);
    }
  });

  it("rejects a duration on a carousel", () => {
    const result = contentPlanFieldsSchema.safeParse({
      type: "carousel",
      durationSec: 12,
    });
    expect(result.success).toBe(false);
  });

  it("allows a static row with no duration", () => {
    const result = contentPlanFieldsSchema.safeParse({
      type: "static",
      pillar: "Education",
    });
    expect(result.success).toBe(true);
  });

  it("treats an explicit null duration as absent, not as a violation", () => {
    const result = contentPlanFieldsSchema.safeParse({
      type: "static",
      durationSec: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a zero or negative duration on a video format", () => {
    for (const durationSec of [0, -5]) {
      const result = contentPlanFieldsSchema.safeParse({
        type: "reel",
        durationSec,
      });
      expect(result.success, `${durationSec} should be rejected`).toBe(false);
    }
  });

  it("rejects an unknown content type", () => {
    const result = contentPlanFieldsSchema.safeParse({ type: "podcast" });
    expect(result.success).toBe(false);
  });
});

describe("clientGoalSchema", () => {
  const base = {
    title: "Grow saves on educational reels",
    hypothesis: "Educational hooks outperform promotional ones for this audience",
    metric: "saves",
    targetWindowStart: "2026-09-01",
    targetWindowEnd: "2026-11-30",
  };

  it("accepts a well-formed goal", () => {
    expect(clientGoalSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a goal with no hypothesis", () => {
    const rest = {
      title: base.title,
      metric: base.metric,
      targetWindowStart: base.targetWindowStart,
      targetWindowEnd: base.targetWindowEnd,
    };
    expect(clientGoalSchema.safeParse(rest).success).toBe(true);
  });

  it("rejects a window that ends before it starts", () => {
    const result = clientGoalSchema.safeParse({
      ...base,
      targetWindowStart: "2026-11-30",
      targetWindowEnd: "2026-09-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty title and an empty metric", () => {
    expect(clientGoalSchema.safeParse({ ...base, title: "" }).success).toBe(false);
    expect(clientGoalSchema.safeParse({ ...base, metric: "" }).success).toBe(false);
  });
});

describe("decisionSchema", () => {
  const base = {
    title: "Switch to educational hooks",
    reason: "Underperforming promotional posts, per the last quarter's reporting",
    expectedOutcome: "Engagement rate rises above the current baseline median",
    reviewAt: "2026-09-01",
  };

  it("accepts a well-formed decision", () => {
    expect(decisionSchema.safeParse(base).success).toBe(true);
  });

  it("rejects an empty title, reason, or expected outcome", () => {
    expect(decisionSchema.safeParse({ ...base, title: "" }).success).toBe(false);
    expect(decisionSchema.safeParse({ ...base, reason: "" }).success).toBe(false);
    expect(
      decisionSchema.safeParse({ ...base, expectedOutcome: "" }).success,
    ).toBe(false);
  });

  it("rejects a missing review date", () => {
    const rest = {
      title: base.title,
      reason: base.reason,
      expectedOutcome: base.expectedOutcome,
    };
    expect(decisionSchema.safeParse(rest).success).toBe(false);
  });
});
