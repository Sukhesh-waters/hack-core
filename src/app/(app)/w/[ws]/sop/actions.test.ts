import { describe, expect, it, vi, beforeEach } from "vitest";

const mockRequireUser = vi.fn().mockResolvedValue({ id: "u_1", email: "test@example.com" });
const mockRequireCapability = vi.fn().mockResolvedValue(undefined);

vi.mock("@/auth", () => ({
  requireUser: () => mockRequireUser(),
}));

vi.mock("@/db/queries/memberships", () => ({
  requireCapability: () => mockRequireCapability(),
  listWorkspaceMembers: vi.fn().mockResolvedValue([{ userId: "u_2", name: "Alice" }]),
}));

vi.mock("@/db/queries/sop", () => ({
  cancelSopRun: vi.fn().mockResolvedValue({ ok: true, skippedCount: 3 }),
  assignRunStep: vi.fn().mockResolvedValue(true),
  sopRunStepsQuery: vi.fn().mockResolvedValue([]),
  getRunStep: vi.fn().mockResolvedValue({
    id: "step_1",
    title: "Design Thumbnail",
    status: "ready",
    gate: "approval",
    assigneeId: "u_2",
  }),
  loadSopRun: vi.fn().mockResolvedValue({
    run: { id: "run_1", name: "Launch", anchorDate: new Date("2026-08-01"), status: "active" },
    steps: [
      { id: "step_1", status: "ready", dueAt: new Date("2026-08-03"), dependsOn: [] },
      { id: "step_2", status: "done", dueAt: new Date("2026-08-01"), dependsOn: [] },
    ],
  }),
  applyRescheduledDates: vi.fn().mockResolvedValue(1),
  reanchorSopRun: vi.fn().mockResolvedValue({ ok: true, moved: 1 }),
  moveRunStep: vi.fn().mockResolvedValue({ ok: true, unblocked: 0, runCompleted: false }),
}));

vi.mock("@/lib/activity", () => ({
  recordActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/db/queries/notifications", () => ({
  notify: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/events/dispatch", () => ({
  emitDomainEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const mockInsertValues = vi.fn();
const mockUpdateSet = vi.fn();

vi.mock("@/db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: (v: unknown) => {
        mockInsertValues(v);
        return {
          returning: vi.fn().mockResolvedValue([{ id: "created_id_1" }]),
        };
      },
    })),
    update: vi.fn(() => ({
      set: (s: unknown) => {
        mockUpdateSet(s);
        return {
          where: vi.fn().mockResolvedValue([{ id: "step_1" }]),
        };
      },
    })),
  },
}));

import {
  cancelRunAction,
  assignStepAction,
  bulkAssignReadyStepsToSelfAction,
  decideGateStepAction,
  materialiseStepAction,
  reanchorRunAction,
  rescheduleDownstreamAction,
} from "./actions";
import {
  cancelSopRun,
  assignRunStep,
  reanchorSopRun,
  loadSopRun,
  sopRunStepsQuery,
} from "@/db/queries/sop";
import { notify } from "@/db/queries/notifications";
import { emitDomainEvent } from "@/lib/events/dispatch";

describe("SOP Run Actions (Slice 1 & 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("cancelRunAction", () => {
    it("cancels an active run and emits domain event", async () => {
      const result = await cancelRunAction("ws_1", "run_1");
      expect(result).toHaveProperty("savedAt");
      expect(cancelSopRun).toHaveBeenCalledWith({
        workspaceId: "ws_1",
        runId: "run_1",
        userId: "u_1",
      });
      expect(emitDomainEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          verb: "sop_step.completed",
          workspaceId: "ws_1",
          subjectType: "sop_run_step",
          subjectId: "run_1",
          actorId: "u_1",
          meta: expect.objectContaining({ status: "cancelled", skippedCount: 3 }),
        }),
      );
    });

    it("returns error if cancelSopRun fails", async () => {
      vi.mocked(cancelSopRun).mockResolvedValueOnce({ ok: false, error: "Run is already cancelled." });
      const result = await cancelRunAction("ws_1", "run_1");
      expect(result).toEqual({ error: "Run is already cancelled." });
    });
  });

  describe("assignStepAction", () => {
    it("assigns step, notifies assignee, and emits domain event", async () => {
      const formData = new FormData();
      formData.append("workspaceId", "ws_1");
      formData.append("runId", "run_1");
      formData.append("stepId", "step_1");
      formData.append("assigneeId", "u_2");

      const result = await assignStepAction(undefined, formData);
      expect(result).toHaveProperty("savedAt");
      expect(assignRunStep).toHaveBeenCalledWith({
        workspaceId: "ws_1",
        runId: "run_1",
        stepId: "step_1",
        assigneeId: "u_2",
      });
      expect(notify).toHaveBeenCalledWith({
        workspaceId: "ws_1",
        userId: "u_2",
        kind: "assigned",
        subjectType: "sop_run_step",
        subjectId: "step_1",
        body: 'You were assigned to "Design Thumbnail".',
      });
      expect(emitDomainEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          verb: "sop_step.assigned",
          subjectType: "sop_run_step",
          subjectId: "step_1",
          runId: "run_1",
        }),
      );
    });
  });

  describe("decideGateStepAction (E2)", () => {
    it("notifies assignee when gate is rejected with reason", async () => {
      const formData = new FormData();
      formData.append("workspaceId", "ws_1");
      formData.append("runId", "run_1");
      formData.append("stepId", "step_1");
      formData.append("decision", "reject");
      formData.append("reason", "Inaccurate brand colors");

      const result = await decideGateStepAction(undefined, formData);
      expect(result).toHaveProperty("savedAt");
      expect(notify).toHaveBeenCalledWith({
        workspaceId: "ws_1",
        userId: "u_2",
        kind: "approval_needed",
        subjectType: "sop_run_step",
        subjectId: "step_1",
        body: 'Gate rejected on "Design Thumbnail": Inaccurate brand colors',
      });
    });
  });

  describe("reanchorRunAction (E9)", () => {
    it("shifts open steps to new anchor date and emits domain event", async () => {
      const formData = new FormData();
      formData.append("workspaceId", "ws_1");
      formData.append("runId", "run_1");
      formData.append("anchorDate", "2026-08-08"); // +7 days

      const result = await reanchorRunAction(undefined, formData);
      expect(result).toHaveProperty("savedAt");
      expect(reanchorSopRun).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "ws_1",
          runId: "run_1",
          days: 7,
          moves: [
            expect.objectContaining({
              id: "step_1",
              dueAt: expect.any(Date),
            }),
          ],
        }),
      );
      expect(emitDomainEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          verb: "sop_step.completed",
          meta: expect.objectContaining({ reanchored: true, days: 7 }),
        }),
      );
    });

    it("returns error if run is not active", async () => {
      vi.mocked(loadSopRun).mockResolvedValueOnce({
        run: { id: "run_1", name: "Launch", anchorDate: new Date("2026-08-01"), status: "cancelled" } as never,
        steps: [],
      });

      const formData = new FormData();
      formData.append("workspaceId", "ws_1");
      formData.append("runId", "run_1");
      formData.append("anchorDate", "2026-08-08");

      const result = await reanchorRunAction(undefined, formData);
      expect(result).toEqual({ error: "Only active runs can be re-anchored." });
    });
  });

  describe("rescheduleDownstreamAction", () => {
    it("reschedules downstream steps and emits domain event", async () => {
      vi.mocked(loadSopRun).mockResolvedValueOnce({
        run: { id: "run_1", name: "Launch", anchorDate: new Date("2026-08-01"), status: "active" } as never,
        steps: [
          { id: "step_1", status: "in_progress", dueAt: new Date("2026-08-03"), dependsOn: [] } as never,
          { id: "step_2", status: "ready", dueAt: new Date("2026-08-05"), dependsOn: ["step_1"] } as never,
        ],
      });

      const formData = new FormData();
      formData.append("workspaceId", "ws_1");
      formData.append("runId", "run_1");
      formData.append("stepId", "step_1");
      formData.append("days", "3");

      const result = await rescheduleDownstreamAction(undefined, formData);
      expect(result).toHaveProperty("savedAt");
      expect(emitDomainEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          verb: "sop_step.completed",
          workspaceId: "ws_1",
          subjectType: "sop_run_step",
          subjectId: "step_1",
          runId: "run_1",
          actorId: "u_1",
          meta: expect.objectContaining({ rescheduled: true, days: 3 }),
        }),
      );
    });
  });

  describe("materialiseStepAction", () => {
    it("creates a hub task with originRunStepId and back-links it to the SOP step", async () => {
      vi.mocked(loadSopRun).mockResolvedValueOnce({
        run: { id: "run_1", clientId: "cli_1", status: "active" } as never,
        steps: [
          {
            id: "step_task_1",
            title: "Prepare launch assets",
            creates: "task",
            linkedId: null,
          } as never,
        ],
      });

      const formData = new FormData();
      formData.append("workspaceId", "ws_1");
      formData.append("runId", "run_1");
      formData.append("stepId", "step_task_1");

      const result = await materialiseStepAction(undefined, formData);
      expect(result).toHaveProperty("savedAt");
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "ws_1",
          title: "Prepare launch assets",
          createdById: "u_1",
          originRunStepId: "step_task_1",
        }),
      );
      expect(mockUpdateSet).toHaveBeenCalledWith({
        linkedType: "task",
        linkedId: "created_id_1",
      });
    });
  });
});

describe("bulkAssignReadyStepsToSelfAction (E13)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({ id: "u_1", email: "test@example.com" });
    mockRequireCapability.mockResolvedValue(undefined);
    (assignRunStep as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });

  it("assigns every unassigned ready step to the caller, skipping the rest", async () => {
    (sopRunStepsQuery as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "step_1", status: "ready", assigneeId: null },
      { id: "step_2", status: "ready", assigneeId: "u_2" }, // already claimed — skip
      { id: "step_3", status: "blocked", assigneeId: null }, // not ready — skip
      { id: "step_4", status: "ready", assigneeId: null },
    ]);

    const result = await bulkAssignReadyStepsToSelfAction("ws_1", "run_1");

    expect(result).toEqual({ assignedCount: 2 });
    expect(assignRunStep).toHaveBeenCalledTimes(2);
    expect(assignRunStep).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      runId: "run_1",
      stepId: "step_1",
      assigneeId: "u_1",
    });
    expect(assignRunStep).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      runId: "run_1",
      stepId: "step_4",
      assigneeId: "u_1",
    });
  });

  it("returns a clear error when there is nothing to claim", async () => {
    (sopRunStepsQuery as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "step_1", status: "ready", assigneeId: "u_2" },
      { id: "step_2", status: "done", assigneeId: null },
    ]);

    const result = await bulkAssignReadyStepsToSelfAction("ws_1", "run_1");

    expect(result).toEqual({ error: "No unassigned ready steps to claim." });
    expect(assignRunStep).not.toHaveBeenCalled();
  });

  it("continues past a step that failed to move instead of stopping", async () => {
    (sopRunStepsQuery as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "step_1", status: "ready", assigneeId: null },
      { id: "step_2", status: "ready", assigneeId: null },
    ]);
    (assignRunStep as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(false) // step_1 changed underneath us
      .mockResolvedValueOnce(true); // step_2 still succeeds

    const result = await bulkAssignReadyStepsToSelfAction("ws_1", "run_1");

    expect(result).toEqual({ assignedCount: 1 });
    expect(assignRunStep).toHaveBeenCalledTimes(2);
  });

  it("checks the capability before reading any steps", async () => {
    mockRequireCapability.mockRejectedValue(
      Object.assign(new Error("You don't have permission to start an SOP run."), {
        name: "PermissionError",
      }),
    );

    const result = await bulkAssignReadyStepsToSelfAction("ws_1", "run_1");

    expect(result).toEqual({
      error: "You don't have permission to start an SOP run.",
    });
    expect(sopRunStepsQuery).not.toHaveBeenCalled();
  });

  it("rejects a call with no workspace or run id", async () => {
    const result = await bulkAssignReadyStepsToSelfAction("", "run_1");
    expect(result).toEqual({ error: "Invalid run identifier." });
    expect(mockRequireUser).not.toHaveBeenCalled();
  });
});
