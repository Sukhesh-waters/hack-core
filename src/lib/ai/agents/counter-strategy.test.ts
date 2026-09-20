import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  buildCounterStrategyPrompt,
  generateCounterStrategy,
} from "./strategy";
import { routeAI } from "@/lib/ai/router";

vi.mock("@/lib/ai/router", () => ({ routeAI: vi.fn() }));
const routeAIMock = routeAI as unknown as Mock;

beforeEach(() => routeAIMock.mockReset());

describe("counter-strategy (strategy agent)", () => {
  it("returns empty array when competitor hook or brand context is empty", async () => {
    const res = await generateCounterStrategy({
      competitorHook: "",
      brandContext: "Brand DNA",
    });
    expect(res).toEqual([]);
    expect(routeAIMock).not.toHaveBeenCalled();
  });

  it("builds prompt with optional target audience", () => {
    const prompt = buildCounterStrategyPrompt({
      competitorHook: "Stop buying cheap coffee",
      brandContext: "Fresh roasts only",
      targetAudience: "Coffee connoisseurs",
    });
    expect(prompt).toContain("Stop buying cheap coffee");
    expect(prompt).toContain("Fresh roasts only");
    expect(prompt).toContain("Coffee connoisseurs");
  });

  it("parses valid counter-positioning angles from AI response", async () => {
    routeAIMock.mockResolvedValue(
      JSON.stringify({
        counterAngles: [
          {
            topic: "Roast Freshness",
            hook: "Cheap coffee isn't your problem — stale coffee is.",
            angle: "Highlight roast date transparency vs generic organic labels.",
            targetPainPoint: "Bitterness and stale taste",
            sourceCompetitorHook: "Stop buying cheap coffee",
          },
        ],
      }),
    );

    const res = await generateCounterStrategy({
      competitorHook: "Stop buying cheap coffee",
      brandContext: "Fresh roasts with printed roast dates",
    });

    expect(res).toHaveLength(1);
    expect(res[0].topic).toBe("Roast Freshness");
    expect(res[0].sourceCompetitorHook).toBe("Stop buying cheap coffee");
    expect(routeAIMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: "fast",
        json: true,
      }),
    );
  });
});
