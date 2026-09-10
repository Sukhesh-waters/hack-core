# Workspace Assets (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every workspace a private, quota-limited place to upload and retrieve files (CSVs, briefs, guideline PDFs, images), so InstaMedia stops being a tool an agency cannot hand a file to.

**Architecture:** One new `assets` table plus a private Supabase Storage bucket. Uploads go through a server action that checks membership, capability, mime, per-file size, and workspace quota before the bytes ever reach storage. Reads go out as 60-second signed URLs — never public URLs. Storage object paths contain only two server-generated ids (`ws/{workspaceId}/{assetId}`), so no user-supplied string ever reaches a path. The network-touching code is isolated in one module (`src/lib/storage.ts`) so everything above it is unit-testable without a network.

**Tech Stack:** Next.js 14 App Router, TypeScript, Drizzle ORM + Postgres (Supabase-hosted), `@supabase/supabase-js` ^2.110.2 (already a dependency — no new packages), Zod, Tailwind + shadcn/ui, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-03-assets-and-saas-gap-audit-design.md` (§2)

---

## Global Constraints

These apply to **every** task below. They are copied from `CLAUDE.md` and from patterns verified in this codebase on 2026-09-03.

- **workspace_id isolation is app-layer, never RLS.** Every `assets` query filters by `workspace_id` explicitly. Every query builder is exported separately from its `await`ing wrapper so a test can call `.toSQL()` on it and assert `'"workspace_id" ='` appears. Precedent: `src/db/queries/workspace-docs.ts` + `src/db/queries/workspace-docs.test.ts`.
- **No static inline styles.** Tailwind + shadcn only. The one allowed exception is a dynamic runtime value Tailwind cannot express — in this plan that is exactly one thing: the storage-meter bar width (`style={{ width: \`${pct}%\` }}`).
- **The `[ws]` route param is the workspace UUID, not a slug.** Pass `params.ws` straight through as `workspaceId`. Precedent: `src/app/(app)/w/[ws]/docs/page.tsx` calls `listWorkspaceDocs(params.ws)`. Confirmed by Phase 0 audit finding F1.
- **Vitest only collects `src/**/*.test.ts`** (see `vitest.config.ts`). There is no jsdom and no `@testing-library/react`. **Do not write `.tsx` tests** — they will not run. UI is verified by Playwright in Task 8.
- **Degradation ladder:** a missing `SUPABASE_SERVICE_ROLE_KEY` disables the feature with a visible, honest message. It never crashes a page and never silently pretends to succeed. Precedent: `bedrockConfigured()` in `src/lib/flags.ts`.
- **Two-layer rule:** assets are first-party consented data. Nothing in this slice touches the public/Apify pattern layer.
- **Gates, run after every task, all three must be green:**
  ```bash
  npx tsc --noEmit
  npx vitest run
  npm run lint
  ```
- **Baseline before you start:** `main` @ `72ae88f` is green — tsc clean, 146 test files / 1336 tests passing, 54 migrations (latest `0053_sop_run_step_rejection_reason`). If your baseline is not green, stop and report before writing code.
- **Deletions require owner approval.** This plan deletes no file and removes no feature. If a task appears to require deleting or disabling existing behaviour, stop and ask the owner in plain language first.

### One-time owner setup (blocks Task 4's manual verification only — Tasks 1-3 and 5-7 do not need it)

1. In the Supabase dashboard → **Storage** → **New bucket**: name `workspace-assets`, **Public = OFF**.
2. Supabase dashboard → **Settings → API** → copy the **`service_role`** key.
3. Add to `.env.local`:
   ```
   SUPABASE_SERVICE_ROLE_KEY=<the service_role key>
   ```
   `NEXT_PUBLIC_SUPABASE_URL` is already present and is reused.

> The `service_role` key bypasses Postgres RLS. That is exactly why it is **server-only** and must never be prefixed `NEXT_PUBLIC_`. It is used solely by `src/lib/storage.ts`, which is imported only by server actions.

### File structure this plan produces

| File | Responsibility |
|---|---|
| `src/lib/assets.ts` (create) | Pure policy: limits, mime allowlist, kind mapping, path builder, quota decision, Zod schemas. No I/O. |
| `src/lib/assets.test.ts` (create) | Unit tests for the above. |
| `src/db/schema.ts` (modify) | `assetKind` enum + `assets` table. |
| `drizzle/0054_*.sql` + `drizzle/meta/*` (generated) | Migration. |
| `src/db/queries/assets.ts` (create) | Workspace-scoped query builders + wrappers. |
| `src/db/queries/assets.test.ts` (create) | SQL-shape isolation assertions. |
| `src/lib/storage.ts` (create) | The only file that talks to Supabase Storage. |
| `src/lib/storage.test.ts` (create) | Config gating + adapter behaviour, network mocked. |
| `src/lib/action-errors.ts` (modify) | Surface `StorageError` verbatim. |
| `src/lib/permissions.ts` (modify) | `asset.upload`, `asset.delete` capabilities. |
| `src/app/(app)/w/[ws]/assets/actions.ts` (create) | Upload / archive / signed-URL server actions. |
| `src/app/(app)/w/[ws]/assets/actions.test.ts` (create) | Guard-order and failure-path tests. |
| `src/app/(app)/w/[ws]/assets/page.tsx` (create) | Server page: quota meter, filters, list. |
| `src/app/(app)/w/[ws]/assets/upload-form.tsx` (create) | Client upload form. |
| `src/app/(app)/w/[ws]/assets/asset-list.tsx` (create) | Client list rows: download + archive. |
| `src/lib/nav.ts` (modify) | Register `assets` nested under `brand-gene`. |
| `src/lib/nav.test.ts` (modify) | Assert the new section. |
| `src/components/workspace-nav.tsx` (modify) | Icon for `assets`. |
| `src/lib/env.ts` (modify) | Doc-block note only (see Task 4 rationale). |
| `.env.example` (modify) | `SUPABASE_SERVICE_ROLE_KEY=`. |
| `e2e/smoke.spec.ts` (modify) | Assets route renders real content. |
| `docs/IA-ROUTE-INVENTORY.md`, `docs/ENHANCEMENTS.md` (modify) | Record route 31 and remaining slices. |

---

## Task 1: Asset policy module (pure, no I/O)

**Files:**
- Create: `src/lib/assets.ts`
- Test: `src/lib/assets.test.ts`

**Interfaces:**
- Consumes: nothing (this is the base layer).
- Produces:
  - `MAX_ASSET_BYTES: number`, `MAX_WORKSPACE_BYTES: number`
  - `ASSET_KINDS: readonly ["csv","doc","image","other"]`, `type AssetKind`
  - `isAllowedMime(mime: string): boolean`
  - `kindForMime(mime: string): AssetKind`
  - `storagePathFor(workspaceId: string, assetId: string): string`
  - `safeFilename(name: string): string`
  - `formatBytes(bytes: number): string`
  - `type UploadCheck = { ok: true; kind: AssetKind } | { ok: false; reason: string }`
  - `checkAssetUpload(input: { filename: string; mime: string; bytes: number; usedBytes: number }): UploadCheck`
  - `uploadAssetSchema`, `archiveAssetSchema` (Zod objects)

- [ ] **Step 1: Write the failing test**

Create `src/lib/assets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ASSET_KINDS,
  MAX_ASSET_BYTES,
  MAX_WORKSPACE_BYTES,
  checkAssetUpload,
  formatBytes,
  isAllowedMime,
  kindForMime,
  safeFilename,
  storagePathFor,
  uploadAssetSchema,
} from "./assets";

describe("mime allowlist", () => {
  it("accepts the formats an agency actually hands over", () => {
    for (const mime of [
      "text/csv",
      "application/vnd.ms-excel",
      "text/plain",
      "text/markdown",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "image/png",
      "image/jpeg",
      "image/webp",
    ]) {
      expect(isAllowedMime(mime)).toBe(true);
    }
  });

  it("rejects executables, archives, and anything unknown", () => {
    for (const mime of [
      "application/x-msdownload",
      "application/zip",
      "application/x-sh",
      "text/html",
      "",
    ]) {
      expect(isAllowedMime(mime)).toBe(false);
    }
  });

  // SVG is deliberately absent: it is an executable document (inline
  // <script>), and a signed URL serves it from a real origin. Re-adding it
  // is an owner decision, not a code cleanup.
  it("rejects SVG deliberately", () => {
    expect(isAllowedMime("image/svg+xml")).toBe(false);
  });

  it("is case- and parameter-insensitive, as browsers send it", () => {
    expect(isAllowedMime("TEXT/CSV")).toBe(true);
    expect(isAllowedMime("text/csv; charset=utf-8")).toBe(true);
  });
});

describe("kindForMime", () => {
  it("maps every allowed mime to a declared kind", () => {
    expect(kindForMime("text/csv")).toBe("csv");
    expect(kindForMime("application/pdf")).toBe("doc");
    expect(kindForMime("image/png")).toBe("image");
    expect(ASSET_KINDS).toContain(kindForMime("text/csv"));
  });

  it("falls back to 'other' rather than throwing", () => {
    expect(kindForMime("application/zip")).toBe("other");
  });
});

describe("storagePathFor", () => {
  it("contains only the two server-generated ids", () => {
    expect(storagePathFor("ws_1", "as_2")).toBe("ws/ws_1/as_2");
  });

  it("never embeds a filename, so no user input reaches the path", () => {
    const path = storagePathFor("ws_1", "as_2");
    expect(path).not.toContain(".");
    expect(path.split("/")).toHaveLength(3);
  });
});

describe("safeFilename", () => {
  it("keeps only the basename, so a display name cannot look like a path", () => {
    expect(safeFilename("../../etc/passwd")).toBe("passwd");
    expect(safeFilename("a\\b.csv")).toBe("b.csv");
    expect(safeFilename("posts.csv")).toBe("posts.csv");
  });

  it("strips control characters", () => {
    expect(safeFilename("re\u0000port\n.csv")).toBe("report.csv");
  });

  it("strips leading dots so nothing renders as a hidden file", () => {
    expect(safeFilename(".hidden.csv")).toBe("hidden.csv");
  });

  it("truncates to 200 characters", () => {
    expect(safeFilename("x".repeat(300))).toHaveLength(200);
  });

  it("falls back to a name when nothing survives", () => {
    expect(safeFilename("   ")).toBe("untitled");
  });
});

describe("checkAssetUpload", () => {
  it("accepts a normal CSV well under both limits", () => {
    const result = checkAssetUpload({
      filename: "posts.csv",
      mime: "text/csv",
      bytes: 1024,
      usedBytes: 0,
    });
    expect(result).toEqual({ ok: true, kind: "csv" });
  });

  it("rejects an empty file", () => {
    const result = checkAssetUpload({
      filename: "empty.csv",
      mime: "text/csv",
      bytes: 0,
      usedBytes: 0,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a file over the per-file limit and says the limit", () => {
    const result = checkAssetUpload({
      filename: "big.pdf",
      mime: "application/pdf",
      bytes: MAX_ASSET_BYTES + 1,
      usedBytes: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("10 MB");
  });

  it("rejects a disallowed mime and names the file", () => {
    const result = checkAssetUpload({
      filename: "tool.exe",
      mime: "application/x-msdownload",
      bytes: 10,
      usedBytes: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("tool.exe");
  });

  it("rejects when this file would cross the workspace quota", () => {
    const result = checkAssetUpload({
      filename: "posts.csv",
      mime: "text/csv",
      bytes: 2048,
      usedBytes: MAX_WORKSPACE_BYTES - 1024,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("250 MB");
  });

  it("accepts a file that exactly fills the remaining quota", () => {
    const result = checkAssetUpload({
      filename: "posts.csv",
      mime: "text/csv",
      bytes: 1024,
      usedBytes: MAX_WORKSPACE_BYTES - 1024,
    });
    expect(result.ok).toBe(true);
  });
});

describe("formatBytes", () => {
  it("renders human sizes without trailing noise", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
  });
});

describe("uploadAssetSchema", () => {
  it("requires a workspaceId and treats a blank clientId as absent", () => {
    const parsed = uploadAssetSchema.safeParse({
      workspaceId: "ws_1",
      clientId: "",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.clientId).toBeUndefined();
  });

  it("rejects a missing workspaceId", () => {
    expect(uploadAssetSchema.safeParse({ clientId: "c_1" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/assets.test.ts
```

Expected: FAIL — `Failed to resolve import "./assets"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/assets.ts`:

```ts
import { z } from "zod";

/**
 * Workspace file storage — policy only. No DB, no network, no env reads, so
 * every rule below is unit-testable and every caller shares one definition.
 *
 * Limits are constants today. When plan tiers land (spec §3, P2-1) they
 * become per-workspace values read from the plan row; keeping every caller
 * on checkAssetUpload() is what makes that a one-file change.
 */
export const MAX_ASSET_BYTES = 10 * 1024 * 1024; // 10 MB per file
export const MAX_WORKSPACE_BYTES = 250 * 1024 * 1024; // 250 MB per workspace

export const ASSET_KINDS = ["csv", "doc", "image", "other"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/**
 * Allowlist, not a blocklist: an unknown type is rejected by default.
 *
 * image/svg+xml is deliberately excluded. An SVG is an executable document —
 * it can carry inline <script> — and we hand out signed URLs on a real
 * origin. Adding it back is an owner decision, not a cleanup.
 */
const MIME_KIND: Record<string, AssetKind> = {
  "text/csv": "csv",
  // What Excel on Windows labels a .csv. Common enough that rejecting it
  // would look like a bug to the person uploading.
  "application/vnd.ms-excel": "csv",
  "text/plain": "doc",
  "text/markdown": "doc",
  "application/pdf": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "doc",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "doc",
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
};

/** Browsers send "text/csv; charset=utf-8" and vary in case. Normalise both. */
function normalizeMime(mime: string): string {
  return mime.split(";")[0].trim().toLowerCase();
}

export function isAllowedMime(mime: string): boolean {
  return normalizeMime(mime) in MIME_KIND;
}

export function kindForMime(mime: string): AssetKind {
  return MIME_KIND[normalizeMime(mime)] ?? "other";
}

/**
 * Object path. Both segments are server-generated ids, so no user-supplied
 * string ever reaches a storage path — path traversal is unrepresentable
 * rather than defended against. The display filename lives in the DB column.
 */
export function storagePathFor(workspaceId: string, assetId: string): string {
  return `ws/${workspaceId}/${assetId}`;
}

/**
 * Display-name hygiene only — the storage path never uses this.
 *
 * Takes the basename first: a browser on some platforms submits a full path
 * as `file.name`, and "passwd" is the honest display name for
 * "../../etc/passwd". Then strips control characters and leading dots.
 */
export function safeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/^\.+/, "")
    .trim();
  if (cleaned.length === 0) return "untitled";
  return cleaned.slice(0, 200);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i++) {
    value /= 1024;
    unit = units[i];
  }
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} ${unit}`;
}

export type UploadCheck =
  | { ok: true; kind: AssetKind }
  | { ok: false; reason: string };

/**
 * The single gate every upload passes. Order matters: cheap structural
 * checks first, quota last, because quota is the only one whose answer
 * needs a DB round-trip to compute `usedBytes`.
 *
 * Refusals name the file and the limit, so the person knows what to do next
 * — same principle as PERMISSION_MESSAGES in src/lib/permissions.ts.
 */
export function checkAssetUpload(input: {
  filename: string;
  mime: string;
  bytes: number;
  usedBytes: number;
}): UploadCheck {
  const name = safeFilename(input.filename);

  if (input.bytes <= 0) {
    return { ok: false, reason: `"${name}" is empty — nothing to upload.` };
  }
  if (!isAllowedMime(input.mime)) {
    return {
      ok: false,
      reason: `"${name}" isn't a supported file type. Upload a CSV, PDF, Word/Excel file, text, Markdown, or a PNG/JPEG/WebP image.`,
    };
  }
  if (input.bytes > MAX_ASSET_BYTES) {
    return {
      ok: false,
      reason: `"${name}" is ${formatBytes(input.bytes)} — the limit is ${formatBytes(MAX_ASSET_BYTES)} per file.`,
    };
  }
  if (input.usedBytes + input.bytes > MAX_WORKSPACE_BYTES) {
    const remaining = Math.max(0, MAX_WORKSPACE_BYTES - input.usedBytes);
    return {
      ok: false,
      reason: `This workspace has ${formatBytes(remaining)} left of its ${formatBytes(MAX_WORKSPACE_BYTES)} storage. Archive something, or upload a smaller file.`,
    };
  }

  return { ok: true, kind: kindForMime(input.mime) };
}

/** A select that submits "" for "no client" is the normal HTML case. */
const optionalId = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional(),
);

export const uploadAssetSchema = z.object({
  workspaceId: z.string().min(1, "Missing workspace."),
  clientId: optionalId,
});

export const archiveAssetSchema = z.object({
  workspaceId: z.string().min(1, "Missing workspace."),
  assetId: z.string().min(1, "Missing asset."),
});
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/assets.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 5: Run the full gates**

```bash
npx tsc --noEmit && npx vitest run && npm run lint
```

Expected: all green, 1336 + new tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/assets.ts src/lib/assets.test.ts
git commit -m "feat(assets): add asset policy module — limits, mime allowlist, quota gate

Pure module, no I/O: one definition of what may be uploaded, how big, and
into which path. SVG is excluded deliberately (executable document served
from a real origin).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Schema and migration

**Files:**
- Modify: `src/db/schema.ts` (append near the end, after `directMessages`)
- Generate: `drizzle/0054_*.sql`, `drizzle/meta/_journal.json`, `drizzle/meta/0054_snapshot.json`

**Interfaces:**
- Consumes: `ASSET_KINDS` values from Task 1 (as literal enum values — the pgEnum must list them in the same order).
- Produces: `assets` table object and `assetKind` pgEnum, both exported from `@/db/schema`. Column names used by Task 3: `id`, `workspaceId`, `clientId`, `uploadedById`, `filename`, `mime`, `bytes`, `storagePath`, `kind`, `linkedType`, `linkedId`, `createdAt`, `archivedAt`.

- [ ] **Step 1: Add the enum and table to the schema**

Append to the end of `src/db/schema.ts`:

```ts
export const assetKind = pgEnum("asset_kind", ["csv", "doc", "image", "other"]);

/**
 * Workspace file storage. The row is the record of truth; the bytes live in
 * a private Supabase Storage bucket at `storage_path`.
 *
 * `client_id` is nullable and ON DELETE SET NULL, not CASCADE: deleting a
 * client must not silently destroy files a team still needs. They become
 * workspace-level assets instead, and stay visible.
 *
 * `linked_type` / `linked_id` are the same untyped polymorphic pair used by
 * `tickets` and `sop_run_steps`. Unused in Slice 1 — they exist so Slice 3
 * (attachments on tickets, DMs, drafts) is a query change, not a migration.
 *
 * Deletion is soft (`archived_at`). Storage bytes ARE removed on archive;
 * the row survives so an audit can still answer "who uploaded what, when".
 */
export const assets = pgTable(
  "assets",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: text("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    uploadedById: text("uploaded_by_id")
      .notNull()
      .references(() => users.id),
    // Display name, sanitised via safeFilename(). Never used to build a path.
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    // `ws/{workspace_id}/{asset_id}` — see storagePathFor() in src/lib/assets.ts.
    storagePath: text("storage_path").notNull(),
    kind: assetKind("kind").notNull().default("other"),
    linkedType: text("linked_type"),
    linkedId: text("linked_id"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { mode: "date" }),
  },
  (table) => ({
    workspaceIdx: index("assets_workspace_id_idx").on(table.workspaceId),
    clientIdx: index("assets_client_id_idx").on(table.clientId),
    linkedIdx: index("assets_linked_idx").on(
      table.workspaceId,
      table.linkedType,
      table.linkedId,
    ),
    // One row per object. Makes an orphaned double-insert impossible.
    storagePathUnique: uniqueIndex("assets_storage_path_unique").on(
      table.storagePath,
    ),
  }),
);
```

- [ ] **Step 2: Verify the schema compiles**

```bash
npx tsc --noEmit
```

Expected: clean. If `integer` or `uniqueIndex` is reported as unused-before-now, they are already imported at the top of `src/db/schema.ts` — no import change is needed.

- [ ] **Step 3: Generate the migration**

```bash
npx drizzle-kit generate --name assets
```

Expected: creates `drizzle/0054_assets.sql` and updates `drizzle/meta/_journal.json` with an `idx: 54` entry.

- [ ] **Step 4: Read the generated SQL line by line**

```bash
cat drizzle/0054_assets.sql
```

Confirm, by eye, all five of these. Do not proceed if any is missing:
1. `CREATE TYPE "public"."asset_kind" AS ENUM('csv', 'doc', 'image', 'other');`
2. `CREATE TABLE ... "assets"` with all 13 columns.
3. Three foreign keys — `workspaces` **ON DELETE cascade**, `clients` **ON DELETE set null**, `users` (no cascade).
4. Indexes `assets_workspace_id_idx`, `assets_client_id_idx`, `assets_linked_idx`.
5. `CREATE UNIQUE INDEX ... "assets_storage_path_unique"`.

There must be **no** `DROP` statement anywhere in the file. If one appears, stop and report to the owner before running the migration — it means drizzle-kit diffed against a stale snapshot.

- [ ] **Step 5: Apply the migration**

```bash
npm run db:migrate
```

Expected: completes and reports the new migration applied. If it errors on an *earlier* migration, stop and report — do not hand-edit `_journal.json`. Ledger drift has bitten this repo before (see `PROGRESS-COUNTERATTACK-13.md`).

- [ ] **Step 6: Run the gates**

```bash
npx tsc --noEmit && npx vitest run && npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(assets): add assets table and asset_kind enum (migration 0054)

workspace_id cascades; client_id sets null so deleting a client never
destroys files. linked_type/linked_id reserved for Slice 3 attachments.
Soft delete via archived_at keeps the audit trail after bytes are removed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Query layer with isolation tests

**Files:**
- Create: `src/db/queries/assets.ts`
- Test: `src/db/queries/assets.test.ts`

**Interfaces:**
- Consumes: `assets` table from Task 2; `AssetKind` from Task 1.
- Produces:
  - `listAssetsQuery(workspaceId: string, filter?: { clientId?: string; kind?: AssetKind })`
  - `listAssets(workspaceId, filter?): Promise<AssetListRow[]>` where
    `AssetListRow = { id: string; filename: string; mime: string; bytes: number; kind: AssetKind; clientId: string | null; uploadedById: string; createdAt: Date }`
  - `getAssetByIdQuery(workspaceId: string, assetId: string)`
  - `getAssetById(workspaceId, assetId): Promise<{ id, storagePath, filename, mime, archivedAt } | null>`
  - `workspaceStorageUsedQuery(workspaceId: string)`
  - `workspaceStorageUsed(workspaceId): Promise<number>`
  - `createAsset(input: { id, workspaceId, clientId?, uploadedById, filename, mime, bytes, storagePath, kind }): Promise<void>`
  - `archiveAssetQuery(workspaceId: string, assetId: string)`
  - `archiveAsset(workspaceId, assetId): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `src/db/queries/assets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  archiveAssetQuery,
  getAssetByIdQuery,
  listAssetsQuery,
  workspaceStorageUsedQuery,
} from "./assets";

describe("asset queries (workspace isolation)", () => {
  it("list query is scoped to workspace and newest first", () => {
    const { sql, params } = listAssetsQuery("ws_isolation_test").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_isolation_test");
    expect(sql).toMatch(/order by .*"created_at" desc/i);
  });

  it("list query hides archived rows by default", () => {
    const { sql } = listAssetsQuery("ws_1").toSQL();
    expect(sql).toMatch(/"archived_at" is null/i);
  });

  it("client filter composes with the workspace filter, never replaces it", () => {
    const { sql, params } = listAssetsQuery("ws_1", {
      clientId: "client_9",
    }).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"client_id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("client_9");
  });

  it("kind filter composes with the workspace filter, never replaces it", () => {
    const { sql, params } = listAssetsQuery("ws_1", { kind: "csv" }).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"kind" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("csv");
  });

  it("single-asset lookup is scoped to the (workspace_id, id) composite", () => {
    const { sql, params } = getAssetByIdQuery("ws_1", "asset_1").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("asset_1");
  });

  it("usage sum is workspace-scoped and ignores archived rows", () => {
    const { sql, params } = workspaceStorageUsedQuery("ws_1").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toMatch(/sum\(/i);
    expect(sql).toMatch(/"archived_at" is null/i);
    expect(params).toContain("ws_1");
  });

  it("archive query is workspace+id scoped and sets archived_at", () => {
    const { sql, params } = archiveAssetQuery("ws_1", "asset_1").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"id" =');
    expect(sql).toMatch(/"archived_at" =/i);
    expect(params).toContain("ws_1");
    expect(params).toContain("asset_1");
  });

  it("archive query returns the storage path so the caller can delete bytes", () => {
    const { sql } = archiveAssetQuery("ws_1", "asset_1").toSQL();
    expect(sql).toMatch(/returning .*"storage_path"/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/db/queries/assets.test.ts
```

Expected: FAIL — `Failed to resolve import "./assets"`.

- [ ] **Step 3: Write the implementation**

Create `src/db/queries/assets.ts`:

```ts
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets } from "@/db/schema";
import type { AssetKind } from "@/lib/assets";

export type AssetListRow = {
  id: string;
  filename: string;
  mime: string;
  bytes: number;
  kind: AssetKind;
  clientId: string | null;
  uploadedById: string;
  createdAt: Date;
};

/**
 * Builder is exported separately from the awaiting wrapper so the test above
 * can call .toSQL() and prove the workspace filter is in the generated SQL.
 * Same shape as src/db/queries/workspace-docs.ts.
 *
 * `storage_path` is NOT selected here: the list page never needs it, and a
 * path that never reaches the client cannot be guessed at.
 */
export function listAssetsQuery(
  workspaceId: string,
  filter?: { clientId?: string; kind?: AssetKind },
) {
  return db
    .select({
      id: assets.id,
      filename: assets.filename,
      mime: assets.mime,
      bytes: assets.bytes,
      kind: assets.kind,
      clientId: assets.clientId,
      uploadedById: assets.uploadedById,
      createdAt: assets.createdAt,
    })
    .from(assets)
    .where(
      and(
        eq(assets.workspaceId, workspaceId),
        isNull(assets.archivedAt),
        ...(filter?.clientId ? [eq(assets.clientId, filter.clientId)] : []),
        ...(filter?.kind ? [eq(assets.kind, filter.kind)] : []),
      ),
    )
    .orderBy(desc(assets.createdAt));
}

export async function listAssets(
  workspaceId: string,
  filter?: { clientId?: string; kind?: AssetKind },
): Promise<AssetListRow[]> {
  return listAssetsQuery(workspaceId, filter);
}

/** Workspace + id scoped. Returns archived rows too — the caller decides. */
export function getAssetByIdQuery(workspaceId: string, assetId: string) {
  return db
    .select({
      id: assets.id,
      storagePath: assets.storagePath,
      filename: assets.filename,
      mime: assets.mime,
      archivedAt: assets.archivedAt,
    })
    .from(assets)
    .where(and(eq(assets.workspaceId, workspaceId), eq(assets.id, assetId)))
    .limit(1);
}

export async function getAssetById(workspaceId: string, assetId: string) {
  const rows = await getAssetByIdQuery(workspaceId, assetId);
  return rows[0] ?? null;
}

/**
 * Quota input. Archived rows are excluded because their bytes are already
 * gone from the bucket — counting them would charge a workspace for storage
 * it is not using.
 */
export function workspaceStorageUsedQuery(workspaceId: string) {
  return db
    .select({ used: sql<string>`coalesce(sum(${assets.bytes}), 0)` })
    .from(assets)
    .where(
      and(eq(assets.workspaceId, workspaceId), isNull(assets.archivedAt)),
    );
}

export async function workspaceStorageUsed(
  workspaceId: string,
): Promise<number> {
  const rows = await workspaceStorageUsedQuery(workspaceId);
  // Postgres sum() over bigint comes back as a string via the driver.
  return Number(rows[0]?.used ?? 0);
}

/**
 * Insert with a caller-supplied id. The action generates the id first so it
 * can build the storage path and upload the bytes BEFORE writing the row —
 * a failed upload then leaves no row at all, rather than a row pointing at
 * nothing.
 */
export async function createAsset(input: {
  id: string;
  workspaceId: string;
  clientId?: string;
  uploadedById: string;
  filename: string;
  mime: string;
  bytes: number;
  storagePath: string;
  kind: AssetKind;
}): Promise<void> {
  await db.insert(assets).values({
    id: input.id,
    workspaceId: input.workspaceId,
    clientId: input.clientId ?? null,
    uploadedById: input.uploadedById,
    filename: input.filename,
    mime: input.mime,
    bytes: input.bytes,
    storagePath: input.storagePath,
    kind: input.kind,
  });
}

/**
 * Soft delete, guard-in-WHERE. Returns the storage path so the caller can
 * remove the bytes; an empty result means "not in this workspace" and the
 * caller must not touch storage.
 */
export function archiveAssetQuery(workspaceId: string, assetId: string) {
  return db
    .update(assets)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(assets.workspaceId, workspaceId),
        eq(assets.id, assetId),
        isNull(assets.archivedAt),
      ),
    )
    .returning({ storagePath: assets.storagePath });
}

export async function archiveAsset(
  workspaceId: string,
  assetId: string,
): Promise<string | null> {
  const rows = await archiveAssetQuery(workspaceId, assetId);
  return rows[0]?.storagePath ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/db/queries/assets.test.ts
```

Expected: PASS, 8 cases.

- [ ] **Step 5: Run the gates**

```bash
npx tsc --noEmit && npx vitest run && npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/db/queries/assets.ts src/db/queries/assets.test.ts
git commit -m "feat(assets): add workspace-scoped asset queries with SQL isolation tests

Every builder is exported so its generated SQL can be asserted to contain
the workspace_id filter. storage_path is never selected into a list payload.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Storage adapter

**Files:**
- Create: `src/lib/storage.ts`
- Test: `src/lib/storage.test.ts`
- Modify: `src/lib/action-errors.ts`
- Modify: `src/lib/env.ts` (doc block only)
- Modify: `.env.example`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `ASSETS_BUCKET: "workspace-assets"`
  - `class StorageError extends Error` (with `name === "StorageError"`)
  - `storageConfigured(): boolean`
  - `putObject(path: string, body: ArrayBuffer, contentType: string): Promise<void>`
  - `removeObject(path: string): Promise<void>`
  - `signedUrlFor(path: string, expiresInSeconds?: number): Promise<string>`
  - `__resetStorageClientForTests(): void`

- [ ] **Step 1: Write the failing test**

Create `src/lib/storage.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const upload = vi.fn();
const remove = vi.fn();
const createSignedUrl = vi.fn();
const from = vi.fn(() => ({ upload, remove, createSignedUrl }));
const createClient = vi.fn(() => ({ storage: { from } }));

vi.mock("@supabase/supabase-js", () => ({ createClient }));

const {
  ASSETS_BUCKET,
  StorageError,
  __resetStorageClientForTests,
  putObject,
  removeObject,
  signedUrlFor,
  storageConfigured,
} = await import("./storage");

const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIGINAL_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function configure() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  __resetStorageClientForTests();
}

beforeEach(() => {
  vi.clearAllMocks();
  configure();
});

afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_KEY;
  __resetStorageClientForTests();
});

describe("storageConfigured", () => {
  it("is true only when both the URL and the service-role key are present", () => {
    expect(storageConfigured()).toBe(true);

    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    __resetStorageClientForTests();
    expect(storageConfigured()).toBe(false);

    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    __resetStorageClientForTests();
    expect(storageConfigured()).toBe(false);
  });
});

describe("unconfigured behaviour (degradation ladder)", () => {
  beforeEach(() => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    __resetStorageClientForTests();
  });

  it("refuses with a StorageError naming the missing var, not a crash", async () => {
    await expect(putObject("ws/a/b", new ArrayBuffer(4), "text/csv")).rejects
      .toMatchObject({
        name: "StorageError",
        message: expect.stringContaining("SUPABASE_SERVICE_ROLE_KEY"),
      });
  });

  it("never constructs a client when unconfigured", async () => {
    await putObject("ws/a/b", new ArrayBuffer(4), "text/csv").catch(() => {});
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe("putObject", () => {
  it("writes to the private bucket with upsert off", async () => {
    upload.mockResolvedValue({ error: null });
    const body = new ArrayBuffer(8);

    await putObject("ws/ws_1/as_1", body, "text/csv");

    expect(from).toHaveBeenCalledWith(ASSETS_BUCKET);
    expect(upload).toHaveBeenCalledWith("ws/ws_1/as_1", body, {
      contentType: "text/csv",
      upsert: false,
    });
  });

  it("turns a storage failure into a StorageError", async () => {
    upload.mockResolvedValue({ error: { message: "Bucket not found" } });

    await expect(
      putObject("ws/ws_1/as_1", new ArrayBuffer(4), "text/csv"),
    ).rejects.toMatchObject({
      name: "StorageError",
      message: expect.stringContaining("Bucket not found"),
    });
  });
});

describe("removeObject", () => {
  it("removes the single path", async () => {
    remove.mockResolvedValue({ error: null });
    await removeObject("ws/ws_1/as_1");
    expect(remove).toHaveBeenCalledWith(["ws/ws_1/as_1"]);
  });

  it("turns a storage failure into a StorageError", async () => {
    remove.mockResolvedValue({ error: { message: "nope" } });
    await expect(removeObject("ws/ws_1/as_1")).rejects.toMatchObject({
      name: "StorageError",
    });
  });
});

describe("signedUrlFor", () => {
  it("defaults to a 60 second expiry", async () => {
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://signed.example/x" },
      error: null,
    });

    const url = await signedUrlFor("ws/ws_1/as_1");

    expect(createSignedUrl).toHaveBeenCalledWith("ws/ws_1/as_1", 60);
    expect(url).toBe("https://signed.example/x");
  });

  it("honours an explicit expiry", async () => {
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://signed.example/x" },
      error: null,
    });
    await signedUrlFor("ws/ws_1/as_1", 300);
    expect(createSignedUrl).toHaveBeenCalledWith("ws/ws_1/as_1", 300);
  });

  it("throws when the provider returns no url", async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: null });
    await expect(signedUrlFor("ws/ws_1/as_1")).rejects.toMatchObject({
      name: "StorageError",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/storage.test.ts
```

Expected: FAIL — `Failed to resolve import "./storage"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/storage.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Private bucket. Created once by hand in the Supabase dashboard. */
export const ASSETS_BUCKET = "workspace-assets";

/**
 * Surfaced verbatim by actionErrorMessage — same treatment as
 * PermissionError. A storage failure that reads "Something went wrong" turns
 * a fixable config problem into a support ticket.
 */
export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

/**
 * Degradation-ladder switch, same shape as bedrockConfigured() in
 * src/lib/flags.ts. Absence disables the feature visibly; it never serves
 * wrong data, which is why SUPABASE_SERVICE_ROLE_KEY is deliberately NOT in
 * the required-in-production list in src/lib/env.ts.
 */
export function storageConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

let cached: SupabaseClient | null = null;

/** Test-only seam: env is read once per client, so a test that changes env
 *  must be able to drop the memoised client. */
export function __resetStorageClientForTests(): void {
  cached = null;
}

function storageClient(): SupabaseClient {
  if (!storageConfigured()) {
    throw new StorageError(
      "File storage isn't configured — set SUPABASE_SERVICE_ROLE_KEY in the environment, then retry.",
    );
  }
  cached ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return cached;
}

export async function putObject(
  path: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<void> {
  const { error } = await storageClient()
    .storage.from(ASSETS_BUCKET)
    // upsert:false — paths carry a fresh UUID, so a collision means a bug,
    // and silently overwriting someone's file is the worst way to find out.
    .upload(path, body, { contentType, upsert: false });
  if (error) throw new StorageError(`Upload failed: ${error.message}`);
}

export async function removeObject(path: string): Promise<void> {
  const { error } = await storageClient()
    .storage.from(ASSETS_BUCKET)
    .remove([path]);
  if (error) throw new StorageError(`Delete failed: ${error.message}`);
}

/**
 * Short-lived signed URL. The bucket is private, so this is the only way
 * bytes leave. 60 seconds is enough for a click-to-download and short enough
 * that a leaked URL in a log or a chat is worthless by the time it is read.
 */
export async function signedUrlFor(
  path: string,
  expiresInSeconds = 60,
): Promise<string> {
  const { data, error } = await storageClient()
    .storage.from(ASSETS_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw new StorageError(`Download link failed: ${error.message}`);
  if (!data?.signedUrl) {
    throw new StorageError("Download link failed: storage returned no URL.");
  }
  return data.signedUrl;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/storage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Surface StorageError verbatim in action errors**

In `src/lib/action-errors.ts`, immediately after the existing `PermissionError` block (which ends with `return message;`), insert:

```ts
  // Storage refusals name the missing config or the provider's own reason
  // ("Bucket not found") — collapsing them into "Something went wrong" hides
  // a one-line fix. Same rule as PermissionError above.
  if (error instanceof Error && error.name === "StorageError") {
    return message;
  }
```

- [ ] **Step 6: Record the env decision**

In `src/lib/env.ts`, inside the doc block listing vars deliberately left OUT, append one bullet after the `NEXT_PUBLIC_SUPABASE_*` bullet:

```
 *  - SUPABASE_SERVICE_ROLE_KEY: server-only key for the workspace-assets
 *    bucket. Absence disables file upload/download visibly (see
 *    storageConfigured() in src/lib/storage.ts); it never serves wrong
 *    data, so it follows the same rule as the NEXT_PUBLIC_SUPABASE_* pair.
```

In `.env.example`, add below the existing `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=` line:

```
# Server-only. Supabase dashboard → Settings → API → service_role.
# Never prefix this NEXT_PUBLIC_ — it bypasses RLS.
SUPABASE_SERVICE_ROLE_KEY=
```

- [ ] **Step 7: Run the gates**

```bash
npx tsc --noEmit && npx vitest run && npm run lint
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/storage.ts src/lib/storage.test.ts src/lib/action-errors.ts src/lib/env.ts .env.example
git commit -m "feat(assets): add Supabase Storage adapter with honest degradation

One module owns every network call to storage, so the layers above are
unit-testable. Missing SUPABASE_SERVICE_ROLE_KEY disables the feature with
a named error instead of crashing. Reads are 60s signed URLs only.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Asset capabilities in the role matrix

**Files:**
- Modify: `src/lib/permissions.ts`
- Test: `src/lib/permissions.test.ts` (add cases; the existing exhaustive tests already cover the new pairs)

**Interfaces:**
- Consumes: nothing.
- Produces: `"asset.upload"` and `"asset.delete"` as valid `Capability` values, usable with `requireCapability(workspaceId, userId, capability)`.

**Role decision, and why:** the matrix comment in `permissions.ts` says a member *does the work* but cannot *rewrite the process*. Uploading a client's CSV or brief is doing the work, so **members get `asset.upload`**. Archiving destroys bytes irreversibly, so **`asset.delete` is owner/admin only** — the same line already drawn for `field.edit` and `client.manage`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/permissions.test.ts`:

```ts
describe("asset capabilities", () => {
  it("lets a member upload — uploading a client CSV is doing the work", () => {
    expect(roleCan("member", "asset.upload")).toBe(true);
  });

  it("does not let a member archive — archiving destroys bytes", () => {
    expect(roleCan("member", "asset.delete")).toBe(false);
  });

  it("gives owner and admin both", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(roleCan(role, "asset.upload")).toBe(true);
      expect(roleCan(role, "asset.delete")).toBe(true);
    }
  });

  it("recognises the new capability strings", () => {
    expect(isCapability("asset.upload")).toBe(true);
    expect(isCapability("asset.delete")).toBe(true);
    expect(isCapability("asset.destroy")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/permissions.test.ts
```

Expected: FAIL — TypeScript rejects `"asset.upload"` as a `Capability`, and `roleCan` returns `false`.

- [ ] **Step 3: Write the implementation**

In `src/lib/permissions.ts`, three edits.

Add to `CAPABILITIES` (after `"client.manage"`):

```ts
  "asset.upload",
  "asset.delete",
```

Add to `CAPABILITY_LABELS`:

```ts
  "asset.upload": "Upload files to the workspace",
  "asset.delete": "Archive workspace files",
```

Add to `PERMISSION_MESSAGES`:

```ts
  "asset.upload": "You don't have permission to upload files to this workspace.",
  "asset.delete": "Only an admin can archive workspace files.",
```

Change the `member` row of `MATRIX` from `["sop.run.start"]` to:

```ts
  // A member does the work: they start runs and upload the client's files.
  // They do not archive files — that destroys bytes and is not reversible.
  member: ["sop.run.start", "asset.upload"],
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/permissions.test.ts
```

Expected: PASS, including the pre-existing exhaustive role × capability and label/message-coverage tests.

- [ ] **Step 5: Run the gates**

```bash
npx tsc --noEmit && npx vitest run && npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/permissions.ts src/lib/permissions.test.ts
git commit -m "feat(assets): add asset.upload and asset.delete capabilities

Members may upload (that is doing the work); archiving destroys bytes and
stays owner/admin, matching field.edit and client.manage.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Server actions

**Files:**
- Create: `src/app/(app)/w/[ws]/assets/actions.ts`
- Test: `src/app/(app)/w/[ws]/assets/actions.test.ts`

**Interfaces:**
- Consumes: Task 1 (`checkAssetUpload`, `safeFilename`, `storagePathFor`, `uploadAssetSchema`, `archiveAssetSchema`), Task 3 (`createAsset`, `archiveAsset`, `getAssetById`, `workspaceStorageUsed`), Task 4 (`putObject`, `removeObject`, `signedUrlFor`), Task 5 (capabilities), plus existing `requireUser`, `requireCapability`, `actionErrorMessage`.
- Produces:
  - `type UploadAssetState = { error?: string; ok?: string } | undefined`
  - `uploadAssetAction(_prev: UploadAssetState, formData: FormData): Promise<UploadAssetState>`
  - `type ArchiveAssetState = { error?: string } | undefined`
  - `archiveAssetAction(_prev: ArchiveAssetState, formData: FormData): Promise<ArchiveAssetState>`
  - `getAssetDownloadUrl(workspaceId: string, assetId: string): Promise<{ url?: string; error?: string }>`

**Guard order (load-bearing — the tests assert it):** parse → authenticate → capability (which internally requires membership) → read quota → policy check → upload bytes → insert row. Nothing touches storage before every guard has passed, and a failed insert removes the bytes it just wrote.

- [ ] **Step 1: Write the failing test**

Create `src/app/(app)/w/[ws]/assets/actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/db/queries/memberships", () => ({ requireCapability: vi.fn() }));
vi.mock("@/db/queries/assets", () => ({
  createAsset: vi.fn(),
  archiveAsset: vi.fn(),
  getAssetById: vi.fn(),
  workspaceStorageUsed: vi.fn(),
}));
vi.mock("@/lib/storage", () => ({
  putObject: vi.fn(),
  removeObject: vi.fn(),
  signedUrlFor: vi.fn(),
}));

const { requireUser } = await import("@/auth");
const { requireCapability } = await import("@/db/queries/memberships");
const { archiveAsset, createAsset, getAssetById, workspaceStorageUsed } =
  await import("@/db/queries/assets");
const { putObject, removeObject, signedUrlFor } = await import("@/lib/storage");
const { archiveAssetAction, getAssetDownloadUrl, uploadAssetAction } =
  await import("./actions");

const requireUserMock = requireUser as unknown as Mock;
const requireCapabilityMock = requireCapability as unknown as Mock;
const createAssetMock = createAsset as unknown as Mock;
const archiveAssetMock = archiveAsset as unknown as Mock;
const getAssetByIdMock = getAssetById as unknown as Mock;
const usedMock = workspaceStorageUsed as unknown as Mock;
const putObjectMock = putObject as unknown as Mock;
const removeObjectMock = removeObject as unknown as Mock;
const signedUrlForMock = signedUrlFor as unknown as Mock;

function csvFile(name = "posts.csv", bytes = 32, type = "text/csv") {
  return new File([new Uint8Array(bytes)], name, { type });
}

function uploadForm(file: File, clientId = "") {
  const form = new FormData();
  form.set("workspaceId", "ws_1");
  form.set("clientId", clientId);
  form.set("file", file);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ id: "user_1" });
  requireCapabilityMock.mockResolvedValue({ role: "admin" });
  usedMock.mockResolvedValue(0);
  putObjectMock.mockResolvedValue(undefined);
  createAssetMock.mockResolvedValue(undefined);
});

describe("uploadAssetAction — happy path", () => {
  it("uploads the bytes, then writes the row", async () => {
    const state = await uploadAssetAction(undefined, uploadForm(csvFile()));

    expect(state?.error).toBeUndefined();
    expect(putObjectMock).toHaveBeenCalledTimes(1);
    expect(createAssetMock).toHaveBeenCalledTimes(1);

    const [path, , contentType] = putObjectMock.mock.calls[0];
    const row = createAssetMock.mock.calls[0][0];
    expect(contentType).toBe("text/csv");
    expect(path).toBe(row.storagePath);
    expect(path).toBe(`ws/ws_1/${row.id}`);
    expect(row).toMatchObject({
      workspaceId: "ws_1",
      uploadedById: "user_1",
      filename: "posts.csv",
      mime: "text/csv",
      bytes: 32,
      kind: "csv",
      clientId: undefined,
    });
  });

  it("records the client when one is chosen", async () => {
    await uploadAssetAction(undefined, uploadForm(csvFile(), "client_9"));
    expect(createAssetMock.mock.calls[0][0].clientId).toBe("client_9");
  });

  it("sanitises the stored display name", async () => {
    await uploadAssetAction(
      undefined,
      uploadForm(csvFile("../../etc/passwd.csv")),
    );
    expect(createAssetMock.mock.calls[0][0].filename).toBe("passwd.csv");
  });
});

describe("uploadAssetAction — guards run before any byte is stored", () => {
  it("refuses an unauthenticated caller", async () => {
    requireUserMock.mockRejectedValue(new Error("Unauthenticated"));
    const state = await uploadAssetAction(undefined, uploadForm(csvFile()));
    expect(state?.error).toBeTruthy();
    expect(putObjectMock).not.toHaveBeenCalled();
  });

  it("refuses a caller without asset.upload, surfacing the message verbatim", async () => {
    const denied = new Error("You don't have permission to upload files to this workspace.");
    denied.name = "PermissionError";
    requireCapabilityMock.mockRejectedValue(denied);

    const state = await uploadAssetAction(undefined, uploadForm(csvFile()));

    expect(state?.error).toBe(
      "You don't have permission to upload files to this workspace.",
    );
    expect(putObjectMock).not.toHaveBeenCalled();
  });

  it("checks asset.upload, not some other capability", async () => {
    await uploadAssetAction(undefined, uploadForm(csvFile()));
    expect(requireCapabilityMock).toHaveBeenCalledWith(
      "ws_1",
      "user_1",
      "asset.upload",
    );
  });

  it("rejects a disallowed file type without storing anything", async () => {
    const state = await uploadAssetAction(
      undefined,
      uploadForm(csvFile("tool.exe", 32, "application/x-msdownload")),
    );
    expect(state?.error).toContain("tool.exe");
    expect(putObjectMock).not.toHaveBeenCalled();
    expect(createAssetMock).not.toHaveBeenCalled();
  });

  it("rejects when the workspace quota is already full", async () => {
    usedMock.mockResolvedValue(250 * 1024 * 1024);
    const state = await uploadAssetAction(undefined, uploadForm(csvFile()));
    expect(state?.error).toContain("250 MB");
    expect(putObjectMock).not.toHaveBeenCalled();
  });

  it("rejects a missing file", async () => {
    const form = new FormData();
    form.set("workspaceId", "ws_1");
    form.set("clientId", "");
    const state = await uploadAssetAction(undefined, form);
    expect(state?.error).toBeTruthy();
    expect(putObjectMock).not.toHaveBeenCalled();
  });
});

describe("uploadAssetAction — failure cleanup", () => {
  it("removes the uploaded bytes when the row insert fails", async () => {
    createAssetMock.mockRejectedValue(new Error("insert failed"));

    const state = await uploadAssetAction(undefined, uploadForm(csvFile()));

    expect(state?.error).toBeTruthy();
    expect(removeObjectMock).toHaveBeenCalledTimes(1);
    expect(removeObjectMock.mock.calls[0][0]).toBe(
      putObjectMock.mock.calls[0][0],
    );
  });

  it("surfaces a storage failure verbatim and writes no row", async () => {
    const failure = new Error("Upload failed: Bucket not found");
    failure.name = "StorageError";
    putObjectMock.mockRejectedValue(failure);

    const state = await uploadAssetAction(undefined, uploadForm(csvFile()));

    expect(state?.error).toBe("Upload failed: Bucket not found");
    expect(createAssetMock).not.toHaveBeenCalled();
  });
});

describe("archiveAssetAction", () => {
  it("requires asset.delete and removes the bytes after the row is archived", async () => {
    archiveAssetMock.mockResolvedValue("ws/ws_1/as_1");
    const form = new FormData();
    form.set("workspaceId", "ws_1");
    form.set("assetId", "as_1");

    const state = await archiveAssetAction(undefined, form);

    expect(state?.error).toBeUndefined();
    expect(requireCapabilityMock).toHaveBeenCalledWith(
      "ws_1",
      "user_1",
      "asset.delete",
    );
    expect(removeObjectMock).toHaveBeenCalledWith("ws/ws_1/as_1");
  });

  it("never touches storage when the asset is not in this workspace", async () => {
    archiveAssetMock.mockResolvedValue(null);
    const form = new FormData();
    form.set("workspaceId", "ws_1");
    form.set("assetId", "as_other");

    const state = await archiveAssetAction(undefined, form);

    expect(state?.error).toBeTruthy();
    expect(removeObjectMock).not.toHaveBeenCalled();
  });
});

describe("getAssetDownloadUrl", () => {
  it("returns a signed URL for an asset in this workspace", async () => {
    getAssetByIdMock.mockResolvedValue({
      id: "as_1",
      storagePath: "ws/ws_1/as_1",
      filename: "posts.csv",
      mime: "text/csv",
      archivedAt: null,
    });
    signedUrlForMock.mockResolvedValue("https://signed.example/x");

    const result = await getAssetDownloadUrl("ws_1", "as_1");

    expect(result.url).toBe("https://signed.example/x");
    expect(getAssetByIdMock).toHaveBeenCalledWith("ws_1", "as_1");
  });

  it("refuses an asset from another workspace without calling storage", async () => {
    getAssetByIdMock.mockResolvedValue(null);
    const result = await getAssetDownloadUrl("ws_1", "as_other");
    expect(result.error).toBeTruthy();
    expect(signedUrlForMock).not.toHaveBeenCalled();
  });

  it("refuses an archived asset — its bytes are gone", async () => {
    getAssetByIdMock.mockResolvedValue({
      id: "as_1",
      storagePath: "ws/ws_1/as_1",
      filename: "posts.csv",
      mime: "text/csv",
      archivedAt: new Date(),
    });
    const result = await getAssetDownloadUrl("ws_1", "as_1");
    expect(result.error).toBeTruthy();
    expect(signedUrlForMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run "src/app/(app)/w/[ws]/assets/actions.test.ts"
```

Expected: FAIL — `Failed to resolve import "./actions"`.

- [ ] **Step 3: Write the implementation**

Create `src/app/(app)/w/[ws]/assets/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import {
  archiveAsset,
  createAsset,
  getAssetById,
  workspaceStorageUsed,
} from "@/db/queries/assets";
import { requireCapability } from "@/db/queries/memberships";
import { actionErrorMessage } from "@/lib/action-errors";
import {
  archiveAssetSchema,
  checkAssetUpload,
  safeFilename,
  storagePathFor,
  uploadAssetSchema,
} from "@/lib/assets";
import { putObject, removeObject, signedUrlFor } from "@/lib/storage";

export type UploadAssetState = { error?: string; ok?: string } | undefined;
export type ArchiveAssetState = { error?: string } | undefined;

/**
 * Guard order is load-bearing and asserted in actions.test.ts:
 *   parse → authenticate → capability (membership is inside it) → quota
 *   → policy → upload bytes → insert row.
 *
 * Bytes are written BEFORE the row, so a failed upload leaves nothing at
 * all. The reverse order would leave a row pointing at an object that does
 * not exist, which the UI would render as a broken file with no way back.
 * The insert's own failure path removes the bytes it just wrote.
 */
export async function uploadAssetAction(
  _prev: UploadAssetState,
  formData: FormData,
): Promise<UploadAssetState> {
  const parsed = uploadAssetSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    clientId: formData.get("clientId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, clientId } = parsed.data;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }

  let storagePath: string | undefined;
  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, "asset.upload");

    const usedBytes = await workspaceStorageUsed(workspaceId);
    const check = checkAssetUpload({
      filename: file.name,
      mime: file.type,
      bytes: file.size,
      usedBytes,
    });
    if (!check.ok) return { error: check.reason };

    const assetId = crypto.randomUUID();
    storagePath = storagePathFor(workspaceId, assetId);

    await putObject(storagePath, await file.arrayBuffer(), file.type);

    try {
      await createAsset({
        id: assetId,
        workspaceId,
        clientId,
        uploadedById: user.id,
        filename: safeFilename(file.name),
        mime: file.type,
        bytes: file.size,
        storagePath,
        kind: check.kind,
      });
    } catch (insertError) {
      // The bytes are already in the bucket and nothing references them.
      // Best-effort cleanup; the original error is what the user sees.
      await removeObject(storagePath).catch(() => {});
      throw insertError;
    }
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/assets`);
  return { ok: `Uploaded ${safeFilename(file.name)}.` };
}

/**
 * Archive is soft for the row and hard for the bytes: the audit trail of who
 * uploaded what survives, the storage quota is actually freed.
 *
 * archiveAsset() returns null when the id is not in this workspace, which is
 * how a cross-workspace archive attempt is stopped before storage is touched.
 */
export async function archiveAssetAction(
  _prev: ArchiveAssetState,
  formData: FormData,
): Promise<ArchiveAssetState> {
  const parsed = archiveAssetSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    assetId: formData.get("assetId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, assetId } = parsed.data;

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, "asset.delete");

    const storagePath = await archiveAsset(workspaceId, assetId);
    if (!storagePath) {
      return { error: "That file is not in this workspace, or is already archived." };
    }
    await removeObject(storagePath);
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/assets`);
  return undefined;
}

/**
 * Called on click from the client list, not a form action. Membership is
 * required (any member may read the workspace's files); the workspace-scoped
 * lookup is what prevents reading another workspace's object by guessing an
 * id — the path is never sent to the browser, only the short-lived URL.
 */
export async function getAssetDownloadUrl(
  workspaceId: string,
  assetId: string,
): Promise<{ url?: string; error?: string }> {
  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, "asset.upload");

    const asset = await getAssetById(workspaceId, assetId);
    if (!asset) return { error: "That file is not in this workspace." };
    if (asset.archivedAt) {
      return { error: "That file was archived — its contents are gone." };
    }

    return { url: await signedUrlFor(asset.storagePath) };
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}
```

> Note on `getAssetDownloadUrl` using `asset.upload`: it is the "may participate in this workspace's files" capability, and every role that has it (owner, admin, member) may read. Introducing a third `asset.read` capability that no role is ever denied would be a matrix row nobody can fail — dead weight in an exhaustively-tested matrix.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run "src/app/(app)/w/[ws]/assets/actions.test.ts"
```

Expected: PASS, 16 cases.

- [ ] **Step 5: Run the gates**

```bash
npx tsc --noEmit && npx vitest run && npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/w/[ws]/assets/actions.ts" "src/app/(app)/w/[ws]/assets/actions.test.ts"
git commit -m "feat(assets): add upload, archive, and signed-download server actions

Guard order is asserted: parse, authenticate, capability, quota, policy,
then bytes, then row. A failed insert removes the bytes it just wrote.
Archive is soft for the row and hard for the bytes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Assets page, upload form, list, and navigation

**Files:**
- Create: `src/app/(app)/w/[ws]/assets/page.tsx`
- Create: `src/app/(app)/w/[ws]/assets/upload-form.tsx`
- Create: `src/app/(app)/w/[ws]/assets/asset-list.tsx`
- Modify: `src/lib/nav.ts`
- Modify: `src/lib/nav.test.ts`
- Modify: `src/components/workspace-nav.tsx`

**Interfaces:**
- Consumes: Task 1 (`formatBytes`, `MAX_WORKSPACE_BYTES`), Task 3 (`listAssets`, `workspaceStorageUsed`, `AssetListRow`), Task 4 (`storageConfigured`), Task 6 (all three actions), plus existing `listClients` from `@/db/queries/clients` and `listWorkspaceMembers` from `@/db/queries/memberships`.
- Produces: the `/w/[ws]/assets` route and a registered nav section.

- [ ] **Step 1: Write the failing nav test**

In `src/lib/nav.test.ts`, add a new `describe` block at the end:

```ts
describe("assets section", () => {
  it("is registered live under Brand & Creative, nested below brand-gene", () => {
    const assets = NAV_SECTIONS.find((s) => s.slug === "assets");
    expect(assets).toBeDefined();
    expect(assets?.group).toBe("Brand & Creative");
    expect(assets?.parentSlug).toBe("brand-gene");
    expect(assets?.status).toBe("live");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/nav.test.ts
```

Expected: FAIL — `expect(assets).toBeDefined()` receives `undefined`.

- [ ] **Step 3: Register the nav section and its icon**

In `src/lib/nav.ts`, inside the `// 2. Brand & Creative` block, add immediately after the `drift` line:

```ts
  { slug: "assets", label: "Asset Library", group: "Brand & Creative", status: "live", parentSlug: "brand-gene" },
```

In `src/components/workspace-nav.tsx`, add `FolderOpen` to the existing `lucide-react` import list, and add to the `ICONS` map after the `"brand-gene": Dna,` line:

```ts
  assets: FolderOpen,
```

- [ ] **Step 4: Run the nav test to verify it passes**

```bash
npx vitest run src/lib/nav.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write the upload form**

Create `src/app/(app)/w/[ws]/assets/upload-form.tsx`:

```tsx
"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadAssetAction, type UploadAssetState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Uploading…" : "Upload file"}
    </Button>
  );
}

export function UploadForm({
  workspaceId,
  clients,
}: {
  workspaceId: string;
  clients: { id: string; name: string }[];
}) {
  const [state, formAction] = useFormState<UploadAssetState, FormData>(
    uploadAssetAction,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="workspaceId" value={workspaceId} />

      <div className="space-y-1.5">
        <Label htmlFor="file">File</Label>
        <Input
          id="file"
          name="file"
          type="file"
          accept=".csv,.txt,.md,.pdf,.docx,.xlsx,.png,.jpg,.jpeg,.webp"
          required
        />
        <p className="text-xs text-muted-foreground/70">
          CSV, PDF, Word, Excel, text, Markdown, or an image. Max 10 MB per
          file.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="clientId">Client (optional)</Label>
        <select
          id="clientId"
          name="clientId"
          defaultValue=""
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">Workspace-wide</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      </div>

      {state?.error ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : null}
      {state?.ok ? (
        <p className="text-sm text-brand-teal">{state.ok}</p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
```

- [ ] **Step 6: Write the asset list**

Create `src/app/(app)/w/[ws]/assets/asset-list.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/glass-card";
import { formatBytes, type AssetKind } from "@/lib/assets";
import { archiveAssetAction, getAssetDownloadUrl } from "./actions";

export type AssetRow = {
  id: string;
  filename: string;
  bytes: number;
  kind: AssetKind;
  clientId: string | null;
  uploadedById: string;
  createdAt: Date;
};

const KIND_LABEL: Record<AssetKind, string> = {
  csv: "CSV",
  doc: "Doc",
  image: "Image",
  other: "File",
};

export function AssetList({
  workspaceId,
  assets,
  clientNameById,
  memberNameById,
  canArchive,
}: {
  workspaceId: string;
  assets: AssetRow[];
  clientNameById: Record<string, string>;
  memberNameById: Record<string, string>;
  canArchive: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  /**
   * The signed URL is fetched on click, never rendered into the page. A URL
   * baked into an href at render time would still be live in the HTML long
   * after the reader stopped looking at it.
   */
  function download(assetId: string) {
    setError(null);
    setBusyId(assetId);
    startTransition(async () => {
      const result = await getAssetDownloadUrl(workspaceId, assetId);
      setBusyId(null);
      if (result.error || !result.url) {
        setError(result.error ?? "Could not open that file.");
        return;
      }
      window.open(result.url, "_blank", "noopener,noreferrer");
    });
  }

  function archive(assetId: string) {
    setError(null);
    setBusyId(assetId);
    startTransition(async () => {
      const form = new FormData();
      form.set("workspaceId", workspaceId);
      form.set("assetId", assetId);
      const result = await archiveAssetAction(undefined, form);
      setBusyId(null);
      if (result?.error) setError(result.error);
    });
  }

  if (assets.length === 0) {
    return (
      <GlassCard className="p-5">
        <p className="text-sm text-muted-foreground/70">
          No files yet — upload the first one above.
        </p>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-2">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {assets.map((asset) => (
        <GlassCard key={asset.id} className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-brand-teal/40 bg-brand-teal/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-brand-teal">
                  {KIND_LABEL[asset.kind]}
                </span>
                <p className="truncate text-sm font-medium text-foreground">
                  {asset.filename}
                </p>
              </div>
              <p className="mt-1 font-mono text-xs text-muted-foreground/50">
                {formatBytes(asset.bytes)} ·{" "}
                {asset.clientId
                  ? (clientNameById[asset.clientId] ?? "a client")
                  : "workspace-wide"}{" "}
                · {memberNameById[asset.uploadedById] ?? "a teammate"} ·{" "}
                {asset.createdAt.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busyId === asset.id}
                onClick={() => download(asset.id)}
              >
                {busyId === asset.id ? "Opening…" : "Download"}
              </Button>
              {canArchive ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busyId === asset.id}
                  onClick={() => archive(asset.id)}
                >
                  Archive
                </Button>
              ) : null}
            </div>
          </div>
        </GlassCard>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Write the page**

Create `src/app/(app)/w/[ws]/assets/page.tsx`:

```tsx
import { requireUser } from "@/auth";
import { listAssets, workspaceStorageUsed } from "@/db/queries/assets";
import { listClients } from "@/db/queries/clients";
import { listWorkspaceMembers, requireMembership } from "@/db/queries/memberships";
import { GlassCard } from "@/components/glass-card";
import { PageShell } from "@/components/page-shell";
import { formatBytes, MAX_WORKSPACE_BYTES } from "@/lib/assets";
import { roleCan } from "@/lib/permissions";
import { storageConfigured } from "@/lib/storage";
import { AssetList } from "./asset-list";
import { UploadForm } from "./upload-form";

export const metadata = { title: "Asset Library" };
export const dynamic = "force-dynamic";

export default async function AssetsPage({
  params,
}: {
  params: { ws: string };
}) {
  const user = await requireUser();
  const membership = await requireMembership(params.ws, user.id);

  const [assets, clients, members, usedBytes] = await Promise.all([
    listAssets(params.ws),
    listClients(params.ws),
    listWorkspaceMembers(params.ws),
    workspaceStorageUsed(params.ws),
  ]);

  const clientNameById = Object.fromEntries(
    clients.map((client) => [client.id, client.name]),
  );
  const memberNameById = Object.fromEntries(
    members.map((member) => [member.userId, member.name ?? member.email]),
  );

  const pct = Math.min(
    100,
    Math.round((usedBytes / MAX_WORKSPACE_BYTES) * 100),
  );
  const configured = storageConfigured();

  return (
    <PageShell width="app">
      <div>
        <p className="label-mono text-brand-teal">Asset Library</p>
        <h1 className="mt-2 font-display text-4xl">
          The workspace&apos;s files
        </h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground/70">
          Client CSVs, brand guideline PDFs, briefs, and reference images —
          held per workspace, shared with the team, and never public. Files
          are served through short-lived links, not public URLs.
        </p>

        <GlassCard className="mt-6 p-5">
          <div className="flex items-baseline justify-between">
            <p className="label-mono text-muted-foreground/70">Storage used</p>
            <p className="font-mono text-xs text-muted-foreground/70">
              {formatBytes(usedBytes)} of {formatBytes(MAX_WORKSPACE_BYTES)}
            </p>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
            {/* Width is a runtime value Tailwind cannot express — the one
                inline-style exception allowed by CLAUDE.md. */}
            <div
              className="h-full rounded-full bg-brand-teal transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </GlassCard>

        {configured ? (
          <GlassCard className="mt-4 p-5">
            <p className="label-mono text-muted-foreground/70">Upload</p>
            <div className="mt-3">
              <UploadForm workspaceId={params.ws} clients={clients} />
            </div>
          </GlassCard>
        ) : (
          <GlassCard className="mt-4 p-5">
            <p className="label-mono text-brand-amber">
              Storage not configured
            </p>
            <p className="mt-2 text-sm text-muted-foreground/70">
              File uploads are turned off because{" "}
              <span className="font-mono text-xs">
                SUPABASE_SERVICE_ROLE_KEY
              </span>{" "}
              is not set. Existing files are unaffected. Set it in the
              environment and reload to enable uploads.
            </p>
          </GlassCard>
        )}

        <div className="mt-8">
          <p className="label-mono text-muted-foreground/70">Files</p>
          <div className="mt-3">
            <AssetList
              workspaceId={params.ws}
              assets={assets}
              clientNameById={clientNameById}
              memberNameById={memberNameById}
              canArchive={roleCan(membership.role, "asset.delete")}
            />
          </div>
        </div>
      </div>
    </PageShell>
  );
}
```

> Both query signatures were verified against the codebase on 2026-09-03 and need no change: `listClients(workspaceId)` returns full `clients` rows (so `id` and `name` are present), and `listWorkspaceMembers(workspaceId)` returns `{ userId, name, email }`. Do not modify either query module.

- [ ] **Step 8: Run the gates**

```bash
npx tsc --noEmit && npx vitest run && npm run lint
```

Expected: all green.

- [ ] **Step 9: Drive it in a browser**

```bash
npm run dev
```

Open `http://localhost:3000/w/d89220ec-6e93-4cbf-9976-9e078fe11918/assets` and confirm all six:
1. The page renders with the storage meter at 0 B.
2. "Asset Library" appears in the sidebar, indented under Brand DNA & Vault.
3. Uploading a small CSV succeeds and the file appears in the list.
4. Download opens the file in a new tab.
5. Archive removes it from the list and the meter returns to 0 B.
6. Temporarily unset `SUPABASE_SERVICE_ROLE_KEY`, restart, reload: the page still renders and shows "Storage not configured" instead of crashing. Restore the key afterwards.

- [ ] **Step 10: Commit**

```bash
git add "src/app/(app)/w/[ws]/assets/" src/lib/nav.ts src/lib/nav.test.ts src/components/workspace-nav.tsx
git commit -m "feat(assets): add Asset Library page, upload form, and nav entry

Nested under Brand DNA & Vault. Signed URLs are fetched on click rather
than rendered into the page. Missing storage config degrades to a visible
notice with the list still readable.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: End-to-end proof and documentation

**Files:**
- Modify: `e2e/smoke.spec.ts`
- Modify: `docs/IA-ROUTE-INVENTORY.md`
- Modify: `docs/ENHANCEMENTS.md`

**Interfaces:**
- Consumes: the live `/assets` route from Task 7.
- Produces: no code interfaces — this task proves and records.

- [ ] **Step 1: Write the failing E2E test**

Append to `e2e/smoke.spec.ts`:

```ts
test("assets page renders the library, not a 404", async ({ page }) => {
  const response = await page.goto(workspacePath("assets"), {
    waitUntil: "domcontentloaded",
  });
  expect(response?.ok()).toBeTruthy();

  // Real content from src/app/(app)/w/[ws]/assets/page.tsx.
  await expect(
    page.getByRole("heading", { name: "The workspace's files", level: 1 }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Storage used")).toBeVisible();

  // The [ws] param is a UUID and notFound() returns HTTP 200, so the status
  // code proves nothing on its own — this check is load-bearing.
  await expect(page.getByText(NOT_FOUND_TEXT)).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(NOT_FOUND_TEXT);
});
```

- [ ] **Step 2: Run the E2E suite**

```bash
npm run test:e2e
```

Expected: both smoke tests PASS. Playwright starts `npm run dev` itself via `webServer`.

- [ ] **Step 3: Record the new route in the IA inventory**

In `docs/IA-ROUTE-INVENTORY.md`:

Add to the Pillar 2 tree, directly under the `Brand DNA & Vault` entry, aligned with its existing `Brand Drift Radar` child:

```
│   └── Asset Library (/assets)
```

Add a row to the route table after row 13 (`drift`), and renumber nothing else — append it as row 31 at the end of the table instead if renumbering would touch other rows:

```
| 31 | `assets` | Brand & Creative | **Nest** | `brand-gene` | `/w/[ws]/assets` | Workspace file storage — client CSVs, guideline PDFs, briefs, reference images. Private bucket, signed-URL reads, 250 MB per workspace. |
```

Under **Architectural Guarantees**, append:

```
5. **Route count is now 31.** `assets` was added, nothing was removed or renamed.
```

- [ ] **Step 4: Record what Slice 1 did and did not do**

In `docs/ENHANCEMENTS.md`, add a new section at the end:

```markdown
## 🟠 Workspace assets — shipped and remaining

**Shipped (Slice 1, 2026-09-03):** `assets` table + private Supabase Storage
bucket, `/w/[ws]/assets` page, upload/archive/signed-download actions,
`asset.upload` + `asset.delete` capabilities, 10 MB per file and 250 MB per
workspace. Spec: `docs/superpowers/specs/2026-09-03-assets-and-saas-gap-audit-design.md`.

**A1. Slice 2 — Knowledge Base ingest from an uploaded file.**
`knowledge_sources` today accepts a URL or a workspace doc. Adding
`source_kind = 'asset'` + an `asset_id` column lets the existing chunk and
embed pipeline read an uploaded PDF or Markdown brief. This is the change
that puts a client's own guidelines behind Brand DNA and the compliance
meter, which is the difference between this product and a prompt wrapper.

**A2. Slice 3 — attachments.** `assets.linked_type` / `linked_id` exist and
are unused. Wiring them to tickets, direct messages, and Studio drafts makes
the file library reachable from the surfaces where people actually work.
`direct_messages.attachments` is an empty jsonb column waiting for this.

**A3. Quota is a constant, not a plan.** `MAX_WORKSPACE_BYTES` in
`src/lib/assets.ts` is 250 MB for every workspace. When plan tiers land it
becomes a per-workspace value; every caller already goes through
`checkAssetUpload()`, so that is a one-file change.

**A4. SVG is deliberately not accepted.** An SVG can carry inline script and
we serve files from a signed URL on a real origin. Re-enabling it is an
owner decision — add `"image/svg+xml": "image"` to `MIME_KIND` in
`src/lib/assets.ts` and the test that asserts its absence will tell you.
```

- [ ] **Step 5: Run the full gates one final time**

```bash
npx tsc --noEmit && npx vitest run && npm run lint && npm run test:e2e
```

Expected: all four green.

- [ ] **Step 6: Commit**

```bash
git add e2e/smoke.spec.ts docs/IA-ROUTE-INVENTORY.md docs/ENHANCEMENTS.md
git commit -m "test(assets): prove the assets route end-to-end and record slice 1

Route inventory is now 31 routes; nothing removed or renamed. ENHANCEMENTS
records slices 2 and 3, the constant quota, and the deliberate SVG refusal.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage** — every requirement in §2 of the spec maps to a task:

| Spec requirement | Task |
|---|---|
| Approach A: Supabase Storage, private bucket, server-side, service-role key | 4 |
| Data model: all 13 columns, path `ws/{workspace_id}/{asset_id}` | 1 (path), 2 (table) |
| Isolation: workspace_id in row and path, filter asserted in SQL | 2, 3 |
| Limits: 10 MB per file, 250 MB per workspace, quota sums non-archived | 1, 3 |
| Mime allowlist | 1 (SVG excluded — deviation, flagged) |
| Route `/w/[ws]/assets`, nested under brand-gene, client filter, kind filter, meter, upload, archive | 3 (filters), 7 (page) |
| Capabilities `asset.upload` / `asset.delete`, membership before storage | 5, 6 |
| Actions: upload, archive, signed URL 60 s TTL, no public URLs | 4, 6 |
| Degradation: missing key renders a notice, never crashes | 4, 7 |
| Tests: query isolation, quota/mime/size/membership rejection, E2E | 1, 3, 6, 8 |

**Deviations from the spec, both deliberate and both reversible:**
1. **SVG removed from the allowlist.** The spec listed it. It is an executable document served from a real origin. Recorded in `ENHANCEMENTS.md` A4 with the exact one-line change to re-enable.
2. **Filename removed from the storage path.** The spec said the path is `ws/{workspace_id}/{asset_id}`; this plan keeps that literally and stores the display name only in the DB column, so no user-supplied string ever reaches a path.

**Placeholder scan:** no TBD, no "add error handling", no "similar to Task N". Every code step carries real code.

**Type consistency:** `AssetKind` is defined once in Task 1 and imported by Tasks 3, 6, 7. `storagePathFor(workspaceId, assetId)` has the same two-argument signature everywhere. `createAsset` takes `id` in Task 3's definition and receives it in Task 6's call. `archiveAsset` returns `string | null` in Task 3 and is consumed as such in Task 6.

**Nothing is deleted.** No file is removed, no route is removed, no feature is disabled. The only behaviour change to existing code is additive: two new capabilities, one new nav row, one new branch in `actionErrorMessage`, one doc comment in `env.ts`.

---

## Out of scope for this plan

These are real and prioritised in the spec, but each needs its own spec → plan cycle. Do not fold them in here.

- **P0-1 Deploy to Vercel.** Blocked on owner authorisation, not on code.
- **P0-3 Fix E2** (an assigned SOP step notifies nobody). A separate subsystem — notifications, My Work, Calendar. Highest-value next plan.
- **Slices 2 and 3** (KB ingest from a file; attachments), recorded in `ENHANCEMENTS.md` by Task 8.
- **Billing and plan tiers**, which need a stack decision from the owner first.
