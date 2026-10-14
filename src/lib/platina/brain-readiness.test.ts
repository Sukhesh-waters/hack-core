import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRAIN_MIGRATIONS, checkBrainMigrations, describeChecks } from "./brain-readiness";

const all = () =>
  new Set(BRAIN_MIGRATIONS.flatMap((m) => m.objects.flatMap((o) => (o.column ? [`${o.table}.${o.column}`, o.table] : [o.table]))));

describe("checkBrainMigrations", () => {
  it("all present → every migration OK", () => {
    expect(checkBrainMigrations(all()).every((c) => c.ok)).toBe(true);
  });

  it("names exactly what a missing migration lacks", () => {
    const present = all();
    present.delete("platina_insight_grades");
    const checks = checkBrainMigrations(present);
    expect(checks.find((c) => c.id === "0089")).toMatchObject({ ok: false, missing: ["platina_insight_grades"] });
    expect(describeChecks(checks).find((l) => l.includes("0089"))).toMatch(/^MISSING/);
  });

  it("every object it checks is really created by that migration's SQL (no drift from the files)", () => {
    const dir = join(process.cwd(), "drizzle");
    const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f));
    for (const m of BRAIN_MIGRATIONS) {
      const file = files.find((f) => f.startsWith(`${m.id}_`));
      if (!file) continue; // a migration still being built on another branch
      const sql = readFileSync(join(dir, file), "utf8");
      for (const o of m.objects) {
        const needle = o.column ? `"${o.column}"` : `CREATE TABLE "${o.table}"`;
        expect(sql, `${m.id} should create ${o.column ? `${o.table}.${o.column}` : o.table}`).toContain(needle);
      }
    }
  });
});
