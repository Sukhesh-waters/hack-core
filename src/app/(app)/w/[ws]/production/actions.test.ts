import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/db/queries/memberships", () => ({ requireMembership: vi.fn() }));
vi.mock("@/db/queries/clients", () => ({ getClientById: vi.fn() }));
vi.mock("@/db/queries/production", () => ({
  advanceStage: vi.fn(),
  createProductionCard: vi.fn(),
}));
vi.mock("@/db/queries/workflow", () => ({
  transitionContent: vi.fn(),
}));
vi.mock("@/lib/events/dispatch", () => ({
  emitDomainEvent: vi.fn(),
}));

const { revalidatePath } = await import("next/cache");
const { requireUser } = await import("@/auth");
const { requireMembership } = await import("@/db/queries/memberships");
const { getClientById } = await import("@/db/queries/clients");
const { advanceStage, createProductionCard } = await import("@/db/queries/production");
const { transitionContent } = await import("@/db/queries/workflow");
const { emitDomainEvent } = await import("@/lib/events/dispatch");

const {
  transitionContentAction,
  advanceProductionStageAction,
  createProductionCardAction,
} = await import("./actions");

const revalidateMock = revalidatePath as unknown as Mock;
const requireUserMock = requireUser as unknown as Mock;
const requireMembershipMock = requireMembership as unknown as Mock;
const getClientByIdMock = getClientById as unknown as Mock;
const advanceStageMock = advanceStage as unknown as Mock;
const createProductionCardMock = createProductionCard as unknown as Mock;
const transitionContentMock = transitionContent as unknown as Mock;
const emitDomainEventMock = emitDomainEvent as unknown as Mock;

const WS = "ws-prod-test";
const USER = { id: "u_1", email: "editor@test.com" };
const MEMBERSHIP = { userId: USER.id, role: "editor" as const };

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue(USER);
  requireMembershipMock.mockResolvedValue(MEMBERSHIP);
  revalidateMock.mockReturnValue(undefined);
  emitDomainEventMock.mockResolvedValue(undefined);
});

describe("transitionContentAction", () => {
  it("rejects when required form fields are missing", async () => {
    const fd = new FormData();
    fd.set("workspaceId", WS);
    // missing contentId and toStateId
    const res = await transitionContentAction(undefined, fd);
    expect(res?.error).toBeDefined();
    expect(transitionContentMock).not.toHaveBeenCalled();
  });

  it("handles authentication failure", async () => {
    requireUserMock.mockRejectedValueOnce(new Error("Unauthorized"));
    const fd = new FormData();
    fd.set("workspaceId", WS);
    fd.set("contentId", "c_1");
    fd.set("toStateId", "state_2");

    const res = await transitionContentAction(undefined, fd);
    expect(res?.error).toBe("Something went wrong. Please try again.");
    expect(transitionContentMock).not.toHaveBeenCalled();
  });

  it("returns error when workflow engine transition rejects", async () => {
    transitionContentMock.mockResolvedValueOnce({
      ok: false,
      error: "Stage transition not allowed.",
    });

    const fd = new FormData();
    fd.set("workspaceId", WS);
    fd.set("contentId", "c_1");
    fd.set("toStateId", "state_invalid");

    const res = await transitionContentAction(undefined, fd);
    expect(res?.error).toBe("Stage transition not allowed.");
    expect(emitDomainEventMock).not.toHaveBeenCalled();
  });

  it("successfully transitions content and dispatches content.transitioned domain event", async () => {
    transitionContentMock.mockResolvedValueOnce({
      ok: true,
      toStateId: "state_review",
      toName: "Internal Review",
    });

    const fd = new FormData();
    fd.set("workspaceId", WS);
    fd.set("contentId", "c_1");
    fd.set("toStateId", "state_review");

    const res = await transitionContentAction(undefined, fd);
    expect(res).toBeUndefined();

    expect(transitionContentMock).toHaveBeenCalledWith({
      workspaceId: WS,
      contentId: "c_1",
      toStateId: "state_review",
      actorId: USER.id,
      actorRole: "editor",
    });

    expect(emitDomainEventMock).toHaveBeenCalledWith({
      verb: "content.transitioned",
      workspaceId: WS,
      subjectType: "content",
      subjectId: "c_1",
      actorId: USER.id,
      meta: { toStateId: "state_review", toName: "Internal Review" },
    });

    expect(revalidateMock).toHaveBeenCalledWith(`/w/${WS}/production`);
    expect(revalidateMock).toHaveBeenCalledWith(`/w/${WS}/calendar`);
  });
});

describe("advanceProductionStageAction", () => {
  it("rejects invalid stage values", async () => {
    const fd = new FormData();
    fd.set("workspaceId", WS);
    fd.set("contentId", "c_1");
    fd.set("from", "invalid_from");
    fd.set("to", "invalid_to");

    const res = await advanceProductionStageAction(undefined, fd);
    expect(res?.error).toBeDefined();
    expect(advanceStageMock).not.toHaveBeenCalled();
  });

  it("advances stage and emits content.stage_advanced event", async () => {
    advanceStageMock.mockResolvedValueOnce(undefined);

    const fd = new FormData();
    fd.set("workspaceId", WS);
    fd.set("contentId", "c_1");
    fd.set("from", "brief");
    fd.set("to", "in_progress");

    const res = await advanceProductionStageAction(undefined, fd);
    expect(res).toBeUndefined();

    expect(advanceStageMock).toHaveBeenCalledWith({
      workspaceId: WS,
      contentId: "c_1",
      from: "brief",
      to: "in_progress",
      actorId: USER.id,
    });

    expect(emitDomainEventMock).toHaveBeenCalledWith({
      verb: "content.stage_advanced",
      workspaceId: WS,
      subjectType: "content",
      subjectId: "c_1",
      actorId: USER.id,
      meta: { from: "brief", to: "in_progress" },
    });

    expect(revalidateMock).toHaveBeenCalledWith(`/w/${WS}/production`);
  });
});

describe("createProductionCardAction", () => {
  it("rejects empty title", async () => {
    const fd = new FormData();
    fd.set("workspaceId", WS);
    fd.set("clientId", "client_1");
    fd.set("title", "   ");
    fd.set("type", "post");

    const res = await createProductionCardAction(undefined, fd);
    expect(res?.error).toBe("Give the card a title.");
    expect(createProductionCardMock).not.toHaveBeenCalled();
  });

  it("rejects when client is not in workspace", async () => {
    getClientByIdMock.mockResolvedValueOnce(null);

    const fd = new FormData();
    fd.set("workspaceId", WS);
    fd.set("clientId", "client_unknown");
    fd.set("title", "New Shoot Video");
    fd.set("type", "reel");

    const res = await createProductionCardAction(undefined, fd);
    expect(res?.error).toBe("Client not found in this workspace.");
    expect(createProductionCardMock).not.toHaveBeenCalled();
  });

  it("creates card and emits content.created event", async () => {
    getClientByIdMock.mockResolvedValueOnce({ id: "client_1", name: "Client A" });
    createProductionCardMock.mockResolvedValueOnce("c_new_123");

    const fd = new FormData();
    fd.set("workspaceId", WS);
    fd.set("clientId", "client_1");
    fd.set("title", "Brand Launch Reel");
    fd.set("type", "reel");

    const res = await createProductionCardAction(undefined, fd);
    expect(res).toBeUndefined();

    expect(createProductionCardMock).toHaveBeenCalledWith({
      workspaceId: WS,
      clientId: "client_1",
      title: "Brand Launch Reel",
      type: "reel",
    });

    expect(emitDomainEventMock).toHaveBeenCalledWith({
      verb: "content.created",
      workspaceId: WS,
      subjectType: "content",
      subjectId: "c_new_123",
      actorId: USER.id,
      meta: { title: "Brand Launch Reel", type: "reel", clientId: "client_1" },
    });

    expect(revalidateMock).toHaveBeenCalledWith(`/w/${WS}/production`);
  });
});
