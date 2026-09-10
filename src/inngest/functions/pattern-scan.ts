import { inngest } from "@/inngest/client";
import type { HarnessSegment } from "@/db/schema";
import {
  createPatternRun,
  finishPatternRun,
  getHarnessRule,
  getLatestProfileSnapshot,
  insertPatternComments,
  insertPatternItems,
  insertPatternProfiles,
  listEnabledHarnessRules,
  listExistingExternalIds,
  markRuleRan,
} from "@/db/queries/harness";
import { fetchComments, fetchProfiles, runSegment } from "@/lib/connectors/apify";
import { resolveActorSlug } from "@/lib/connectors/apify-actors";
import {
  actorKeyForSegment,
  clampCap,
  COMMENTS_HARD_CAP,
  COMMENTS_PER_POST_CAP,
  dedupeItems,
  extractCompetitorHandles,
  hasCommentMining,
  nextRunDue,
  pickTopPostsForComments,
  profileFetchDue,
} from "@/lib/harness";

type HarnessRule = {
  id: string;
  workspaceId: string;
  segments: HarnessSegment[];
  maxPostsPerRun: number;
};

/**
 * Execute every segment of one rule. Each segment gets its own pattern_runs
 * row; a segment failure is recorded there and never kills the sweep.
 * Degradation: no APIFY_TOKEN → the run rows carry the clear error, the app
 * keeps working (constitution ladder).
 *
 * A2: Segments with target=reels route to the reel-scraper actor.
 * A3: Competitor handles also trigger a profile snapshot (deduped per day).
 * A4: Segments with mineComments=true trigger comment mining on top posts.
 * A5: Each run row records which actor it used.
 */
async function executeRule(rule: HarnessRule) {
  let fetched = 0;
  const allFetchedItems: Array<{
    id?: string;
    externalId?: string;
    likes?: number;
    segment: HarnessSegment;
  }> = [];
  const patternPostIdByExternalId = new Map<string, string>();

  // --- Post/Reel segments ---
  for (const segment of rule.segments) {
    const actorKey = actorKeyForSegment(segment);
    const actorSlug = resolveActorSlug(actorKey);
    const runId = await createPatternRun(
      rule.workspaceId,
      rule.id,
      segment,
      actorSlug,
    );
    try {
      const items = await runSegment(segment, clampCap(rule.maxPostsPerRun));
      const existing = await listExistingExternalIds(
        rule.workspaceId,
        items.flatMap((i) => (i.externalId ? [i.externalId] : [])),
      );
      const fresh = dedupeItems(items, existing);
      const { count, insertedByExternalId } = await insertPatternItems({
        workspaceId: rule.workspaceId,
        runId,
        segment,
        items: fresh,
      });
      for (const [externalId, id] of insertedByExternalId) {
        patternPostIdByExternalId.set(externalId, id);
      }
      await finishPatternRun(runId, { status: "done", postsFetched: count });
      fetched += count;

      // Track for comment mining (A4)
      for (const item of fresh) {
        allFetchedItems.push({ ...item, segment });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown harness error";
      console.error(
        `pattern-scan segment failed (ws ${rule.workspaceId}, ${segment.kind}:${segment.value}):`,
        message,
      );
      await finishPatternRun(runId, { status: "failed", error: message });
    }
  }

  // --- A3: Profile snapshots for competitor handles ---
  try {
    const handles = extractCompetitorHandles(rule.segments);
    const handlesToFetch: string[] = [];
    const now = new Date();

    for (const handle of handles) {
      const latest = await getLatestProfileSnapshot(
        rule.workspaceId,
        handle,
      );
      if (profileFetchDue(latest?.takenAt ?? null, now)) {
        handlesToFetch.push(handle);
      }
    }

    if (handlesToFetch.length > 0) {
      const profiles = await fetchProfiles(handlesToFetch);
      await insertPatternProfiles({
        workspaceId: rule.workspaceId,
        items: profiles,
      });
    }
  } catch (error) {
    // Profile fetch is best-effort — don't kill the sweep
    console.error(
      `pattern-scan profile fetch failed (ws ${rule.workspaceId}):`,
      error instanceof Error ? error.message : "Unknown error",
    );
  }

  // --- A4: Comment mining (opt-in per segment) ---
  if (hasCommentMining(rule.segments)) {
    try {
      // Collect items from segments that have comment mining enabled
      const mineableItems = allFetchedItems.filter(
        (item) => item.segment.mineComments && item.externalId,
      );
      const topPosts = pickTopPostsForComments(mineableItems);
      let commentsBudget = COMMENTS_HARD_CAP;

      for (const post of topPosts) {
        if (commentsBudget <= 0) break;
        if (!post.externalId) continue;
        const patternPostId = patternPostIdByExternalId.get(post.externalId);
        if (!patternPostId) continue;
        try {
          const postUrl = `https://www.instagram.com/p/${post.externalId}/`;
          const comments = await fetchComments(
            postUrl,
            Math.min(COMMENTS_PER_POST_CAP, commentsBudget),
          );
          commentsBudget -= comments.length;
          if (comments.length > 0) {
            await insertPatternComments({
              workspaceId: rule.workspaceId,
              patternPostId,
              items: comments,
            });
          }
        } catch (commentError) {
          // Individual comment fetch failure — log and continue
          console.error(
            `pattern-scan comment fetch failed for ${post.externalId}:`,
            commentError instanceof Error
              ? commentError.message
              : "Unknown error",
          );
        }
      }
    } catch (error) {
      // Comment mining is best-effort — don't kill the sweep
      console.error(
        `pattern-scan comment mining failed (ws ${rule.workspaceId}):`,
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  await markRuleRan(rule.id, new Date());
  return fetched;
}

/**
 * Apify harness sweep (Slice E1). Hourly cron scans enabled harness rules
 * whose cadence is due; the "patterns/run.requested" event powers the manual
 * "Run now" button. Pattern layer only — results never touch the baseline.
 */
export const patternScan = inngest.createFunction(
  {
    id: "pattern-scan",
    triggers: [{ cron: "0 * * * *" }, { event: "patterns/run.requested" }],
  },
  async ({ event, step }) => {
    // Cron and event triggers share this handler; only the manual event
    // carries a workspaceId payload.
    const data = (event as { data?: Record<string, unknown> } | undefined)
      ?.data;
    const requestedWorkspace =
      typeof data?.workspaceId === "string" ? data.workspaceId : null;

    const rules = await step.run("plan-rules", async () => {
      if (requestedWorkspace) {
        // Manual run: explicit user intent, cadence/enabled don't gate it
        const rule = await getHarnessRule(requestedWorkspace);
        return rule && rule.segments.length > 0 ? [rule] : [];
      }
      const now = new Date();
      const enabled = await listEnabledHarnessRules();
      return enabled.filter(
        (rule) => rule.segments.length > 0 && nextRunDue(rule, now),
      );
    });

    let totalFetched = 0;
    for (const rule of rules) {
      const fetched = await step.run(`rule-${rule.id}`, () =>
        executeRule({
          id: rule.id,
          workspaceId: rule.workspaceId,
          segments: rule.segments as HarnessSegment[],
          maxPostsPerRun: rule.maxPostsPerRun,
        }),
      );
      totalFetched += fetched;
    }
    return { rules: rules.length, fetched: totalFetched };
  },
);
