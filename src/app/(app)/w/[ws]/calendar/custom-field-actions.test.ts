import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { CustomFieldDefinition } from "@/lib/custom-fields";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/db/queries/memberships", () => ({ requireMembership: vi.fn() }));
vi.mock("@/db/queries/clients", () => ({ getContentById: vi.fn() }));
vi.mock("@/db/queries/custom-fields", () => ({
  listFieldsForSubject: vi.fn(),
  setContentCustomFieldsQuery: vi.fn(),
}));

const { requireUser } = await import("@/auth");
const { requireMembership } = await import("@/db/queries/memberships");
const { getContentById } = await import("@/db/queries/clients");
const { listFieldsForSubject, setContentCustomFieldsQuery } = await import(
  "@/db/queries/custom-fields"
);
const { saveCustomFieldValueAction } = await import("./custom-field-actions");

const requireUserMock = requireUser as unknown as Mock;
const requireMembershipMock = requireMembership as unknown as Mock;
const getContentByIdMock = getContentById as unknown as Mock;
const listFieldsForSubjectMock = listFieldsForSubject as unknown as Mock;
const setContentCustomFieldsQueryMock =
  setContentCustomFieldsQuery as unknown as Mock;

const shortTextField: CustomFieldDefinition = {
  id: "field_1",
  name: "Reference",
  description: null,
  type: "short_text",
  options: null,
  required: false,
};

const dropdownField: CustomFieldDefinition = {
  id: "field_2",
  name: "Priority",
  description: null,
  type: "dropdown",
  options: ["Low", "High"],
  required: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ id: "user_1" });
  requireMembershipMock.mockResolvedValue({ role: "member" });
  getContentByIdMock.mockResolvedValue({
    id: "content_1",
    workspaceId: "ws_1",
    customFields: { field_2: "Low" },
  });
  listFieldsForSubjectMock.mockResolvedValue([shortTextField, dropdownField]);
  setContentCustomFieldsQueryMock.mockResolvedValue([{ id: "content_1" }]);
});

describe("saveCustomFieldValueAction — input shape", () => {
  it("rejects a missing content id without touching auth", async () => {
    const result = await saveCustomFieldValueAction({
      workspaceId: "ws_1",
      contentId: "",
      fieldId: "field_1",
      value: "x",
    });
    expect(result).toEqual({ ok: false, error: "Missing field reference." });
    expect(requireUserMock).not.toHaveBeenCalled();
  });
});

describe("saveCustomFieldValueAction — the injection guard", () => {
  it("rejects a field id with no live definition in this workspace, and never writes", async () => {
    const result = await saveCustomFieldValueAction({
      workspaceId: "ws_1",
      contentId: "content_1",
      fieldId: "field_does_not_exist",
      value: "anything",
    });
    expect(result).toEqual({ ok: false, error: "That field no longer exists." });
    expect(setContentCustomFieldsQueryMock).not.toHaveBeenCalled();
  });

  it("rejects when the content row isn't found in this workspace", async () => {
    getContentByIdMock.mockResolvedValue(null);
    const result = await saveCustomFieldValueAction({
      workspaceId: "ws_1",
      contentId: "content_missing",
      fieldId: "field_1",
      value: "x",
    });
    expect(result).toEqual({
      ok: false,
      error: "That row is no longer available.",
    });
    expect(setContentCustomFieldsQueryMock).not.toHaveBeenCalled();
  });
});

describe("saveCustomFieldValueAction — validation runs against the live definition", () => {
  it("rejects a dropdown value outside its configured options", async () => {
    const result = await saveCustomFieldValueAction({
      workspaceId: "ws_1",
      contentId: "content_1",
      fieldId: "field_2",
      value: "Not An Option",
    });
    expect(result.ok).toBe(false);
    expect(setContentCustomFieldsQueryMock).not.toHaveBeenCalled();
  });

  it("rejects a required field cleared to empty", async () => {
    const result = await saveCustomFieldValueAction({
      workspaceId: "ws_1",
      contentId: "content_1",
      fieldId: "field_2",
      value: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/required/i);
    expect(setContentCustomFieldsQueryMock).not.toHaveBeenCalled();
  });
});

describe("saveCustomFieldValueAction — merge, never replace", () => {
  it("merges the new value alongside the row's existing custom fields", async () => {
    await saveCustomFieldValueAction({
      workspaceId: "ws_1",
      contentId: "content_1",
      fieldId: "field_1",
      value: "REF-42",
    });

    expect(setContentCustomFieldsQueryMock).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      contentId: "content_1",
      merged: { field_2: "Low", field_1: "REF-42" },
    });
  });

  it("does not drop a value belonging to a field the panel never showed", async () => {
    getContentByIdMock.mockResolvedValue({
      id: "content_1",
      workspaceId: "ws_1",
      customFields: { field_2: "High", some_other_field: "untouched" },
    });

    await saveCustomFieldValueAction({
      workspaceId: "ws_1",
      contentId: "content_1",
      fieldId: "field_1",
      value: "REF-99",
    });

    const call = setContentCustomFieldsQueryMock.mock.calls[0][0];
    expect(call.merged).toMatchObject({
      some_other_field: "untouched",
      field_2: "High",
      field_1: "REF-99",
    });
  });
});

describe("saveCustomFieldValueAction — lost row on write", () => {
  it("reports the row as gone when the scoped update matches 0 rows", async () => {
    setContentCustomFieldsQueryMock.mockResolvedValue([]);
    const result = await saveCustomFieldValueAction({
      workspaceId: "ws_1",
      contentId: "content_1",
      fieldId: "field_1",
      value: "REF-1",
    });
    expect(result).toEqual({
      ok: false,
      error: "That row is no longer available.",
    });
  });
});

describe("saveCustomFieldValueAction — happy path", () => {
  it("succeeds and revalidates the calendar", async () => {
    const result = await saveCustomFieldValueAction({
      workspaceId: "ws_1",
      contentId: "content_1",
      fieldId: "field_1",
      value: "REF-1",
    });
    expect(result).toEqual({ ok: true });
    expect(requireMembershipMock).toHaveBeenCalledWith("ws_1", "user_1");
  });
});
