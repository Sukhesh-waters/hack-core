# Phase 2 — Connectors + Pattern Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feature-flagged Meta connector, Apify public-pattern ingestion into its own namespace, a live-database layer-separation proof in CI, and a Connected Accounts screen with a freshness heartbeat.

**Architecture:** Public pattern rows get their **own table** (`pattern_posts`) that structurally has no score columns — a pattern row *cannot* carry performance truth. The Meta connector reuses Phase 1's import pipeline (first-party layer) and hides behind `META_CONNECTOR_ENABLED` until app review clears; connector tokens are AES-256-GCM encrypted at rest with a key derived from `AUTH_SECRET`. CI gains a pgvector Postgres service so the layer-separation test runs against a real database on every push.

**Tech Stack:** Next.js 14 App Router, Drizzle, Zod, Vitest, node:crypto, Meta Graph API v21.0 (REST), Apify REST (`apify~instagram-scraper`). No new npm dependencies.

## Global Constraints (from CLAUDE.md constitution)

- `workspace_id` on every new table, indexed; register new tables in `workspaceScopedTables`.
- Two-layer rule: `pattern_posts` is the public namespace — `source='public'`, `weight` neutral (1), no score columns, never cited as performance truth. First-party pulls go through the existing `buildImportPlan` path only.
- Degradation ladder: Meta flag off → connect UI shows "pending app review"; Apify token missing → patterns UI disabled with instructions; sync failure → heartbeat `status='error'` + `lastError`, never a crash.
- Minimum-N gate and router usage are inherited from Phase 1 (Meta pulls flow through `buildImportPlan`/`normalizeCaptions`/`embedPosts`).
- Secrets never stored plaintext: tokens pass through `encryptSecret` before insert.
- Gate before every commit: `npm run lint && npm run typecheck && npm test` (build for UI tasks).

## File Structure

```
src/db/schema.ts                          (modify: connected_accounts, pattern_posts, enums)
src/db/schema.test.ts                     (modify: pattern-namespace + registry tests)
src/lib/crypto.ts / crypto.test.ts        (create: AES-256-GCM secret encryption)
src/lib/flags.ts / flags.test.ts          (create: feature flags)
src/lib/freshness.ts / freshness.test.ts  (create: heartbeat staleness)
src/db/queries/accounts.ts / accounts.test.ts (create: accounts + pattern queries, scoped-SQL tests)
src/lib/connectors/apify.ts / apify.test.ts (create: public page scrape → pattern items)
src/lib/connectors/meta.ts / meta.test.ts (create: Graph API pull → ParsedPostRow[])
src/app/(app)/w/[ws]/accounts/page.tsx + actions.ts + connect-form.tsx + pattern-form.tsx + account-card.tsx (create)
src/app/(app)/w/[ws]/kb/page.tsx          (modify: public pattern section)
src/components/workspace-nav.tsx          (modify: Accounts link)
src/db/layer-separation.integration.test.ts (create: live-DB proof, CI-gated)
.github/workflows/ci.yml                  (modify: pgvector Postgres service + migrate)
.env.example                              (modify: META_CONNECTOR_ENABLED, META_*, APIFY_TOKEN)
drizzle/0003_*.sql                        (generated)
```

---

### Task 1: Schema — connected_accounts + pattern_posts

**Files:**
- Modify: `src/db/schema.ts`, `src/db/schema.test.ts`
- Generated: `drizzle/0003_*.sql`

**Interfaces:**
- Produces: `connectedAccounts` (cols: `id, workspaceId, clientId, provider, igUserId, accessTokenEnc, status: "connected"|"error"|"disconnected", lastPullAt: Date|null, lastError, createdAt`), `patternPosts` (cols: `id, workspaceId, pageHandle, source (default "public"), weight (default 1), externalId, caption, format, postedAt, likes, comments, raw, createdAt`), enums `connectorProvider("meta")`, `connectionStatus`.

- [ ] **Step 1: Failing tests** — append to `src/db/schema.test.ts`:

```ts
describe("pattern layer namespace (constitution rule)", () => {
  it("pattern_posts defaults to the public layer with neutral weight", () => {
    const columns = getTableColumns(schema.patternPosts);
    expect(columns.source.default).toBe("public");
    expect(columns.weight.default).toBe(1);
  });

  it("pattern_posts structurally cannot carry performance truth — no score columns", () => {
    const columns = getTableColumns(schema.patternPosts);
    expect(columns).not.toHaveProperty("zScore");
    expect(columns).not.toHaveProperty("direction");
    expect(columns).not.toHaveProperty("scoreStatus");
    expect(columns).not.toHaveProperty("engagementRate");
  });

  it("connector tables are registered as workspace-scoped", () => {
    expect(schema.workspaceScopedTables).toMatchObject({
      connectedAccounts: schema.connectedAccounts,
      patternPosts: schema.patternPosts,
    });
  });

  it("one connection per provider per client", () => {
    const { indexes } = getTableConfig(schema.connectedAccounts);
    expect(indexes.some((idx) => idx.config.unique)).toBe(true);
  });
});
```

- [ ] **Step 2:** `npm test -- src/db/schema.test.ts` → FAIL (`patternPosts` undefined).

- [ ] **Step 3: Implement** — append to `src/db/schema.ts` before `workspaceScopedTables`:

```ts
// ---------------------------------------------------------------------------
// Connectors (Phase 2). connected_accounts drives first-party pulls (Meta,
// feature-flagged). pattern_posts is the public pattern layer's OWN
// namespace: source=public, weight neutral, and structurally score-free —
// a pattern row cannot carry performance truth (two-layer rule).
// ---------------------------------------------------------------------------

export const connectorProvider = pgEnum("connector_provider", ["meta"]);
export const connectionStatus = pgEnum("connection_status", [
  "connected",
  "error",
  "disconnected",
]);

export const connectedAccounts = pgTable(
  "connected_accounts",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    provider: connectorProvider("provider").notNull().default("meta"),
    igUserId: text("ig_user_id").notNull(),
    // AES-256-GCM via src/lib/crypto.ts — never store the raw token.
    accessTokenEnc: text("access_token_enc").notNull(),
    status: connectionStatus("status").notNull().default("connected"),
    lastPullAt: timestamp("last_pull_at", { mode: "date" }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("connected_accounts_workspace_id_idx").on(
      table.workspaceId,
    ),
    uniquePerClient: uniqueIndex("connected_accounts_client_provider_unique").on(
      table.workspaceId,
      table.clientId,
      table.provider,
    ),
  }),
);

export const patternPosts = pgTable(
  "pattern_posts",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    pageHandle: text("page_handle").notNull(),
    source: ingestSource("source").notNull().default("public"),
    weight: real("weight").notNull().default(1),
    externalId: text("external_id"),
    caption: text("caption"),
    format: text("format"),
    postedAt: timestamp("posted_at", { mode: "date" }).notNull(),
    likes: integer("likes"),
    comments: integer("comments"),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("pattern_posts_workspace_id_idx").on(table.workspaceId),
  }),
);
```

Extend the registry:

```ts
export const workspaceScopedTables = {
  memberships,
  clients,
  content,
  importJobs,
  posts,
  postEmbeddings,
  connectedAccounts,
  patternPosts,
} as const;
```

- [ ] **Step 4:** `npm test -- src/db/schema.test.ts` → PASS. Then `npm run db:generate` → inspect `drizzle/0003_*.sql` for both `CREATE TABLE`s.

- [ ] **Step 5: Gate + commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/db/schema.ts src/db/schema.test.ts drizzle
git commit -m "feat: connected accounts + score-free pattern_posts namespace"
```

---

### Task 2: Secret encryption + feature flags

**Files:**
- Create: `src/lib/crypto.ts`, `src/lib/crypto.test.ts`, `src/lib/flags.ts`, `src/lib/flags.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `encryptSecret(plaintext): string`, `decryptSecret(payload): string` (throws on tamper/missing `AUTH_SECRET`); `metaConnectorEnabled(): boolean`, `apifyConfigured(): boolean`.

- [ ] **Step 1: Failing tests** — `src/lib/crypto.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto";

beforeEach(() => vi.stubEnv("AUTH_SECRET", "test-secret-at-least-32-chars-long!!"));
afterEach(() => vi.unstubAllEnvs());

describe("secret encryption", () => {
  it("round-trips a token", () => {
    expect(decryptSecret(encryptSecret("IGQVJtoken123"))).toBe("IGQVJtoken123");
  });

  it("produces distinct ciphertexts per call (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects tampered payloads", () => {
    const payload = encryptSecret("token");
    const parts = payload.split(".");
    parts[2] = parts[2].slice(0, -2) + "AA";
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("refuses to run without AUTH_SECRET", () => {
    vi.stubEnv("AUTH_SECRET", "");
    expect(() => encryptSecret("x")).toThrow("AUTH_SECRET");
  });
});
```

`src/lib/flags.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { apifyConfigured, metaConnectorEnabled } from "./flags";

afterEach(() => vi.unstubAllEnvs());

describe("feature flags", () => {
  it("meta connector is off unless META_CONNECTOR_ENABLED=true", () => {
    vi.stubEnv("META_CONNECTOR_ENABLED", "");
    expect(metaConnectorEnabled()).toBe(false);
    vi.stubEnv("META_CONNECTOR_ENABLED", "true");
    expect(metaConnectorEnabled()).toBe(true);
  });

  it("apify is configured when a token is present", () => {
    vi.stubEnv("APIFY_TOKEN", "");
    expect(apifyConfigured()).toBe(false);
    vi.stubEnv("APIFY_TOKEN", "apify_api_xyz");
    expect(apifyConfigured()).toBe(true);
  });
});
```

- [ ] **Step 2:** Run both → FAIL (modules missing).

- [ ] **Step 3: Implement** — `src/lib/crypto.ts`:

```ts
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

/** Connector tokens at rest: AES-256-GCM, key derived from AUTH_SECRET. */
function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((b) => b.toString("base64url")).join(".");
}

export function decryptSecret(payload: string): string {
  const [iv, tag, encrypted] = payload
    .split(".")
    .map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8",
  );
}
```

`src/lib/flags.ts`:

```ts
/** Degradation ladder switches — features stay dark until env unlocks them. */
export function metaConnectorEnabled(): boolean {
  return process.env.META_CONNECTOR_ENABLED === "true";
}

export function apifyConfigured(): boolean {
  return Boolean(process.env.APIFY_TOKEN);
}
```

Append to `.env.example`:

```bash
# --- Phase 2 connectors ------------------------------------------------------
# Flip to "true" only after Meta app review clears (constitution: feature flag)
META_CONNECTOR_ENABLED=false
# Apify token enables the public pattern layer — https://console.apify.com
APIFY_TOKEN=""
```

- [ ] **Step 4: Gate + commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/lib/crypto.ts src/lib/crypto.test.ts src/lib/flags.ts src/lib/flags.test.ts .env.example
git commit -m "feat: token encryption at rest and connector feature flags"
```

---

### Task 3: Freshness heartbeat + accounts/pattern query layer

**Files:**
- Create: `src/lib/freshness.ts`, `src/lib/freshness.test.ts`, `src/db/queries/accounts.ts`, `src/db/queries/accounts.test.ts`

**Interfaces:**
- Produces: `STALE_AFTER_DAYS = 7`, `getFreshness(lastPullAt: Date | null, now?): { status: "never" | "fresh" | "stale"; ageDays?: number }`; queries `listConnectedAccounts(workspaceId)`, `getConnectedAccount(workspaceId, accountId)`, `updateHeartbeat(workspaceId, accountId, patch)`, `listPatternPosts(workspaceId, { limit? })`, `patternQuery(workspaceId)` (exported for the scoped-SQL test), `countPatternPosts(workspaceId)`.

- [ ] **Step 1: Failing tests** — `src/lib/freshness.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getFreshness, STALE_AFTER_DAYS } from "./freshness";

const NOW = new Date("2026-07-04T00:00:00Z");

describe("freshness heartbeat", () => {
  it("never-pulled accounts report 'never'", () => {
    expect(getFreshness(null, NOW)).toEqual({ status: "never" });
  });

  it("recent pulls are fresh", () => {
    const twoDaysAgo = new Date(NOW.getTime() - 2 * 86_400_000);
    expect(getFreshness(twoDaysAgo, NOW)).toEqual({
      status: "fresh",
      ageDays: 2,
    });
  });

  it(`pulls older than ${STALE_AFTER_DAYS} days are flagged stale, not hidden`, () => {
    const nineDaysAgo = new Date(NOW.getTime() - 9 * 86_400_000);
    expect(getFreshness(nineDaysAgo, NOW)).toEqual({
      status: "stale",
      ageDays: 9,
    });
  });
});
```

`src/db/queries/accounts.test.ts` (`.toSQL()`, no DB — same style as posts.test.ts):

```ts
import { describe, expect, it } from "vitest";
import { patternQuery } from "./accounts";

describe("pattern layer queries", () => {
  it("pattern reads are workspace-scoped (isolation rule)", () => {
    const { sql, params } = patternQuery("ws_1").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });

  it("pattern reads select from pattern_posts, never from posts", () => {
    const { sql } = patternQuery("ws_1").toSQL();
    expect(sql).toContain('"pattern_posts"');
    expect(sql).not.toContain('"posts"');
  });
});
```

- [ ] **Step 2:** Run both → FAIL.

- [ ] **Step 3: Implement** — `src/lib/freshness.ts`:

```ts
export const STALE_AFTER_DAYS = 7;

export type Freshness =
  | { status: "never" }
  | { status: "fresh" | "stale"; ageDays: number };

/** Constitution: KB stale → flag it, don't silently serve it. */
export function getFreshness(
  lastPullAt: Date | null,
  now: Date = new Date(),
): Freshness {
  if (!lastPullAt) return { status: "never" };
  const ageDays = Math.floor(
    (now.getTime() - lastPullAt.getTime()) / 86_400_000,
  );
  return { status: ageDays > STALE_AFTER_DAYS ? "stale" : "fresh", ageDays };
}
```

`src/db/queries/accounts.ts`:

```ts
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { connectedAccounts, patternPosts } from "@/db/schema";

export async function listConnectedAccounts(workspaceId: string) {
  return db
    .select()
    .from(connectedAccounts)
    .where(eq(connectedAccounts.workspaceId, workspaceId))
    .orderBy(desc(connectedAccounts.createdAt));
}

export async function getConnectedAccount(
  workspaceId: string,
  accountId: string,
) {
  const rows = await db
    .select()
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.workspaceId, workspaceId),
        eq(connectedAccounts.id, accountId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function updateHeartbeat(
  workspaceId: string,
  accountId: string,
  patch: {
    status: "connected" | "error" | "disconnected";
    lastPullAt?: Date;
    lastError?: string | null;
  },
) {
  await db
    .update(connectedAccounts)
    .set(patch)
    .where(
      and(
        eq(connectedAccounts.workspaceId, workspaceId),
        eq(connectedAccounts.id, accountId),
      ),
    );
}

/** Public pattern layer reads its OWN namespace (two-layer rule). */
export function patternQuery(workspaceId: string) {
  return db
    .select()
    .from(patternPosts)
    .where(eq(patternPosts.workspaceId, workspaceId));
}

export async function listPatternPosts(
  workspaceId: string,
  opts: { limit?: number } = {},
) {
  return db
    .select()
    .from(patternPosts)
    .where(eq(patternPosts.workspaceId, workspaceId))
    .orderBy(desc(patternPosts.postedAt))
    .limit(opts.limit ?? 20);
}

export async function countPatternPosts(workspaceId: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(patternPosts)
    .where(eq(patternPosts.workspaceId, workspaceId));
  return row.count;
}
```

- [ ] **Step 4: Gate + commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/lib/freshness.ts src/lib/freshness.test.ts src/db/queries/accounts.ts src/db/queries/accounts.test.ts
git commit -m "feat: freshness heartbeat and workspace-scoped accounts/pattern queries"
```

---

### Task 4: Apify connector (public pattern ingestion)

**Files:**
- Create: `src/lib/connectors/apify.ts`, `src/lib/connectors/apify.test.ts`

**Interfaces:**
- Consumes: `APIFY_TOKEN` env.
- Produces: `fetchPublicPosts(handle: string, limit?): Promise<PatternItem[]>` with `type PatternItem = { externalId?: string; caption?: string; format: string | null; postedAt: Date; likes?: number; comments?: number; raw: unknown }`; `class ApifyError extends Error { status? }`.

- [ ] **Step 1: Failing tests** — `src/lib/connectors/apify.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApifyError, fetchPublicPosts } from "./apify";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => vi.stubEnv("APIFY_TOKEN", "apify_api_test"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fetchPublicPosts", () => {
  it("runs the Instagram scraper actor and maps items to pattern items", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          id: "abc123",
          caption: "Competitor launch post",
          timestamp: "2026-06-20T10:00:00.000Z",
          likesCount: 512,
          commentsCount: 33,
          type: "Video",
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const items = await fetchPublicPosts("competitor.coffee");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      externalId: "abc123",
      caption: "Competitor launch post",
      likes: 512,
      comments: 33,
      format: "video",
    });
    expect(items[0].postedAt.getUTCFullYear()).toBe(2026);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("api.apify.com");
    expect(url).toContain("instagram-scraper");
  });

  it("skips items without a usable timestamp", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse([
          { id: "1", caption: "no date" },
          { id: "2", caption: "ok", timestamp: "2026-06-01T00:00:00Z" },
        ]),
      ),
    );
    const items = await fetchPublicPosts("page");
    expect(items).toHaveLength(1);
    expect(items[0].externalId).toBe("2");
  });

  it("throws ApifyError without a token", async () => {
    vi.stubEnv("APIFY_TOKEN", "");
    vi.stubGlobal("fetch", vi.fn());
    await expect(fetchPublicPosts("page")).rejects.toBeInstanceOf(ApifyError);
  });

  it("throws ApifyError on a failed run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "quota" }, 402)),
    );
    await expect(fetchPublicPosts("page")).rejects.toBeInstanceOf(ApifyError);
  });
});
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implement** — `src/lib/connectors/apify.ts`:

```ts
/**
 * Public pattern ingestion via Apify's instagram-scraper actor (constitution:
 * Apify actors only — no own-scraper pipelines). Output lands ONLY in
 * pattern_posts (source=public, weight neutral).
 */

const ACTOR = "apify~instagram-scraper";
const RUN_SYNC_URL = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items`;

export class ApifyError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ApifyError";
  }
}

export type PatternItem = {
  externalId?: string;
  caption?: string;
  format: string | null;
  postedAt: Date;
  likes?: number;
  comments?: number;
  raw: unknown;
};

type ApifyItem = {
  id?: string;
  caption?: string;
  timestamp?: string;
  likesCount?: number;
  commentsCount?: number;
  type?: string;
};

export async function fetchPublicPosts(
  handle: string,
  limit = 30,
): Promise<PatternItem[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new ApifyError("APIFY_TOKEN is not set");

  const response = await fetch(`${RUN_SYNC_URL}?token=${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      directUrls: [`https://www.instagram.com/${handle.replace(/^@/, "")}/`],
      resultsType: "posts",
      resultsLimit: limit,
    }),
  });
  if (!response.ok) {
    throw new ApifyError(
      `Apify run failed (${response.status})`,
      response.status,
    );
  }

  const items = (await response.json()) as ApifyItem[];
  if (!Array.isArray(items)) {
    throw new ApifyError("Apify returned an unexpected payload");
  }

  return items.flatMap((item) => {
    const postedAt = new Date(item.timestamp ?? "");
    if (Number.isNaN(postedAt.getTime())) return [];
    return [
      {
        externalId: item.id,
        caption: item.caption,
        format: item.type ? item.type.toLowerCase() : null,
        postedAt,
        likes: item.likesCount,
        comments: item.commentsCount,
        raw: item,
      },
    ];
  });
}
```

- [ ] **Step 4: Gate + commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/lib/connectors
git commit -m "feat: Apify public pattern connector"
```

---

### Task 5: Meta Graph connector (feature-flagged, first-party layer)

**Files:**
- Create: `src/lib/connectors/meta.ts`, `src/lib/connectors/meta.test.ts`

**Interfaces:**
- Consumes: `ParsedPostRow` (Phase 1 Task 4).
- Produces: `pullMetaMedia(igUserId: string, accessToken: string, limit?): Promise<ParsedPostRow[]>`; `class MetaConnectorError extends Error { status? }`. Field mapping is best-effort until app review unlocks live testing — the shape is pinned by tests, the endpoint strings may need a version bump later.

- [ ] **Step 1: Failing tests** — `src/lib/connectors/meta.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaConnectorError, pullMetaMedia } from "./meta";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

const MEDIA_PAYLOAD = {
  data: [
    {
      id: "m1",
      caption: "Our launch",
      timestamp: "2026-06-01T10:00:00+0000",
      media_type: "REEL",
      like_count: 120,
      comments_count: 8,
    },
  ],
};

describe("pullMetaMedia", () => {
  it("maps media + insights into ParsedPostRow shape (first-party layer input)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(MEDIA_PAYLOAD))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { name: "reach", values: [{ value: 4000 }] },
            { name: "saved", values: [{ value: 25 }] },
            { name: "shares", values: [{ value: 10 }] },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const rows = await pullMetaMedia("ig_user_1", "token");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      externalId: "m1",
      caption: "Our launch",
      likes: 120,
      comments: 8,
      reach: 4000,
      saves: 25,
      shares: 10,
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "graph.facebook.com",
    );
  });

  it("keeps the row without reach when insights fail — unscored, not fabricated", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(MEDIA_PAYLOAD))
      .mockResolvedValueOnce(jsonResponse({ error: "denied" }, 403));
    vi.stubGlobal("fetch", fetchMock);

    const rows = await pullMetaMedia("ig_user_1", "token");
    expect(rows).toHaveLength(1);
    expect(rows[0].reach).toBeUndefined();
  });

  it("throws MetaConnectorError when the media listing fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "bad token" }, 401)),
    );
    await expect(pullMetaMedia("u", "t")).rejects.toBeInstanceOf(
      MetaConnectorError,
    );
  });
});
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implement** — `src/lib/connectors/meta.ts`:

```ts
import type { ParsedPostRow } from "@/lib/csv-import";

/**
 * Meta Graph API pull → first-party layer, behind META_CONNECTOR_ENABLED.
 * Endpoint fields are best-effort until app review unlocks live testing;
 * the output shape (ParsedPostRow) is the stable contract — it feeds the
 * same buildImportPlan pipeline as CSV import.
 */

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

export class MetaConnectorError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "MetaConnectorError";
  }
}

type MediaItem = {
  id: string;
  caption?: string;
  timestamp?: string;
  media_type?: string;
  like_count?: number;
  comments_count?: number;
};

type InsightsPayload = {
  data?: { name: string; values?: { value?: number }[] }[];
};

async function fetchMediaInsights(
  mediaId: string,
  accessToken: string,
): Promise<{ reach?: number; saves?: number; shares?: number }> {
  try {
    const response = await fetch(
      `${GRAPH_BASE}/${mediaId}/insights?metric=reach,saved,shares&access_token=${accessToken}`,
    );
    if (!response.ok) return {};
    const payload = (await response.json()) as InsightsPayload;
    const metric = (name: string) =>
      payload.data?.find((m) => m.name === name)?.values?.[0]?.value;
    return {
      reach: metric("reach"),
      saves: metric("saved"),
      shares: metric("shares"),
    };
  } catch {
    return {}; // insights are enhancement — row stays importable, unscored
  }
}

export async function pullMetaMedia(
  igUserId: string,
  accessToken: string,
  limit = 50,
): Promise<ParsedPostRow[]> {
  const response = await fetch(
    `${GRAPH_BASE}/${igUserId}/media?fields=id,caption,timestamp,media_type,like_count,comments_count&limit=${limit}&access_token=${accessToken}`,
  );
  if (!response.ok) {
    throw new MetaConnectorError(
      `Meta media listing failed (${response.status})`,
      response.status,
    );
  }
  const payload = (await response.json()) as { data?: MediaItem[] };
  const media = payload.data ?? [];

  const rows: ParsedPostRow[] = [];
  for (const item of media) {
    const postedAt = new Date(item.timestamp ?? "");
    if (Number.isNaN(postedAt.getTime())) continue;
    const insights = await fetchMediaInsights(item.id, accessToken);
    rows.push({
      externalId: item.id,
      caption: item.caption,
      postedAt,
      likes: item.like_count,
      comments: item.comments_count,
      reach: insights.reach,
      saves: insights.saves,
      shares: insights.shares,
    });
  }
  return rows;
}
```

- [ ] **Step 4: Gate + commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/lib/connectors
git commit -m "feat: feature-flagged Meta Graph connector mapping to the first-party pipeline"
```

---

### Task 6: Connected Accounts screen + server actions

**Files:**
- Create: `src/app/(app)/w/[ws]/accounts/actions.ts`, `.../accounts/page.tsx`, `.../accounts/connect-form.tsx`, `.../accounts/pattern-form.tsx`, `.../accounts/account-card.tsx`
- Modify: `src/lib/validation.ts`, `src/lib/validation.test.ts`, `src/components/workspace-nav.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–5 plus Phase 1's `buildImportPlan`, `normalizeCaptions`, `embedPosts`, `getBaselinePoints`, `requireMembership`, `actionErrorMessage`, `listClients`.
- Produces: route `/w/[ws]/accounts`; actions `connectMetaAccount`, `syncAccount`, `disconnectAccount`, `addPublicPage`; schemas `connectMetaSchema`, `publicPageSchema`.

- [ ] **Step 1: Failing validation tests** — append to `src/lib/validation.test.ts`:

```ts
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
```

(extend the `./validation` import with `connectMetaSchema, publicPageSchema`.)

- [ ] **Step 2:** Run → FAIL. Then append to `src/lib/validation.ts`:

```ts
export const connectMetaSchema = z.object({
  workspaceId: z.string().min(1, "Missing workspace"),
  clientId: z.string().min(1, "Pick a client"),
  igUserId: z.string().trim().min(1, "Instagram user id is required").max(64),
  accessToken: z.string().trim().min(10, "Paste the page access token"),
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
```

Run → PASS.

- [ ] **Step 3: Actions** — `src/app/(app)/w/[ws]/accounts/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { db } from "@/db";
import { connectedAccounts, patternPosts, posts } from "@/db/schema";
import { getConnectedAccount, updateHeartbeat } from "@/db/queries/accounts";
import { requireMembership } from "@/db/queries/memberships";
import { getBaselinePoints } from "@/db/queries/posts";
import { actionErrorMessage } from "@/lib/action-errors";
import { fetchPublicPosts } from "@/lib/connectors/apify";
import { pullMetaMedia } from "@/lib/connectors/meta";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { embedPosts } from "@/lib/embed-posts";
import { metaConnectorEnabled } from "@/lib/flags";
import { buildImportPlan } from "@/lib/import-pipeline";
import { normalizeCaptions } from "@/lib/normalize";
import { connectMetaSchema, publicPageSchema } from "@/lib/validation";

export type AccountsActionState = { error?: string; ok?: string } | undefined;

export async function connectMetaAccount(
  _prev: AccountsActionState,
  formData: FormData,
): Promise<AccountsActionState> {
  const parsed = connectMetaSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    clientId: formData.get("clientId"),
    igUserId: formData.get("igUserId"),
    accessToken: formData.get("accessToken"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const user = await requireUser();
    await requireMembership(parsed.data.workspaceId, user.id);
    await db.insert(connectedAccounts).values({
      workspaceId: parsed.data.workspaceId,
      clientId: parsed.data.clientId,
      igUserId: parsed.data.igUserId,
      accessTokenEnc: encryptSecret(parsed.data.accessToken),
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
  revalidatePath(`/w/${parsed.data.workspaceId}/accounts`);
  return { ok: "Account connected. Run a sync to pull history." };
}

export async function syncAccount(
  _prev: AccountsActionState,
  formData: FormData,
): Promise<AccountsActionState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const accountId = String(formData.get("accountId") ?? "");
  if (!metaConnectorEnabled()) {
    return { error: "Meta connector is disabled until app review clears." };
  }

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    const account = await getConnectedAccount(workspaceId, accountId);
    if (!account || account.status === "disconnected") {
      return { error: "Account not found or disconnected." };
    }

    const rows = await pullMetaMedia(
      account.igUserId,
      decryptSecret(account.accessTokenEnc),
    );
    if (rows.length > 0) {
      const meta = await normalizeCaptions(rows.map((row) => row.caption));
      const existingBaseline = await getBaselinePoints(
        workspaceId,
        account.clientId,
      );
      const planned = buildImportPlan({
        workspaceId,
        clientId: account.clientId,
        importJobId: accountId, // provenance: which connection produced these
        rows,
        meta,
        existingBaseline,
      });
      const inserted = await db
        .insert(posts)
        .values(planned)
        .returning({ id: posts.id, caption: posts.caption });
      await embedPosts(workspaceId, inserted);
    }
    await updateHeartbeat(workspaceId, accountId, {
      status: "connected",
      lastPullAt: new Date(),
      lastError: null,
    });
  } catch (error) {
    await updateHeartbeat(workspaceId, accountId, {
      status: "error",
      lastError: actionErrorMessage(error),
    }).catch(() => {});
    return { error: actionErrorMessage(error) };
  }
  revalidatePath(`/w/${workspaceId}/accounts`);
  return { ok: "Sync complete." };
}

export async function disconnectAccount(
  _prev: AccountsActionState,
  formData: FormData,
): Promise<AccountsActionState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const accountId = String(formData.get("accountId") ?? "");
  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    await updateHeartbeat(workspaceId, accountId, { status: "disconnected" });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
  revalidatePath(`/w/${workspaceId}/accounts`);
  return { ok: "Disconnected." };
}

export async function addPublicPage(
  _prev: AccountsActionState,
  formData: FormData,
): Promise<AccountsActionState> {
  const parsed = publicPageSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    handle: formData.get("handle"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const user = await requireUser();
    await requireMembership(parsed.data.workspaceId, user.id);
    const items = await fetchPublicPosts(parsed.data.handle);
    if (items.length === 0) {
      return { error: "No public posts found for that handle." };
    }
    await db.insert(patternPosts).values(
      items.map((item) => ({
        workspaceId: parsed.data.workspaceId,
        pageHandle: parsed.data.handle,
        externalId: item.externalId ?? null,
        caption: item.caption ?? null,
        format: item.format,
        postedAt: item.postedAt,
        likes: item.likes ?? null,
        comments: item.comments ?? null,
        raw: item.raw,
      })),
    );
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
  revalidatePath(`/w/${parsed.data.workspaceId}/accounts`);
  return { ok: `Pattern layer updated from @${parsed.data.handle}.` };
}
```

- [ ] **Step 4: Forms.** `connect-form.tsx` (client component — same `useFormState` pattern as Phase 1 forms):

```tsx
"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { connectMetaAccount, type AccountsActionState } from "./actions";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Working…" : label}
    </Button>
  );
}

export function ConnectForm({
  workspaceId,
  clients,
}: {
  workspaceId: string;
  clients: { id: string; name: string }[];
}) {
  const [state, formAction] = useFormState<AccountsActionState, FormData>(
    connectMetaAccount,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <div className="space-y-1.5">
        <Label htmlFor="clientId">Client</Label>
        <select
          id="clientId"
          name="clientId"
          required
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
        >
          <option value="">Select a client…</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="igUserId">Instagram user id</Label>
        <Input id="igUserId" name="igUserId" placeholder="17841400000000000" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="accessToken">Page access token</Label>
        <Input id="accessToken" name="accessToken" type="password" required />
        <p className="text-xs text-white/40">
          Encrypted at rest. Dev-mode tokens work for pages you admin while
          app review is pending.
        </p>
      </div>
      {state?.error ? <p className="text-sm text-red-400">{state.error}</p> : null}
      {state?.ok ? <p className="text-sm text-brand-teal">{state.ok}</p> : null}
      <SubmitButton label="Connect account" />
    </form>
  );
}
```

`pattern-form.tsx`:

```tsx
"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addPublicPage, type AccountsActionState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} variant="outline" className="w-full">
      {pending ? "Scraping via Apify…" : "Pull public patterns"}
    </Button>
  );
}

export function PatternForm({ workspaceId }: { workspaceId: string }) {
  const [state, formAction] = useFormState<AccountsActionState, FormData>(
    addPublicPage,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <div className="space-y-1.5">
        <Label htmlFor="handle">Public Instagram handle</Label>
        <Input id="handle" name="handle" placeholder="@competitor" required />
        <p className="text-xs text-white/40">
          Lands in the pattern layer — source=public, weight neutral, never
          scored, never cited as performance truth.
        </p>
      </div>
      {state?.error ? <p className="text-sm text-red-400">{state.error}</p> : null}
      {state?.ok ? <p className="text-sm text-brand-teal">{state.ok}</p> : null}
      <SubmitButton />
    </form>
  );
}
```

`account-card.tsx` (client — sync/disconnect buttons wrap the actions):

```tsx
"use client";

import { useFormState } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/glass-card";
import {
  disconnectAccount,
  syncAccount,
  type AccountsActionState,
} from "./actions";

export type AccountView = {
  id: string;
  clientName: string;
  igUserId: string;
  status: "connected" | "error" | "disconnected";
  freshness: { status: "never" | "fresh" | "stale"; ageDays?: number };
  lastError: string | null;
  metaEnabled: boolean;
};

function FreshnessBadge({ freshness }: { freshness: AccountView["freshness"] }) {
  if (freshness.status === "never") {
    return (
      <Badge variant="outline" className="border-white/15 text-white/40">
        Never pulled
      </Badge>
    );
  }
  if (freshness.status === "stale") {
    return (
      <Badge variant="outline" className="border-brand-amber/40 text-brand-amber">
        Stale · {freshness.ageDays}d
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-brand-teal/40 text-brand-teal">
      Fresh · {freshness.ageDays}d
    </Badge>
  );
}

export function AccountCard({
  workspaceId,
  account,
}: {
  workspaceId: string;
  account: AccountView;
}) {
  const [syncState, syncFormAction] = useFormState<AccountsActionState, FormData>(
    syncAccount,
    undefined,
  );
  const [, disconnectFormAction] = useFormState<AccountsActionState, FormData>(
    disconnectAccount,
    undefined,
  );

  return (
    <GlassCard className="flex items-center justify-between p-5">
      <div>
        <p className="font-display text-xl">{account.clientName}</p>
        <p className="mt-1 font-mono text-xs text-white/45">
          Meta · {account.igUserId}
        </p>
        {account.lastError ? (
          <p className="mt-1 text-xs text-red-400">{account.lastError}</p>
        ) : null}
        {syncState?.error ? (
          <p className="mt-1 text-xs text-red-400">{syncState.error}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        <FreshnessBadge freshness={account.freshness} />
        {account.status !== "disconnected" ? (
          <>
            <form action={syncFormAction}>
              <input type="hidden" name="workspaceId" value={workspaceId} />
              <input type="hidden" name="accountId" value={account.id} />
              <Button size="sm" type="submit" disabled={!account.metaEnabled}>
                {account.metaEnabled ? "Sync now" : "Awaiting review"}
              </Button>
            </form>
            <form action={disconnectFormAction}>
              <input type="hidden" name="workspaceId" value={workspaceId} />
              <input type="hidden" name="accountId" value={account.id} />
              <Button size="sm" variant="ghost" type="submit">
                Disconnect
              </Button>
            </form>
          </>
        ) : (
          <Badge variant="outline" className="border-white/15 text-white/40">
            Disconnected
          </Badge>
        )}
      </div>
    </GlassCard>
  );
}
```

- [ ] **Step 5: Page** — `src/app/(app)/w/[ws]/accounts/page.tsx`:

```tsx
import { listConnectedAccounts } from "@/db/queries/accounts";
import { listClients } from "@/db/queries/clients";
import { apifyConfigured, metaConnectorEnabled } from "@/lib/flags";
import { getFreshness } from "@/lib/freshness";
import { GlassCard } from "@/components/glass-card";
import { AccountCard, type AccountView } from "./account-card";
import { ConnectForm } from "./connect-form";
import { PatternForm } from "./pattern-form";

export const metadata = { title: "Connected accounts" };
export const dynamic = "force-dynamic";

export default async function AccountsPage({
  params,
}: {
  params: { ws: string };
}) {
  const [accounts, clients] = await Promise.all([
    listConnectedAccounts(params.ws),
    listClients(params.ws),
  ]);
  const metaEnabled = metaConnectorEnabled();
  const clientNames = new Map(clients.map((c) => [c.id, c.name]));

  const views: AccountView[] = accounts.map((account) => ({
    id: account.id,
    clientName: clientNames.get(account.clientId) ?? "Unknown client",
    igUserId: account.igUserId,
    status: account.status,
    freshness: getFreshness(account.lastPullAt),
    lastError: account.lastError,
    metaEnabled,
  }));

  return (
    <div>
      <p className="label-mono text-brand-teal">Connected accounts</p>
      <h1 className="mt-2 font-display text-4xl">Data connections</h1>
      <p className="mt-2 text-sm text-white/50">
        First-party pulls feed the baseline engine. Public pages feed the
        separate pattern layer. The two never mix.
      </p>

      {views.length > 0 ? (
        <div className="mt-8 space-y-3">
          {views.map((account) => (
            <AccountCard
              key={account.id}
              workspaceId={params.ws}
              account={account}
            />
          ))}
        </div>
      ) : null}

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <GlassCard className="p-6">
          <p className="label-mono text-brand-teal">
            First-party · Meta connector
          </p>
          {!metaEnabled ? (
            <p className="mt-2 text-sm text-brand-amber">
              Awaiting Meta app review — connections can be saved now, syncs
              unlock when META_CONNECTOR_ENABLED=true.
            </p>
          ) : null}
          <div className="mt-4">
            <ConnectForm workspaceId={params.ws} clients={clients} />
          </div>
        </GlassCard>

        <GlassCard className="p-6">
          <p className="label-mono text-brand-purple">
            Pattern layer · public pages
          </p>
          {apifyConfigured() ? (
            <div className="mt-4">
              <PatternForm workspaceId={params.ws} />
            </div>
          ) : (
            <p className="mt-2 text-sm text-white/50">
              Set <code className="font-mono">APIFY_TOKEN</code> in{" "}
              <code className="font-mono">.env.local</code> to enable public
              pattern ingestion.
            </p>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Nav.** In `src/components/workspace-nav.tsx`, extend the imports (`import { BookOpenText, Cable, Users } from "lucide-react";`) and the items array:

```ts
  const items = [
    { label: "Knowledge Base", href: `${base}/kb`, icon: BookOpenText },
    { label: "Clients", href: `${base}/clients`, icon: Users },
    { label: "Accounts", href: `${base}/accounts`, icon: Cable },
  ];
```

- [ ] **Step 7: Gate (incl. build) + commit**

```bash
npm run lint && npm run typecheck && npm test && npm run build
git add "src/app/(app)/w/[ws]/accounts" src/lib/validation.ts src/lib/validation.test.ts src/components/workspace-nav.tsx
git commit -m "feat: Connected Accounts screen — flagged Meta connect, Apify patterns, heartbeat"
```

---

### Task 7: Pattern layer visible in the KB

**Files:**
- Modify: `src/app/(app)/w/[ws]/kb/page.tsx`

**Interfaces:**
- Consumes: `listPatternPosts`, `countPatternPosts` (Task 3).

- [ ] **Step 1:** In `kb/page.tsx`, extend the imports:

```tsx
import Link from "next/link";
import { countPatternPosts, listPatternPosts } from "@/db/queries/accounts";
```

change the data load to:

```tsx
  const [stats, rows, patternCount, patternRows] = await Promise.all([
    getKbStats(params.ws),
    listPosts(params.ws, { limit: 50 }),
    countPatternPosts(params.ws),
    listPatternPosts(params.ws, { limit: 10 }),
  ]);
```

and append after the first-party table's closing `</GlassCard>` (before the final `</div>`):

```tsx
      <GlassCard className="mt-6 p-6">
        <div className="flex items-center justify-between">
          <p className="label-mono text-brand-purple">
            Public pattern layer · {patternCount} rows
          </p>
          <Link
            href={`/w/${params.ws}/accounts`}
            className="text-xs text-white/40 hover:text-white"
          >
            Manage sources →
          </Link>
        </div>
        {patternRows.length === 0 ? (
          <p className="mt-2 text-sm text-white/50">
            Empty — add a public page from Connected Accounts. Pattern rows
            are market context only: neutral weight, no scores, never cited
            as performance truth.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {patternRows.map((pattern) => (
              <li
                key={pattern.id}
                className="flex items-center justify-between text-sm"
              >
                <span className="max-w-md truncate text-white/70">
                  <span className="font-mono text-xs text-white/40">
                    @{pattern.pageHandle}
                  </span>{" "}
                  {pattern.caption ?? "No caption"}
                </span>
                <Badge
                  variant="outline"
                  className="border-brand-purple/40 text-brand-purple"
                >
                  Pattern · neutral
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>
```

- [ ] **Step 2: Gate + commit**

```bash
npm run lint && npm run typecheck && npm test && npm run build
git add "src/app/(app)/w/[ws]/kb/page.tsx"
git commit -m "feat: public pattern layer section on the Knowledge Base screen"
```

---

### Task 8: Live-database layer-separation proof in CI

**Files:**
- Create: `src/db/layer-separation.integration.test.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `db`, schema tables, `getBaselinePoints`, `countPatternPosts`.
- Produces: a CI job step that migrates a real pgvector Postgres and proves a public row never enters the baseline. Gated by `INTEGRATION_DB=1` so local runs (no DB) skip it.

- [ ] **Step 1: The test** — `src/db/layer-separation.integration.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import {
  clients,
  memberships,
  orgs,
  patternPosts,
  posts,
  users,
  workspaces,
} from "@/db/schema";
import { getBaselinePoints } from "@/db/queries/posts";
import { countPatternPosts } from "@/db/queries/accounts";

/**
 * W3 "Done =" proof, against a real Postgres (CI service container):
 * a public row must never surface as performance truth. Runs only when
 * INTEGRATION_DB=1 (CI); local suites skip it.
 */
describe.skipIf(process.env.INTEGRATION_DB !== "1")(
  "layer separation (live database)",
  () => {
    const ids = {
      user: randomUUID(),
      org: randomUUID(),
      workspace: randomUUID(),
      client: randomUUID(),
    };

    afterAll(async () => {
      await db.delete(orgs).where(eq(orgs.id, ids.org)); // cascades workspace → rows
      await db.delete(users).where(eq(users.id, ids.user));
    });

    it("a public row never enters the baseline", async () => {
      await db.insert(users).values({ id: ids.user, email: `${ids.user}@t.io` });
      await db.insert(orgs).values({
        id: ids.org,
        name: "T",
        slug: `t-${ids.org.slice(0, 8)}`,
        ownerUserId: ids.user,
      });
      await db.insert(workspaces).values({
        id: ids.workspace,
        orgId: ids.org,
        name: "T",
        slug: `tw-${ids.workspace.slice(0, 8)}`,
      });
      await db.insert(memberships).values({
        workspaceId: ids.workspace,
        userId: ids.user,
        role: "owner",
      });
      await db.insert(clients).values({
        id: ids.client,
        workspaceId: ids.workspace,
        name: "Test client",
      });

      // 25 first-party truth rows…
      await db.insert(posts).values(
        Array.from({ length: 25 }, (_, i) => ({
          workspaceId: ids.workspace,
          clientId: ids.client,
          source: "first_party" as const,
          postedAt: new Date(Date.UTC(2026, 0, 1 + i)),
          engagementRate: 0.05 + i * 0.001,
          scoreStatus: "scored" as const,
        })),
      );
      // …one misrouted public row in the posts table…
      await db.insert(posts).values({
        workspaceId: ids.workspace,
        clientId: ids.client,
        source: "public" as const,
        postedAt: new Date(Date.UTC(2026, 5, 1)),
        engagementRate: 99, // absurd — would wreck the baseline if it leaked
        scoreStatus: "unscored" as const,
      });
      // …and a proper pattern-layer row in its own namespace.
      await db.insert(patternPosts).values({
        workspaceId: ids.workspace,
        pageHandle: "competitor",
        postedAt: new Date(Date.UTC(2026, 5, 2)),
        caption: "public pattern",
      });

      const baseline = await getBaselinePoints(ids.workspace, ids.client);
      expect(baseline).toHaveLength(25);
      expect(baseline.every((point) => point.value < 1)).toBe(true);

      expect(await countPatternPosts(ids.workspace)).toBe(1);

      // Workspace isolation: another workspace sees nothing.
      expect(await getBaselinePoints(randomUUID(), ids.client)).toHaveLength(0);
    });
  },
);
```

- [ ] **Step 2: Run locally** — `npm test -- src/db/layer-separation.integration.test.ts` → suite reported as **skipped** (no `INTEGRATION_DB`).

- [ ] **Step 3: CI service.** Replace the `verify` job in `.github/workflows/ci.yml` with:

```yaml
jobs:
  verify:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: instamedia_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/instamedia_test
      INTEGRATION_DB: "1"
      AUTH_SECRET: ci-only-secret-not-a-real-deployment
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run db:migrate
      - run: npm test
      - run: npm run build
```

- [ ] **Step 4: Gate + commit + push**

```bash
npm run lint && npm run typecheck && npm test && npm run build
git add src/db/layer-separation.integration.test.ts .github/workflows/ci.yml
git commit -m "test: live-database layer-separation proof with pgvector service in CI"
git push origin main
```

Then watch the Actions run — **this is the slice's real "Done" check**: the integration test must pass against the CI database.

---

## Known non-goals this slice (deliberate)

- No Meta OAuth redirect flow — manual token connect (works with dev-mode apps for pages you admin); full OAuth lands once app review defines the final scopes.
- No scheduled pulls — heartbeat is updated on manual sync; Inngest cron arrives in Phase 4 and will call the same `syncAccount` path.
- No pattern-post dedup per handle (same known gap as CSV import; one upsert fix covers both later).
- No pattern embeddings — pattern rows are context, not retrieval targets, until a Phase 3 decision says otherwise.

## Self-review notes

- Spec coverage (W3): Meta connector behind flag ✅, Apify `source=public`/`weight=neutral` own table ✅, CI-gated layer-separation test (now against a live DB) ✅, freshness heartbeat ✅, Connected Accounts screen with connect/disconnect ✅.
- Type consistency: `pullMetaMedia` returns Phase 1's `ParsedPostRow` and feeds the existing `buildImportPlan`; `PatternItem` maps 1:1 onto `patternPosts` insert columns; `AccountView.freshness` is exactly `getFreshness`'s return type.
- Constitution check: pattern table has no score columns (structural), baseline guardrail untouched, tokens encrypted, degradation paths for flag-off/token-missing/insights-failure all specified.
