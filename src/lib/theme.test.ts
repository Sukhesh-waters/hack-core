import { describe, expect, it } from "vitest";
import { resolveTheme, THEME_STORAGE_KEY } from "./theme";

/**
 * Owner decision C7.9: light by default. An explicit choice from the theme
 * menu always wins; nothing else (including the OS dark preference) does.
 */
describe("resolveTheme", () => {
  it("an explicit stored choice always wins", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("is light when nothing is stored", () => {
    expect(resolveTheme(null)).toBe("light");
  });
});

describe("THEME_STORAGE_KEY", () => {
  it("is a stable, namespaced key", () => {
    expect(THEME_STORAGE_KEY).toBe("platina-theme");
  });
});
