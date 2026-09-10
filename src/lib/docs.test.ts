import { describe, expect, it } from "vitest";
import { createWorkspaceDocSchema, updateWorkspaceDocSchema } from "./docs";

describe("createWorkspaceDocSchema (kind distinction — V2 SOP layer)", () => {
  it("defaults kind to 'doc' when omitted", () => {
    const parsed = createWorkspaceDocSchema.parse({
      workspaceId: "ws_1",
      title: "Onboarding",
    });
    expect(parsed.kind).toBe("doc");
  });

  it("accepts an explicit kind of 'sop'", () => {
    const parsed = createWorkspaceDocSchema.parse({
      workspaceId: "ws_1",
      title: "Publish a post",
      kind: "sop",
    });
    expect(parsed.kind).toBe("sop");
  });

  it("rejects an invalid kind", () => {
    const result = createWorkspaceDocSchema.safeParse({
      workspaceId: "ws_1",
      title: "Bad kind",
      kind: "runbook",
    });
    expect(result.success).toBe(false);
  });
});

describe("updateWorkspaceDocSchema (kind distinction — V2 SOP layer)", () => {
  it("defaults kind to 'doc' when omitted", () => {
    const parsed = updateWorkspaceDocSchema.parse({
      workspaceId: "ws_1",
      docId: "doc_1",
      title: "Onboarding",
    });
    expect(parsed.kind).toBe("doc");
  });

  it("accepts an explicit kind of 'sop'", () => {
    const parsed = updateWorkspaceDocSchema.parse({
      workspaceId: "ws_1",
      docId: "doc_1",
      title: "Publish a post",
      kind: "sop",
    });
    expect(parsed.kind).toBe("sop");
  });

  it("rejects an invalid kind", () => {
    const result = updateWorkspaceDocSchema.safeParse({
      workspaceId: "ws_1",
      docId: "doc_1",
      title: "Bad kind",
      kind: "runbook",
    });
    expect(result.success).toBe(false);
  });
});
