import { describe, expect, it } from "vitest";
import {
  createUndoToken,
  isExternalBoundaryVerb,
  isUndoable,
  type UndoToken,
} from "./undo";

describe("Undo Substrate (B1)", () => {
  const baseNow = new Date("2026-08-08T12:00:00.000Z");

  it("createUndoToken produces token with 30s default expiry", () => {
    const token = createUndoToken(
      {
        subjectType: "hub_task",
        subjectId: "task-123",
        verb: "completed",
        priorFields: { status: "open", completedAt: null },
      },
      baseNow,
    );

    expect(token.subjectType).toBe("hub_task");
    expect(token.subjectId).toBe("task-123");
    expect(token.verb).toBe("completed");
    expect(token.priorFields).toEqual({ status: "open", completedAt: null });
    expect(token.expiresAtIso).toBe("2026-08-08T12:00:30.000Z");
  });

  it("createUndoToken respects custom ttlSeconds", () => {
    const token = createUndoToken(
      {
        subjectType: "content",
        subjectId: "c-456",
        verb: "moved",
        priorFields: { stateId: "state-1" },
        ttlSeconds: 60,
      },
      baseNow,
    );

    expect(token.expiresAtIso).toBe("2026-08-08T12:01:00.000Z");
  });

  it("isUndoable returns true within window and false after expiry", () => {
    const token = createUndoToken(
      {
        subjectType: "idea",
        subjectId: "idea-1",
        verb: "drafted",
        priorFields: { status: "new" },
      },
      baseNow,
    );

    const insideWindow = new Date("2026-08-08T12:00:15.000Z");
    const exactExpiry = new Date("2026-08-08T12:00:30.000Z");
    const afterExpiry = new Date("2026-08-08T12:00:31.000Z");

    expect(isUndoable(token, insideWindow)).toBe(true);
    expect(isUndoable(token, exactExpiry)).toBe(false);
    expect(isUndoable(token, afterExpiry)).toBe(false);
  });

  it("isUndoable returns false for null/undefined/invalid tokens", () => {
    expect(isUndoable(null, baseNow)).toBe(false);
    expect(isUndoable(undefined, baseNow)).toBe(false);

    const badToken = {
      subjectType: "hub_task",
      subjectId: "t-1",
      verb: "updated",
      priorFields: {},
      expiresAtIso: "invalid-date",
    } as UndoToken;

    expect(isUndoable(badToken, baseNow)).toBe(false);
  });

  it("isExternalBoundaryVerb detects external boundary crossing verbs", () => {
    expect(isExternalBoundaryVerb("posted")).toBe(true);
    expect(isExternalBoundaryVerb("published")).toBe(true);
    expect(isExternalBoundaryVerb("emailed")).toBe(true);
    expect(isExternalBoundaryVerb("sent")).toBe(true);
    expect(isExternalBoundaryVerb("dispatched")).toBe(true);

    expect(isExternalBoundaryVerb("updated")).toBe(false);
    expect(isExternalBoundaryVerb("reopened")).toBe(false);
    expect(isExternalBoundaryVerb("drafted")).toBe(false);
  });
});
