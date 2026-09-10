import { describe, expect, it } from "vitest";
import { resolveTheme, THEME_STORAGE_KEY } from "./theme";

/**
 * The whole point of this function: an explicit stored choice always wins;
 * absent that, follow the system; absent even that (no window, e.g. the
 * blocking inline script's SSR-adjacent edge case), default dark — matching
 * where most of the component tree is still authored until the A3 token
 * migration finishes.
 */
describe("resolveTheme", () => {
  it("an explicit stored preference always wins over system", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("follows the system preference when nothing is stored", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
  });

  it("defaults dark when neither stored nor system is known", () => {
    expect(resolveTheme(null, null)).toBe("dark");
  });
});

describe("THEME_STORAGE_KEY", () => {
  it("is a stable, namespaced key", () => {
    expect(THEME_STORAGE_KEY).toBe("instamedia-theme");
  });
});
