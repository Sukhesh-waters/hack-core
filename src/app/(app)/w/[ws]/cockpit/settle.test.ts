import { describe, expect, it } from "vitest";
import { resolved } from "./settle";

describe("resolved", () => {
  it("returns the fulfilled value and does not record a failure", () => {
    const failed: string[] = [];
    const value = resolved(
      { status: "fulfilled", value: 42 },
      0,
      "some section",
      failed,
    );
    expect(value).toBe(42);
    expect(failed).toEqual([]);
  });

  it("returns the fallback and records the label on rejection", () => {
    const failed: string[] = [];
    const value = resolved(
      { status: "rejected", reason: new Error("db down") },
      0,
      "some section",
      failed,
    );
    expect(value).toBe(0);
    expect(failed).toEqual(["some section"]);
  });

  it("accumulates multiple failure labels across calls", () => {
    const failed: string[] = [];
    resolved({ status: "rejected", reason: "x" }, [], "A", failed);
    resolved({ status: "fulfilled", value: [] }, [], "B", failed);
    resolved({ status: "rejected", reason: "y" }, [], "C", failed);
    expect(failed).toEqual(["A", "C"]);
  });
});
