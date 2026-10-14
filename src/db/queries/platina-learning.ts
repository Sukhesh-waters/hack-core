/**
 * C6 queries: the client's own website (Plane A) and the learning loop.
 * Every query filters workspace_id explicitly (app-layer isolation; see
 * CLAUDE.md) and platina-learning.test.ts asserts it in the generated SQL.
 */
import { and, asc, cosineDistance, desc, eq, gte, ilike, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  PLATINA_EMBEDDING_MODEL_VERSION,
  platinaBrainChunks,
  platinaBrands,
  platinaCreativeMetrics,
  platinaCreativeReviews,
  platinaCreatives,
  platinaFirstPartyChunks,
  platinaLearningEvents,
  platinaLearningSnapshots,
  platinaOwnSitePages,
  platinaSuggestionEvents,
  platinaSuggestions,
  type SuggestionEventKind,
  type SuggestionFeatures,
  type SuggestionInput,
  type SuggestionKind,
  type CreativeStatus,
  type FirstPartyChunkKind,
  type OwnSitePageStatus,
  type ReviewFacts,
  type ReviewVerdict,
  type ReviewWhy,
} from "@/db/platina-schema";

// ---------------------------------------------------------------------------
// Own-site pages
// ---------------------------------------------------------------------------

export function ownSitePagesQuery(workspaceId: string, brandId: string) {
  return db
    .select()
    .from(platinaOwnSitePages)
    .where(and(eq(platinaOwnSitePages.workspaceId, workspaceId), eq(platinaOwnSitePages.brandId, brandId)))
    .orderBy(desc(platinaOwnSitePages.priority), asc(platinaOwnSitePages.url));
}

export async function listOwnSitePages(workspaceId: string, brandId: string) {
  return ownSitePagesQuery(workspaceId, brandId);
}

export async function insertOwnSitePages(
  workspaceId: string,
  brandId: string,
  pages: { url: string; title: string | null; priority: number }[],
) {
  if (pages.length === 0) return;
  await db
    .insert(platinaOwnSitePages)
    .values(pages.map((p) => ({ ...p, workspaceId, brandId })))
    .onConflictDoNothing();
}

export async function updateOwnSitePage(
  workspaceId: string,
  pageId: string,
  patch: Partial<{
    title: string | null;
    priority: number;
    status: OwnSitePageStatus;
    contentHash: string | null;
    etag: string | null;
    lastModified: string | null;
    changeDetectedAt: Date | null;
    chunkCount: number;
    error: string | null;
    lastReadAt: Date;
    lastCheckedAt: Date;
  }>,
) {
  await db
    .update(platinaOwnSitePages)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(platinaOwnSitePages.workspaceId, workspaceId), eq(platinaOwnSitePages.id, pageId)));
}

export async function markOwnSitePagesGone(workspaceId: string, pageIds: string[]) {
  if (pageIds.length === 0) return;
  await db
    .update(platinaOwnSitePages)
    .set({ status: "gone", changeDetectedAt: null, updatedAt: new Date() })
    .where(and(eq(platinaOwnSitePages.workspaceId, workspaceId), inArray(platinaOwnSitePages.id, pageIds)));
}

export async function recordOwnSiteMap(
  workspaceId: string,
  brandId: string,
  outcome: { mappedAt: Date | null; error: string | null },
) {
  await db
    .update(platinaBrands)
    .set({
      ...(outcome.mappedAt ? { ownSiteMappedAt: outcome.mappedAt } : {}),
      ownSiteError: outcome.error,
      updatedAt: new Date(),
    })
    .where(and(eq(platinaBrands.workspaceId, workspaceId), eq(platinaBrands.id, brandId)));
}

/** Clients (own brands with a homepage) whose site is read, across one workspace. */
export function ownSiteClientsQuery(workspaceId: string) {
  return db
    .select({
      id: platinaBrands.id,
      name: platinaBrands.name,
      homepageUrl: platinaBrands.homepageUrl,
      ownSiteMappedAt: platinaBrands.ownSiteMappedAt,
    })
    .from(platinaBrands)
    .where(
      and(
        eq(platinaBrands.workspaceId, workspaceId),
        eq(platinaBrands.kind, "own_brand"),
        eq(platinaBrands.status, "active"),
        sql`${platinaBrands.homepageUrl} is not null`,
      ),
    );
}

export async function listOwnSiteClients(workspaceId: string) {
  return ownSiteClientsQuery(workspaceId);
}

// ---------------------------------------------------------------------------
// First-party chunks (own site pages, confirmed lessons)
// ---------------------------------------------------------------------------

export async function insertFirstPartyChunks(
  rows: {
    workspaceId: string;
    brandId: string | null;
    kind: FirstPartyChunkKind;
    sourceRef: string;
    sourceUrl: string | null;
    title: string | null;
    content: string;
    chunkIndex: number;
    embedding?: number[];
  }[],
): Promise<string[]> {
  if (rows.length === 0) return [];
  const inserted = await db
    .insert(platinaFirstPartyChunks)
    .values(rows)
    .returning({ id: platinaFirstPartyChunks.id });
  return inserted.map((r) => r.id);
}

/** Retire a source's current chunks, except the ones just written. */
export async function supersedeFirstPartyChunks(
  workspaceId: string,
  sourceRefs: string[],
  excludeIds: string[] = [],
) {
  if (sourceRefs.length === 0) return;
  await db
    .update(platinaFirstPartyChunks)
    .set({ supersededAt: new Date() })
    .where(
      and(
        eq(platinaFirstPartyChunks.workspaceId, workspaceId),
        inArray(platinaFirstPartyChunks.sourceRef, sourceRefs),
        isNull(platinaFirstPartyChunks.supersededAt),
        ...(excludeIds.length > 0 ? [notInArray(platinaFirstPartyChunks.id, excludeIds)] : []),
      ),
    );
}

/**
 * Nearest live first-party chunks. Scoped to one client when given (its own
 * site and lessons, plus workspace-wide lessons with no client); unscoped =
 * the whole workspace.
 */
export function similarFirstPartyChunksQuery(
  workspaceId: string,
  embedding: number[],
  options: { brandId?: string | null; limit?: number } = {},
) {
  const distance = cosineDistance(platinaFirstPartyChunks.embedding, embedding);
  return db
    .select({
      id: platinaFirstPartyChunks.id,
      kind: platinaFirstPartyChunks.kind,
      content: platinaFirstPartyChunks.content,
      sourceUrl: platinaFirstPartyChunks.sourceUrl,
      title: platinaFirstPartyChunks.title,
      createdAt: platinaFirstPartyChunks.createdAt,
      score: sql<number>`(1 - (${distance}))`,
    })
    .from(platinaFirstPartyChunks)
    .where(
      and(
        eq(platinaFirstPartyChunks.workspaceId, workspaceId),
        isNull(platinaFirstPartyChunks.supersededAt),
        eq(platinaFirstPartyChunks.embeddingModelVersion, PLATINA_EMBEDDING_MODEL_VERSION),
        ...(options.brandId
          ? [
              sql`(${platinaFirstPartyChunks.brandId} = ${options.brandId} or ${platinaFirstPartyChunks.brandId} is null)`,
            ]
          : []),
      ),
    )
    .orderBy(distance)
    .limit(options.limit ?? 8);
}

export function firstPartyChunkCountsQuery(workspaceId: string) {
  return db
    .select({
      brandId: platinaFirstPartyChunks.brandId,
      kind: platinaFirstPartyChunks.kind,
      chunks: sql<number>`count(*)::int`,
    })
    .from(platinaFirstPartyChunks)
    .where(and(eq(platinaFirstPartyChunks.workspaceId, workspaceId), isNull(platinaFirstPartyChunks.supersededAt)))
    .groupBy(platinaFirstPartyChunks.brandId, platinaFirstPartyChunks.kind);
}

// ---------------------------------------------------------------------------
// Creatives (C6 L2)
// ---------------------------------------------------------------------------

export type CreativeInput = {
  brandId: string | null;
  planId: string | null;
  phaseId: string | null;
  opportunityKey: string | null;
  title: string;
  channel: string;
  format: string;
  topic: string | null;
  hookType: string | null;
  cta: string | null;
  url: string | null;
  externalId: string | null;
  hypothesis: string;
  postedAt: Date | null;
  status: CreativeStatus;
};

export async function insertCreative(workspaceId: string, createdById: string, input: CreativeInput) {
  const [row] = await db
    .insert(platinaCreatives)
    .values({ ...input, workspaceId, createdById })
    .returning({ id: platinaCreatives.id });
  return row.id;
}

export async function updateCreative(workspaceId: string, creativeId: string, patch: Partial<CreativeInput>) {
  await db
    .update(platinaCreatives)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(platinaCreatives.workspaceId, workspaceId), eq(platinaCreatives.id, creativeId)));
}

/** A client's creatives (brandId), or the whole workspace's (null), newest first. */
export function creativesQuery(workspaceId: string, brandId?: string | null) {
  return db
    .select()
    .from(platinaCreatives)
    .where(
      and(
        eq(platinaCreatives.workspaceId, workspaceId),
        ...(brandId ? [eq(platinaCreatives.brandId, brandId)] : []),
      ),
    )
    .orderBy(desc(platinaCreatives.postedAt), desc(platinaCreatives.createdAt));
}

export async function listCreatives(workspaceId: string, brandId?: string | null) {
  return creativesQuery(workspaceId, brandId);
}

export async function getCreative(workspaceId: string, creativeId: string) {
  const rows = await db
    .select()
    .from(platinaCreatives)
    .where(and(eq(platinaCreatives.workspaceId, workspaceId), eq(platinaCreatives.id, creativeId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Creatives matched by URL or platform post id (spreadsheet and connector imports). */
export async function findCreativesByRef(workspaceId: string, refs: string[]) {
  if (refs.length === 0) return [];
  return db
    .select({ id: platinaCreatives.id, url: platinaCreatives.url, externalId: platinaCreatives.externalId })
    .from(platinaCreatives)
    .where(
      and(
        eq(platinaCreatives.workspaceId, workspaceId),
        or(inArray(platinaCreatives.url, refs), inArray(platinaCreatives.externalId, refs)),
      ),
    );
}

// ---------------------------------------------------------------------------
// Metric snapshots
// ---------------------------------------------------------------------------

export type MetricInput = {
  creativeId: string;
  capturedAt: Date;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  engagements: number | null;
  saves: number | null;
  shares: number | null;
  videoViews: number | null;
  leads: number | null;
  spend: number | null;
  source: string;
};

/**
 * Inserts snapshots; the same creative + moment + source replaces the earlier
 * numbers (a corrected entry), never a second row.
 */
export async function upsertMetricSnapshots(workspaceId: string, createdById: string | null, rows: MetricInput[]) {
  if (rows.length === 0) return 0;
  const written = await db
    .insert(platinaCreativeMetrics)
    .values(rows.map((r) => ({ ...r, workspaceId, createdById })))
    .onConflictDoUpdate({
      target: [
        platinaCreativeMetrics.workspaceId,
        platinaCreativeMetrics.creativeId,
        platinaCreativeMetrics.capturedAt,
        platinaCreativeMetrics.source,
      ],
      set: {
        impressions: sql`excluded.impressions`,
        reach: sql`excluded.reach`,
        clicks: sql`excluded.clicks`,
        engagements: sql`excluded.engagements`,
        saves: sql`excluded.saves`,
        shares: sql`excluded.shares`,
        videoViews: sql`excluded.video_views`,
        leads: sql`excluded.leads`,
        spend: sql`excluded.spend`,
      },
    })
    .returning({ id: platinaCreativeMetrics.id });
  return written.length;
}

export function metricsForCreativesQuery(workspaceId: string, creativeIds: string[]) {
  return db
    .select()
    .from(platinaCreativeMetrics)
    .where(
      and(
        eq(platinaCreativeMetrics.workspaceId, workspaceId),
        inArray(platinaCreativeMetrics.creativeId, creativeIds),
      ),
    )
    .orderBy(asc(platinaCreativeMetrics.capturedAt));
}

export async function listMetricsForCreatives(workspaceId: string, creativeIds: string[]) {
  if (creativeIds.length === 0) return [];
  return metricsForCreativesQuery(workspaceId, creativeIds);
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export function reviewsQuery(workspaceId: string, creativeIds: string[]) {
  return db
    .select()
    .from(platinaCreativeReviews)
    .where(
      and(
        eq(platinaCreativeReviews.workspaceId, workspaceId),
        inArray(platinaCreativeReviews.creativeId, creativeIds),
      ),
    );
}

export async function listReviews(workspaceId: string, creativeIds: string[]) {
  if (creativeIds.length === 0) return [];
  return reviewsQuery(workspaceId, creativeIds);
}

export async function getReviewForCreative(workspaceId: string, creativeId: string) {
  const rows = await db
    .select()
    .from(platinaCreativeReviews)
    .where(and(eq(platinaCreativeReviews.workspaceId, workspaceId), eq(platinaCreativeReviews.creativeId, creativeId)))
    .limit(1);
  return rows[0] ?? null;
}

export type ReviewDraftRow = {
  facts: ReviewFacts;
  verdict: ReviewVerdict | null;
  what: string | null;
  why: ReviewWhy[];
  how: string | null;
  keep: string | null;
  draftedBy: "model" | "human";
  draftError: string | null;
};

/** Writes (or rewrites) the draft. A confirmed review is never overwritten by a draft. */
export async function upsertReviewDraft(workspaceId: string, creativeId: string, draft: ReviewDraftRow) {
  await db
    .insert(platinaCreativeReviews)
    .values({ workspaceId, creativeId, status: "draft", ...draft })
    .onConflictDoUpdate({
      target: platinaCreativeReviews.creativeId,
      set: { ...draft, updatedAt: new Date() },
      setWhere: and(
        eq(platinaCreativeReviews.workspaceId, workspaceId),
        eq(platinaCreativeReviews.status, "draft"),
      ),
    });
}

/** Draft -> confirmed, once. Returns false when it was not a draft (double submit). */
export async function markReviewConfirmed(
  workspaceId: string,
  reviewId: string,
  input: {
    verdict: ReviewVerdict;
    what: string;
    why: ReviewWhy[];
    how: string;
    keep: string | null;
    draftedBy: "model" | "human";
    confirmedById: string;
  },
) {
  const now = new Date();
  const rows = await db
    .update(platinaCreativeReviews)
    .set({ ...input, status: "confirmed", confirmedAt: now, updatedAt: now })
    .where(
      and(
        eq(platinaCreativeReviews.workspaceId, workspaceId),
        eq(platinaCreativeReviews.id, reviewId),
        eq(platinaCreativeReviews.status, "draft"),
      ),
    )
    .returning({ id: platinaCreativeReviews.id });
  return rows.length > 0;
}

/** Confirmed results with the features the engine credits. */
export function confirmedResultsQuery(workspaceId: string, brandId?: string | null) {
  return db
    .select({
      creativeId: platinaCreatives.id,
      brandId: platinaCreatives.brandId,
      verdict: platinaCreativeReviews.verdict,
      confirmedAt: platinaCreativeReviews.confirmedAt,
      topic: platinaCreatives.topic,
      channel: platinaCreatives.channel,
      format: platinaCreatives.format,
      hookType: platinaCreatives.hookType,
      postedAt: platinaCreatives.postedAt,
      opportunityKey: platinaCreatives.opportunityKey,
    })
    .from(platinaCreativeReviews)
    .innerJoin(
      platinaCreatives,
      and(
        eq(platinaCreatives.id, platinaCreativeReviews.creativeId),
        eq(platinaCreatives.workspaceId, workspaceId),
      ),
    )
    .where(
      and(
        eq(platinaCreativeReviews.workspaceId, workspaceId),
        eq(platinaCreativeReviews.status, "confirmed"),
        ...(brandId ? [eq(platinaCreatives.brandId, brandId)] : []),
      ),
    );
}

export async function listConfirmedResults(workspaceId: string, brandId?: string | null) {
  return confirmedResultsQuery(workspaceId, brandId);
}

// ---------------------------------------------------------------------------
// Learning events + Brain confidence (backtracking)
// ---------------------------------------------------------------------------

export async function insertLearningEvents(
  rows: {
    workspaceId: string;
    brandId: string | null;
    kind: "demote" | "promote" | "lesson";
    reviewId: string;
    targetRef: string | null;
    detail: Record<string, unknown>;
  }[],
) {
  if (rows.length === 0) return;
  await db.insert(platinaLearningEvents).values(rows);
}

export function learningEventsQuery(workspaceId: string, limit = 50) {
  return db
    .select()
    .from(platinaLearningEvents)
    .where(eq(platinaLearningEvents.workspaceId, workspaceId))
    .orderBy(desc(platinaLearningEvents.createdAt))
    .limit(limit);
}

export async function listLearningEvents(workspaceId: string, limit = 50) {
  return learningEventsQuery(workspaceId, limit);
}

/** A confirmed win raises an ACTIVE insight's confidence a step, capped. */
export function promoteBrainChunkQuery(workspaceId: string, chunkId: string, step: number, cap: number) {
  return db
    .update(platinaBrainChunks)
    .set({ confidence: sql`LEAST(${platinaBrainChunks.confidence} + ${step}, ${cap})` })
    .where(
      and(
        eq(platinaBrainChunks.workspaceId, workspaceId),
        eq(platinaBrainChunks.id, chunkId),
        eq(platinaBrainChunks.status, "active"),
      ),
    );
}

export async function promoteBrainChunk(workspaceId: string, chunkId: string, step: number, cap: number) {
  await promoteBrainChunkQuery(workspaceId, chunkId, step, cap);
}

export async function brainChunkSummaries(workspaceId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select({ id: platinaBrainChunks.id, content: platinaBrainChunks.content, status: platinaBrainChunks.status })
    .from(platinaBrainChunks)
    .where(and(eq(platinaBrainChunks.workspaceId, workspaceId), inArray(platinaBrainChunks.id, ids)));
}

/** Live first-party chunks stored without a vector (an embedding outage). */
export function unembeddedFirstPartyChunksQuery(workspaceId: string, limit = 50) {
  return db
    .select({ id: platinaFirstPartyChunks.id, content: platinaFirstPartyChunks.content })
    .from(platinaFirstPartyChunks)
    .where(
      and(
        eq(platinaFirstPartyChunks.workspaceId, workspaceId),
        isNull(platinaFirstPartyChunks.supersededAt),
        isNull(platinaFirstPartyChunks.embedding),
      ),
    )
    .limit(limit);
}

export async function setFirstPartyEmbedding(workspaceId: string, chunkId: string, embedding: number[]) {
  await db
    .update(platinaFirstPartyChunks)
    .set({ embedding, embeddingModelVersion: PLATINA_EMBEDDING_MODEL_VERSION })
    .where(and(eq(platinaFirstPartyChunks.workspaceId, workspaceId), eq(platinaFirstPartyChunks.id, chunkId)));
}

export function creativesForPlanQuery(workspaceId: string, planId: string) {
  return db
    .select({
      id: platinaCreatives.id,
      title: platinaCreatives.title,
      phaseId: platinaCreatives.phaseId,
      postedAt: platinaCreatives.postedAt,
    })
    .from(platinaCreatives)
    .where(and(eq(platinaCreatives.workspaceId, workspaceId), eq(platinaCreatives.planId, planId)))
    .orderBy(asc(platinaCreatives.createdAt));
}

export async function listCreativesForPlan(workspaceId: string, planId: string) {
  return creativesForPlanQuery(workspaceId, planId);
}

/**
 * First-party passages that contain any of these words (C8.4 brief). The
 * fallback when a passage has no embedding yet (the free embedding quota
 * leaves a backlog): the words still find it. Longest passages first.
 */
export function keywordFirstPartyChunksQuery(
  workspaceId: string,
  words: string[],
  options: { brandId?: string | null; limit?: number } = {},
) {
  const terms = words.filter((w) => w.length >= 3).slice(0, 6);
  const match = terms.length
    ? or(...terms.map((w) => ilike(platinaFirstPartyChunks.content, `%${w.replace(/[%_\\]/g, "")}%`)))
    : sql`false`;
  return db
    .select({
      id: platinaFirstPartyChunks.id,
      content: platinaFirstPartyChunks.content,
      sourceUrl: platinaFirstPartyChunks.sourceUrl,
      title: platinaFirstPartyChunks.title,
    })
    .from(platinaFirstPartyChunks)
    .where(
      and(
        eq(platinaFirstPartyChunks.workspaceId, workspaceId),
        isNull(platinaFirstPartyChunks.supersededAt),
        ...(options.brandId ? [eq(platinaFirstPartyChunks.brandId, options.brandId)] : []),
        match,
      ),
    )
    .orderBy(desc(sql`length(${platinaFirstPartyChunks.content})`))
    .limit(options.limit ?? 6);
}

// ---------------------------------------------------------------------------
// C8.5 suggestion ledger and monthly consolidation
// ---------------------------------------------------------------------------

export type SuggestionRow = typeof platinaSuggestions.$inferSelect;

/** Records a suggestion once per (kind, subject, inputs); returns its id either way. */
export async function recordSuggestionRow(input: {
  workspaceId: string;
  brandId: string | null;
  kind: SuggestionKind;
  subjectKey: string;
  inputHash: string;
  title: string;
  body: Record<string, unknown>;
  inputs: SuggestionInput[];
  features: SuggestionFeatures;
  factors: Record<string, number | string>;
  weightsVersion: string;
  model?: string | null;
  promptVersion?: string | null;
  explore: boolean;
}): Promise<{ id: string; created: boolean }> {
  const [row] = await db.insert(platinaSuggestions).values(input).onConflictDoNothing().returning({ id: platinaSuggestions.id });
  if (row) return { id: row.id, created: true };
  const [existing] = await db
    .select({ id: platinaSuggestions.id })
    .from(platinaSuggestions)
    .where(
      and(
        eq(platinaSuggestions.workspaceId, input.workspaceId),
        eq(platinaSuggestions.kind, input.kind),
        eq(platinaSuggestions.subjectKey, input.subjectKey),
        eq(platinaSuggestions.inputHash, input.inputHash),
      ),
    );
  return { id: existing.id, created: false };
}

/** One event per suggestion, kind and day ("shown" is counted once a day). */
export async function recordSuggestionEventRow(input: {
  workspaceId: string;
  suggestionId: string;
  kind: SuggestionEventKind;
  reason?: string | null;
  reward?: number | null;
  actorId?: string | null;
  detail?: Record<string, unknown>;
  day: string;
}): Promise<boolean> {
  const inserted = await db
    .insert(platinaSuggestionEvents)
    .values({ ...input, detail: input.detail ?? {} })
    .onConflictDoNothing()
    .returning({ id: platinaSuggestionEvents.id });
  return inserted.length > 0;
}

export async function setSuggestionStatus(workspaceId: string, id: string, status: string) {
  await db
    .update(platinaSuggestions)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(platinaSuggestions.workspaceId, workspaceId), eq(platinaSuggestions.id, id)));
}

export function suggestionsQuery(workspaceId: string, opts: { kind?: string; status?: string; limit?: number } = {}) {
  return db
    .select()
    .from(platinaSuggestions)
    .where(
      and(
        eq(platinaSuggestions.workspaceId, workspaceId),
        opts.kind ? eq(platinaSuggestions.kind, opts.kind as SuggestionKind) : undefined,
        opts.status ? eq(platinaSuggestions.status, opts.status) : undefined,
      ),
    )
    .orderBy(desc(platinaSuggestions.createdAt))
    .limit(opts.limit ?? 500);
}

export function suggestionByIdQuery(workspaceId: string, id: string) {
  return db
    .select()
    .from(platinaSuggestions)
    .where(and(eq(platinaSuggestions.workspaceId, workspaceId), eq(platinaSuggestions.id, id)));
}

/** Newest records per subject (opportunity cards' keys), for their buttons. */
export function latestSuggestionsForSubjectsQuery(workspaceId: string, kind: SuggestionKind, subjectKeys: string[]) {
  return db
    .select()
    .from(platinaSuggestions)
    .where(
      and(
        eq(platinaSuggestions.workspaceId, workspaceId),
        eq(platinaSuggestions.kind, kind),
        inArray(platinaSuggestions.subjectKey, subjectKeys.length > 0 ? subjectKeys : ["__none__"]),
      ),
    )
    .orderBy(desc(platinaSuggestions.createdAt));
}

/**
 * Suggestions whose `inputs` cite this Brain chunk (B5 ledger link, C8.5).
 * `ref` for a Brain chunk is written as `"brain:<chunkId>"` everywhere else
 * this is read (consolidate.ts's trust lookup), so that is the exact string
 * matched here — not a prefix or a jsonb containment guess. One suggestion
 * can be found this way even though `inputs` is a free-form jsonb array: the
 * check runs over its elements in SQL rather than assuming a shape Postgres
 * can index.
 */
export function suggestionsCitingBrainChunkQuery(workspaceId: string, brainChunkId: string) {
  const ref = `brain:${brainChunkId}`;
  return db
    .select({ id: platinaSuggestions.id, inputs: platinaSuggestions.inputs, features: platinaSuggestions.features })
    .from(platinaSuggestions)
    .where(
      and(
        eq(platinaSuggestions.workspaceId, workspaceId),
        sql`exists (select 1 from jsonb_array_elements(${platinaSuggestions.inputs}) elem where elem->>'ref' = ${ref})`,
      ),
    );
}

export async function listSuggestionsCitingBrainChunk(workspaceId: string, brainChunkId: string) {
  return suggestionsCitingBrainChunkQuery(workspaceId, brainChunkId);
}

export function suggestionEventsQuery(workspaceId: string, suggestionId?: string) {
  return db
    .select()
    .from(platinaSuggestionEvents)
    .where(
      and(
        eq(platinaSuggestionEvents.workspaceId, workspaceId),
        suggestionId ? eq(platinaSuggestionEvents.suggestionId, suggestionId) : undefined,
      ),
    )
    .orderBy(asc(platinaSuggestionEvents.createdAt));
}

/** Ideas recorded since a moment (the idea engine's daily cap). */
export async function countIdeasSince(workspaceId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(platinaSuggestions)
    .where(
      and(
        eq(platinaSuggestions.workspaceId, workspaceId),
        eq(platinaSuggestions.kind, "idea"),
        gte(platinaSuggestions.createdAt, since),
      ),
    );
  return row?.n ?? 0;
}

export function learningSnapshotsQuery(workspaceId: string) {
  return db
    .select()
    .from(platinaLearningSnapshots)
    .where(eq(platinaLearningSnapshots.workspaceId, workspaceId))
    .orderBy(desc(platinaLearningSnapshots.month));
}

/** Idempotent per month: a second consolidation of the same month writes nothing. */
export async function insertLearningSnapshot(input: {
  workspaceId: string;
  month: string;
  weights: Record<string, unknown>;
  digest: Record<string, unknown>;
}): Promise<boolean> {
  const rows = await db.insert(platinaLearningSnapshots).values(input).onConflictDoNothing().returning({ id: platinaLearningSnapshots.id });
  return rows.length > 0;
}

/** Brain insights the consolidation may merge or retire: debate and idea insights (measured ones supersede themselves). */
export function consolidatableBrainQuery(workspaceId: string) {
  return db
    .select({
      id: platinaBrainChunks.id,
      content: platinaBrainChunks.content,
      confidence: platinaBrainChunks.confidence,
      status: platinaBrainChunks.status,
      absorbedChunkIds: platinaBrainChunks.absorbedChunkIds,
      lastRetrievedAt: platinaBrainChunks.lastRetrievedAt,
      createdAt: platinaBrainChunks.createdAt,
    })
    .from(platinaBrainChunks)
    .where(
      and(
        eq(platinaBrainChunks.workspaceId, workspaceId),
        isNull(platinaBrainChunks.insightKey),
        inArray(platinaBrainChunks.status, ["active", "archived"]),
      ),
    );
}

/** A merge: the survivor absorbs the others, which are superseded (kept, never deleted). */
export async function mergeBrainChunks(workspaceId: string, keepId: string, absorbIds: string[], priorAbsorbed: string[]) {
  if (absorbIds.length === 0) return;
  await db.transaction(async (tx) => {
    await tx
      .update(platinaBrainChunks)
      .set({ absorbedChunkIds: [...new Set([...priorAbsorbed, ...absorbIds])] })
      .where(and(eq(platinaBrainChunks.workspaceId, workspaceId), eq(platinaBrainChunks.id, keepId)));
    await tx
      .update(platinaBrainChunks)
      .set({ status: "superseded" })
      .where(and(eq(platinaBrainChunks.workspaceId, workspaceId), inArray(platinaBrainChunks.id, absorbIds)));
  });
}

/** Retire (active -> archived) or restore (archived -> active) Brain insights; nothing else moves. */
export async function setBrainChunksStatus(workspaceId: string, ids: string[], status: "active" | "archived") {
  if (ids.length === 0) return;
  await db
    .update(platinaBrainChunks)
    .set({ status })
    .where(
      and(
        eq(platinaBrainChunks.workspaceId, workspaceId),
        inArray(platinaBrainChunks.id, ids),
        eq(platinaBrainChunks.status, status === "active" ? "archived" : "active"),
      ),
    );
}
