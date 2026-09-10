/**
 * Multi-actor Apify registry (Plan A1). Each entry defines:
 * - slug: Apify actor identifier (owner~name)
 * - envOverrideKey: optional env var to swap the actor ID
 * - buildInput: transforms caller params into the actor's expected JSON body
 * - mapOutput: normalises raw Apify items into our internal types
 *
 * Constitution: Apify actors only; every row lands in the pattern layer
 * tagged source=public, weight neutral.
 */

// ---------------------------------------------------------------------------
// Shared output types
// ---------------------------------------------------------------------------

export type PatternPostItem = {
  externalId?: string;
  caption?: string;
  format: string | null;
  postedAt: Date;
  likes?: number;
  comments?: number;
  views?: number;
  raw: unknown;
};

export type PatternProfileItem = {
  handle: string;
  followers: number;
  following: number;
  postsCount: number;
  bio: string | null;
  isVerified: boolean;
  businessCategory: string | null;
  profilePicUrl: string | null;
  externalUrl: string | null;
  raw: unknown;
};

export type PatternCommentItem = {
  authorHandle: string | null;
  text: string;
  likes: number;
  takenAt: Date;
  raw: unknown;
};

export type PatternAdLibraryItem = {
  externalId?: string;
  pageHandle: string;
  adBody: string | null;
  adFormat: string | null;
  targetAudience: string | null;
  postedAt: Date;
  raw: unknown;
};

// ---------------------------------------------------------------------------
// Raw Apify response shapes (minimal — we only map what we need)
// ---------------------------------------------------------------------------

type RawPostItem = {
  id?: string;
  caption?: string;
  timestamp?: string;
  likesCount?: number;
  commentsCount?: number;
  videoViewCount?: number;
  type?: string;
};

type RawReelItem = {
  id?: string;
  caption?: string;
  timestamp?: string;
  likesCount?: number;
  commentsCount?: number;
  videoPlayCount?: number;
  videoViewCount?: number;
  type?: string;
};

type RawProfileItem = {
  username?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  biography?: string;
  verified?: boolean;
  businessCategoryName?: string;
  profilePicUrl?: string;
  externalUrl?: string;
};

type RawCommentItem = {
  id?: string;
  ownerUsername?: string;
  text?: string;
  likesCount?: number;
  timestamp?: string;
};

type RawDeepPostItem = RawPostItem; // same shape, richer fields

type RawTikTokPostItem = {
  id?: string;
  desc?: string;
  createTime?: number; // unix seconds
  diggCount?: number;
  commentCount?: number;
  playCount?: number;
  shareCount?: number;
  authorMeta?: { name?: string };
};

type RawTikTokProfileItem = {
  uniqueId?: string;
  followerCount?: number;
  followingCount?: number;
  videoCount?: number;
  signature?: string;
  verified?: boolean;
  avatarThumb?: string;
};

type RawAdLibraryItem = {
  id?: string;
  page_name?: string;
  ad_creative_bodies?: string[];
  ad_creative_link_titles?: string[];
  ad_delivery_start_time?: string;
  publisher_platforms?: string[];
  bylines?: string;
  estimated_audience_size?: { lower_bound?: number; upper_bound?: number };
};

// ---------------------------------------------------------------------------
// Mapper helpers
// ---------------------------------------------------------------------------

function safeDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Input builders
// ---------------------------------------------------------------------------

export type PostsInput = {
  directUrls?: string[];
  hashtags?: string[];
  resultsLimit: number;
};

export type ReelsInput = {
  /** Reel scraper requires username[] — NOT directUrls */
  username?: string[];
  hashtags?: string[];
  resultsLimit: number;
};

export type ProfileInput = {
  usernames: string[];
};

export type CommentInput = {
  /** Direct URL to the post whose comments we want */
  directUrls: string[];
  resultsLimit: number;
};

export type DeepPostInput = {
  /** Post scraper requires username[] — NOT directUrls */
  username: string[];
  resultsLimit: number;
};

export type TikTokPostsInput = {
  profiles?: string[];
  hashtags?: string[];
  resultsLimit: number;
};

export type TikTokProfileInput = {
  profiles: string[];
};

export type AdLibraryInput = {
  /** Facebook page name or ID to search ads for */
  searchTerms: string[];
  resultsLimit: number;
};

// ---------------------------------------------------------------------------
// Actor registry
// ---------------------------------------------------------------------------

export type ActorKey =
  | "posts"
  | "reels"
  | "profile"
  | "comments"
  | "deep_post"
  | "tiktok_posts"
  | "tiktok_profile"
  | "ad_library";

export type ActorEntry<TInput, TRaw, TOutput> = {
  key: ActorKey;
  slug: string;
  envOverrideKey: string;
  buildInput: (params: TInput) => Record<string, unknown>;
  mapOutput: (raw: TRaw[]) => TOutput[];
};

// --- Posts (current default: apify~instagram-scraper) -----------------------
export const postsActor: ActorEntry<PostsInput, RawPostItem, PatternPostItem> =
  {
    key: "posts",
    slug: "apify~instagram-scraper",
    envOverrideKey: "APIFY_ACTOR_POSTS",
    buildInput: (params) => ({
      ...(params.directUrls ? { directUrls: params.directUrls } : {}),
      ...(params.hashtags ? { hashtags: params.hashtags } : {}),
      resultsType: "posts",
      resultsLimit: params.resultsLimit,
    }),
    mapOutput: (items) =>
      items.flatMap((item) => {
        const postedAt = safeDate(item.timestamp);
        if (!postedAt) return [];
        return [
          {
            externalId: item.id,
            caption: item.caption,
            format: item.type ? item.type.toLowerCase() : null,
            postedAt,
            likes: item.likesCount,
            comments: item.commentsCount,
            views: item.videoViewCount,
            raw: item,
          },
        ];
      }),
  };

// --- Reels (apify~instagram-reel-scraper) -----------------------------------
export const reelsActor: ActorEntry<ReelsInput, RawReelItem, PatternPostItem> =
  {
    key: "reels",
    slug: "apify~instagram-reel-scraper",
    envOverrideKey: "APIFY_ACTOR_REELS",
    buildInput: (params) => ({
      ...(params.username ? { username: params.username } : {}),
      ...(params.hashtags ? { hashtags: params.hashtags } : {}),
      resultsLimit: params.resultsLimit,
    }),
    mapOutput: (items) =>
      items.flatMap((item) => {
        const postedAt = safeDate(item.timestamp);
        if (!postedAt) return [];
        return [
          {
            externalId: item.id,
            caption: item.caption,
            format: "reel",
            postedAt,
            likes: item.likesCount,
            comments: item.commentsCount,
            views: item.videoPlayCount ?? item.videoViewCount,
            raw: item,
          },
        ];
      }),
  };

// --- Profile (apify~instagram-profile-scraper) ------------------------------
export const profileActor: ActorEntry<
  ProfileInput,
  RawProfileItem,
  PatternProfileItem
> = {
  key: "profile",
  slug: "apify~instagram-profile-scraper",
  envOverrideKey: "APIFY_ACTOR_PROFILE",
  buildInput: (params) => ({
    usernames: params.usernames,
  }),
  mapOutput: (items) =>
    items.flatMap((item) => {
      if (!item.username) return [];
      return [
        {
          handle: item.username,
          followers: item.followersCount ?? 0,
          following: item.followsCount ?? 0,
          postsCount: item.postsCount ?? 0,
          bio: item.biography ?? null,
          isVerified: item.verified ?? false,
          businessCategory: item.businessCategoryName ?? null,
          profilePicUrl: item.profilePicUrl ?? null,
          externalUrl: item.externalUrl ?? null,
          raw: item,
        },
      ];
    }),
};

// --- Comments (apify~instagram-comment-scraper) -----------------------------
export const commentsActor: ActorEntry<
  CommentInput,
  RawCommentItem,
  PatternCommentItem
> = {
  key: "comments",
  slug: "apify~instagram-comment-scraper",
  envOverrideKey: "APIFY_ACTOR_COMMENTS",
  buildInput: (params) => ({
    directUrls: params.directUrls,
    resultsLimit: params.resultsLimit,
  }),
  mapOutput: (items) =>
    items.flatMap((item) => {
      const takenAt = safeDate(item.timestamp);
      if (!takenAt || !item.text) return [];
      return [
        {
          authorHandle: item.ownerUsername ?? null,
          text: item.text,
          likes: item.likesCount ?? 0,
          takenAt,
          raw: item,
        },
      ];
    }),
};

// --- Deep post (apify~instagram-post-scraper) — on-demand enrich -----------
export const deepPostActor: ActorEntry<
  DeepPostInput,
  RawDeepPostItem,
  PatternPostItem
> = {
  key: "deep_post",
  slug: "apify~instagram-post-scraper",
  envOverrideKey: "APIFY_ACTOR_DEEP_POST",
  buildInput: (params) => ({
    username: params.username,
    resultsLimit: params.resultsLimit,
  }),
  mapOutput: (items) =>
    items.flatMap((item) => {
      const postedAt = safeDate(item.timestamp);
      if (!postedAt) return [];
      return [
        {
          externalId: item.id,
          caption: item.caption,
          format: item.type ? item.type.toLowerCase() : null,
          postedAt,
          likes: item.likesCount,
          comments: item.commentsCount,
          views: item.videoViewCount,
          raw: item,
        },
      ];
    }),
};

// --- TikTok Posts (apify~clockworks-tiktok-scraper) -------------------------
export const tiktokPostsActor: ActorEntry<
  TikTokPostsInput,
  RawTikTokPostItem,
  PatternPostItem
> = {
  key: "tiktok_posts",
  slug: "clockworks~tiktok-scraper",
  envOverrideKey: "APIFY_ACTOR_TIKTOK_POSTS",
  buildInput: (params) => ({
    ...(params.profiles ? { profiles: params.profiles } : {}),
    ...(params.hashtags ? { hashtags: params.hashtags } : {}),
    resultsPerPage: params.resultsLimit,
  }),
  mapOutput: (items) =>
    items.flatMap((item) => {
      if (!item.createTime) return [];
      const postedAt = new Date(item.createTime * 1000);
      if (Number.isNaN(postedAt.getTime())) return [];
      return [
        {
          externalId: item.id,
          caption: item.desc,
          format: "tiktok_video",
          postedAt,
          likes: item.diggCount,
          comments: item.commentCount,
          views: item.playCount,
          raw: item,
        },
      ];
    }),
};

// --- TikTok Profile (apify~clockworks-tiktok-profile-scraper) ---------------
export const tiktokProfileActor: ActorEntry<
  TikTokProfileInput,
  RawTikTokProfileItem,
  PatternProfileItem
> = {
  key: "tiktok_profile",
  slug: "clockworks~tiktok-profile-scraper",
  envOverrideKey: "APIFY_ACTOR_TIKTOK_PROFILE",
  buildInput: (params) => ({
    profiles: params.profiles,
  }),
  mapOutput: (items) =>
    items.flatMap((item) => {
      if (!item.uniqueId) return [];
      return [
        {
          handle: item.uniqueId,
          followers: item.followerCount ?? 0,
          following: item.followingCount ?? 0,
          postsCount: item.videoCount ?? 0,
          bio: item.signature ?? null,
          isVerified: item.verified ?? false,
          businessCategory: null,
          profilePicUrl: item.avatarThumb ?? null,
          externalUrl: null,
          raw: item,
        },
      ];
    }),
};

// --- Meta Ad Library (apify~facebook-ads-scraper) ---------------------------
export const adLibraryActor: ActorEntry<
  AdLibraryInput,
  RawAdLibraryItem,
  PatternAdLibraryItem
> = {
  key: "ad_library",
  slug: "apify~facebook-ads-scraper",
  envOverrideKey: "APIFY_ACTOR_AD_LIBRARY",
  buildInput: (params) => ({
    searchTerms: params.searchTerms,
    resultsLimit: params.resultsLimit,
  }),
  mapOutput: (items) =>
    items.flatMap((item) => {
      const postedAt = safeDate(item.ad_delivery_start_time);
      if (!postedAt) return [];
      return [
        {
          externalId: item.id,
          pageHandle: item.page_name ?? "unknown",
          adBody: item.ad_creative_bodies?.join(" ") ?? null,
          adFormat: item.publisher_platforms?.join(",") ?? null,
          targetAudience: item.estimated_audience_size
            ? `${item.estimated_audience_size.lower_bound ?? "?"}–${item.estimated_audience_size.upper_bound ?? "?"}`
            : null,
          postedAt,
          raw: item,
        },
      ];
    }),
};

// ---------------------------------------------------------------------------
// Registry lookup
// ---------------------------------------------------------------------------

const REGISTRY: Record<ActorKey, ActorEntry<unknown, unknown, unknown>> = {
  posts: postsActor as ActorEntry<unknown, unknown, unknown>,
  reels: reelsActor as ActorEntry<unknown, unknown, unknown>,
  profile: profileActor as ActorEntry<unknown, unknown, unknown>,
  comments: commentsActor as ActorEntry<unknown, unknown, unknown>,
  deep_post: deepPostActor as ActorEntry<unknown, unknown, unknown>,
  tiktok_posts: tiktokPostsActor as ActorEntry<unknown, unknown, unknown>,
  tiktok_profile: tiktokProfileActor as ActorEntry<unknown, unknown, unknown>,
  ad_library: adLibraryActor as ActorEntry<unknown, unknown, unknown>,
};

/**
 * Resolve the actual actor slug at runtime. Checks for an env override first,
 * then falls back to the hardcoded slug.
 */
export function resolveActorSlug(key: ActorKey): string {
  const entry = REGISTRY[key];
  const override = process.env[entry.envOverrideKey];
  return override || entry.slug;
}

export function getActorEntry(
  key: ActorKey,
): ActorEntry<unknown, unknown, unknown> {
  return REGISTRY[key];
}
