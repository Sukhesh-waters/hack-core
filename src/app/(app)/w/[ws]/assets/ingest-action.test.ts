import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/db/queries/memberships", () => ({ requireMembership: vi.fn() }));
vi.mock("@/db/queries/clients", () => ({ getClientById: vi.fn() }));
vi.mock("@/db/queries/assets", () => ({ getAssetById: vi.fn() }));
vi.mock("@/db/queries/knowledge", () => ({
  createAssetKnowledgeSource: vi.fn(),
  insertKnowledgeChunks: vi.fn(),
  updateKnowledgeSource: vi.fn(),
}));
vi.mock("@/lib/storage", () => ({ getObject: vi.fn() }));
vi.mock("@/lib/asset-extract", () => ({
  extractTextFromAsset: vi.fn(),
  isIngestibleMime: vi.fn(),
}));
vi.mock("@/lib/knowledge-ingest", () => ({ chunkText: vi.fn() }));
vi.mock("@/lib/ai/router", () => ({ routeAI: vi.fn() }));
vi.mock("@/lib/ai/usage-context", () => ({
  runWithAiCost: vi.fn((_ctx, fn) => fn()),
}));

const { requireUser } = await import("@/auth");
const { requireMembership } = await import("@/db/queries/memberships");
const { getClientById } = await import("@/db/queries/clients");
const { getAssetById } = await import("@/db/queries/assets");
const {
  createAssetKnowledgeSource,
  insertKnowledgeChunks,
  updateKnowledgeSource,
} = await import("@/db/queries/knowledge");
const { getObject } = await import("@/lib/storage");
const { extractTextFromAsset, isIngestibleMime } = await import(
  "@/lib/asset-extract"
);
const { chunkText } = await import("@/lib/knowledge-ingest");
const { routeAI } = await import("@/lib/ai/router");
const { ingestAssetToKnowledgeBaseAction } = await import("./ingest-action");

const requireUserMock = requireUser as unknown as Mock;
const requireMembershipMock = requireMembership as unknown as Mock;
const getClientByIdMock = getClientById as unknown as Mock;
const getAssetByIdMock = getAssetById as unknown as Mock;
const createAssetKnowledgeSourceMock =
  createAssetKnowledgeSource as unknown as Mock;
const insertKnowledgeChunksMock = insertKnowledgeChunks as unknown as Mock;
const updateKnowledgeSourceMock = updateKnowledgeSource as unknown as Mock;
const getObjectMock = getObject as unknown as Mock;
const extractTextMock = extractTextFromAsset as unknown as Mock;
const isIngestibleMimeMock = isIngestibleMime as unknown as Mock;
const chunkTextMock = chunkText as unknown as Mock;
const routeAIMock = routeAI as unknown as Mock;

function makeForm(ws = "ws_1", client = "c_1", asset = "as_1") {
  const form = new FormData();
  form.set("workspaceId", ws);
  form.set("clientId", client);
  form.set("assetId", asset);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ id: "user_1" });
  requireMembershipMock.mockResolvedValue({ role: "member" });
  getClientByIdMock.mockResolvedValue({ id: "c_1", name: "Acme Corp" });
  getAssetByIdMock.mockResolvedValue({
    id: "as_1",
    filename: "guidelines.pdf",
    mime: "application/pdf",
    storagePath: "ws/ws_1/as_1",
    archivedAt: null,
  });
  isIngestibleMimeMock.mockReturnValue(true);
  createAssetKnowledgeSourceMock.mockResolvedValue({ id: "source_1" });
  getObjectMock.mockResolvedValue(new ArrayBuffer(100));
  extractTextMock.mockResolvedValue("Valid guidelines text content");
  chunkTextMock.mockReturnValue(["Chunk 1", "Chunk 2"]);
  routeAIMock.mockResolvedValue([[0.1, 0.2], [0.3, 0.4]]);
});

describe("ingestAssetToKnowledgeBaseAction — happy path", () => {
  it("downloads bytes, extracts text, chunks, embeds, and updates source to ready", async () => {
    const result = await ingestAssetToKnowledgeBaseAction(
      undefined,
      makeForm(),
    );

    expect(result?.error).toBeUndefined();
    expect(result?.ok).toContain("guidelines.pdf");
    expect(getObjectMock).toHaveBeenCalledWith("ws/ws_1/as_1");
    expect(extractTextMock).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      "application/pdf",
      "guidelines.pdf",
    );
    expect(insertKnowledgeChunksMock).toHaveBeenCalledTimes(1);
    expect(updateKnowledgeSourceMock).toHaveBeenCalledWith(
      "ws_1",
      "source_1",
      expect.objectContaining({
        status: "ready",
        chunkCount: 2,
      }),
    );
  });
});

describe("ingestAssetToKnowledgeBaseAction — guards", () => {
  it("refuses unauthenticated calls", async () => {
    requireUserMock.mockRejectedValue(new Error("Unauthenticated"));
    const result = await ingestAssetToKnowledgeBaseAction(
      undefined,
      makeForm(),
    );
    expect(result?.error).toBeTruthy();
    expect(createAssetKnowledgeSourceMock).not.toHaveBeenCalled();
  });

  it("refuses callers outside the workspace", async () => {
    requireMembershipMock.mockRejectedValue(new Error("Not a member"));
    const result = await ingestAssetToKnowledgeBaseAction(
      undefined,
      makeForm(),
    );
    expect(result?.error).toBeTruthy();
    expect(createAssetKnowledgeSourceMock).not.toHaveBeenCalled();
  });

  it("refuses if client does not belong to workspace", async () => {
    getClientByIdMock.mockResolvedValue(null);
    const result = await ingestAssetToKnowledgeBaseAction(
      undefined,
      makeForm(),
    );
    expect(result?.error).toContain("Client not found");
    expect(createAssetKnowledgeSourceMock).not.toHaveBeenCalled();
  });

  it("refuses an archived asset", async () => {
    getAssetByIdMock.mockResolvedValue({
      id: "as_1",
      filename: "old.pdf",
      archivedAt: new Date(),
    });
    const result = await ingestAssetToKnowledgeBaseAction(
      undefined,
      makeForm(),
    );
    expect(result?.error).toContain("archived");
    expect(createAssetKnowledgeSourceMock).not.toHaveBeenCalled();
  });

  it("refuses non-ingestible mime types (e.g. images)", async () => {
    isIngestibleMimeMock.mockReturnValue(false);
    const result = await ingestAssetToKnowledgeBaseAction(
      undefined,
      makeForm(),
    );
    expect(result?.error).toContain("cannot be ingested");
    expect(createAssetKnowledgeSourceMock).not.toHaveBeenCalled();
  });
});

describe("ingestAssetToKnowledgeBaseAction — fail-soft", () => {
  it("marks source as failed when extraction or embedding throws", async () => {
    extractTextMock.mockRejectedValue(
      new Error("Extraction failed: Corrupted PDF structure"),
    );

    const result = await ingestAssetToKnowledgeBaseAction(
      undefined,
      makeForm(),
    );

    expect(result?.error).toContain("Corrupted PDF structure");
    expect(updateKnowledgeSourceMock).toHaveBeenCalledWith(
      "ws_1",
      "source_1",
      expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("Corrupted PDF structure"),
      }),
    );
  });
});
