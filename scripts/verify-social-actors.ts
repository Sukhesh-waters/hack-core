/**
 * R5: confirm the social actor field names against LIVE payloads.
 *
 *   npx tsx scripts/verify-social-actors.ts [--handle nasa] [--save]
 *
 * The mapper reads likesCount / commentsCount / videoPlayCount / diggCount /
 * playCount / shareCount / authorMeta.fans / createTimeISO. Those names came
 * from documentation and were only ever checked against fixtures — and a wrong
 * name fails silently, because pickMetrics drops anything that is not a finite
 * number. One real run per actor is the only way to know.
 *
 * SPENDS APIFY CREDITS: four runs, three items each. --save writes the first
 * item of each payload to fetch/fixtures/<actor>-live-<date>.json.
 */
import { writeFileSync } from "node:fs";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function runActor(slug: string, input: Record<string, unknown>, memoryMb = 1024) {
  const token = process.env.APIFY_TOKEN;
  const res = await fetch(
    `https://api.apify.com/v2/acts/${slug}/run-sync-get-dataset-items?token=${token}&memory=${memoryMb}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(300_000),
    },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const items = await res.json();
  if (!Array.isArray(items)) throw new Error("unexpected payload");
  return items as Record<string, unknown>[];
}

async function main() {
  process.loadEnvFile(".env.local");
  const handle = arg("handle") ?? "nasa";
  const save = process.argv.includes("--save");
  const today = new Date().toISOString().slice(0, 10);
  const { mapSocialItem, pickMetrics } = await import("@/lib/platina/fetch/actors");

  const cases = [
    {
      name: "instagram-profile",
      slug: "apify~instagram-profile-scraper",
      input: { usernames: [handle] },
      target: { kind: "social_profile" as const, value: `instagram:@${handle}` },
      ref: { platform: "instagram" as const, handle },
    },
    {
      name: "instagram-posts",
      slug: "apify~instagram-scraper",
      input: {
        directUrls: [`https://www.instagram.com/${handle}/`],
        resultsType: "posts",
        resultsLimit: 3,
      },
      target: { kind: "social_posts" as const, value: `instagram:@${handle}` },
      ref: { platform: "instagram" as const, handle },
    },
    {
      name: "tiktok-profile",
      slug: "clockworks~tiktok-profile-scraper",
      input: { profiles: [handle], resultsPerPage: 3, shouldDownloadVideos: false },
      target: { kind: "social_profile" as const, value: `tiktok:@${handle}` },
      ref: { platform: "tiktok" as const, handle },
    },
    {
      name: "tiktok-posts",
      slug: "clockworks~tiktok-scraper",
      input: { profiles: [handle], resultsPerPage: 3, shouldDownloadVideos: false },
      target: { kind: "social_posts" as const, value: `tiktok:@${handle}` },
      ref: { platform: "tiktok" as const, handle },
    },
  ];

  for (const c of cases) {
    console.log(`\n=== ${c.name} (${c.slug}) ===`);
    try {
      const started = Date.now();
      const items = await runActor(c.slug, c.input);
      console.log(`${items.length} item(s) in ${Math.round((Date.now() - started) / 1000)}s`);
      const first = items[0];
      if (!first) {
        console.log("NO ITEMS — the actor returned an empty dataset");
        continue;
      }
      console.log("top-level keys:", Object.keys(first).slice(0, 30).join(", "));
      // What the mapper would actually produce today.
      const mapped = mapSocialItem(first, c.target as never, c.ref);
      console.log(
        "mapped:",
        mapped
          ? JSON.stringify({
              title: mapped.title,
              bodyChars: mapped.body.length,
              metrics: mapped.metrics ?? null,
            })
          : "NULL — the mapper rejected this item",
      );
      // Which documented field names are actually present?
      const probe = [
        "likesCount", "commentsCount", "videoViewCount", "videoPlayCount", "timestamp",
        "caption", "url", "followersCount", "fullName", "biography",
        "diggCount", "commentCount", "playCount", "shareCount", "createTimeISO",
        "createTime", "text", "webVideoUrl", "authorMeta", "fans",
      ];
      const present = probe.filter((k) => first[k] !== undefined);
      const missing = probe.filter((k) => first[k] === undefined);
      console.log("present:", present.join(", ") || "(none)");
      console.log("absent :", missing.join(", "));
      if (first.authorMeta && typeof first.authorMeta === "object") {
        console.log("authorMeta keys:", Object.keys(first.authorMeta as object).join(", "));
      }
      if (save) {
        const path = `src/lib/platina/fetch/fixtures/${c.name}-live-${today}.json`;
        writeFileSync(path, JSON.stringify(first, null, 2));
        console.log("saved", path);
      }
    } catch (error) {
      console.log("FAILED:", error instanceof Error ? error.message : String(error));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export {};
