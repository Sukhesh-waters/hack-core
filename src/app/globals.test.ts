import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression lock for the theme rewrite (A1 / counterattack-13).
 *
 * `!important` and the `:not(.dark) X` descendant pattern are the two
 * mechanisms that made the old light-mode compat layer both fragile and
 * actively wrong: `:not(.dark) X` matches any `.dark`-less ANCESTOR, and
 * since `.dark` is applied to `<html>` while `<body>` never carries it, the
 * rule fired unconditionally regardless of the resolved theme — the root
 * cause of V7 (dark mode was unfixable by toggling) and, combined with
 * `!important`, of V5 (a component that is unconditionally dark, like a
 * dropdown menu, had its light text forced dark on top of a dark
 * background). The replacement compat layer wins ties through selector
 * specificity (`html X` outranks the bare utility; `.dark X` outranks
 * `html X`) instead — see the comment block in globals.css.
 */
describe("globals.css — theme compat layer", () => {
  const css = readFileSync(
    join(__dirname, "globals.css"),
    "utf-8",
  );

  it("never uses !important", () => {
    expect(css).not.toContain("!important");
  });

  it("never uses the :not(.dark) descendant pattern", () => {
    expect(css).not.toMatch(/:not\(\.dark\)/);
  });

  /**
   * Every `html .foo { ... }` compat rule needs a `.dark .foo { ... }`
   * counterpart, or the light-mode override stays active in dark mode too
   * — it has no built-in awareness of the theme, only higher specificity
   * than the bare utility, and only a `.dark` rule outranks THAT. Found by
   * browser-testing the sidebar after A1: `bg-slate-950/60` was recolored
   * light even with `.dark` on `<html>`, because its light-mode rule had
   * no dark-mode counterpart to cede priority back to it.
   */
  it("pairs every html-scoped compat rule with a .dark counterpart", () => {
    // Only single-class selectors (`html .foo {` or `html .foo,`) — not
    // compound descendant chains like `html .bg-primary .text-white`,
    // which are the deliberately theme-invariant "always white" exceptions
    // and need no dark-mode counterpart by design.
    const htmlClasses = new Set(
      [...css.matchAll(/html \.([\w\\/-]+)\s*[{,]/g)].map((m) => m[1]),
    );
    const darkClasses = new Set(
      [...css.matchAll(/\.dark \.([\w\\/-]+)\s*[{,]/g)].map((m) => m[1]),
    );
    const unpaired = [...htmlClasses].filter((c) => !darkClasses.has(c));
    expect(unpaired, `missing .dark counterpart for: ${unpaired.join(", ")}`).toEqual([]);
  });
});
