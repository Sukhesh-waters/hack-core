"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "@/lib/theme";

const ThemeContext = createContext<{
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
} | null>(null);

/**
 * Owns the `.dark` class on `<html>` for the lifetime of the session. The
 * blocking inline script in the root layout already set the class before
 * first paint (see `src/app/layout.tsx`) — this only needs to apply the
 * SAME resolution afterward so React's view of the theme matches the DOM,
 * and to react to explicit toggles.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Always "dark" on first render, matching the server's only possible
  // answer (it has no `document`) — reading the real DOM class here instead
  // would make the client's FIRST render pass diverge from the server's,
  // which is exactly what a hydration mismatch is. The blocking script in
  // the root layout already set the correct class before paint, so this
  // effect (below) only needs to resync React's state to match it — that
  // happens post-hydration, where a state update is just a normal re-render,
  // not a hydration comparison.
  const [theme, setThemeState] = useState<ThemePreference>("dark");

  useEffect(() => {
    const fromDom = document.documentElement.classList.contains("dark")
      ? "dark"
      : "light";
    setThemeState(fromDom);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resync once, on mount only
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const setTheme = useCallback((next: ThemePreference) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
    setThemeState(next);
  }, []);

  // No stored preference yet: keep following the system until the user
  // makes an explicit choice, matching resolveTheme's own precedence.
  useEffect(() => {
    if (window.localStorage.getItem(THEME_STORAGE_KEY)) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      setThemeState(resolveTheme(null, media.matches));
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
