import { describe, expect, it, vi, beforeEach } from "vitest";
import { getTableName } from "drizzle-orm";

/**
 * The guards run as reads before the transaction opens, so they are
 * observable by stubbing the read layer. The transaction body is stubbed to
 * record which tables were written, which is what "all five or none" means
 * in practice.
 */
const getMembership = vi.hoisted(() => vi.fn());
vi.mock("@/db/queries/memberships", () => ({ getMembership }));

const selectResult = vi.hoisted(() => ({ content: [] as unknown[], tickets: [] as unknown[] }));
const written = vi.hoisted(() => [] as string[]);
const txShouldFailAt = vi.hoisted(() => ({ table: null as string | null }));
const contentUpdateSet = vi.hoisted(() => ({ value: undefined as Record<string, unknown> | undefined }));

const dbMock = vi.hoisted(() => {
  let call = 0;
  const makeSelect = () => ({
    from: () => ({
      where: () => ({
        limit: () => {
          // first select is content, second is the open-ticket check
          call += 1;
          return call === 1 ? selectResult.content : selectResult.tickets;
        },
      }),
    }),
  });
  return {
    reset() {
      call = 0;
      written.length = 0;
      txShouldFailAt.table = null;
      contentUpdateSet.value = undefined;
    },
    select: () => makeSelect(),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        update: () => ({
          set: (value: Record<string, unknown>) => {
            contentUpdateSet.value = value;
            return { where: async () => undefined };
          },
        }),
        insert: (table: unknown) => {
          const name = getTableName(table as never);
          const record = () => {
            if (txShouldFailAt.table === name) {
              throw new Error(`write to ${name} failed`);
            }
            written.push(name);
          };
          // drizzle's builder is both awaitable and chainable into
          // .returning(), so the stub has to be a thenable that also
          // exposes returning() — awaiting one must not double-record.
          return {
            values: () => ({
              returning: async () => {
                record();
                return [{ id: "ticket_1" }];
              },
              then: (
                resolve: (v: undefined) => void,
                reject: (e: unknown) => void,
              ) => {
                try {
                  record();
                  resolve(undefined);
                } catch (error) {
                  reject(error);
                }
              },
            }),
          };
        },
      };
      return fn(tx);
    },
  };
});

vi.mock("@/db", () => ({ db: dbMock }));

const { pushToTeam } = await import("./push-to-team");

const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const base = {
  workspaceId: "ws_1",
  contentId: "content_1",
  assigneeId: "user_2",
  dueAt: future,
  actorId: "user_1",
};
const readyRow = {
  id: "content_1",
  title: "Barrier repair basics",
  body: "## Caption\nhi\n\n## Script\nyo\n\n## Hashtags\n#a\n\n## CTA\ngo",
  clientId: "client_1",
  productionStage: null,
};

beforeEach(() => {
  dbMock.reset();
  getMembership.mockReset();
  getMembership.mockResolvedValue({ userId: "user_2", role: "member" });
  selectResult.content = [readyRow];
  selectResult.tickets = [];
});

describe("pushToTeam — guards", () => {
  it("rejects a due date in the past", async () => {
    const result = await pushToTeam({
      ...base,
      dueAt: new Date(Date.now() - 1000),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/future/i);
  });

  it("rejects an assignee who isn't in the workspace", async () => {
    getMembership.mockResolvedValue(null);
    const result = await pushToTeam(base);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/isn't in this workspace/i);
  });

  it("rejects a draft with no body — there is nothing to work on", async () => {
    selectResult.content = [{ ...readyRow, body: "" }];
    const result = await pushToTeam(base);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no content yet/i);
  });

  it("rejects a second push while a linked ticket is still open", async () => {
    selectResult.tickets = [{ id: "t_9", title: "Barrier repair basics" }];
    const result = await pushToTeam(base);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // names the existing ticket rather than a generic refusal
    expect(result.error).toContain("Barrier repair basics");
  });

  it("writes nothing when a guard rejects", async () => {
    await pushToTeam({ ...base, dueAt: new Date(Date.now() - 1000) });
    expect(written).toHaveLength(0);
  });
});

describe("pushToTeam — the unit", () => {
  it("writes the ticket, hub line, activity and notification together", async () => {
    const result = await pushToTeam(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ticketId).toBe("ticket_1");
    expect(written).toContain("tickets");
    expect(written).toContain("hub_messages");
    expect(written).toContain("activity");
    expect(written).toContain("notifications");
  });

  /**
   * The spec's rollback case: force a failure at the activity write and
   * assert the caller is told nothing changed rather than being handed a
   * half-push.
   */
  it("reports a clean failure when a write inside the unit fails", async () => {
    txShouldFailAt.table = "activity";
    const result = await pushToTeam(base);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/nothing was changed/i);
  });

  it("does not notify when someone pushes work to themselves", async () => {
    const result = await pushToTeam({ ...base, assigneeId: "user_1" });
    expect(result.ok).toBe(true);
    expect(written).not.toContain("notifications");
    // but the team still sees the hub line and the history
    expect(written).toContain("hub_messages");
    expect(written).toContain("activity");
  });
});

describe("pushToTeam — production stage advances on push", () => {
  it("moves a brand-new card (null stage) to in_progress", async () => {
    selectResult.content = [{ ...readyRow, productionStage: null }];
    const result = await pushToTeam(base);
    expect(result.ok).toBe(true);
    expect(contentUpdateSet.value?.productionStage).toBe("in_progress");
  });

  it("moves a card sitting in brief to in_progress", async () => {
    selectResult.content = [{ ...readyRow, productionStage: "brief" }];
    const result = await pushToTeam(base);
    expect(result.ok).toBe(true);
    expect(contentUpdateSet.value?.productionStage).toBe("in_progress");
  });

  /**
   * A card already past brief is mid-flight — pushing it to a (possibly
   * new) assignee must not yank it backward or sideways in the stage graph.
   */
  it("does not touch the stage of a card already past brief", async () => {
    selectResult.content = [{ ...readyRow, productionStage: "internal_review" }];
    const result = await pushToTeam(base);
    expect(result.ok).toBe(true);
    expect(contentUpdateSet.value).not.toHaveProperty("productionStage");
  });
});
