import { describe, expect, it, vi } from "vitest";
import { runOrchestration } from "./run";

describe("runOrchestration", () => {
  it("short-circuits on insufficient context without calling the agent, critic, or apply", async () => {
    const agent = vi.fn();
    const apply = vi.fn();

    const result = await runOrchestration({
      taskType: "test_task",
      contextParams: {},
      assembleContext: async () => ({
        state: "insufficient_baseline",
        sampleSize: 3,
      }),
      agent,
      validate: () => ({ valid: true }),
      apply,
    });

    expect(result).toEqual({
      status: "insufficient_context",
      state: "insufficient_baseline",
    });
    expect(agent).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it("short-circuits on an invalid proposal without calling critic or apply", async () => {
    const critic = vi.fn();
    const apply = vi.fn();

    const result = await runOrchestration({
      taskType: "test_task",
      contextParams: {},
      assembleContext: async () => ({
        state: "context_available",
        context: { ok: true },
      }),
      agent: async () => ({ proposal: "bad" }),
      validate: () => ({ valid: false, reason: "missing required field" }),
      critic,
      apply,
    });

    expect(result).toEqual({
      status: "invalid_proposal",
      reason: "missing required field",
    });
    expect(critic).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it("skips the critic step entirely when none is supplied", async () => {
    const apply = vi.fn().mockResolvedValue({ saved: true });

    const result = await runOrchestration({
      taskType: "test_task",
      contextParams: {},
      assembleContext: async () => ({
        state: "context_available",
        context: { ok: true },
      }),
      agent: async () => ({ proposal: "good" }),
      validate: () => ({ valid: true }),
      apply,
    });

    expect(result).toEqual({ status: "completed", output: { saved: true }, critic: undefined });
    expect(apply).toHaveBeenCalledWith(
      { proposal: "good" },
      { ok: true },
      undefined,
    );
  });

  it("runs the critic and passes its verdict through to apply and the result", async () => {
    const context = { ok: true };
    const proposal = { proposal: "good" };
    const critic = vi
      .fn()
      .mockResolvedValue({ verdict: "flagged", feedback: ["risky budget"] });
    const apply = vi.fn().mockResolvedValue({ saved: true });

    const result = await runOrchestration({
      taskType: "test_task",
      contextParams: {},
      assembleContext: async () => ({ state: "context_available", context }),
      agent: async () => proposal,
      validate: () => ({ valid: true }),
      critic,
      apply,
    });

    expect(critic).toHaveBeenCalledWith(proposal, context);
    expect(apply).toHaveBeenCalledWith(proposal, context, {
      verdict: "flagged",
      feedback: ["risky budget"],
    });
    expect(result).toEqual({
      status: "completed",
      output: { saved: true },
      critic: { verdict: "flagged", feedback: ["risky budget"] },
    });
  });
});
