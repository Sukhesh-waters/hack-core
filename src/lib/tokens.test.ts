import { describe, expect, it } from "vitest";
import config from "../../tailwind.config";

const colors = config.theme.extend.colors;
const fonts = config.theme.extend.fontFamily;

describe("design tokens", () => {
  it("brand accents match the spec", () => {
    expect(colors.brand).toEqual({
      teal: "#0d9488",
      purple: "#8b5cf6",
      amber: "#f59e0b",
      success: "#10b981",
    });
  });

  it("font stacks map to the three families", () => {
    expect(fonts.display[0]).toBe("var(--font-display)"); // Playfair Display
    expect(fonts.sans[0]).toBe("var(--font-sans)"); // Inter
    expect(fonts.mono[0]).toBe("var(--font-mono)"); // IBM Plex Mono
  });
});
