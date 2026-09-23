export type ThemePreference = "light" | "dark";

/** localStorage key. Namespaced so it never collides with another app's
 *  bare "theme" key if this ever runs alongside one (browser extensions,
 *  shared subdomains). */
export const THEME_STORAGE_KEY = "platina-theme";

/**
 * `stored ?? "light"`. Owner decision (C7.9, 2026-09-22): the product is
 * light by default. An explicit choice from the theme menu always wins; the
 * operating system's dark preference no longer switches it, so everyone
 * lands on the same light, report-first surface unless they pick dark.
 */
export function resolveTheme(stored: ThemePreference | null): ThemePreference {
  return stored ?? "light";
}
