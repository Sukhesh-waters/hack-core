/**
 * Live Meta check: does each connected Instagram account still answer the
 * calls the connectors make, and which API version actually served them.
 *
 *   npx tsx scripts/verify-meta.ts [--ws <workspace slug>] [--discover <ig username>]
 *
 * Replays the requests in lib/connectors/meta.ts and metrics-read.ts (v21),
 * then the same insights on the current version, and prints status, the
 * version Meta reports, any deprecation warning header and which metrics
 * came back. --discover also probes Business Discovery for one public
 * Business/Creator username. Writes nothing; never prints a token.
 */
const CODE_VERSION = "v21.0";
const CURRENT_VERSION = "v27.0";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function line(label: string, detail: string) {
  console.log(`  ${label.padEnd(34)} ${detail}`);
}

const WATCHED_HEADERS = [
  "facebook-api-version",
  "x-ad-api-version-warning",
  "x-app-usage",
  "x-business-use-case-usage",
];

async function graph(version: string, path: string, token: string) {
  const response = await fetch(`https://graph.facebook.com/${version}/${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const headers = WATCHED_HEADERS.flatMap((name) => {
    const value = response.headers.get(name);
    return value ? [`${name}=${value}`] : [];
  });
  return { status: response.status, body, headers };
}

function errorText(body: Record<string, unknown>): string {
  const error = body.error as { message?: string; code?: number } | undefined;
  return error ? `${error.code ?? "?"}: ${error.message ?? ""}`.slice(0, 160) : "";
}

function report(label: string, result: Awaited<ReturnType<typeof graph>>, detail = "") {
  const outcome = result.status === 200 ? "OK" : `FAILED ${result.status} ${errorText(result.body)}`;
  line(label, [outcome, detail].filter(Boolean).join(" — "));
  for (const header of result.headers) line("", header);
}

function metricNames(body: Record<string, unknown>): string {
  const data = (body.data as { name: string; values?: { value?: unknown }[] }[] | undefined) ?? [];
  return data.map((m) => `${m.name}=${JSON.stringify(m.values?.[0]?.value ?? null)}`).join(", ") || "(none)";
}

async function main() {
  process.loadEnvFile(".env.local");
  const { db } = await import("@/db");
  const { connectedAccounts, workspaces } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { decryptSecret } = await import("@/lib/crypto");

  line("META_CONNECTOR_ENABLED", process.env.META_CONNECTOR_ENABLED ?? "NOT SET");

  const slug = arg("ws");
  const query = db
    .select({
      account: connectedAccounts,
      workspaceSlug: workspaces.slug,
    })
    .from(connectedAccounts)
    .innerJoin(workspaces, eq(workspaces.id, connectedAccounts.workspaceId));
  const rows = slug ? await query.where(eq(workspaces.slug, slug)) : await query;

  if (rows.length === 0) {
    console.log(`\nNo connected Instagram accounts${slug ? ` in "${slug}"` : ""}. Nothing to check.\n`);
    process.exit(0);
  }

  let failures = 0;
  for (const { account, workspaceSlug } of rows) {
    console.log(`\n${workspaceSlug} / ig ${account.igUserId}`);
    line("status in DB", `${account.status}${account.lastError ? ` (last error: ${account.lastError.slice(0, 80)})` : ""}`);
    line("last pull", account.lastPullAt?.toISOString() ?? "never");
    line("token expires", account.tokenExpiresAt?.toISOString() ?? "unknown");

    let token: string;
    try {
      token = decryptSecret(account.accessTokenEnc);
    } catch {
      failures += 1;
      line("token", "FAILED to decrypt (AUTH_SECRET changed?)");
      continue;
    }

    const media = await graph(
      CODE_VERSION,
      `${account.igUserId}/media?fields=id,timestamp,media_type,like_count,comments_count&limit=3`,
      token,
    );
    const items = (media.body.data as { id: string; media_type?: string; like_count?: number }[] | undefined) ?? [];
    report(`media list (${CODE_VERSION})`, media, `${items.length} item(s)`);
    if (media.status !== 200) {
      failures += 1;
      continue;
    }
    const hiddenLikes = items.filter((item) => item.like_count === undefined).length;
    if (hiddenLikes > 0) line("", `${hiddenLikes} item(s) without like_count (hidden, not zero)`);

    const first = items[0];
    if (!first) continue;
    line("probe media", `${first.id} (${first.media_type ?? "?"})`);

    for (const version of [CODE_VERSION, CURRENT_VERSION]) {
      const insights = await graph(version, `${first.id}/insights?metric=reach,saved,shares`, token);
      report(`insights reach,saved,shares (${version})`, insights, insights.status === 200 ? metricNames(insights.body) : "");
      if (insights.status !== 200) failures += 1;
    }
    const views = await graph(CURRENT_VERSION, `${first.id}/insights?metric=views`, token);
    report(`insights views (${CURRENT_VERSION})`, views, views.status === 200 ? metricNames(views.body) : "");

    const username = arg("discover");
    if (username) {
      const discovery = await graph(
        CURRENT_VERSION,
        `${account.igUserId}?fields=business_discovery.username(${encodeURIComponent(username)}){followers_count,media_count,media.limit(3){timestamp,like_count,comments_count,view_count}}`,
        token,
      );
      const found = discovery.body.business_discovery as { followers_count?: number; media_count?: number } | undefined;
      report(
        `business discovery @${username}`,
        discovery,
        found ? `followers=${found.followers_count ?? "?"}, media=${found.media_count ?? "?"}` : "",
      );
    }
  }

  console.log(failures === 0 ? "\nAll good.\n" : `\n${failures} check(s) failed.\n`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  if (error instanceof Error && error.cause) console.error("cause:", String(error.cause));
  process.exit(1);
});

export {};
