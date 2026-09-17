import { describe, expect, it } from "vitest";
import { CONFERENCE_PRESETS, getConferencePreset } from "./presets";

describe("conference presets", () => {
  it("are unique, valid https URLs", () => {
    const keys = CONFERENCE_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const preset of CONFERENCE_PRESETS) {
      const url = new URL(preset.url);
      expect(url.protocol).toBe("https:");
    }
  });

  it("resolves by key and misses cleanly", () => {
    expect(getConferencePreset("asms")?.name).toContain("ASMS");
    expect(getConferencePreset("nope")).toBeNull();
  });
});
