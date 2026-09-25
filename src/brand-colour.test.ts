import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * C7.9 (owner decision D11): the product's colour is a mild Salesforce-style
 * blue from the theme tokens (--brand, --primary). Teal must not creep back:
 * no Tailwind teal-* classes and no hard-coded teal values. Client data
 * defaults (a new brand's placeholder swatch, the hex validator's example)
 * are data, not the product's look, and are named here explicitly.
 */
const ROOTS = [join(__dirname, "app"), join(__dirname, "components"), join(__dirname, "lib")];
const ALLOWLIST = new Set(["components/brand/color-palette-input.tsx", "lib/validation.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

const rel = (p: string) => p.slice(__dirname.length + 1).split(sep).join("/");
const files = ROOTS.flatMap((r) => walk(r)).filter((f) => !ALLOWLIST.has(rel(f)));

describe("brand colour (C7.9)", () => {
  it("no Tailwind teal-* utilities", () => {
    const offenders = files.filter((f) => /\bteal-\d{2,3}\b/.test(readFileSync(f, "utf-8"))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("no hard-coded teal values", () => {
    const teal = /#0d9488|#0f9d8a|#14b8a6|#2dd4bf|#0f766e|13,\s*148,\s*136/i;
    const offenders = files.filter((f) => teal.test(readFileSync(f, "utf-8"))).map(rel);
    expect(offenders).toEqual([]);
  });
});
