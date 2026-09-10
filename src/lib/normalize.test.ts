import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { normalizeCaptions } from "./normalize";
import { routeAI } from "@/lib/ai/router";

vi.mock("@/lib/ai/router", () => ({ routeAI: vi.fn() }));
// Cast past routeAI's overloads — this suite only exercises the chat shape.
const routeAIMock = routeAI as unknown as Mock;

beforeEach(() => {
  routeAIMock.mockReset();
});

describe("normalizeCaptions", () => {
  it("maps classified formats and topics back to caption positions", async () => {
    routeAIMock.mockResolvedValue(
      JSON.stringify({
        posts: [{ index: 1, format: "reel", topics: ["launch", "summer"] }],
      }),
    );
    const result = await normalizeCaptions([undefined, "Summer launch reel"]);
    expect(result[0]).toBeNull();
    expect(result[1]).toEqual({ format: "reel", topics: ["launch", "summer"] });
  });

  it("degrades to nulls when the model call fails — import must not block", async () => {
    routeAIMock.mockRejectedValue(new Error("provider down"));
    await expect(normalizeCaptions(["a", "b"])).resolves.toEqual([null, null]);
  });

  it("degrades to nulls when the model returns malformed JSON", async () => {
    routeAIMock.mockResolvedValue("not json at all");
    await expect(normalizeCaptions(["a"])).resolves.toEqual([null]);
  });

  it("skips the model entirely when no captions are present", async () => {
    await expect(normalizeCaptions([undefined, ""])).resolves.toEqual([
      null,
      null,
    ]);
    expect(routeAIMock).not.toHaveBeenCalled();
  });
});
