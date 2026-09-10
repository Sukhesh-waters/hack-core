import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireUser = vi.fn().mockResolvedValue({ id: "u_1", email: "test@example.com" });
const mockRequireMembership = vi.fn().mockResolvedValue(undefined);
const mockMoveRunStep = vi.fn().mockResolvedValue({ ok: true });
const mockBroadcastHubSignal = vi.fn().mockResolvedValue(undefined);
const mockLiveTeamHub = vi.fn().mockResolvedValue({ channel: "#ws_1", tasks: [] });

vi.mock("@/auth", () => ({
  requireUser: () => mockRequireUser(),
}));

vi.mock("@/db/queries/memberships", () => ({
  requireMembership: () => mockRequireMembership(),
}));

vi.mock("@/db/queries/sop", () => ({
  moveRunStep: (input: unknown) => mockMoveRunStep(input),
}));

vi.mock("@/lib/realtime", () => ({
  broadcastHubSignal: () => mockBroadcastHubSignal(),
}));

vi.mock("@/lib/data/live/team-hub", () => ({
  liveTeamHub: () => mockLiveTeamHub(),
}));

const mockUpdateReturning = vi.fn();
const mockSelectLimit = vi.fn();

vi.mock("@/db", () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: () => mockUpdateReturning(),
        })),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: () => mockSelectLimit(),
        })),
      })),
    })),
  },
}));

import { setHubTaskStatus } from "./actions";

describe("setHubTaskStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid transition", async () => {
    const result = await setHubTaskStatus("ws_1", "task_1", "done", "done" as never);
    expect(result).toHaveProperty("error");
  });

  it("updates task to done without originRunStepId", async () => {
    mockUpdateReturning.mockResolvedValueOnce([{ id: "task_1", originRunStepId: null }]);
    const result = await setHubTaskStatus("ws_1", "task_1", "open", "done");
    expect(result).toHaveProperty("data");
    expect(mockMoveRunStep).not.toHaveBeenCalled();
  });

  it("updates task to done and syncs to origin SOP step", async () => {
    mockUpdateReturning.mockResolvedValueOnce([
      { id: "task_1", originRunStepId: "step_42" },
    ]);
    mockSelectLimit.mockResolvedValueOnce([
      { id: "step_42", runId: "run_99", status: "ready" },
    ]);

    const result = await setHubTaskStatus("ws_1", "task_1", "open", "done");
    expect(result).toHaveProperty("data");
    expect(mockMoveRunStep).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      runId: "run_99",
      stepId: "step_42",
      userId: "u_1",
      to: "done",
      expectFrom: ["ready"],
    });
  });
});
