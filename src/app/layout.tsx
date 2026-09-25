import type { Metadata } from "next";
import { NavLoadingBar } from "@/components/nav-loading-bar";
import { ThemeProvider } from "@/components/theme-provider";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Platina AI OS",
    template: "%s · Platina AI OS",
  },
  description:
    "The agency operating system for social content — baseline-driven ideation, studio, calendar, and campaign planning for every client workspace.",
};

// Sets `.dark` on <html> before first paint so there is no flash of the
// wrong theme. Deliberately plain JS, not a build of src/lib/theme.ts's
// resolveTheme — a <script> tag can't import a module — but it mirrors the
// same rule (a stored "dark" wins, otherwise light; C7.9) and that
// function's tests are what keep the two definitions honest.
const noFlashScript = `
(function () {
  try {
    var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    document.documentElement.classList.toggle("dark", stored === "dark");
  } catch (e) {
    document.documentElement.classList.remove("dark");
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
