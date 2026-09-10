import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { AIBudgetError, dayStart, enforceAiBudget, logAiUsage } from "./budget";
import { runWithAiCost } from "./usage-context";
import { isDbConfigured } from "@/db";
import { listImmediateMemberEmails } from "@/db/queries/memberships";
import {
  getWorkspaceSpendSince,
  hasCapAlertSince,
  insertAiUsage,
} from "@/db/queries/usage";
import { resend } from "@/lib/resend";

vi.mock("@/db", () => ({ isDbConfigured: vi.fn(), db: {} }));
vi.mock("@/db/queries/usage", () => ({
  getWorkspaceSpendSince: vi.fn(),
  hasCapAlertSince: vi.fn(),
  insertAiUsage: vi.fn(),
}));
vi.mock("@/db/queries/memberships", () => ({
  listImmediateMemberEmails: vi.fn(),
}));
vi.mock("@/lib/resend", () => ({
  resend: { emails: { send: vi.fn() } },
}));

const dbConfiguredMock = isDbConfigured as unknown as Mock;
const spendMock = getWorkspaceSpendSince as unknown as Mock;
const alertSentMock = hasCapAlertSince as unknown as Mock;
const insertMock = insertAiUsage as unknown as Mock;
const emailsMock = listImmediateMemberEmails as unknown as Mock;
const sendMock = resend.emails.send as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  dbConfiguredMock.mockReturnValue(true);
  insertMock.mockResolvedValue(undefined);
  emailsMock.mockResolvedValue(["owner@agency.com"]);
  sendMock.mockResolvedValue({ error: null });
  delete process.env.AI_DAILY_COST_CAP_USD;
});

describe("dayStart", () => {
  it("returns UTC midnight of the given day", () => {
    const start = dayStart(new Date("2026-07-08T15:30:00Z"));
    expect(start.toISOString()).toBe("2026-07-08T00:00:00.000Z");
  });
});

describe("enforceAiBudget", () => {
  it("no-op outside a cost context — system jobs never gated", async () => {
    await expect(enforceAiBudget()).resolves.toBeUndefined();
    expect(spendMock).not.toHaveBeenCalled();
  });

  it("no-op when the DB is not configured (tests, cold envs)", async () => {
    dbConfiguredMock.mockReturnValue(false);
    await runWithAiCost({ workspaceId: "ws1" }, async () => {
      await expect(enforceAiBudget()).resolves.toBeUndefined();
    });
    expect(spendMock).not.toHaveBeenCalled();
  });

  it("passes under the cap", async () => {
    spendMock.mockResolvedValue({ costUsd: 4.99, calls: 12 });
    await runWithAiCost({ workspaceId: "ws1" }, async () => {
      await expect(enforceAiBudget()).resolves.toBeUndefined();
    });
  });

  it("first breach: records cap-alert row, emails members, throws", async () => {
    spendMock.mockResolvedValue({ costUsd: 5.01, calls: 40 });
    alertSentMock.mockResolvedValue(false);
    await runWithAiCost({ workspaceId: "ws1" }, async () => {
      await expect(enforceAiBudget()).rejects.toBeInstanceOf(AIBudgetError);
    });
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws1", purpose: "cap-alert" }),
    );
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("later breaches: throws without a second email", async () => {
    spendMock.mockResolvedValue({ costUsd: 9, calls: 60 });
    alertSentMock.mockResolvedValue(true);
    await runWithAiCost({ workspaceId: "ws1" }, async () => {
      await expect(enforceAiBudget()).rejects.toBeInstanceOf(AIBudgetError);
    });
    expect(sendMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("respects AI_DAILY_COST_CAP_USD override", async () => {
    process.env.AI_DAILY_COST_CAP_USD = "20";
    spendMock.mockResolvedValue({ costUsd: 6, calls: 10 });
    await runWithAiCost({ workspaceId: "ws1" }, async () => {
      await expect(enforceAiBudget()).resolves.toBeUndefined();
    });
  });
});

describe("logAiUsage", () => {
  it("attributes to the active context with an estimated cost", async () => {
    await runWithAiCost(
      { workspaceId: "ws1", purpose: "ideation" },
      async () => {
        logAiUsage({
          provider: "groq",
          model: "llama-3.3-70b-versatile",
          kind: "chat",
          tier: "fast",
          tokensIn: 1000,
          tokensOut: 500,
        });
      },
    );
    expect(insertMock).toHaveBeenCalledTimes(1);
    const row = insertMock.mock.calls[0][0];
    expect(row.workspaceId).toBe("ws1");
    expect(row.purpose).toBe("ideation");
    expect(row.costUsd).toBeGreaterThan(0);
  });

  it("logs system rows (workspace null) outside a context", () => {
    logAiUsage({
      provider: "gemini",
      model: "text-embedding-004",
      kind: "embed",
      tokensIn: 200,
      tokensOut: 0,
    });
    expect(insertMock.mock.calls[0][0].workspaceId).toBeNull();
  });

  it("skips silently when the DB is not configured", () => {
    dbConfiguredMock.mockReturnValue(false);
    logAiUsage({
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      kind: "chat",
      tokensIn: 10,
      tokensOut: 10,
    });
    expect(insertMock).not.toHaveBeenCalled();
  });
});
