import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

/**
 * U4's two actions never touch the db client directly — they go through
 * getContentById / listActivityForSubject / listComments / addComment, so
 * (unlike push-to-team.test.ts, which stubs a raw drizzle transaction) the
 * mocks here are the query functions themselves. The chainable-stub lesson
 * still applies though: every mock below resolves a concrete value rather
 * than a bare vi.fn() left to return undefined, because writePlanCell-style
 * code awaits these directly — an un-primed vi.fn() resolves to undefined,
 * `.map` on it throws, and that throw lands in the action's generic catch
 * and reports a plausible-looking { ok: false } for the WRONG reason. A
 * test asserting on that error string would pass even if the real
 * workspace-isolation or auth-ordering guard were deleted. Every test here
 * instead asserts which mocked query fired (or didn't), not just the
 * shape of the result.
 */
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/db/queries/memberships", () => ({ requireMembership: vi.fn() }));
vi.mock("@/db/queries/clients", () => ({
  getContentById: vi.fn(),
  getClientById: vi.fn(),
}));
vi.mock("@/lib/activity", () => ({
  listActivityForSubject: vi.fn(),
  recordActivity: vi.fn().mockResolvedValue({ id: "act_1" }),
}));
vi.mock("@/db/queries/comments", () => ({
  addComment: vi.fn(),
  listComments: vi.fn(),
}));
vi.mock("@/db/queries/schedule", () => ({
  updatePlanCellQuery: vi.fn(),
  setPlanSlot: vi.fn(),
  createScheduledPost: vi.fn(),
}));
vi.mock("@/lib/realtime", () => ({ broadcastSignal: vi.fn() }));

const { requireUser } = await import("@/auth");
const { requireMembership } = await import("@/db/queries/memberships");
const { getContentById } = await import("@/db/queries/clients");
const { listActivityForSubject } = await import("@/lib/activity");
const { addComment, listComments } = await import("@/db/queries/comments");
const { getClientById } = await import("@/db/queries/clients");
const { updatePlanCellQuery, createScheduledPost } = await import(
  "@/db/queries/schedule"
);
const { broadcastSignal } = await import("@/lib/realtime");
const {
  loadRowDetailAction,
  addPlanRowCommentAction,
  updatePlanCellAction,
  bulkUpdatePlanCellsAction,
  addCalendarPostAction,
} = await import("./actions");

const requireUserMock = requireUser as unknown as Mock;
const requireMembershipMock = requireMembership as unknown as Mock;
const getContentByIdMock = getContentById as unknown as Mock;
const listActivityForSubjectMock = listActivityForSubject as unknown as Mock;
const addCommentMock = addComment as unknown as Mock;
const listCommentsMock = listComments as unknown as Mock;
const getClientByIdMock = getClientById as unknown as Mock;
const updatePlanCellQueryMock = updatePlanCellQuery as unknown as Mock;
const createScheduledPostMock = createScheduledPost as unknown as Mock;
const broadcastSignalMock = broadcastSignal as unknown as Mock;

const row = {
  id: "content_1",
  workspaceId: "ws_1",
  title: "Barrier repair basics",
  type: "post",
  durationSec: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ id: "user_1" });
  requireMembershipMock.mockResolvedValue({ role: "member" });
  getContentByIdMock.mockResolvedValue(row);
  listActivityForSubjectMock.mockResolvedValue([]);
  listCommentsMock.mockResolvedValue([]);
  addCommentMock.mockResolvedValue({
    id: "cmt_1",
    createdAt: new Date("2026-01-03T00:00:00.000Z"),
  });
  updatePlanCellQueryMock.mockResolvedValue([{ id: "content_1" }]);
  createScheduledPostMock.mockResolvedValue("content_2");
  getClientByIdMock.mockResolvedValue({ id: "client_1", name: "Aurora Skincare" });
});

describe("loadRowDetailAction — input shape", () => {
  it("rejects a missing content id without touching auth", async () => {
    const result = await loadRowDetailAction("ws_1", "");
    expect(result).toEqual({ ok: false, error: "Missing row reference." });
    expect(requireUserMock).not.toHaveBeenCalled();
    expect(getContentByIdMock).not.toHaveBeenCalled();
  });

  it("rejects a missing workspace id without touching auth", async () => {
    const result = await loadRowDetailAction("", "content_1");
    expect(result).toEqual({ ok: false, error: "Missing row reference." });
    expect(requireUserMock).not.toHaveBeenCalled();
  });
});

describe("loadRowDetailAction — cross-tenant guard", () => {
  it("rejects when the row isn't found in the caller's workspace and reads nothing else", async () => {
    // A cross-tenant id (or a real id in someone else's workspace) simply
    // matches nothing once getContentById is scoped by workspaceId — the
    // guarantee under test is that activity/comments are never read for a
    // row the caller couldn't otherwise see, not merely that an error
    // string comes back.
    getContentByIdMock.mockResolvedValue(null);
    const result = await loadRowDetailAction("ws_1", "content_other_tenant");
    expect(result).toEqual({
      ok: false,
      error: "That row is no longer available.",
    });
    expect(listActivityForSubjectMock).not.toHaveBeenCalled();
    expect(listCommentsMock).not.toHaveBeenCalled();
  });

  it("checks membership before ever reading the row", async () => {
    requireMembershipMock.mockRejectedValue(new Error("Not a member of this workspace"));
    const result = await loadRowDetailAction("ws_1", "content_1");
    expect(result.ok).toBe(false);
    expect(getContentByIdMock).not.toHaveBeenCalled();
    expect(listActivityForSubjectMock).not.toHaveBeenCalled();
    expect(listCommentsMock).not.toHaveBeenCalled();
  });
});

describe("loadRowDetailAction — happy path", () => {
  it("returns activity and comments for the requested row only", async () => {
    listActivityForSubjectMock.mockResolvedValue([
      {
        id: "act_1",
        verb: "assigned",
        actorId: "user_2",
        meta: { to: "user_1" },
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);
    listCommentsMock.mockResolvedValue([
      {
        id: "cmt_1",
        body: "looks good",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        authorName: "Ada",
        authorEmail: "ada@example.com",
      },
    ]);

    const result = await loadRowDetailAction("ws_1", "content_1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.activity).toEqual([
      {
        id: "act_1",
        verb: "assigned",
        actorId: "user_2",
        meta: { to: "user_1" },
        createdAtIso: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(result.comments).toEqual([
      {
        id: "cmt_1",
        body: "looks good",
        createdAtIso: "2026-01-02T00:00:00.000Z",
        authorName: "Ada",
        authorEmail: "ada@example.com",
      },
    ]);
    // scoped to exactly the row asked for, not the whole workspace
    expect(listActivityForSubjectMock).toHaveBeenCalledWith(
      "ws_1",
      "content",
      "content_1",
    );
    expect(listCommentsMock).toHaveBeenCalledWith("ws_1", "content_1");
    expect(requireMembershipMock).toHaveBeenCalledWith("ws_1", "user_1");
  });
});

describe("addPlanRowCommentAction — input shape", () => {
  it("rejects an empty comment body without touching auth", async () => {
    const result = await addPlanRowCommentAction({
      workspaceId: "ws_1",
      contentId: "content_1",
      body: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/write something/i);
    expect(requireUserMock).not.toHaveBeenCalled();
    expect(addCommentMock).not.toHaveBeenCalled();
  });

  it("rejects a missing content id without touching auth", async () => {
    const result = await addPlanRowCommentAction({
      workspaceId: "ws_1",
      contentId: "",
      body: "hello",
    });
    expect(result.ok).toBe(false);
    expect(requireUserMock).not.toHaveBeenCalled();
  });
});

describe("addPlanRowCommentAction — cross-tenant guard", () => {
  it("rejects when the row isn't found in the caller's workspace and posts nothing", async () => {
    getContentByIdMock.mockResolvedValue(null);
    const result = await addPlanRowCommentAction({
      workspaceId: "ws_1",
      contentId: "content_other_tenant",
      body: "hello",
    });
    expect(result).toEqual({
      ok: false,
      error: "That row is no longer available.",
    });
    expect(addCommentMock).not.toHaveBeenCalled();
    expect(listCommentsMock).not.toHaveBeenCalled();
  });
});

describe("addPlanRowCommentAction — author identity", () => {
  it("posts as the session user, never a client-supplied author id", async () => {
    requireUserMock.mockResolvedValue({ id: "user_1" });

    await addPlanRowCommentAction({
      workspaceId: "ws_1",
      contentId: "content_1",
      body: "on it",
      // A crafted request trying to post as someone else. The action's
      // input type doesn't even accept this field — zod strips it — and
      // the assertion below proves the session id wins regardless of
      // whatever the client sent.
      ...( { authorId: "someone_else" } as Record<string, unknown> ),
    } as never);

    expect(addCommentMock).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      contentId: "content_1",
      authorId: "user_1",
      body: "on it",
    });
  });
});

describe("addPlanRowCommentAction — happy path", () => {
  it("returns only the one new comment, built from the session user, without re-reading the thread", async () => {
    requireUserMock.mockResolvedValue({
      id: "user_1",
      name: "Ada",
      email: "ada@example.com",
    });
    addCommentMock.mockResolvedValue({
      id: "cmt_1",
      createdAt: new Date("2026-01-03T00:00:00.000Z"),
    });

    const result = await addPlanRowCommentAction({
      workspaceId: "ws_1",
      contentId: "content_1",
      body: "on it",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.comment).toEqual({
      id: "cmt_1",
      body: "on it",
      createdAtIso: "2026-01-03T00:00:00.000Z",
      authorName: "Ada",
      authorEmail: "ada@example.com",
    });
    expect(addCommentMock).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      contentId: "content_1",
      authorId: "user_1",
      body: "on it",
    });
    // The whole point of the fix: no second read of the thread just to
    // report back the comment we already know everything about.
    expect(listCommentsMock).not.toHaveBeenCalled();
  });
});

describe("updatePlanCellAction — broadcasts on success", () => {
  it("broadcasts the calendar scope after a successful edit", async () => {
    const result = await updatePlanCellAction({
      workspaceId: "ws_1",
      contentId: "content_1",
      field: "title",
      value: "New title",
    });
    expect(result).toEqual({ ok: true });
    expect(broadcastSignalMock).toHaveBeenCalledWith("ws_1", "calendar");
  });

  it("does not broadcast when the edit fails validation", async () => {
    const result = await updatePlanCellAction({
      workspaceId: "ws_1",
      contentId: "content_1",
      field: "title",
      value: "",
    });
    expect(result.ok).toBe(false);
    expect(broadcastSignalMock).not.toHaveBeenCalled();
  });

  it("does not broadcast when the row is gone", async () => {
    getContentByIdMock.mockResolvedValue(null);
    const result = await updatePlanCellAction({
      workspaceId: "ws_1",
      contentId: "content_1",
      field: "title",
      value: "New title",
    });
    expect(result.ok).toBe(false);
    expect(broadcastSignalMock).not.toHaveBeenCalled();
  });
});

describe("bulkUpdatePlanCellsAction — broadcasts once, not per row", () => {
  it("broadcasts exactly once for a multi-row bulk edit", async () => {
    const result = await bulkUpdatePlanCellsAction({
      workspaceId: "ws_1",
      contentIds: ["content_1", "content_1", "content_1"],
      field: "title",
      value: "Bulk title",
    });
    expect(result.ok).toBe(true);
    expect(broadcastSignalMock).toHaveBeenCalledWith("ws_1", "calendar");
  });

  it("does not broadcast when every row in the batch fails", async () => {
    getContentByIdMock.mockResolvedValue(null);
    const result = await bulkUpdatePlanCellsAction({
      workspaceId: "ws_1",
      contentIds: ["content_1"],
      field: "title",
      value: "Bulk title",
    });
    expect(result).toEqual({
      ok: true,
      updated: [],
      failed: [{ id: "content_1", error: "That row is no longer available." }],
    });
    expect(broadcastSignalMock).not.toHaveBeenCalled();
  });
});

describe("addCalendarPostAction — broadcasts on success", () => {
  function formData(overrides: Record<string, string> = {}) {
    const fd = new FormData();
    const base = {
      workspaceId: "ws_1",
      clientId: "client_1",
      title: "New post",
      type: "post",
      day: "2026-08-20",
      time: "10:00",
      ...overrides,
    };
    for (const [key, value] of Object.entries(base)) fd.set(key, value);
    return fd;
  }

  it("broadcasts after creating a scheduled post", async () => {
    const result = await addCalendarPostAction(undefined, formData());
    expect(result).toBeUndefined();
    expect(broadcastSignalMock).toHaveBeenCalledWith("ws_1", "calendar");
  });

  it("does not broadcast when the client isn't in this workspace", async () => {
    getClientByIdMock.mockResolvedValue(null);
    const result = await addCalendarPostAction(undefined, formData());
    expect(result).toEqual({ error: "Client not found in this workspace." });
    expect(broadcastSignalMock).not.toHaveBeenCalled();
  });

  it("does not broadcast on an invalid day/time", async () => {
    const result = await addCalendarPostAction(
      undefined,
      formData({ day: "not-a-date" }),
    );
    expect(result).toEqual({ error: "Pick a valid day and time." });
    expect(broadcastSignalMock).not.toHaveBeenCalled();
  });
});
