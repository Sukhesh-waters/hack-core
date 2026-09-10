import { describe, expect, it, vi, beforeEach } from "vitest";

const insertValues = vi.hoisted(() => vi.fn());
const insert = vi.hoisted(() => vi.fn(() => ({ values: insertValues })));

vi.mock("@/db", () => ({ db: { insert, select: vi.fn() } }));

const { recordActivity } = await import("./activity");

beforeEach(() => {
  insert.mockClear();
  insertValues.mockClear();
  insertValues.mockResolvedValue(undefined);
});

describe("recordActivity", () => {
  it("writes exactly one row with the verb and subject", async () => {
    await recordActivity({
      workspaceId: "ws_1",
      subjectType: "content",
      subjectId: "content_1",
      actorId: "user_1",
      verb: "stage_advanced",
      meta: { from: "brief", to: "in_progress" },
    });
    expect(insertValues).toHaveBeenCalledOnce();
    expect(insertValues.mock.calls[0][0]).toMatchObject({
      workspaceId: "ws_1",
      subjectType: "content",
      subjectId: "content_1",
      actorId: "user_1",
      verb: "stage_advanced",
      meta: { from: "brief", to: "in_progress" },
    });
  });

  it("keeps actorId null for automation-sourced rows", async () => {
    await recordActivity({
      workspaceId: "ws_1",
      subjectType: "idea",
      subjectId: "idea_1",
      actorId: null,
      verb: "automation_create_ticket",
    });
    expect(insertValues.mock.calls[0][0].actorId).toBeNull();
  });

  it("stores null rather than undefined when meta is omitted", async () => {
    await recordActivity({
      workspaceId: "ws_1",
      subjectType: "content",
      subjectId: "c_1",
      actorId: "u_1",
      verb: "approved",
    });
    expect(insertValues.mock.calls[0][0].meta).toBeNull();
  });

  /**
   * Activity is observability, not the operation. A failed insert must not
   * roll back the stage advance or approval it was recording — losing a
   * history line is bad, losing the user's actual work is much worse.
   */
  it("never throws when the write fails", async () => {
    insertValues.mockRejectedValueOnce(new Error("db down"));
    await expect(
      recordActivity({
        workspaceId: "ws_1",
        subjectType: "content",
        subjectId: "c_1",
        actorId: "u_1",
        verb: "approved",
      }),
    ).resolves.toBeUndefined();
  });

  /**
   * The exception: inside a caller-supplied transaction the failure SHOULD
   * propagate, so the transaction rolls back as a unit (S8's pushToTeam).
   */
  it("propagates the failure when running inside a transaction", async () => {
    const txValues = vi.fn().mockRejectedValue(new Error("tx failed"));
    const tx = { insert: vi.fn(() => ({ values: txValues })) };
    await expect(
      recordActivity(
        {
          workspaceId: "ws_1",
          subjectType: "content",
          subjectId: "c_1",
          actorId: "u_1",
          verb: "pushed_to_team",
        },
        tx as never,
      ),
    ).rejects.toThrow("tx failed");
    // and it must not have fallen back to the ambient db
    expect(insert).not.toHaveBeenCalled();
  });
});
