import { z } from "zod";

import { contentType, isVideoContentType } from "@/db/schema";

export const slugSchema = z
  .string()
  .min(3, "Must be at least 3 characters")
  .max(32, "Must be 32 characters or fewer")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Lowercase letters, numbers and hyphens only",
  );

export const orgClaimSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(60),
  slug: slugSchema,
});

export const workspaceSetupSchema = z.object({
  orgId: z.string().min(1, "Missing organization"),
  name: z.string().trim().min(2, "Name is too short").max(60),
  slug: slugSchema,
});

export const joinWorkspaceSchema = z.object({
  code: z
    .string()
    .trim()
    .min(3, "Enter a workspace slug or invite code")
    .max(64),
});

export const emailSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
});

export function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export const clientIntakeSchema = z.object({
  workspaceId: z.string().min(1, "Missing workspace"),
  name: z.string().trim().min(2, "Name is too short").max(60),
  handle: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((value) => (value === "" ? undefined : value)),
});

const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Colors must be 6-digit hex like #0d9488");

const chip = z.string().trim().min(1).max(60);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((value) => (value ? value : null));

const optionalLink = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((value) => (value ? value : undefined));

/** Mirrors BrandContext (src/db/schema.ts) — the wizard's final payload. */
export const brandContextSchema = z.object({
  brandType: z.enum([
    "personal_brand",
    "product_promotion",
    "aesthetic_lifestyle",
    "minimalistic",
    "educational_authority",
    "community_ugc",
  ]),
  mission: z.string().trim().min(4, "Add a 1–2 sentence mission").max(300),
  showcaseTheme: z
    .string()
    .trim()
    .min(2, "Describe the showcase theme")
    .max(120),
  tones: z.array(chip).max(12).default([]),
  pillars: z.array(chip).max(12).default([]),
  bannedWords: z
    .array(chip.transform((w) => w.toLowerCase()))
    .max(50)
    .default([]),
  avoidTopics: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  colors: z.array(hexColor).max(8).default([]),
  typography: optionalText(160),
  logoUrl: optionalText(400),
  links: z
    .object({
      website: optionalLink,
      instagram: optionalLink,
      facebook: optionalLink,
      other: z.array(z.string().trim().min(1).max(200)).max(6).optional(),
    })
    .optional()
    .transform(
      (
        value,
      ): {
        website?: string;
        instagram?: string;
        facebook?: string;
        other?: string[];
      } => value ?? {},
    ),
});

/** Full intake wizard submit: client profile + declared brand context. */
export const clientWithContextSchema = z.object({
  workspaceId: z.string().min(1, "Missing workspace"),
  name: z.string().trim().min(2, "Name is too short").max(60),
  handle: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((value) => (value ? value : undefined)),
  context: brandContextSchema,
});

/** Harness config (Slice E): what Apify scrapes, how much, when. */
export const harnessRuleSchema = z.object({
  workspaceId: z.string().min(1, "Missing workspace"),
  segments: z
    .array(
      z.object({
        kind: z.enum(["competitor_handle", "hashtag", "niche_query"]),
        value: z.string().trim().min(1, "Segment value required").max(120),
        note: z
          .string()
          .trim()
          .max(200)
          .optional()
          .transform((v) => (v ? v : undefined)),
        /** A2: route to reels actor when "reels"; default "posts". */
        target: z.enum(["posts", "reels"]).default("posts").optional(),
        /** A4: opt-in comment mining for top posts in this segment. */
        mineComments: z.boolean().default(false).optional(),
      }),
    )
    .max(12, "Keep it to 12 segments"),
  maxPostsPerRun: z.coerce
    .number()
    .int()
    .min(1)
    .max(100, "Hard cap is 100 posts per run"),
  cadence: z.enum(["manual", "daily", "weekly"]),
  enabled: z.boolean(),
});

/**
 * S1 — the plan-grid fields on `content`.
 *
 * The duration/type invariant lives here rather than in the DB on purpose: a
 * static row carrying a duration is a caller mistake worth surfacing, and a
 * CHECK constraint would surface it as an opaque 500 instead of a field error.
 * S2's per-cell action and S5's apply path both reuse this, so an AI
 * suggestion can never write a value a human couldn't.
 */
export const contentPlanFieldsSchema = z
  .object({
    type: z.enum(contentType.enumValues),
    durationSec: z.coerce
      .number()
      .int("Duration must be whole seconds")
      .positive("Duration must be greater than zero")
      .max(7200, "Keep durations under two hours")
      .nullable()
      .optional(),
    pillar: z.string().trim().max(120).nullable().optional(),
    strategyNote: z.string().trim().max(2000).nullable().optional(),
    assigneeId: z.string().min(1).nullable().optional(),
    dueAt: z.coerce.date().nullable().optional(),
  })
  .refine(
    (v) => v.durationSec == null || isVideoContentType(v.type),
    {
      message:
        "Duration only applies to video formats — reel, talking head or motion graphic.",
      path: ["durationSec"],
    },
  );

/** Brand Gene → Knowledge tab: paste-a-URL ingest. */
export const ingestUrlSchema = z.object({
  workspaceId: z.string().min(1, "Missing workspace"),
  clientId: z.string().min(1, "Pick a client"),
  url: z
    .string()
    .trim()
    .url("Enter a valid URL")
    .refine(
      (u) => u.startsWith("http://") || u.startsWith("https://"),
      "Only http/https URLs are supported.",
    ),
});

/** Ask InstaMedia floating assistant. */
export const askSchema = z.object({
  workspaceId: z.string().min(1, "Missing workspace"),
  question: z
    .string()
    .trim()
    .min(3, "Ask a fuller question")
    .max(500, "Keep questions under 500 characters"),
});

export const connectMetaSchema = z.object({
  workspaceId: z.string().min(1, "Missing workspace"),
  clientId: z.string().min(1, "Pick a client"),
  igUserId: z.string().trim().min(1, "Instagram user id is required").max(64),
  accessToken: z.string().trim().min(10, "Paste the page access token"),
});

/** Ads Management → 5-step campaign builder's final submit. */
export const campaignSchema = z.object({
  workspaceId: z.string().min(1, "Missing workspace"),
  clientId: z.string().min(1, "Pick a client"),
  name: z.string().trim().min(2, "Name is too short").max(120),
  objective: z.enum([
    "awareness",
    "traffic",
    "engagement",
    "leads",
    "conversions",
  ]),
  audience: z.object({
    demographics: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((v) => (v ? v : undefined)),
    interests: z.array(z.string()).default([]),
    locations: z.array(z.string()).default([]),
  }),
  budget: z.coerce.number().positive("Budget must be greater than zero"),
  startDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), {
    message: "Invalid start date",
  }),
  endDate: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => !v || !Number.isNaN(Date.parse(v)), {
      message: "Invalid end date",
    }),
  creativeContentId: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  creativeNote: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export const publicPageSchema = z.object({
  workspaceId: z.string().min(1, "Missing workspace"),
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .transform((value) => value.replace(/^@/, ""))
    .pipe(
      z
        .string()
        .min(2, "Enter an Instagram handle")
        .max(60)
        .regex(/^[a-z0-9._]+$/, "Letters, numbers, dots and underscores only"),
    ),
});

export const clientGoalSchema = z
  .object({
    title: z.string().trim().min(1, "Give the goal a title").max(160),
    // Free text on purpose. A structured {audience, variable, metric} shape is
    // a DSL and would fill with junk on a 4-client dataset. Revisit only if
    // free text proves unusable in practice.
    hypothesis: z.string().trim().max(1000).nullish(),
    metric: z.string().trim().min(1, "Name the metric this goal moves").max(80),
    targetWindowStart: z.coerce.date(),
    targetWindowEnd: z.coerce.date(),
  })
  .refine((v) => v.targetWindowEnd.getTime() > v.targetWindowStart.getTime(), {
    message: "The goal window must end after it starts",
    path: ["targetWindowEnd"],
  });

export const decisionSchema = z.object({
  title: z.string().trim().min(1, "Give the decision a title").max(160),
  reason: z.string().trim().min(1, "Say why").max(1000),
  expectedOutcome: z
    .string()
    .trim()
    .min(1, "Say what you expect to happen")
    .max(500),
  reviewAt: z.coerce.date(),
});
