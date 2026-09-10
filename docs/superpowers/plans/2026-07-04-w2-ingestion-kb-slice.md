# Phase 1 — Ingestion + Knowledge Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CSV import → normalized, direction/magnitude-scored, embedded rows in a workspace-scoped Knowledge Base, with the two-layer separation baked into the schema and CI.

**Architecture:** Pure-function core (scoring, CSV parsing, import planning) fully unit-tested; thin server actions do the DB/AI I/O. All AI calls (Groq normalization, Gemini embeddings) go through a new single-call-site model router with a throttle-fallback. New workspace-scoped route segment `/w/[ws]/…` carries the intake wizard and KB screen.

**Tech Stack:** Next.js 14 App Router, Drizzle ORM + Postgres/pgvector, Zod v4, Vitest, papaparse (new dep), Groq + Gemini REST APIs (no SDKs).

## Global Constraints (from CLAUDE.md constitution)

- `workspace_id` on every new table, indexed, and in every query — extend `workspaceScopedTables` so the existing CI test covers new tables.
- Two-layer rule: baseline/scoring reads `source = 'first_party'` ONLY; enforced by a CI-gated guardrail test.
- Minimum-N gate: below `MIN_BASELINE_N` show `insufficient_baseline` — never a fabricated score.
- Every AI call goes through `routeAI()` — no direct provider calls elsewhere.
- Degradation ladder: Groq throttled → router swaps to Gemini; normalization/embedding failures degrade gracefully (import still lands).
- UI: Tailwind + shadcn/ui + existing `GlassCard`/`Badge`/`Button` primitives. No inline styles.
- Only new dependency allowed: `papaparse` (+ `@types/papaparse`).
- Gate before every commit: `npm run lint && npm run typecheck && npm test`.

## File Structure

```
src/db/schema.ts                                    (modify: enums + posts, import_jobs, post_embeddings)
src/db/schema.test.ts                               (modify: layer-metadata tests)
src/db/queries/posts.ts                             (create: baseline/list/stats queries)
src/db/queries/posts.test.ts                        (create: layer-separation guardrail, CI gate)
src/db/queries/clients.ts                           (modify: add getClientById)
src/lib/scoring.ts / scoring.test.ts                (create: z-score, freshness decay, min-N gate)
src/lib/ai/router.ts / router.test.ts               (create: routeAI over Groq/Gemini)
src/lib/csv-import.ts / csv-import.test.ts          (create: header-alias CSV parser)
src/lib/normalize.ts / normalize.test.ts            (create: Groq caption classifier)
src/lib/import-pipeline.ts / import-pipeline.test.ts (create: pure import planner)
src/lib/embed-posts.ts                              (create: embed + store, non-fatal)
src/lib/validation.ts                               (modify: clientIntakeSchema)
src/app/(app)/w/[ws]/layout.tsx                     (create: membership guard)
src/app/(app)/w/[ws]/clients/page.tsx               (create: client list)
src/app/(app)/w/[ws]/clients/new/page.tsx + client-form.tsx + actions.ts (create: intake step 1)
src/app/(app)/w/[ws]/clients/[clientId]/import/page.tsx + upload-form.tsx + actions.ts (create: intake step 2)
src/app/(app)/w/[ws]/kb/page.tsx                    (create: Knowledge Base screen)
src/components/score-chip.tsx                       (create: direction/magnitude chip)
src/components/workspace-nav.tsx                    (create: ws-aware sidebar links)
src/components/app-sidebar.tsx                      (modify: mount WorkspaceNav)
src/app/(app)/hub/page.tsx                          (modify: workspace card → /w/[id]/kb)
fixtures/sample-posts.csv                           (create: 24-row demo CSV)
.env.example                                        (modify: GROQ_API_KEY, GEMINI_API_KEY)
drizzle/0001_pgvector.sql, drizzle/0002_*.sql       (generated)
```

---

### Task 1: Ingestion schema + pgvector migration

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/schema.test.ts`
- Generated: `drizzle/0001_pgvector.sql`, `drizzle/0002_*.sql`

**Interfaces:**
- Produces: tables `posts`, `importJobs`, `postEmbeddings`; enums `ingestSource("first_party"|"public")`, `scoreStatus("scored"|"insufficient_baseline"|"unscored")`, `scoreDirection("up"|"down"|"flat")`, `importJobStatus("processing"|"complete"|"failed")`. All later tasks import these from `@/db/schema`.

- [ ] **Step 1: Write the failing tests** — append to `src/db/schema.test.ts` (inside the existing describe or a new one):

```ts
describe("two-layer separation metadata (constitution rule)", () => {
  it("ingestion tables carry a source column", () => {
    expect(getTableColumns(schema.posts).source).toBeDefined();
    expect(getTableColumns(schema.postEmbeddings).source).toBeDefined();
  });

  it("posts default to the first-party layer with neutral weight available", () => {
    const columns = getTableColumns(schema.posts);
    expect(columns.source.default).toBe("first_party");
    expect(columns.weight).toBeDefined();
  });

  it("new ingestion tables are registered as workspace-scoped", () => {
    expect(schema.workspaceScopedTables).toMatchObject({
      posts: schema.posts,
      importJobs: schema.importJobs,
      postEmbeddings: schema.postEmbeddings,
    });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -- src/db/schema.test.ts` → FAIL: `schema.posts` undefined.

- [ ] **Step 3: Implement schema.** In `src/db/schema.ts`, extend the pg-core import to include `integer`, `jsonb`, `real`, `vector`, then append after the `content` table:

```ts
// ---------------------------------------------------------------------------
// Ingestion layer (W2). Two-layer rule: source separates first-party truth
// from public pattern rows; the baseline engine filters on it (see
// src/db/queries/posts.ts). weight stays neutral (1) for public rows.
// ---------------------------------------------------------------------------

export const ingestSource = pgEnum("ingest_source", ["first_party", "public"]);
export const scoreStatus = pgEnum("score_status", [
  "scored",
  "insufficient_baseline",
  "unscored",
]);
export const scoreDirection = pgEnum("score_direction", ["up", "down", "flat"]);
export const importJobStatus = pgEnum("import_job_status", [
  "processing",
  "complete",
  "failed",
]);

export const importJobs = pgTable(
  "import_jobs",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    rowCount: integer("row_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    status: importJobStatus("status").notNull().default("processing"),
    error: text("error"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("import_jobs_workspace_id_idx").on(table.workspaceId),
  }),
);

export const posts = pgTable(
  "posts",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    importJobId: text("import_job_id").references(() => importJobs.id),
    source: ingestSource("source").notNull().default("first_party"),
    weight: real("weight").notNull().default(1),
    externalId: text("external_id"),
    caption: text("caption"),
    format: text("format"),
    topics: jsonb("topics").$type<string[]>(),
    postedAt: timestamp("posted_at", { mode: "date" }).notNull(),
    reach: integer("reach"),
    likes: integer("likes"),
    comments: integer("comments"),
    shares: integer("shares"),
    saves: integer("saves"),
    engagementRate: real("engagement_rate"),
    zScore: real("z_score"),
    magnitude: real("magnitude"),
    direction: scoreDirection("direction"),
    scoreStatus: scoreStatus("score_status").notNull().default("unscored"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("posts_workspace_id_idx").on(table.workspaceId),
    clientIdx: index("posts_client_id_idx").on(table.clientId),
    sourceIdx: index("posts_source_idx").on(table.source),
  }),
);

export const postEmbeddings = pgTable(
  "post_embeddings",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    postId: text("post_id")
      .notNull()
      .unique()
      .references(() => posts.id, { onDelete: "cascade" }),
    source: ingestSource("source").notNull(),
    embedding: vector("embedding", { dimensions: 768 }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("post_embeddings_workspace_id_idx").on(
      table.workspaceId,
    ),
  }),
);
```

Then extend the registry (existing line at the bottom of the file):

```ts
export const workspaceScopedTables = {
  memberships,
  clients,
  content,
  importJobs,
  posts,
  postEmbeddings,
} as const;
```

- [ ] **Step 4: Run tests** — `npm test -- src/db/schema.test.ts` → PASS (including the pre-existing workspace-isolation tests now covering the three new tables).

- [ ] **Step 5: Generate migrations.** pgvector extension must exist before the `vector(768)` column, so the custom migration comes first:

```bash
npx drizzle-kit generate --custom --name=pgvector
```

Fill the generated `drizzle/0001_pgvector.sql` with exactly:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Then: `npm run db:generate` → creates `drizzle/0002_*.sql` with the enums + three tables. Inspect it: it must contain `CREATE TABLE` for `posts`, `import_jobs`, `post_embeddings` and `"embedding" vector(768)`.

- [ ] **Step 6: Full gate + commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/db/schema.ts src/db/schema.test.ts drizzle
git commit -m "feat: ingestion schema — posts, import jobs, embeddings with two-layer source metadata"
```

---

### Task 2: Scoring engine (z-score + freshness decay + min-N gate)

**Files:**
- Create: `src/lib/scoring.ts`
- Test: `src/lib/scoring.test.ts`

**Interfaces:**
- Produces: `MIN_BASELINE_N = 20`, `FRESHNESS_HALF_LIFE_DAYS = 90`, `type BaselinePoint = { value: number; postedAt: Date }`, `type PostScore = { status: "insufficient_baseline"; sampleSize: number } | { status: "scored"; zScore: number; direction: "up" | "down" | "flat"; magnitude: number }`, `freshnessWeight(postedAt, now?): number`, `scoreAgainstBaseline(value, baseline, now?): PostScore`, `computeEngagementRate(row): number | null`.

- [ ] **Step 1: Write the failing tests** — `src/lib/scoring.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  computeEngagementRate,
  freshnessWeight,
  MIN_BASELINE_N,
  scoreAgainstBaseline,
  type BaselinePoint,
} from "./scoring";

const NOW = new Date("2026-07-04T00:00:00Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

function points(values: number[], ageDays = 10): BaselinePoint[] {
  return values.map((value) => ({ value, postedAt: daysAgo(ageDays) }));
}

describe("minimum-N gate (constitution rule)", () => {
  it("refuses to score below MIN_BASELINE_N — no fabricated numbers", () => {
    const baseline = points(Array(MIN_BASELINE_N - 1).fill(5));
    expect(scoreAgainstBaseline(5, baseline, NOW)).toEqual({
      status: "insufficient_baseline",
      sampleSize: MIN_BASELINE_N - 1,
    });
  });

  it("scores at exactly MIN_BASELINE_N", () => {
    const baseline = points([...Array(MIN_BASELINE_N)].map((_, i) => i));
    expect(scoreAgainstBaseline(10, baseline, NOW).status).toBe("scored");
  });
});

describe("direction + magnitude", () => {
  const baseline = points([1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2, 3, 4, 5]);

  it("clear outlier above baseline scores up", () => {
    const score = scoreAgainstBaseline(9, baseline, NOW);
    expect(score).toMatchObject({ status: "scored", direction: "up" });
    if (score.status === "scored") expect(score.magnitude).toBeGreaterThan(0.5);
  });

  it("clear outlier below baseline scores down", () => {
    expect(scoreAgainstBaseline(-3, baseline, NOW)).toMatchObject({
      status: "scored",
      direction: "down",
    });
  });

  it("value at the mean scores flat with ~zero magnitude", () => {
    const score = scoreAgainstBaseline(3, baseline, NOW);
    expect(score).toMatchObject({ status: "scored", direction: "flat" });
    if (score.status === "scored") expect(score.magnitude).toBeLessThan(0.1);
  });

  it("zero-variance baseline scores flat instead of dividing by zero", () => {
    expect(scoreAgainstBaseline(7, points(Array(25).fill(7)), NOW)).toMatchObject(
      { status: "scored", direction: "flat", magnitude: 0 },
    );
  });
});

describe("freshness decay", () => {
  it("halves the weight every FRESHNESS_HALF_LIFE_DAYS", () => {
    expect(freshnessWeight(daysAgo(0), NOW)).toBeCloseTo(1, 5);
    expect(freshnessWeight(daysAgo(90), NOW)).toBeCloseTo(0.5, 5);
    expect(freshnessWeight(daysAgo(180), NOW)).toBeCloseTo(0.25, 5);
  });

  it("discounts stale baseline points: a value matching recent posts reads flat, not down", () => {
    const baseline = [...points(Array(20).fill(10), 5), ...points(Array(20).fill(100), 360)];
    const score = scoreAgainstBaseline(10, baseline, NOW);
    expect(score.status).toBe("scored");
    if (score.status === "scored") expect(score.direction).not.toBe("down");
  });
});

describe("computeEngagementRate", () => {
  it("sums interactions over reach", () => {
    expect(
      computeEngagementRate({ reach: 1000, likes: 80, comments: 10, shares: 5, saves: 5 }),
    ).toBeCloseTo(0.1, 5);
  });

  it("treats missing interaction counts as zero", () => {
    expect(computeEngagementRate({ reach: 100, likes: 10 })).toBeCloseTo(0.1, 5);
  });

  it("returns null without positive reach — unscorable, not zero", () => {
    expect(computeEngagementRate({ likes: 10 })).toBeNull();
    expect(computeEngagementRate({ reach: 0, likes: 10 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -- src/lib/scoring.test.ts` → FAIL: cannot resolve `./scoring`.

- [ ] **Step 3: Implement** — `src/lib/scoring.ts`:

```ts
/**
 * Direction/magnitude scoring: z-score of a post's metric against the
 * account's own freshness-weighted baseline (constitution: baseline engine
 * reads first-party rows only — enforced upstream in src/db/queries/posts.ts).
 */

export const MIN_BASELINE_N = 20;
export const FRESHNESS_HALF_LIFE_DAYS = 90;

export type BaselinePoint = { value: number; postedAt: Date };

export type PostScore =
  | { status: "insufficient_baseline"; sampleSize: number }
  | {
      status: "scored";
      zScore: number;
      direction: "up" | "down" | "flat";
      magnitude: number;
    };

export function freshnessWeight(postedAt: Date, now: Date = new Date()): number {
  const ageDays = Math.max(0, (now.getTime() - postedAt.getTime()) / 86_400_000);
  return Math.pow(0.5, ageDays / FRESHNESS_HALF_LIFE_DAYS);
}

export function scoreAgainstBaseline(
  value: number,
  baseline: BaselinePoint[],
  now: Date = new Date(),
): PostScore {
  if (baseline.length < MIN_BASELINE_N) {
    return { status: "insufficient_baseline", sampleSize: baseline.length };
  }

  const weights = baseline.map((point) => freshnessWeight(point.postedAt, now));
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  const mean =
    baseline.reduce((sum, point, i) => sum + point.value * weights[i], 0) /
    weightSum;
  const variance =
    baseline.reduce(
      (sum, point, i) => sum + weights[i] * (point.value - mean) ** 2,
      0,
    ) / weightSum;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) {
    return { status: "scored", zScore: 0, direction: "flat", magnitude: 0 };
  }

  const zScore = (value - mean) / stdDev;
  const direction = zScore > 0.5 ? "up" : zScore < -0.5 ? "down" : "flat";
  // Magnitude: |z| normalized to 0..1, saturating at 3 standard deviations.
  const magnitude = Math.min(Math.abs(zScore), 3) / 3;
  return { status: "scored", zScore, direction, magnitude };
}

export function computeEngagementRate(row: {
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
}): number | null {
  if (!row.reach || row.reach <= 0) return null;
  const interactions =
    (row.likes ?? 0) + (row.comments ?? 0) + (row.shares ?? 0) + (row.saves ?? 0);
  return interactions / row.reach;
}
```

- [ ] **Step 4: Run tests** — `npm test -- src/lib/scoring.test.ts` → PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/lib/scoring.ts src/lib/scoring.test.ts
git commit -m "feat: baseline scoring engine — z-score, freshness decay, min-N gate"
```

---

### Task 3: Model router skeleton (Groq chat, Gemini fallback + embeddings)

**Files:**
- Create: `src/lib/ai/router.ts`
- Test: `src/lib/ai/router.test.ts`
- Modify: `.env.example` (append)

**Interfaces:**
- Produces: `routeAI({ kind: "chat", prompt, system?, json? }): Promise<string>`, `routeAI({ kind: "embed", texts }): Promise<number[][]>`, `class AIRouterError extends Error { provider; status? }`, `EMBEDDING_DIMENSIONS = 768`. Tasks 6 and the embed step call only `routeAI` — never a provider directly.

- [ ] **Step 1: Write the failing tests** — `src/lib/ai/router.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AIRouterError, routeAI } from "./router";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubEnv("GROQ_API_KEY", "test-groq-key");
  vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("routeAI chat", () => {
  it("routes chat to Groq and returns the completion text", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ choices: [{ message: { content: "hello back" } }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(routeAI({ kind: "chat", prompt: "hello" })).resolves.toBe(
      "hello back",
    );
    expect(String(fetchMock.mock.calls[0][0])).toContain("api.groq.com");
  });

  it("falls back to Gemini when Groq throttles (degradation ladder)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, 429))
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [{ content: { parts: [{ text: "gemini says hi" }] } }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(routeAI({ kind: "chat", prompt: "hello" })).resolves.toBe(
      "gemini says hi",
    );
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      "generativelanguage.googleapis.com",
    );
  });

  it("does not fall back on non-throttle client errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "bad request" }, 400));
    vi.stubGlobal("fetch", fetchMock);

    await expect(routeAI({ kind: "chat", prompt: "x" })).rejects.toBeInstanceOf(
      AIRouterError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("routeAI embed", () => {
  it("routes embeddings to Gemini batchEmbedContents", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      routeAI({ kind: "embed", texts: ["a", "b"] }),
    ).resolves.toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("batchEmbedContents");
  });
});

describe("configuration errors", () => {
  it("throws AIRouterError when the provider key is missing", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn());
    await expect(routeAI({ kind: "chat", prompt: "x" })).rejects.toBeInstanceOf(
      AIRouterError,
    );
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -- src/lib/ai/router.test.ts` → FAIL: cannot resolve `./router`.

- [ ] **Step 3: Implement** — `src/lib/ai/router.ts`:

```ts
/**
 * Model router — the single call-site for every AI call (constitution rule).
 * Providers are a config detail behind routeAI: Groq for fast chat, Gemini
 * for chat fallback + embeddings. Bedrock's quality tier lands in Phase 3.
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_CHAT_MODEL = "gemini-2.0-flash";
const GEMINI_EMBED_MODEL = "text-embedding-004";

export const EMBEDDING_DIMENSIONS = 768;

export class AIRouterError extends Error {
  constructor(
    message: string,
    public readonly provider: "groq" | "gemini",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AIRouterError";
  }
}

export type ChatTask = {
  kind: "chat";
  prompt: string;
  system?: string;
  json?: boolean;
};
export type EmbedTask = { kind: "embed"; texts: string[] };

export async function routeAI(task: ChatTask): Promise<string>;
export async function routeAI(task: EmbedTask): Promise<number[][]>;
export async function routeAI(
  task: ChatTask | EmbedTask,
): Promise<string | number[][]> {
  if (task.kind === "embed") return geminiEmbed(task.texts);
  try {
    return await groqChat(task);
  } catch (error) {
    // Degradation ladder: provider throttled or down → swap provider.
    const swappable =
      error instanceof AIRouterError &&
      error.provider === "groq" &&
      (error.status === 429 || (error.status ?? 0) >= 500);
    if (swappable) return geminiChat(task);
    throw error;
  }
}

function requireKey(
  name: "GROQ_API_KEY" | "GEMINI_API_KEY",
  provider: "groq" | "gemini",
): string {
  const key = process.env[name];
  if (!key) throw new AIRouterError(`${name} is not set`, provider);
  return key;
}

async function groqChat(task: ChatTask): Promise<string> {
  const key = requireKey("GROQ_API_KEY", "groq");
  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        ...(task.system ? [{ role: "system", content: task.system }] : []),
        { role: "user", content: task.prompt },
      ],
      ...(task.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!response.ok) {
    throw new AIRouterError(
      `Groq request failed (${response.status})`,
      "groq",
      response.status,
    );
  }
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== "string") {
    throw new AIRouterError("Groq returned no content", "groq");
  }
  return text;
}

async function geminiChat(task: ChatTask): Promise<string> {
  const key = requireKey("GEMINI_API_KEY", "gemini");
  const response = await fetch(
    `${GEMINI_BASE}/models/${GEMINI_CHAT_MODEL}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(task.system
          ? { systemInstruction: { parts: [{ text: task.system }] } }
          : {}),
        contents: [{ role: "user", parts: [{ text: task.prompt }] }],
        ...(task.json
          ? { generationConfig: { responseMimeType: "application/json" } }
          : {}),
      }),
    },
  );
  if (!response.ok) {
    throw new AIRouterError(
      `Gemini request failed (${response.status})`,
      "gemini",
      response.status,
    );
  }
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") {
    throw new AIRouterError("Gemini returned no content", "gemini");
  }
  return text;
}

async function geminiEmbed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const key = requireKey("GEMINI_API_KEY", "gemini");
  const response = await fetch(
    `${GEMINI_BASE}/models/${GEMINI_EMBED_MODEL}:batchEmbedContents?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${GEMINI_EMBED_MODEL}`,
          content: { parts: [{ text }] },
        })),
      }),
    },
  );
  if (!response.ok) {
    throw new AIRouterError(
      `Gemini embed failed (${response.status})`,
      "gemini",
      response.status,
    );
  }
  const data = await response.json();
  const embeddings = Array.isArray(data.embeddings)
    ? data.embeddings.map((e: { values: number[] }) => e.values)
    : null;
  if (!embeddings) {
    throw new AIRouterError("Gemini returned no embeddings", "gemini");
  }
  return embeddings;
}
```

- [ ] **Step 4: Run tests** — `npm test -- src/lib/ai/router.test.ts` → PASS (5 tests).

- [ ] **Step 5: Document env.** Append to `.env.example`:

```bash
# Model router (Phase 1: Groq fast tier + Gemini fallback/embeddings)
GROQ_API_KEY=""
GEMINI_API_KEY=""
```

- [ ] **Step 6: Commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/lib/ai .env.example
git commit -m "feat: model router — Groq chat with Gemini fallback and embeddings"
```

---

### Task 4: CSV parser with header aliasing

**Files:**
- Create: `src/lib/csv-import.ts`
- Test: `src/lib/csv-import.test.ts`

**Interfaces:**
- Consumes: nothing internal.
- Produces: `parsePostsCsv(csvText: string): { rows: ParsedPostRow[]; skipped: { line: number; reason: string }[] }`, `type ParsedPostRow = { externalId?: string; caption?: string; postedAt: Date; reach?: number; likes?: number; comments?: number; shares?: number; saves?: number }`, `MAX_CSV_BYTES = 5 * 1024 * 1024`.

- [ ] **Step 1: Install the parser dependency**

```bash
npm install papaparse && npm install -D @types/papaparse
```

- [ ] **Step 2: Write the failing tests** — `src/lib/csv-import.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parsePostsCsv } from "./csv-import";

const META_HEADER =
  "Post ID,Description,Publish time,Reach,Likes,Comments,Shares,Saves";

describe("parsePostsCsv", () => {
  it("parses Meta-style export headers into canonical fields", () => {
    const { rows, skipped } = parsePostsCsv(
      `${META_HEADER}\n17890,Summer launch reel,2026-05-01,12000,900,40,25,60\n`,
    );
    expect(skipped).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      externalId: "17890",
      caption: "Summer launch reel",
      reach: 12000,
      likes: 900,
      comments: 40,
      shares: 25,
      saves: 60,
    });
    expect(rows[0].postedAt.getUTCFullYear()).toBe(2026);
  });

  it("handles quoted captions containing commas", () => {
    const { rows } = parsePostsCsv(
      `${META_HEADER}\n1,"Hello, world — big news",2026-05-01,100,10,1,0,2\n`,
    );
    expect(rows[0].caption).toBe("Hello, world — big news");
  });

  it("parses thousands separators in numeric columns", () => {
    const { rows } = parsePostsCsv(
      `${META_HEADER}\n1,post,2026-05-01,"12,345","1,000",5,0,0\n`,
    );
    expect(rows[0].reach).toBe(12345);
    expect(rows[0].likes).toBe(1000);
  });

  it("skips rows with an unparseable date, reporting the CSV line number", () => {
    const { rows, skipped } = parsePostsCsv(
      `${META_HEADER}\n1,good,2026-05-01,100,10,1,0,2\n2,bad,not-a-date,100,10,1,0,2\n`,
    );
    expect(rows).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].line).toBe(3);
  });

  it("treats blank numeric cells as absent, not zero", () => {
    const { rows } = parsePostsCsv(
      `${META_HEADER}\n1,post,2026-05-01,,10,1,0,2\n`,
    );
    expect(rows[0].reach).toBeUndefined();
  });

  it("returns empty results for an empty file", () => {
    expect(parsePostsCsv("")).toEqual({ rows: [], skipped: [] });
  });
});
```

- [ ] **Step 3: Run to verify failure** — `npm test -- src/lib/csv-import.test.ts` → FAIL: cannot resolve `./csv-import`.

- [ ] **Step 4: Implement** — `src/lib/csv-import.ts`:

```ts
import Papa from "papaparse";
import { z } from "zod";

export const MAX_CSV_BYTES = 5 * 1024 * 1024;

/** Column aliases seen across Meta/Instagram insight exports (lowercased). */
const HEADER_ALIASES = {
  externalId: ["post id", "id", "media id", "post_id"],
  caption: ["caption", "description", "message", "post caption", "text"],
  postedAt: [
    "publish time",
    "posted at",
    "publish date",
    "date",
    "created",
    "timestamp",
  ],
  reach: ["reach", "impressions"],
  likes: ["likes", "like count", "reactions"],
  comments: ["comments", "comment count"],
  shares: ["shares", "share count"],
  saves: ["saves", "saved", "save count"],
} as const;

type CanonicalField = keyof typeof HEADER_ALIASES;

const optionalText = z.preprocess(
  (value) =>
    value === undefined || value === null || String(value).trim() === ""
      ? undefined
      : String(value).trim(),
  z.string().optional(),
);

const optionalCount = z.preprocess((value) => {
  if (value === undefined || value === null) return undefined;
  const raw = String(value).replace(/,/g, "").trim();
  if (raw === "") return undefined;
  return Number(raw);
}, z.number().int().nonnegative().optional());

const rowSchema = z.object({
  externalId: optionalText,
  caption: optionalText,
  postedAt: z.preprocess((value) => {
    const date = new Date(String(value ?? ""));
    return Number.isNaN(date.getTime()) ? undefined : date;
  }, z.date()),
  reach: optionalCount,
  likes: optionalCount,
  comments: optionalCount,
  shares: optionalCount,
  saves: optionalCount,
});

export type ParsedPostRow = z.infer<typeof rowSchema>;
export type SkippedRow = { line: number; reason: string };
export type CsvParseResult = { rows: ParsedPostRow[]; skipped: SkippedRow[] };

function canonicalizeHeader(header: string): string {
  const needle = header.trim().toLowerCase();
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if ((aliases as readonly string[]).includes(needle)) {
      return field satisfies CanonicalField;
    }
  }
  return header;
}

export function parsePostsCsv(csvText: string): CsvParseResult {
  if (csvText.trim() === "") return { rows: [], skipped: [] };

  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: canonicalizeHeader,
  });

  const rows: ParsedPostRow[] = [];
  const skipped: SkippedRow[] = [];
  parsed.data.forEach((raw, i) => {
    const line = i + 2; // 1-based, +1 for the header row
    const result = rowSchema.safeParse(raw);
    if (result.success) {
      rows.push(result.data);
    } else {
      const issue = result.error.issues[0];
      skipped.push({
        line,
        reason: `${issue.path.join(".") || "row"}: ${issue.message}`,
      });
    }
  });
  return { rows, skipped };
}
```

- [ ] **Step 5: Run tests** — `npm test -- src/lib/csv-import.test.ts` → PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
npm run lint && npm run typecheck && npm test
git add package.json package-lock.json src/lib/csv-import.ts src/lib/csv-import.test.ts
git commit -m "feat: CSV parser with Meta-export header aliasing and row validation"
```

---

### Task 5: Posts query layer + layer-separation guardrail (CI gate)

**Files:**
- Create: `src/db/queries/posts.ts`
- Test: `src/db/queries/posts.test.ts`
- Modify: `src/db/queries/clients.ts` (add `getClientById`)

**Interfaces:**
- Consumes: `BaselinePoint` from Task 2, tables from Task 1.
- Produces: `baselineQuery(workspaceId, clientId)` (exported for the guardrail test), `getBaselinePoints(workspaceId, clientId): Promise<BaselinePoint[]>`, `listPosts(workspaceId, { clientId?, limit? })`, `getKbStats(workspaceId): Promise<{ total; baselineSize; scored; medianEngagement }>`, `getClientById(workspaceId, clientId)`.

- [ ] **Step 1: Write the failing guardrail tests** — `src/db/queries/posts.test.ts`. These run without a database: Drizzle's `.toSQL()` builds SQL without connecting.

```ts
import { describe, expect, it } from "vitest";
import { baselineQuery } from "./posts";

/**
 * Two-layer rule (constitution, CI gate): a public/Apify row must never
 * surface as performance truth. The baseline engine's query is asserted at
 * the SQL level — Phase 2 adds the live-DB version of this proof.
 */
describe("layer separation guardrail", () => {
  const { sql, params } = baselineQuery("ws_1", "client_1").toSQL();

  it("hard-filters the baseline to the first-party layer", () => {
    expect(sql).toContain('"source" =');
    expect(params).toContain("first_party");
    expect(params).not.toContain("public");
  });

  it("is workspace-scoped (isolation rule)", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });

  it("is client-scoped — one account's baseline, not the workspace's", () => {
    expect(sql).toContain('"client_id" =');
    expect(params).toContain("client_1");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -- src/db/queries/posts.test.ts` → FAIL: cannot resolve `./posts`.

- [ ] **Step 3: Implement** — `src/db/queries/posts.ts`:

```ts
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { posts } from "@/db/schema";
import type { BaselinePoint } from "@/lib/scoring";

/**
 * Two-layer rule: the baseline/scoring engine reads first-party rows ONLY.
 * Public pattern rows (source='public', Phase 2) must never pass this filter.
 * Guardrail test: src/db/queries/posts.test.ts (CI-gated).
 */
export function baselineQuery(workspaceId: string, clientId: string) {
  return db
    .select({ engagementRate: posts.engagementRate, postedAt: posts.postedAt })
    .from(posts)
    .where(
      and(
        eq(posts.workspaceId, workspaceId),
        eq(posts.clientId, clientId),
        eq(posts.source, "first_party"),
      ),
    );
}

export async function getBaselinePoints(
  workspaceId: string,
  clientId: string,
): Promise<BaselinePoint[]> {
  const rows = await baselineQuery(workspaceId, clientId);
  return rows
    .filter(
      (row): row is { engagementRate: number; postedAt: Date } =>
        row.engagementRate !== null,
    )
    .map((row) => ({ value: row.engagementRate, postedAt: row.postedAt }));
}

export async function listPosts(
  workspaceId: string,
  opts: { clientId?: string; limit?: number } = {},
) {
  return db
    .select()
    .from(posts)
    .where(
      and(
        eq(posts.workspaceId, workspaceId),
        opts.clientId ? eq(posts.clientId, opts.clientId) : undefined,
      ),
    )
    .orderBy(desc(posts.postedAt))
    .limit(opts.limit ?? 100);
}

export async function getKbStats(workspaceId: string) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      baselineSize: sql<number>`count(*) filter (where ${posts.source} = 'first_party' and ${posts.engagementRate} is not null)::int`,
      scored: sql<number>`count(*) filter (where ${posts.scoreStatus} = 'scored')::int`,
      medianEngagement: sql<
        number | null
      >`percentile_cont(0.5) within group (order by ${posts.engagementRate})`,
    })
    .from(posts)
    .where(eq(posts.workspaceId, workspaceId));
  return row;
}
```

Append to `src/db/queries/clients.ts`:

```ts
export async function getClientById(workspaceId: string, clientId: string) {
  const rows = await db
    .select()
    .from(clients)
    .where(and(eq(clients.workspaceId, workspaceId), eq(clients.id, clientId)))
    .limit(1);
  return rows[0] ?? null;
}
```

(and extend its drizzle-orm import to include `and`).

- [ ] **Step 4: Run tests** — `npm test -- src/db/queries/posts.test.ts` → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/db/queries
git commit -m "feat: posts query layer with CI-gated first-party baseline guardrail"
```

---

### Task 6: Groq normalization + pure import planner

**Files:**
- Create: `src/lib/normalize.ts`, `src/lib/import-pipeline.ts`
- Test: `src/lib/normalize.test.ts`, `src/lib/import-pipeline.test.ts`

**Interfaces:**
- Consumes: `routeAI` (Task 3), `ParsedPostRow` (Task 4), scoring (Task 2), `posts` insert type (Task 1).
- Produces: `normalizeCaptions(captions: (string | undefined)[]): Promise<(NormalizedMeta | null)[]>` with `type NormalizedMeta = { format: string | null; topics: string[] }`; `buildImportPlan({ workspaceId, clientId, importJobId, rows, meta, existingBaseline, now? }): PlannedPost[]` with `type PlannedPost = typeof posts.$inferInsert`.

- [ ] **Step 1: Write the failing normalization tests** — `src/lib/normalize.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeCaptions } from "./normalize";
import { routeAI } from "@/lib/ai/router";

vi.mock("@/lib/ai/router", () => ({ routeAI: vi.fn() }));
const routeAIMock = vi.mocked(routeAI);

beforeEach(() => {
  routeAIMock.mockReset();
});

describe("normalizeCaptions", () => {
  it("maps classified formats and topics back to caption positions", async () => {
    routeAIMock.mockResolvedValue(
      JSON.stringify({
        posts: [{ index: 1, format: "reel", topics: ["launch", "summer"] }],
      }),
    );
    const result = await normalizeCaptions([undefined, "Summer launch reel"]);
    expect(result[0]).toBeNull();
    expect(result[1]).toEqual({ format: "reel", topics: ["launch", "summer"] });
  });

  it("degrades to nulls when the model call fails — import must not block", async () => {
    routeAIMock.mockRejectedValue(new Error("provider down"));
    await expect(normalizeCaptions(["a", "b"])).resolves.toEqual([null, null]);
  });

  it("degrades to nulls when the model returns malformed JSON", async () => {
    routeAIMock.mockResolvedValue("not json at all");
    await expect(normalizeCaptions(["a"])).resolves.toEqual([null]);
  });

  it("skips the model entirely when no captions are present", async () => {
    await expect(normalizeCaptions([undefined, ""])).resolves.toEqual([
      null,
      null,
    ]);
    expect(routeAIMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -- src/lib/normalize.test.ts` → FAIL: cannot resolve `./normalize`.

- [ ] **Step 3: Implement** — `src/lib/normalize.ts`:

```ts
import { z } from "zod";
import { routeAI } from "@/lib/ai/router";

export const POST_FORMATS = [
  "reel",
  "carousel",
  "image",
  "video",
  "story",
  "text",
] as const;

export type NormalizedMeta = { format: string | null; topics: string[] };

const responseSchema = z.object({
  posts: z.array(
    z.object({
      index: z.number().int(),
      format: z.enum(POST_FORMATS).nullable(),
      topics: z.array(z.string()).max(5).default([]),
    }),
  ),
});

const SYSTEM_PROMPT = [
  "You classify social media captions.",
  'Reply with JSON only, shaped {"posts":[{"index":number,"format":"reel"|"carousel"|"image"|"video"|"story"|"text"|null,"topics":string[]}]}.',
  "topics are 1-3 word themes, at most 5 per post. Keep every input index.",
].join(" ");

/**
 * Classify captions into format + topics via the router (Groq fast tier).
 * Normalization is an enhancement, not a gate: any failure returns nulls and
 * the import proceeds unnormalized (degradation ladder).
 */
export async function normalizeCaptions(
  captions: (string | undefined)[],
): Promise<(NormalizedMeta | null)[]> {
  const indexed = captions
    .map((caption, index) => ({ index, caption: caption?.trim() ?? "" }))
    .filter((entry) => entry.caption !== "");
  if (indexed.length === 0) return captions.map(() => null);

  try {
    const raw = await routeAI({
      kind: "chat",
      json: true,
      system: SYSTEM_PROMPT,
      prompt: JSON.stringify({ posts: indexed }),
    });
    const parsed = responseSchema.parse(JSON.parse(raw));
    const byIndex = new Map(parsed.posts.map((post) => [post.index, post]));
    return captions.map((_, i) => {
      const hit = byIndex.get(i);
      return hit ? { format: hit.format, topics: hit.topics } : null;
    });
  } catch {
    return captions.map(() => null);
  }
}
```

- [ ] **Step 4: Run** — `npm test -- src/lib/normalize.test.ts` → PASS (4 tests).

- [ ] **Step 5: Write the failing planner tests** — `src/lib/import-pipeline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildImportPlan } from "./import-pipeline";
import { MIN_BASELINE_N, type BaselinePoint } from "./scoring";
import type { ParsedPostRow } from "./csv-import";

const NOW = new Date("2026-07-04T00:00:00Z");
const IDS = { workspaceId: "ws_1", clientId: "client_1", importJobId: "job_1" };

function row(overrides: Partial<ParsedPostRow> = {}): ParsedPostRow {
  return {
    caption: "a post",
    postedAt: new Date("2026-06-01T00:00:00Z"),
    reach: 1000,
    likes: 100,
    ...overrides,
  };
}

function plan(rows: ParsedPostRow[], existingBaseline: BaselinePoint[] = []) {
  return buildImportPlan({
    ...IDS,
    rows,
    meta: rows.map(() => null),
    existingBaseline,
    now: NOW,
  });
}

describe("buildImportPlan", () => {
  it("stamps workspace, client, job, and first_party source on every row", () => {
    const [planned] = plan([row()]);
    expect(planned).toMatchObject({
      workspaceId: "ws_1",
      clientId: "client_1",
      importJobId: "job_1",
      source: "first_party",
      engagementRate: 0.1,
    });
  });

  it("min-N gate: below threshold every row is insufficient_baseline, never scored", () => {
    const planned = plan(Array.from({ length: MIN_BASELINE_N - 1 }, () => row()));
    for (const p of planned) {
      expect(p.scoreStatus).toBe("insufficient_baseline");
      expect(p.zScore).toBeNull();
      expect(p.direction).toBeNull();
    }
  });

  it("scores rows once incoming + existing baseline clears the gate", () => {
    const planned = plan(
      Array.from({ length: MIN_BASELINE_N }, (_, i) =>
        row({ likes: 50 + i * 10 }),
      ),
    );
    expect(planned.every((p) => p.scoreStatus === "scored")).toBe(true);
  });

  it("rows without positive reach are unscored — no metric, no fake score", () => {
    const planned = plan([
      row({ reach: undefined }),
      ...Array.from({ length: MIN_BASELINE_N }, () => row()),
    ]);
    expect(planned[0].scoreStatus).toBe("unscored");
    expect(planned[0].engagementRate).toBeNull();
  });

  it("attaches normalization meta by row position", () => {
    const rows = [row(), row()];
    const planned = buildImportPlan({
      ...IDS,
      rows,
      meta: [null, { format: "reel", topics: ["launch"] }],
      existingBaseline: [],
      now: NOW,
    });
    expect(planned[0].format).toBeNull();
    expect(planned[1].format).toBe("reel");
    expect(planned[1].topics).toEqual(["launch"]);
  });
});
```

- [ ] **Step 6: Run to verify failure** — `npm test -- src/lib/import-pipeline.test.ts` → FAIL: cannot resolve `./import-pipeline`.

- [ ] **Step 7: Implement** — `src/lib/import-pipeline.ts`:

```ts
import type { posts } from "@/db/schema";
import type { ParsedPostRow } from "@/lib/csv-import";
import type { NormalizedMeta } from "@/lib/normalize";
import {
  computeEngagementRate,
  scoreAgainstBaseline,
  type BaselinePoint,
} from "@/lib/scoring";

export type PlannedPost = typeof posts.$inferInsert;

/**
 * Pure planner: turns parsed CSV rows into insert-ready post rows with
 * scores. Baseline = the account's existing first-party points + this
 * import's computable rows (self-inclusion is negligible at min-N sizes).
 */
export function buildImportPlan(input: {
  workspaceId: string;
  clientId: string;
  importJobId: string;
  rows: ParsedPostRow[];
  meta: (NormalizedMeta | null)[];
  existingBaseline: BaselinePoint[];
  now?: Date;
}): PlannedPost[] {
  const now = input.now ?? new Date();
  const incoming = input.rows.map((row) => ({
    row,
    engagementRate: computeEngagementRate(row),
  }));

  const baseline: BaselinePoint[] = [
    ...input.existingBaseline,
    ...incoming
      .filter((entry) => entry.engagementRate !== null)
      .map((entry) => ({
        value: entry.engagementRate as number,
        postedAt: entry.row.postedAt,
      })),
  ];

  return incoming.map(({ row, engagementRate }, i) => {
    const score =
      engagementRate === null
        ? null
        : scoreAgainstBaseline(engagementRate, baseline, now);
    const scored = score?.status === "scored" ? score : null;
    return {
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      importJobId: input.importJobId,
      source: "first_party" as const,
      externalId: row.externalId ?? null,
      caption: row.caption ?? null,
      format: input.meta[i]?.format ?? null,
      topics: input.meta[i]?.topics ?? null,
      postedAt: row.postedAt,
      reach: row.reach ?? null,
      likes: row.likes ?? null,
      comments: row.comments ?? null,
      shares: row.shares ?? null,
      saves: row.saves ?? null,
      engagementRate,
      zScore: scored?.zScore ?? null,
      magnitude: scored?.magnitude ?? null,
      direction: scored?.direction ?? null,
      scoreStatus: score === null ? ("unscored" as const) : score.status,
    };
  });
}
```

- [ ] **Step 8: Run tests, gate, commit**

```bash
npm test -- src/lib/import-pipeline.test.ts   # PASS (5 tests)
npm run lint && npm run typecheck && npm test
git add src/lib/normalize.ts src/lib/normalize.test.ts src/lib/import-pipeline.ts src/lib/import-pipeline.test.ts
git commit -m "feat: Groq caption normalization and pure import planner with min-N gate"
```

---

### Task 7: Intake wizard — workspace routes, client creation, CSV upload action

**Files:**
- Create: `src/app/(app)/w/[ws]/layout.tsx`
- Create: `src/app/(app)/w/[ws]/clients/page.tsx`
- Create: `src/app/(app)/w/[ws]/clients/new/page.tsx`, `.../new/client-form.tsx`, `.../new/actions.ts`
- Create: `src/app/(app)/w/[ws]/clients/[clientId]/import/page.tsx`, `.../import/upload-form.tsx`, `.../import/actions.ts`
- Create: `src/lib/embed-posts.ts`
- Modify: `src/lib/validation.ts`, `src/lib/validation.test.ts`

**Interfaces:**
- Consumes: `requireUser` (`@/auth`), `requireMembership`, `listClients`/`getClientById`, `parsePostsCsv`/`MAX_CSV_BYTES`, `normalizeCaptions`, `getBaselinePoints`, `buildImportPlan`, `routeAI`, tables `importJobs`/`posts`/`postEmbeddings`, `actionErrorMessage`.
- Produces: routes `/w/[ws]/clients`, `/w/[ws]/clients/new`, `/w/[ws]/clients/[clientId]/import`; actions `createClient`, `importCsv`; `embedPosts(workspaceId, rows): Promise<number>`; `clientIntakeSchema`.

- [ ] **Step 1: Write the failing validation test** — append to `src/lib/validation.test.ts`:

```ts
import { clientIntakeSchema } from "./validation";

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
```

(Match the file's existing import style — extend the existing `./validation` import instead of duplicating it.)

- [ ] **Step 2: Run to verify failure** — `npm test -- src/lib/validation.test.ts` → FAIL: `clientIntakeSchema` not exported.

- [ ] **Step 3: Add the schema** — append to `src/lib/validation.ts`:

```ts
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
```

Run `npm test -- src/lib/validation.test.ts` → PASS.

- [ ] **Step 4: Workspace guard layout** — `src/app/(app)/w/[ws]/layout.tsx`:

```tsx
import { notFound } from "next/navigation";
import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { ws: string };
}) {
  const user = await requireUser();
  try {
    await requireMembership(params.ws, user.id);
  } catch {
    notFound();
  }
  return <>{children}</>;
}
```

- [ ] **Step 5: Client creation action** — `src/app/(app)/w/[ws]/clients/new/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireMembership } from "@/db/queries/memberships";
import { actionErrorMessage } from "@/lib/action-errors";
import { clientIntakeSchema } from "@/lib/validation";

export type CreateClientState = { error?: string } | undefined;

export async function createClient(
  _prev: CreateClientState,
  formData: FormData,
): Promise<CreateClientState> {
  const parsed = clientIntakeSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    name: formData.get("name"),
    handle: formData.get("handle") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  let clientId: string;
  try {
    const user = await requireUser();
    await requireMembership(parsed.data.workspaceId, user.id);
    const [client] = await db
      .insert(clients)
      .values({
        workspaceId: parsed.data.workspaceId,
        name: parsed.data.name,
        handle: parsed.data.handle ?? null,
      })
      .returning({ id: clients.id });
    clientId = client.id;
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  redirect(`/w/${parsed.data.workspaceId}/clients/${clientId}/import`);
}
```

- [ ] **Step 6: Client form + pages.** `src/app/(app)/w/[ws]/clients/new/client-form.tsx`:

```tsx
"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient, type CreateClientState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Creating…" : "Create client & continue"}
    </Button>
  );
}

export function ClientForm({ workspaceId }: { workspaceId: string }) {
  const [state, formAction] = useFormState<CreateClientState, FormData>(
    createClient,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <div className="space-y-1.5">
        <Label htmlFor="name">Client name</Label>
        <Input id="name" name="name" placeholder="Acme Coffee" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="handle">Instagram handle (optional)</Label>
        <Input id="handle" name="handle" placeholder="@acmecoffee" />
      </div>
      {state?.error ? (
        <p className="text-sm text-red-400">{state.error}</p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
```

`src/app/(app)/w/[ws]/clients/new/page.tsx`:

```tsx
import { GlassCard } from "@/components/glass-card";
import { ClientForm } from "./client-form";

export const metadata = { title: "New client" };

export default function NewClientPage({ params }: { params: { ws: string } }) {
  return (
    <div className="mx-auto max-w-lg">
      <p className="label-mono text-brand-teal">Client intake · Step 1 of 2</p>
      <h1 className="mt-2 font-display text-3xl">Who are we onboarding?</h1>
      <p className="mt-2 text-sm text-white/50">
        Create the client, then import their post history so the baseline
        engine has something to learn from.
      </p>
      <GlassCard className="mt-8 p-6">
        <ClientForm workspaceId={params.ws} />
      </GlassCard>
    </div>
  );
}
```

`src/app/(app)/w/[ws]/clients/page.tsx`:

```tsx
import Link from "next/link";
import { Plus } from "lucide-react";
import { listClients } from "@/db/queries/clients";
import { GlassCard } from "@/components/glass-card";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

export default async function ClientsPage({
  params,
}: {
  params: { ws: string };
}) {
  const rows = await listClients(params.ws);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <p className="label-mono text-brand-teal">Clients</p>
          <h1 className="mt-2 font-display text-4xl">Client accounts</h1>
        </div>
        <Button asChild>
          <Link href={`/w/${params.ws}/clients/new`}>
            <Plus className="mr-2 h-4 w-4" aria-hidden /> Add client
          </Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <GlassCard className="mt-8 p-8 text-center">
          <p className="font-display text-xl">No clients yet</p>
          <p className="mt-2 text-sm text-white/50">
            Add your first client and import their post history to seed the
            knowledge base.
          </p>
        </GlassCard>
      ) : (
        <div className="mt-8 space-y-3">
          {rows.map((client) => (
            <GlassCard
              key={client.id}
              className="flex items-center justify-between p-5"
            >
              <div>
                <p className="font-display text-xl">{client.name}</p>
                {client.handle ? (
                  <p className="mt-1 font-mono text-xs text-white/45">
                    {client.handle}
                  </p>
                ) : null}
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={`/w/${params.ws}/clients/${client.id}/import`}>
                  Import CSV
                </Link>
              </Button>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}
```

(If `@/components/ui/input` or `label` are missing from the installed shadcn set, add them with the same v2.3.0 CLI workaround used in W1: `npx shadcn@2.3.0 add input label`.)

- [ ] **Step 7: Embedding helper** — `src/lib/embed-posts.ts`:

```ts
import { db } from "@/db";
import { postEmbeddings } from "@/db/schema";
import { routeAI } from "@/lib/ai/router";

const EMBED_BATCH_SIZE = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Embed captions via the router (Gemini) and store them. Embeddings are an
 * enhancement — on failure the KB rows stand without them (degradation
 * ladder), so this returns the embedded count instead of throwing.
 */
export async function embedPosts(
  workspaceId: string,
  rows: { id: string; caption: string | null }[],
): Promise<number> {
  const withCaptions = rows.filter((row) => row.caption?.trim());
  if (withCaptions.length === 0) return 0;

  let embedded = 0;
  try {
    for (const batch of chunk(withCaptions, EMBED_BATCH_SIZE)) {
      const vectors = await routeAI({
        kind: "embed",
        texts: batch.map((row) => row.caption as string),
      });
      await db.insert(postEmbeddings).values(
        batch.map((row, i) => ({
          workspaceId,
          postId: row.id,
          source: "first_party" as const,
          embedding: vectors[i],
        })),
      );
      embedded += batch.length;
    }
  } catch {
    // Partial embeddings are fine; retry/backfill arrives with Inngest in Phase 4.
  }
  return embedded;
}
```

- [ ] **Step 8: Import action** — `src/app/(app)/w/[ws]/clients/[clientId]/import/actions.ts`:

```ts
"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { db } from "@/db";
import { importJobs, posts } from "@/db/schema";
import { getClientById } from "@/db/queries/clients";
import { requireMembership } from "@/db/queries/memberships";
import { getBaselinePoints } from "@/db/queries/posts";
import { actionErrorMessage } from "@/lib/action-errors";
import { MAX_CSV_BYTES, parsePostsCsv } from "@/lib/csv-import";
import { embedPosts } from "@/lib/embed-posts";
import { buildImportPlan } from "@/lib/import-pipeline";
import { normalizeCaptions } from "@/lib/normalize";

export type ImportCsvState =
  | { error?: string; skipped?: { line: number; reason: string }[] }
  | undefined;

export async function importCsv(
  _prev: ImportCsvState,
  formData: FormData,
): Promise<ImportCsvState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const clientId = String(formData.get("clientId") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV file to import." };
  }
  if (file.size > MAX_CSV_BYTES) {
    return { error: "That CSV is larger than 5 MB — split it and retry." };
  }

  let jobId: string | undefined;
  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    const client = await getClientById(workspaceId, clientId);
    if (!client) return { error: "Client not found in this workspace." };

    const { rows, skipped } = parsePostsCsv(await file.text());
    if (rows.length === 0) {
      return { error: "No importable rows found in that CSV.", skipped };
    }

    const [job] = await db
      .insert(importJobs)
      .values({
        workspaceId,
        clientId,
        filename: file.name,
        rowCount: rows.length,
        skippedCount: skipped.length,
      })
      .returning({ id: importJobs.id });
    jobId = job.id;

    const meta = await normalizeCaptions(rows.map((row) => row.caption));
    const existingBaseline = await getBaselinePoints(workspaceId, clientId);
    const planned = buildImportPlan({
      workspaceId,
      clientId,
      importJobId: job.id,
      rows,
      meta,
      existingBaseline,
    });

    const inserted = await db
      .insert(posts)
      .values(planned)
      .returning({ id: posts.id, caption: posts.caption });

    await embedPosts(workspaceId, inserted);
    await db
      .update(importJobs)
      .set({ status: "complete" })
      .where(eq(importJobs.id, job.id));
  } catch (error) {
    if (jobId) {
      await db
        .update(importJobs)
        .set({ status: "failed", error: actionErrorMessage(error) })
        .where(eq(importJobs.id, jobId))
        .catch(() => {});
    }
    return { error: actionErrorMessage(error) };
  }

  redirect(`/w/${workspaceId}/kb`);
}
```

- [ ] **Step 9: Upload form + page.** `src/app/(app)/w/[ws]/clients/[clientId]/import/upload-form.tsx`:

```tsx
"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { importCsv, type ImportCsvState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Importing — scoring against baseline…" : "Import & score"}
    </Button>
  );
}

export function UploadForm({
  workspaceId,
  clientId,
}: {
  workspaceId: string;
  clientId: string;
}) {
  const [state, formAction] = useFormState<ImportCsvState, FormData>(
    importCsv,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="clientId" value={clientId} />
      <div className="space-y-1.5">
        <Label htmlFor="file">Post history CSV</Label>
        <Input id="file" name="file" type="file" accept=".csv,text/csv" required />
        <p className="text-xs text-white/40">
          Meta/Instagram insights export. Needs a publish date; reach + likes
          + comments + shares + saves unlock scoring. Max 5 MB.
        </p>
      </div>
      {state?.error ? (
        <p className="text-sm text-red-400">{state.error}</p>
      ) : null}
      {state?.skipped?.length ? (
        <p className="text-xs text-brand-amber">
          {state.skipped.length} rows were skipped (first issue: line{" "}
          {state.skipped[0].line} — {state.skipped[0].reason}).
        </p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
```

`src/app/(app)/w/[ws]/clients/[clientId]/import/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getClientById } from "@/db/queries/clients";
import { GlassCard } from "@/components/glass-card";
import { UploadForm } from "./upload-form";

export const metadata = { title: "Import posts" };
export const dynamic = "force-dynamic";

export default async function ImportPage({
  params,
}: {
  params: { ws: string; clientId: string };
}) {
  const client = await getClientById(params.ws, params.clientId);
  if (!client) notFound();

  return (
    <div className="mx-auto max-w-lg">
      <p className="label-mono text-brand-teal">Client intake · Step 2 of 2</p>
      <h1 className="mt-2 font-display text-3xl">
        Import {client.name}&apos;s post history
      </h1>
      <p className="mt-2 text-sm text-white/50">
        Rows are normalized, scored against this account&apos;s own baseline,
        and embedded into the knowledge base. First-party layer only.
      </p>
      <GlassCard className="mt-8 p-6">
        <UploadForm workspaceId={params.ws} clientId={params.clientId} />
      </GlassCard>
    </div>
  );
}
```

- [ ] **Step 10: Gate + commit**

```bash
npm run lint && npm run typecheck && npm test && npm run build
git add "src/app/(app)/w" src/lib/embed-posts.ts src/lib/validation.ts src/lib/validation.test.ts
git commit -m "feat: client intake wizard — creation, CSV upload, import action"
```

---

### Task 8: Knowledge Base screen

**Files:**
- Create: `src/app/(app)/w/[ws]/kb/page.tsx`, `src/components/score-chip.tsx`

**Interfaces:**
- Consumes: `getKbStats`, `listPosts` (Task 5), `MIN_BASELINE_N` (Task 2), `GlassCard`, `Badge`.
- Produces: route `/w/[ws]/kb`; `<ScoreChip status direction magnitude />`.

- [ ] **Step 1: Score chip** — `src/components/score-chip.tsx`:

```tsx
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function ScoreChip({
  status,
  direction,
  magnitude,
}: {
  status: "scored" | "insufficient_baseline" | "unscored";
  direction: "up" | "down" | "flat" | null;
  magnitude: number | null;
}) {
  if (status === "insufficient_baseline") {
    return (
      <Badge
        variant="outline"
        className="border-brand-amber/40 text-brand-amber"
      >
        Insufficient baseline
      </Badge>
    );
  }
  if (status === "unscored" || direction === null) {
    return (
      <Badge variant="outline" className="border-white/15 text-white/40">
        No metric
      </Badge>
    );
  }

  const Icon =
    direction === "up"
      ? ArrowUpRight
      : direction === "down"
        ? ArrowDownRight
        : ArrowRight;
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 font-mono",
        direction === "up" && "border-brand-teal/40 text-brand-teal",
        direction === "down" && "border-brand-amber/40 text-brand-amber",
        direction === "flat" && "border-white/15 text-white/50",
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {Math.round((magnitude ?? 0) * 100)}
    </Badge>
  );
}
```

- [ ] **Step 2: KB page** — `src/app/(app)/w/[ws]/kb/page.tsx`:

```tsx
import Link from "next/link";
import { getKbStats, listPosts } from "@/db/queries/posts";
import { MIN_BASELINE_N } from "@/lib/scoring";
import { GlassCard } from "@/components/glass-card";
import { ScoreChip } from "@/components/score-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Knowledge Base" };
export const dynamic = "force-dynamic";

function formatPercent(value: number | null) {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

export default async function KnowledgeBasePage({
  params,
}: {
  params: { ws: string };
}) {
  const [stats, rows] = await Promise.all([
    getKbStats(params.ws),
    listPosts(params.ws, { limit: 50 }),
  ]);

  const statCards = [
    { label: "Posts ingested", value: String(stats.total) },
    {
      label: "First-party baseline",
      value: `${stats.baselineSize} / ${MIN_BASELINE_N}`,
    },
    { label: "Scored rows", value: String(stats.scored) },
    { label: "Median engagement", value: formatPercent(stats.medianEngagement) },
  ];

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <p className="label-mono text-brand-teal">Knowledge Base</p>
          <h1 className="mt-2 font-display text-4xl">
            What this account has learned
          </h1>
        </div>
        <Button asChild variant="outline">
          <Link href={`/w/${params.ws}/clients`}>Import more posts</Link>
        </Button>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {statCards.map((card) => (
          <GlassCard key={card.label} className="p-5">
            <p className="label-mono text-white/40">{card.label}</p>
            <p className="mt-2 font-display text-3xl">{card.value}</p>
          </GlassCard>
        ))}
      </div>

      <GlassCard className="mt-6 p-6">
        <p className="label-mono text-brand-purple">Two layers, never mixed</p>
        <p className="mt-2 text-sm text-white/60">
          <span className="text-white/90">First-party layer</span> — this
          account&apos;s own consented history. It is the only data the
          baseline and every score below draw from.{" "}
          <span className="text-white/90">Public pattern layer</span> — market
          patterns from public pages (arriving with connectors). Kept in a
          separate namespace, weighted neutral, and never cited as performance
          truth.
        </p>
      </GlassCard>

      <GlassCard className="mt-6 overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-white/40">
              <th className="p-4 font-normal">Post</th>
              <th className="p-4 font-normal">Posted</th>
              <th className="p-4 font-normal">Reach</th>
              <th className="p-4 font-normal">Engagement</th>
              <th className="p-4 font-normal">Layer</th>
              <th className="p-4 font-normal">Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-white/40">
                  Nothing ingested yet — import a client CSV to seed the
                  knowledge base.
                </td>
              </tr>
            ) : (
              rows.map((post) => (
                <tr key={post.id} className="border-b border-white/5">
                  <td className="max-w-xs truncate p-4 text-white/80">
                    {post.caption ?? (
                      <span className="text-white/30">No caption</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap p-4 text-white/50">
                    {post.postedAt.toISOString().slice(0, 10)}
                  </td>
                  <td className="p-4 font-mono text-white/60">
                    {post.reach ?? "—"}
                  </td>
                  <td className="p-4 font-mono text-white/60">
                    {formatPercent(post.engagementRate)}
                  </td>
                  <td className="p-4">
                    <Badge
                      variant="outline"
                      className="border-white/15 text-white/50"
                    >
                      {post.source === "first_party" ? "First-party" : "Public"}
                    </Badge>
                  </td>
                  <td className="p-4">
                    <ScoreChip
                      status={post.scoreStatus}
                      direction={post.direction}
                      magnitude={post.magnitude}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </GlassCard>
    </div>
  );
}
```

- [ ] **Step 3: Gate + commit**

```bash
npm run lint && npm run typecheck && npm test && npm run build
git add "src/app/(app)/w/[ws]/kb" src/components/score-chip.tsx
git commit -m "feat: Knowledge Base screen — stat cards, layer explainer, scored rows"
```

---

### Task 9: Navigation wiring, fixture CSV, end-to-end verification

**Files:**
- Create: `src/components/workspace-nav.tsx`, `fixtures/sample-posts.csv`
- Modify: `src/components/app-sidebar.tsx`, `src/app/(app)/hub/page.tsx`

**Interfaces:**
- Consumes: existing sidebar layout; `usePathname` from `next/navigation`.
- Produces: sidebar "Workspace" section with Knowledge Base + Clients links; hub workspace cards navigate to `/w/[id]/kb`.

- [ ] **Step 1: Workspace nav** — `src/components/workspace-nav.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpenText, Users } from "lucide-react";
import { cn } from "@/lib/utils";

/** Renders workspace links only when inside /w/[ws]/… routes. */
export function WorkspaceNav() {
  const pathname = usePathname();
  const match = pathname.match(/^\/w\/([^/]+)/);
  if (!match) return null;

  const base = `/w/${match[1]}`;
  const items = [
    { label: "Knowledge Base", href: `${base}/kb`, icon: BookOpenText },
    { label: "Clients", href: `${base}/clients`, icon: Users },
  ];

  return (
    <>
      <p className="label-mono px-3 pb-2 pt-4 text-white/30">Workspace</p>
      {items.map(({ label, href, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition hover:bg-white/10 hover:text-white",
            pathname.startsWith(href) ? "bg-white/10 text-white" : "text-white/75",
          )}
        >
          <Icon className="h-4 w-4 text-brand-teal" aria-hidden />
          {label}
        </Link>
      ))}
    </>
  );
}
```

- [ ] **Step 2: Mount it in the sidebar.** In `src/components/app-sidebar.tsx`, import it (`import { WorkspaceNav } from "@/components/workspace-nav";`) and render `<WorkspaceNav />` immediately after the `activeItems.map(...)` block, before the `<Separator />`.

- [ ] **Step 3: Point hub cards at the workspace.** Run `grep -n "workspace/ready" "src/app/(app)/hub/page.tsx"` and change the workspace-card link target from `/workspace/ready?ws=${workspace.id}` to:

```tsx
`/w/${workspace.id}/kb`
```

(Leave the org-claim/join CTA links untouched. Also update the "enter workspace" CTA in `src/app/(app)/workspace/ready/page.tsx` to `/w/${ws}/kb` if it links to `/hub` — check with `grep -n "href" "src/app/(app)/workspace/ready/page.tsx"`.)

- [ ] **Step 4: Fixture CSV** — `fixtures/sample-posts.csv` (24 rows clears `MIN_BASELINE_N = 20`; one bad-date row and one blank-reach row exercise skip + unscored paths):

```csv
Post ID,Description,Publish time,Reach,Likes,Comments,Shares,Saves
p001,"Behind the scenes at the roastery",2026-01-05,8200,610,22,14,40
p002,"New single-origin drop — Ethiopia",2026-01-12,15400,1420,65,48,120
p003,"Meet the team: our head barista",2026-01-19,7800,540,31,9,22
p004,"Latte art tutorial, part 1",2026-01-26,20100,1980,88,102,240
p005,"Weekend market pop-up recap",2026-02-02,6900,410,18,7,15
p006,"Cold brew myths, busted",2026-02-09,13200,1105,54,36,95
p007,"Customer spotlight: Maya's order",2026-02-16,7100,488,26,11,19
p008,"Latte art tutorial, part 2",2026-02-23,18700,1750,79,88,205
p009,"Sourcing trip diary — day one",2026-03-02,9400,702,35,17,44
p010,"Sourcing trip diary — day two",2026-03-05,9900,745,38,21,52
p011,"How we cup new lots",2026-03-09,8600,590,29,13,31
p012,"Spring menu teaser",2026-03-16,16800,1602,71,64,150
p013,"Ask the roaster: grind size",2026-03-23,7500,512,41,10,26
p014,"Compost program update",2026-03-30,6200,355,15,6,12
p015,"Spring menu launch day",2026-04-06,22400,2210,96,118,280
p016,"Barista championship results",2026-04-13,11900,940,49,33,77
p017,"Recipe card: oat flat white",2026-04-20,14100,1230,58,41,110
p018,"Shop dog of the month",2026-04-27,9800,820,44,19,38
p019,"Why we changed our cups",2026-05-04,8100,566,27,12,24
p020,"Iced season is here",2026-05-11,17300,1640,74,69,165
p021,"Founder Q&A — your questions",2026-05-18,10600,845,52,23,49
p022,"One year in our new space",2026-05-25,12800,1088,57,39,88
p023,"This row has a bad date",not-a-date,5000,300,10,5,8
p024,"This row is missing reach",2026-06-01,,412,20,9,16
```

- [ ] **Step 5: Full gate**

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

Expected: all pass; test count ≥ 44 (18 existing + ~26 new).

- [ ] **Step 6: Manual verification (requires `DATABASE_URL` + `npm run db:migrate`; needs the W1 env close-out).** With `npm run dev`:
  1. Log in → hub → open a workspace → lands on `/w/[id]/kb` with the empty state.
  2. Clients → Add client → name "Fixture Coffee" → lands on the import step.
  3. Upload `fixtures/sample-posts.csv` → redirected to KB.
  4. Verify: 23 rows ingested (1 skipped for the bad date), the blank-reach row shows "No metric", the rest show direction chips, stat cards populated, baseline card reads `22 / 20`.
  5. Re-import the same file → rows double (dedup is a known non-goal this slice; note it in the review).
  6. Without `GROQ_API_KEY`/`GEMINI_API_KEY` set, the import still lands (formats null, no embeddings) — degradation ladder proof.

- [ ] **Step 7: Commit + push for review**

```bash
git add src/components/workspace-nav.tsx src/components/app-sidebar.tsx "src/app/(app)/hub/page.tsx" "src/app/(app)/workspace/ready/page.tsx" fixtures
git commit -m "feat: workspace nav, hub deep-links, fixture CSV — Phase 1 complete"
git push origin main
```

(If review prefers a PR branch: `git checkout -b phase-1-ingestion` before the first task instead, and push that branch.)

---

## Known non-goals this slice (deliberate, per YAGNI)

- No import dedup/upsert on `externalId` (re-importing duplicates rows) — flagged for review; trivial to add as an upsert later.
- No Inngest background jobs — imports run synchronously in the action (fine at CSV scale; Inngest lands in Phase 4 per plan).
- No pgvector similarity queries yet — embeddings are stored, retrieval arrives in Phase 3.
- No RTL/component tests — UI is covered by typecheck + build + manual checklist; logic is fully unit-tested.

## Self-review notes

- Spec coverage: importer ✅, Groq normalization ✅, z-score + freshness + min-N ✅, Gemini embeddings in pgvector with workspace/source metadata ✅, intake wizard ✅, KB screen with stat cards + layer explainer ✅, W3's source column + separation guardrail pulled forward ✅.
- Type consistency: `BaselinePoint`/`PostScore` (Task 2) are the exact types consumed in Tasks 5–6; `ParsedPostRow` (Task 4) feeds `buildImportPlan` (Task 6); `PlannedPost = typeof posts.$inferInsert` matches the Task 1 schema; `ScoreChip` props match the `posts` row enums.
