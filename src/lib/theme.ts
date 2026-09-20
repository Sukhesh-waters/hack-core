export type ThemePreference = "light" | "dark";

/** localStorage key. Namespaced so it never collides with another app's
 *  bare "theme" key if this ever runs alongside one (browser extensions,
 *  shared subdomains). */
export const THEME_STORAGE_KEY = "platina-theme";

/**
 * `stored ?? system ?? "dark"`. An explicit user choice always wins; absent
 * that, follow `prefers-color-scheme`; absent even a system read (no
 * `window`, e.g. the very first paint before the blocking script runs),
 * default dark — most of the component tree is still authored assuming a
 * dark shell until the A3 token migration completes, so dark is the safer
 * default mid-migration.
 */
export function resolveTheme(
  stored: ThemePreference | null,
  prefersDark: boolean | null,
): ThemePreference {
  if (stored) return stored;
  if (prefersDark !== null) return prefersDark ? "dark" : "light";
  return "dark";
}
