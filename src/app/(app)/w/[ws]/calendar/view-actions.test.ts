import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/db/queries/memberships", () => ({ requireMembership: vi.fn() }));
vi.mock("@/db/queries/plan-views", () => ({ savePlanView: vi.fn() }));

const { requireUser } = await import("@/auth");
const { requireMembership } = await import("@/db/queries/memberships");
const { savePlanView } = await import("@/db/queries/plan-views");
const { savePlanViewAction } = await import("./view-actions");

const requireUserMock = requireUser as unknown as Mock;
const requireMembershipMock = requireMembership as unknown as Mock;
const savePlanViewMock = savePlanView as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ id: "user_1" });
  requireMembershipMock.mockResolvedValue({ role: "member" });
  savePlanViewMock.mockResolvedValue(undefined);
});

describe("savePlanViewAction — input shape", () => {
  it("rejects a missing workspace id without touching auth", async () => {
    const result = await savePlanViewAction({
      workspaceId: "",
      scope: "all",
      grouping: "none",
    });
    expect(result).toEqual({ ok: false, error: "Missing view details." });
    expect(requireUserMock).not.toHaveBeenCalled();
    expect(savePlanViewMock).not.toHaveBeenCalled();
  });

  it("rejects an unrecognized scope before touching auth", async () => {
    const result = await savePlanViewAction({
      workspaceId: "ws_1",
      scope: "everything",
      grouping: "none",
    });
    expect(result).toEqual({
      ok: false,
      error: "Unrecognized view — reload and try again.",
    });
    expect(requireUserMock).not.toHaveBeenCalled();
    expect(savePlanViewMock).not.toHaveBeenCalled();
  });

  it("rejects an unrecognized grouping before touching auth", async () => {
    const result = await savePlanViewAction({
      workspaceId: "ws_1",
      scope: "all",
      grouping: "by-vibes",
    });
    expect(result.ok).toBe(false);
    expect(savePlanViewMock).not.toHaveBeenCalled();
  });
});

describe("savePlanViewAction — membership guard", () => {
  it("checks membership before ever writing", async () => {
    requireMembershipMock.mockRejectedValue(
      new Error("Not a member of this workspace"),
    );
    const result = await savePlanViewAction({
      workspaceId: "ws_1",
      scope: "all",
      grouping: "none",
    });
    expect(result.ok).toBe(false);
    expect(savePlanViewMock).not.toHaveBeenCalled();
  });
});

describe("savePlanViewAction — session identity", () => {
  it("saves under the session user's id, never a client-supplied one", async () => {
    requireUserMock.mockResolvedValue({ id: "user_from_session" });

    await savePlanViewAction({
      workspaceId: "ws_1",
      scope: "client",
      clientId: "client_1",
      grouping: "status",
      // The input type has no field for "whose view this is" at all — this
      // proves a crafted extra property can't reach the write either.
      ...({ userId: "someone_else" } as Record<string, unknown>),
    } as never);

    expect(savePlanViewMock).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      userId: "user_from_session",
      scope: "client",
      clientId: "client_1",
      targetUserId: undefined,
      grouping: "status",
      hiddenColumns: undefined,
    });
  });
});

describe("savePlanViewAction — happy path", () => {
  it("saves scope, grouping, and hidden columns together", async () => {
    const result = await savePlanViewAction({
      workspaceId: "ws_1",
      scope: "person",
      targetUserId: "user_2",
      grouping: "pillar",
      hiddenColumns: ["field_1", "field_2"],
    });

    expect(result).toEqual({ ok: true });
    expect(savePlanViewMock).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      userId: "user_1",
      scope: "person",
      clientId: undefined,
      targetUserId: "user_2",
      grouping: "pillar",
      hiddenColumns: ["field_1", "field_2"],
    });
    expect(requireMembershipMock).toHaveBeenCalledWith("ws_1", "user_1");
  });
});
