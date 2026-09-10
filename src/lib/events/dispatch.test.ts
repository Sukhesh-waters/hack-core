import { describe, expect, it, vi } from "vitest";
import { emitDomainEvent, mapEventToRealtimeScopes } from "./dispatch";
import type { ContentStateChangedEvent } from "./registry";

vi.mock("@/inngest/client", () => ({
  inngest: {
    send: vi.fn().mockResolvedValue({ ids: ["test-id"] }),
  },
}));

vi.mock("@/lib/activity", () => ({
  recordActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/realtime", () => ({
  broadcastSignal: vi.fn().mockResolvedValue(undefined),
}));

describe("event spine dispatch", () => {
  it("maps content state change to workflow and calendar scopes", () => {
    const event: ContentStateChangedEvent = {
      verb: "content.state_changed",
      workspaceId: "ws-1",
      subjectType: "content",
      subjectId: "c-1",
      actorId: "u-1",
      from: "draft",
      to: "published",
    };

    const scopes = mapEventToRealtimeScopes(event);
    expect(scopes).toEqual(["workflow", "calendar", "my-work"]);
  });

  it("emits domain event cleanly without throwing", async () => {
    const event: ContentStateChangedEvent = {
      verb: "content.state_changed",
      workspaceId: "ws-1",
      subjectType: "content",
      subjectId: "c-1",
      actorId: "u-1",
      from: "draft",
      to: "published",
    };

    await expect(emitDomainEvent(event)).resolves.not.toThrow();
  });
});
