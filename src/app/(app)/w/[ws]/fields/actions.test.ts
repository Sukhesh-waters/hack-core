import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { getTableName } from "drizzle-orm";
import { customFieldAssignments, customFieldDefinitions } from "@/db/schema";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/db/queries/memberships", () => ({ requireCapability: vi.fn() }));
vi.mock("@/db/queries/custom-fields", () => ({ archiveFieldQuery: vi.fn() }));
vi.mock("@/db", () => ({
  db: {
    transaction: vi.fn(),
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
  },
}));

const { requireUser } = await import("@/auth");
const { requireCapability } = await import("@/db/queries/memberships");
const { archiveFieldQuery } = await import("@/db/queries/custom-fields");
const { db } = await import("@/db");
const {
  archiveFieldAction,
  assignFieldAction,
  createFieldAction,
  unassignFieldAction,
} = await import("./actions");

const requireUserMock = requireUser as unknown as Mock;
const requireCapabilityMock = requireCapability as unknown as Mock;
const archiveFieldQueryMock = archiveFieldQuery as unknown as Mock;
const dbTransactionMock = db.transaction as unknown as Mock;
const dbSelectMock = db.select as unknown as Mock;
const dbInsertMock = db.insert as unknown as Mock;

const DEFINITIONS_TABLE = getTableName(customFieldDefinitions);
const ASSIGNMENTS_TABLE = getTableName(customFieldAssignments);

/**
 * A chainable, awaitable stub for a drizzle tx.insert(table).values(v) call.
 * `.returning()` resolves to `returningRow` (used by the definition insert);
 * the bare awaited form (used by the assignment insert) resolves to
 * undefined, or rejects when `failTables` names this table.
 */
function makeInsertRecorder(
  written: Array<{ table: string; values: unknown }>,
  failTables: Set<string>,
) {
  return (table: unknown) => {
    const name = getTableName(table as never);
    return {
      values: (values: unknown) => {
        const record = () => written.push({ table: name, values });
        return {
          returning: async () => {
            record();
            if (failTables.has(name)) throw new Error(`${name} insert failed`);
            return [{ id: "def_1" }];
          },
          onConflictDoNothing: async () => {
            record();
            if (failTables.has(name)) throw new Error(`${name} insert failed`);
            return undefined;
          },
          then: (
            resolve: (v: undefined) => void,
            reject: (e: unknown) => void,
          ) => {
            try {
              record();
              if (failTables.has(name)) {
                throw new Error(`${name} insert failed`);
              }
              resolve(undefined);
            } catch (error) {
              reject(error);
            }
          },
        };
      },
    };
  };
}

function makeSelectChain(result: unknown[]) {
  return () => ({
    from: () => ({
      where: () => ({
        limit: async () => result,
      }),
    }),
  });
}

/** Stub for the tx.select(...).from(...).where(...).groupBy(...) shape
 *  createFieldAction uses to find each subject's current highest position. */
function makeGroupedSelectChain(result: unknown[]) {
  return () => ({
    from: () => ({
      where: () => ({
        groupBy: async () => result,
      }),
    }),
  });
}

function formData(entries: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    if (Array.isArray(value)) {
      for (const v of value) fd.append(key, v);
    } else {
      fd.append(key, value);
    }
  }
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ id: "user_1" });
  requireCapabilityMock.mockResolvedValue({ role: "admin" });
});

describe("createFieldAction — validation runs before touching auth or the db", () => {
  it("rejects a missing workspace id without calling requireUser", async () => {
    const result = await createFieldAction(undefined, formData({ name: "X" }));
    expect(result?.error).toBe("Missing workspace");
    expect(requireUserMock).not.toHaveBeenCalled();
  });

  it("rejects an empty name via customFieldDefinitionSchema", async () => {
    const result = await createFieldAction(
      undefined,
      formData({
        workspaceId: "ws_1",
        name: "",
        type: "short_text",
        subjects: ["content"],
      }),
    );
    expect(result?.error).toMatch(/name/i);
    expect(requireUserMock).not.toHaveBeenCalled();
  });

  it("rejects a dropdown submitted with no options — needsOptions is enforced, not decorative", async () => {
    const result = await createFieldAction(
      undefined,
      formData({
        workspaceId: "ws_1",
        name: "Priority",
        type: "dropdown",
        subjects: ["ticket"],
      }),
    );
    expect(result?.error).toMatch(/at least one option/i);
    expect(requireUserMock).not.toHaveBeenCalled();
  });

  it("rejects duplicate options", async () => {
    const result = await createFieldAction(
      undefined,
      formData({
        workspaceId: "ws_1",
        name: "Priority",
        type: "dropdown",
        options: "High\nHigh",
        subjects: ["ticket"],
      }),
    );
    expect(result?.error).toMatch(/unique/i);
  });

  it("rejects zero subjects — a field attached to nothing is dead data", async () => {
    const result = await createFieldAction(
      undefined,
      formData({
        workspaceId: "ws_1",
        name: "Notes",
        type: "short_text",
        subjects: [],
      }),
    );
    expect(result?.error).toMatch(/pick at least one/i);
  });
});

describe("createFieldAction — the transaction actually runs", () => {
  it("happy path: inserts the definition and one assignment row per selected subject, inside the transaction", async () => {
    const written: Array<{ table: string; values: unknown }> = [];
    dbTransactionMock.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        insert: makeInsertRecorder(written, new Set()),
        // No existing assignments for either subject — both start at 0.
        select: makeGroupedSelectChain([]),
      };
      return fn(tx);
    });

    const result = await createFieldAction(
      undefined,
      formData({
        workspaceId: "ws_1",
        name: "Priority",
        type: "short_text",
        subjects: ["content", "ticket"],
      }),
    );

    expect(result).toBeUndefined();
    expect(dbTransactionMock).toHaveBeenCalledTimes(1);

    const definitionWrites = written.filter((w) => w.table === DEFINITIONS_TABLE);
    expect(definitionWrites).toHaveLength(1);

    const assignmentWrites = written.filter((w) => w.table === ASSIGNMENTS_TABLE);
    expect(assignmentWrites).toHaveLength(1);
    const assignmentRows = assignmentWrites[0].values as Array<{
      subjectType: string;
      position: number;
    }>;
    // 2 subjects selected => 2 assignment rows in the batched insert.
    expect(assignmentRows).toHaveLength(2);
    expect(assignmentRows.map((r) => r.subjectType).sort()).toEqual([
      "content",
      "ticket",
    ]);
    // Each subject's own list is empty, so both start at position 0 —
    // neither list's length dictates the other's starting position.
    expect(assignmentRows.find((r) => r.subjectType === "content")?.position).toBe(0);
    expect(assignmentRows.find((r) => r.subjectType === "ticket")?.position).toBe(0);
  });

  it("appends after the existing highest position instead of resetting to 0", async () => {
    const written: Array<{ table: string; values: unknown }> = [];
    dbTransactionMock.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        insert: makeInsertRecorder(written, new Set()),
        select: makeGroupedSelectChain([{ subjectType: "content", highest: 2 }]),
      };
      return fn(tx);
    });

    await createFieldAction(
      undefined,
      formData({
        workspaceId: "ws_1",
        name: "Notes",
        type: "short_text",
        subjects: ["content"],
      }),
    );

    const assignmentWrites = written.filter((w) => w.table === ASSIGNMENTS_TABLE);
    const rows = assignmentWrites[0].values as Array<{ position: number }>;
    // Highest existing position is 2, so the new field lands at 3 — a
    // position of 0 here would mean it silently fell back to name order.
    expect(rows[0].position).toBe(3);
  });

  it("transaction integrity: an assignment insert failure surfaces as an error, not a silent partial success", async () => {
    const written: Array<{ table: string; values: unknown }> = [];
    dbTransactionMock.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        insert: makeInsertRecorder(written, new Set([ASSIGNMENTS_TABLE])),
        select: makeGroupedSelectChain([]),
      };
      return fn(tx);
    });

    const result = await createFieldAction(
      undefined,
      formData({
        workspaceId: "ws_1",
        name: "Priority",
        type: "short_text",
        subjects: ["content"],
      }),
    );

    expect(result?.error).toBeTruthy();
    // The definition write was attempted, but a half-write must never be
    // reported as success.
    expect(written.some((w) => w.table === DEFINITIONS_TABLE)).toBe(true);
  });
});

describe("assignFieldAction — cross-workspace ownership is enforced", () => {
  it("accepts a fieldId owned by the caller's workspace and performs the assignment insert", async () => {
    dbSelectMock.mockImplementation(makeSelectChain([{ id: "field_1" }]));
    const written: Array<{ table: string; values: unknown }> = [];
    dbInsertMock.mockImplementation(makeInsertRecorder(written, new Set()));

    const result = await assignFieldAction(
      undefined,
      formData({ workspaceId: "ws_1", fieldId: "field_1", subjectType: "content" }),
    );

    expect(result).toBeUndefined();
    const assignmentWrites = written.filter((w) => w.table === ASSIGNMENTS_TABLE);
    expect(assignmentWrites).toHaveLength(1);
    expect(assignmentWrites[0].values).toMatchObject({
      workspaceId: "ws_1",
      fieldId: "field_1",
      subjectType: "content",
    });
  });

  it("rejects a foreign-workspace fieldId — no row from the ownership check means no insert, ever", async () => {
    dbSelectMock.mockImplementation(makeSelectChain([]));
    dbInsertMock.mockImplementation(
      makeInsertRecorder([], new Set()),
    );

    const result = await assignFieldAction(
      undefined,
      formData({ workspaceId: "ws_1", fieldId: "field_from_other_ws", subjectType: "content" }),
    );

    expect(result?.error).toMatch(/not found in this workspace/i);
    // The actual cross-tenant guarantee: the insert must never fire.
    expect(dbInsertMock).not.toHaveBeenCalled();
  });
});

describe("archiveFieldAction", () => {
  it("requires a field id", async () => {
    const result = await archiveFieldAction(
      undefined,
      formData({ workspaceId: "ws_1" }),
    );
    expect(result?.error).toBe("Missing field");
  });

  it("reports a lost race when 0 rows come back", async () => {
    archiveFieldQueryMock.mockResolvedValue([]);
    const result = await archiveFieldAction(
      undefined,
      formData({ workspaceId: "ws_1", fieldId: "f_1" }),
    );
    expect(result?.error).toMatch(/already archived/i);
  });

  it("succeeds when a row comes back", async () => {
    archiveFieldQueryMock.mockResolvedValue([{ id: "f_1" }]);
    const result = await archiveFieldAction(
      undefined,
      formData({ workspaceId: "ws_1", fieldId: "f_1" }),
    );
    expect(result).toBeUndefined();
  });
});

describe("assignFieldAction / unassignFieldAction — subject type is validated", () => {
  it("assign rejects an unknown subject type before touching the db", async () => {
    const result = await assignFieldAction(
      undefined,
      formData({ workspaceId: "ws_1", fieldId: "f_1", subjectType: "invoice" }),
    );
    expect(result?.error).toBe("Invalid subject type");
    expect(requireUserMock).not.toHaveBeenCalled();
  });

  it("unassign rejects an unknown subject type before touching the db", async () => {
    const result = await unassignFieldAction(
      undefined,
      formData({ workspaceId: "ws_1", fieldId: "f_1", subjectType: "invoice" }),
    );
    expect(result?.error).toBe("Invalid subject type");
    expect(requireUserMock).not.toHaveBeenCalled();
  });

  it("assign requires a field id", async () => {
    const result = await assignFieldAction(
      undefined,
      formData({ workspaceId: "ws_1", subjectType: "content" }),
    );
    expect(result?.error).toBe("Missing field");
  });
});
