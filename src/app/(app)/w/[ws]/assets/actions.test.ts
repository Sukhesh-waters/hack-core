import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/db/queries/memberships", () => ({ requireCapability: vi.fn() }));
vi.mock("@/db/queries/assets", () => ({
  createAsset: vi.fn(),
  archiveAsset: vi.fn(),
  getAssetById: vi.fn(),
  linkAsset: vi.fn(),
  unlinkAsset: vi.fn(),
  workspaceStorageUsed: vi.fn(),
}));
vi.mock("@/lib/storage", () => ({
  putObject: vi.fn(),
  removeObject: vi.fn(),
  signedUrlFor: vi.fn(),
}));

const { requireUser } = await import("@/auth");
const { requireCapability } = await import("@/db/queries/memberships");
const { archiveAsset, createAsset, getAssetById, linkAsset, unlinkAsset, workspaceStorageUsed } =
  await import("@/db/queries/assets");
const { putObject, removeObject, signedUrlFor } = await import("@/lib/storage");
const { archiveAssetAction, getAssetDownloadUrl, linkAssetAction, unlinkAssetAction, uploadAssetAction } =
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

describe("uploadAssetAction — linked items", () => {
  it("persists linkedType and linkedId when provided", async () => {
    const form = uploadForm(csvFile());
    form.set("linkedType", "ticket");
    form.set("linkedId", "tick_123");

    const state = await uploadAssetAction(undefined, form);

    expect(state?.error).toBeUndefined();
    expect(createAssetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        linkedType: "ticket",
        linkedId: "tick_123",
      }),
    );
  });
});

describe("linkAssetAction & unlinkAssetAction", () => {
  it("linkAssetAction links an asset to a target entity", async () => {
    const form = new FormData();
    form.set("workspaceId", "ws_1");
    form.set("assetId", "as_1");
    form.set("linkedType", "content");
    form.set("linkedId", "content_456");

    const state = await linkAssetAction(undefined, form);

    expect(state?.error).toBeUndefined();
    expect(linkAsset).toHaveBeenCalledWith("ws_1", "as_1", "content", "content_456");
  });

  it("unlinkAssetAction detaches an asset from an entity", async () => {
    const form = new FormData();
    form.set("workspaceId", "ws_1");
    form.set("assetId", "as_1");
    form.set("linkedType", "ticket");
    form.set("linkedId", "tick_123");

    const state = await unlinkAssetAction(undefined, form);

    expect(state?.error).toBeUndefined();
    expect(unlinkAsset).toHaveBeenCalledWith("ws_1", "as_1");
  });
});
