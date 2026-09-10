import {
  getBaselinePoints,
  similarPostsQuery,
  topMoversQuery,
} from "@/db/queries/posts";
import { routeAI } from "@/lib/ai/router";
import { MIN_BASELINE_N } from "@/lib/scoring";

export type DriverPost = {
  id: string;
  caption: string | null;
  direction: string | null;
  magnitude: number | null;
  format: string | null;
};

export type DriverBrief =
  | { status: "insufficient_baseline"; sampleSize: number }
  | {
      status: "ready";
      brief: string;
      citedPostIds: string[];
      drivers: DriverPost[];
    };

/** Pure prompt assembly — drivers are rendered with 8-char citation ids. */
export function buildBriefPrompt(topic: string, drivers: DriverPost[]): string {
  const rows = drivers
    .map(
      (d) =>
        `[${d.id.slice(0, 8)}] "${(d.caption ?? "no caption").slice(0, 120)}" ` +
        `direction=${d.direction ?? "unscored"} magnitude=${d.magnitude?.toFixed(2) ?? "-"} format=${d.format ?? "-"}`,
    )
    .join("\n");
  return [
    `Topic: ${topic}`,
    "First-party performance drivers for this account (the ONLY data that exists — cite rows inline using their bracketed id):",
    rows,
    "Write a ~200-token driver brief: what works, what underperforms, and how it applies to the topic. Cite drivers inline like [aabbccdd]. No preamble.",
  ].join("\n\n");
}

/**
 * Retrieval agent (W4): first-party rows → compact driver brief. Enforces the
 * minimum-N gate before any model call; the SQL layer enforces the two-layer
 * rule (see src/db/queries/posts.ts guardrails).
 */
export async function retrieveDrivers(input: {
  workspaceId: string;
  clientId: string;
  topic: string;
}): Promise<DriverBrief> {
  const baseline = await getBaselinePoints(input.workspaceId, input.clientId);
  if (baseline.length < MIN_BASELINE_N) {
    return { status: "insufficient_baseline", sampleSize: baseline.length };
  }

  const [embedding] = await routeAI({ kind: "embed", texts: [input.topic] });
  const [similar, upMovers, downMovers] = await Promise.all([
    similarPostsQuery(input.workspaceId, input.clientId, embedding),
    topMoversQuery(input.workspaceId, input.clientId, "up", 5),
    topMoversQuery(input.workspaceId, input.clientId, "down", 3),
  ]);

  const byId = new Map<string, DriverPost>();
  for (const post of [...similar, ...upMovers, ...downMovers]) {
    byId.set(post.id, post);
  }
  const drivers = Array.from(byId.values());

  const brief = await routeAI({
    kind: "chat",
    system:
      "You are a social performance analyst. Ground every claim in the provided first-party rows; never invent data.",
    prompt: buildBriefPrompt(input.topic, drivers),
  });

  const citedPrefixes = new Set(
    Array.from(brief.matchAll(/\[([a-f0-9]{8})\]/gi)).map((m) =>
      m[1].toLowerCase(),
    ),
  );
  const citedPostIds = drivers
    .filter((d) => citedPrefixes.has(d.id.slice(0, 8).toLowerCase()))
    .map((d) => d.id);

  return { status: "ready", brief, citedPostIds, drivers };
}
