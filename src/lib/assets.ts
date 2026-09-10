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

/** A select that submits "" for "no client", or omitted formData fields (null) */
const optionalId = z.preprocess(
  (value) =>
    value === null || value === undefined || (typeof value === "string" && value.trim() === "")
      ? undefined
      : value,
  z.string().min(1).optional(),
);

export const uploadAssetSchema = z.object({
  workspaceId: z.string().min(1, "Missing workspace."),
  clientId: optionalId,
  linkedType: optionalId,
  linkedId: optionalId,
});

export const archiveAssetSchema = z.object({
  workspaceId: z.string().min(1, "Missing workspace."),
  assetId: z.string().min(1, "Missing asset."),
});

export const linkAssetSchema = z.object({
  workspaceId: z.string().min(1, "Missing workspace."),
  assetId: z.string().min(1, "Missing asset."),
  linkedType: z.string().min(1, "Missing linked type."),
  linkedId: z.string().min(1, "Missing linked id."),
});

export const unlinkAssetSchema = z.object({
  workspaceId: z.string().min(1, "Missing workspace."),
  assetId: z.string().min(1, "Missing asset."),
});
