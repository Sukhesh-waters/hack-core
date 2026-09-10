import { describe, expect, it } from "vitest";
import { WIDTH_CLASSES, type PageWidth } from "@/lib/page-width";

describe("PageShell width contract", () => {
  const EXPECTED: { width: PageWidth; class: string }[] = [
    { width: "prose", class: "max-w-3xl" },
    { width: "app", class: "max-w-6xl" },
    { width: "wide", class: "max-w-[1600px]" },
  ];

  for (const { width, class: cls } of EXPECTED) {
    it(`"${width}" maps to ${cls}`, () => {
      expect(WIDTH_CLASSES[width]).toBe(cls);
    });
  }

  it('"full" emits no max-w-* class', () => {
    expect(WIDTH_CLASSES.full).toBe("");
  });

  it("every PageWidth key is covered", () => {
    const keys = Object.keys(WIDTH_CLASSES).sort();
    expect(keys).toEqual(["app", "full", "prose", "wide"]);
  });
});
