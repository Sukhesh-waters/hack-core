import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Definition of done for A3 (semantic token migration, part 2). Dark-authored
 * raw utilities (`text-white/*`, `bg-white/*`, `border-white/*`) must be gone
 * from every component; the only exception is a genuinely-white surface that
 * is deliberately theme-invariant (a brand button, the marketing landing
 * page), which the allowlist below names explicitly rather than pattern-matching.
 */

// D1 follow-up found the first version of this scan only walked .tsx files —
// src/lib/*.ts "chip class" records (Tailwind's JIT scans string literals
// wherever they live, not just JSX files) had four more raw-utility offenders
// sitting untouched. Scanning lib/ too closes that gap.
const ROOTS = [join(__dirname, "app"), join(__dirname, "components"), join(__dirname, "lib")];

// Files where a literal white surface is intentional and must not react to
// the app's light/dark toggle — not a migration gap.
const ALLOWLIST = new Set(["app/(marketing)/page.tsx"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (
      (entry.endsWith(".tsx") || entry.endsWith(".ts")) &&
      !entry.includes(".test.")
    ) {
      out.push(full);
    }
  }
  return out;
}

function relSrc(path: string): string {
  return path.slice(__dirname.length + 1);
}

const files = ROOTS.flatMap((root) => walk(root)).filter(
  (f) => !ALLOWLIST.has(relSrc(f)),
);

const WHITE_UTILITY = /\b(text|bg|border)-white(\/\d+|\[[\d.]+\])?\b/;

describe("theme-migration — semantic token coverage (A3)", () => {
  it("no text-white/* outside the allowlist", () => {
    const offenders = files
      .filter((f) => /\btext-white(\/\d+|\[[\d.]+\])?\b/.test(readFileSync(f, "utf-8")))
      .map(relSrc);
    expect(offenders).toEqual([]);
  });

  it("no bg-white/* outside the allowlist", () => {
    const offenders = files
      .filter((f) => /\bbg-white(\/\d+|\[[\d.]+\])?\b/.test(readFileSync(f, "utf-8")))
      .map(relSrc);
    expect(offenders).toEqual([]);
  });

  it("no border-white/* anywhere", () => {
    const offenders = files
      .filter((f) => /\bborder-white(\/\d+|\[[\d.]+\])?\b/.test(readFileSync(f, "utf-8")))
      .map(relSrc);
    expect(offenders).toEqual([]);
  });

  it("no bare (non-dark:) bg-slate-900 or bg-slate-950 — these belong to bg-popover", () => {
    const bare = /(^|[^:-])bg-slate-(900|950)(\/\d+)?\b/;
    const offenders = files
      .filter((f) => bare.test(readFileSync(f, "utf-8")))
      .map(relSrc);
    expect(offenders).toEqual([]);
  });

  it("no raw red-300/red-400 color literals — these belong to the destructive token", () => {
    // Found by accident during D2: 123 occurrences across 61 files, all
    // authored as error/danger UI, none paired with a dark: counterpart
    // (i.e. none were a legitimately dual-themed pair — every one was a
    // straight compat-layer gap the earlier A3 pass missed).
    const raw = /\b(text|bg|border)-red-(300|400)(\/\d+)?\b/;
    const offenders = files
      .filter((f) => raw.test(readFileSync(f, "utf-8")))
      .map(relSrc);
    expect(offenders).toEqual([]);
  });

  it("no decoration-white/* or border-t-white/* compound-prefix variants", () => {
    // The four checks above use \b(text|bg|border)-white, which doesn't
    // match a color utility hung off a compound prefix like `decoration-`
    // or `border-t-` — both real, found in revision-drawer.tsx and
    // production/page.tsx respectively.
    const raw = /\b(decoration|border-t)-white(\/\d+|\[[\d.]+\])?\b/;
    const offenders = files
      .filter((f) => raw.test(readFileSync(f, "utf-8")))
      .map(relSrc);
    expect(offenders).toEqual([]);
  });

  it("no border-t-red-300/400 compound-prefix variants", () => {
    const raw = /\bborder-t-red-(300|400)(\/\d+)?\b/;
    const offenders = files
      .filter((f) => raw.test(readFileSync(f, "utf-8")))
      .map(relSrc);
    expect(offenders).toEqual([]);
  });

  it("globals.css has no COMPAT block", () => {
    const css = readFileSync(join(__dirname, "app/globals.css"), "utf-8");
    expect(css).not.toMatch(/COMPAT LAYER/i);
  });

  it("the allowlist only exists because these files are deliberately theme-invariant", () => {
    // Sanity check the allowlist itself doesn't silently grow stale — if a
    // listed file no longer contains a white utility, it no longer needs
    // the exemption and should be removed from ALLOWLIST.
    for (const rel of ALLOWLIST) {
      const full = join(__dirname, rel);
      const content = readFileSync(full, "utf-8");
      expect(WHITE_UTILITY.test(content), `${rel} no longer needs an allowlist entry`).toBe(true);
    }
  });
});
