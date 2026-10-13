import { describe, expect, it } from "vitest";
import { BRAIN_STAGES, deterministicShare, modeOf, parseBrainModes } from "./brain-modes";

describe("parseBrainModes", () => {
  it("defaults every stage to off when raw is null/undefined/not an object", () => {
    for (const raw of [null, undefined, "nope", 42, []]) {
      const modes = parseBrainModes(raw);
      for (const stage of BRAIN_STAGES) expect(modes[stage]).toBe("off");
    }
  });

  it("never throws on malformed input", () => {
    expect(() => parseBrainModes(undefined)).not.toThrow();
    expect(() => parseBrainModes("garbage")).not.toThrow();
    expect(() => parseBrainModes({ interrogation: { nested: true } })).not.toThrow();
  });

  it("reads valid modes and defaults invalid/missing ones to off", () => {
    const modes = parseBrainModes({ interrogation: "shadow", challenger: "on", gate: "not-a-mode", retrieval: 5 });
    expect(modes.interrogation).toBe("shadow");
    expect(modes.challenger).toBe("on");
    expect(modes.gate).toBe("off"); // invalid string
    expect(modes.retrieval).toBe("off"); // wrong type
    expect(modes.surprise).toBe("off"); // missing
    expect(modes.budget).toBe("off");
    expect(modes.grading).toBe("off");
  });

  it("covers every declared stage", () => {
    const modes = parseBrainModes({});
    expect(Object.keys(modes).sort()).toEqual([...BRAIN_STAGES].sort());
  });
});

describe("modeOf", () => {
  it("is off for every stage when config is null/undefined", () => {
    expect(modeOf(null, "gate")).toBe("off");
    expect(modeOf(undefined, "surprise")).toBe("off");
  });

  it("is off when brainModes is missing on the config", () => {
    expect(modeOf({}, "gate")).toBe("off");
  });

  it("reads the stage's mode from the config", () => {
    const config = { brainModes: { gate: "on" as const } };
    expect(modeOf(config, "gate")).toBe("on");
    expect(modeOf(config, "surprise")).toBe("off");
  });
});

describe("deterministicShare", () => {
  it("is stable: the same id, share and salt always answers the same way", () => {
    const first = deterministicShare("signal-123", 0.5, "challenger-arm");
    for (let i = 0; i < 20; i++) {
      expect(deterministicShare("signal-123", 0.5, "challenger-arm")).toBe(first);
    }
  });

  it("share 0 is always false and share 1 is always true", () => {
    for (const id of ["a", "b", "c", "signal-xyz"]) {
      expect(deterministicShare(id, 0)).toBe(false);
      expect(deterministicShare(id, 1)).toBe(true);
    }
  });

  it("approximates the requested share over many ids", () => {
    const n = 2000;
    let trueCount = 0;
    for (let i = 0; i < n; i++) {
      if (deterministicShare(`id-${i}`, 0.1, "surprise-audit")) trueCount++;
    }
    const observed = trueCount / n;
    expect(observed).toBeGreaterThan(0.06);
    expect(observed).toBeLessThan(0.14);
  });

  it("different salts over the same id are independent splits", () => {
    const ids = Array.from({ length: 200 }, (_, i) => `id-${i}`);
    const armA = ids.map((id) => deterministicShare(id, 0.5, "arm-a"));
    const armB = ids.map((id) => deterministicShare(id, 0.5, "arm-b"));
    // Not identical across the whole set (would be astronomically unlikely
    // if the salt had no effect).
    expect(armA).not.toEqual(armB);
  });
});
