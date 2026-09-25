"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
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
  // Always "light" on first render, matching the server's only possible
  // answer (it has no `document`) and the product default (C7.9). The
  // blocking script already applied a stored "dark" before paint; the effect
  // below resyncs React's state to the DOM after hydration, where a state
  // update is a normal re-render, not a hydration comparison.
  const [theme, setThemeState] = useState<ThemePreference>("light");

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
