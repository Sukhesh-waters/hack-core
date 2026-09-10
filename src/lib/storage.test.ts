import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const upload = vi.fn();
const remove = vi.fn();
const createSignedUrl = vi.fn();
const download = vi.fn();
const from = vi.fn(() => ({ upload, remove, createSignedUrl, download }));
const createClient = vi.fn(() => ({ storage: { from } }));

vi.mock("@supabase/supabase-js", () => ({ createClient }));

const {
  ASSETS_BUCKET,
  StorageError,
  __resetStorageClientForTests,
  getObject,
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
    await expect(
      putObject("ws/a/b", new ArrayBuffer(4), "text/csv"),
    ).rejects.toThrowError(StorageError);
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

describe("getObject", () => {
  it("downloads the bytes from the bucket", async () => {
    const mockBuffer = new ArrayBuffer(8);
    const mockBlob = { arrayBuffer: vi.fn().mockResolvedValue(mockBuffer) };
    download.mockResolvedValue({ data: mockBlob, error: null });

    const buffer = await getObject("ws/ws_1/as_1");

    expect(from).toHaveBeenCalledWith(ASSETS_BUCKET);
    expect(download).toHaveBeenCalledWith("ws/ws_1/as_1");
    expect(buffer).toBe(mockBuffer);
  });

  it("turns a download failure into a StorageError", async () => {
    download.mockResolvedValue({ data: null, error: { message: "File not found" } });

    await expect(getObject("ws/ws_1/as_1")).rejects.toMatchObject({
      name: "StorageError",
      message: expect.stringContaining("File not found"),
    });
  });

  it("throws StorageError when data is missing", async () => {
    download.mockResolvedValue({ data: null, error: null });

    await expect(getObject("ws/ws_1/as_1")).rejects.toMatchObject({
      name: "StorageError",
      message: expect.stringContaining("returned no data"),
    });
  });
});
