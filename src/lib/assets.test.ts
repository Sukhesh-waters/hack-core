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
