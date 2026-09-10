import type { Metadata } from "next";
import { NavLoadingBar } from "@/components/nav-loading-bar";
import { ThemeProvider } from "@/components/theme-provider";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "InstaMedia AI",
    template: "%s · InstaMedia AI",
  },
  description:
    "The agency operating system for social content — baseline-driven ideation, studio, and calendar for every client workspace.",
};

// Sets `.dark` on <html> before first paint so there is no flash of the
// wrong theme. Deliberately plain JS, not a build of src/lib/theme.ts's
// resolveTheme — a <script> tag can't import a module — but it mirrors the
// same precedence (stored → system → dark) and that function's tests are
// what keep the two definitions honest if either one changes.
const noFlashScript = `
(function () {
  try {
    var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    var dark;
    if (stored === "dark" || stored === "light") {
      dark = stored === "dark";
    } else if (window.matchMedia) {
      dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    } else {
      dark = true;
    }
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {
    document.documentElement.classList.add("dark");
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The blocking script below sets .dark on this element before React
    // hydrates, deliberately diverging from what the server rendered (the
    // server has no window, so it can't know the resolved theme) — that's
    // the whole no-flash mechanism. suppressHydrationWarning scopes React's
    // mismatch check to skip exactly this element's attributes; it does not
    // suppress mismatches anywhere else in the tree.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashScript }} />
      </head>
      <body>
        <ThemeProvider>
          <NavLoadingBar />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
