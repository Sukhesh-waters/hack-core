import { describe, expect, it } from "vitest";
import { mapIdeaFormatToContentType } from "./accept-idea";

describe("mapIdeaFormatToContentType", () => {
  it("maps recognized formats case-insensitively", () => {
    expect(mapIdeaFormatToContentType("Reel")).toBe("reel");
    expect(mapIdeaFormatToContentType("5-slide Carousel")).toBe("carousel");
    expect(mapIdeaFormatToContentType("Story")).toBe("story");
  });

  it("defaults to post for null, unrecognized, or explicit Post", () => {
    expect(mapIdeaFormatToContentType(null)).toBe("post");
    expect(mapIdeaFormatToContentType("Post")).toBe("post");
    expect(mapIdeaFormatToContentType("Something else entirely")).toBe(
      "post",
    );
  });
});
