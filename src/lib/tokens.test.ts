import { describe, expect, it } from "vitest";
import config from "../../tailwind.config";

const colors = config.theme.extend.colors;
const fonts = config.theme.extend.fontFamily;

describe("design tokens", () => {
  it("brand accents match the spec (C7.9: the brand blue comes from the theme)", () => {
    expect(colors.brand).toEqual({
      teal: "hsl(var(--brand) / <alpha-value>)",
      blue: "hsl(var(--brand) / <alpha-value>)",
      sky: "hsl(var(--brand-sky) / <alpha-value>)",
      purple: "#8b5cf6",
      amber: "#f59e0b",
      success: "#10b981",
    });
  });

  it("the brand blue is readable: text and buttons pass WCAG AA (4.5:1)", () => {
    const lin = (c: number) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    // globals.css: --brand/--primary light 207 99% 42% (#0176D3), dark 208 100% 55% (#1B96FF).
    expect(ratio("#0176D3", "#FFFFFF")).toBeGreaterThanOrEqual(4.5); // text on white, white on buttons
    expect(ratio("#1B96FF", "#0B1220")).toBeGreaterThanOrEqual(4.5); // text on the dark shell
    // The Salesforce-logo blue (--brand-sky, #00A1E0) is NOT readable as text on white: decorative only.
    expect(ratio("#00A1E0", "#FFFFFF")).toBeLessThan(4.5);
  });

  it("font stacks map to the three families", () => {
    expect(fonts.display[0]).toBe("var(--font-display)"); // Playfair Display
    expect(fonts.sans[0]).toBe("var(--font-sans)"); // Inter
    expect(fonts.mono[0]).toBe("var(--font-mono)"); // IBM Plex Mono
  });
});
