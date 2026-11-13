import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runOrigin } from "./run-origin";

const SCRIPTS_DIR = join(__dirname, "..", "..", "..", "scripts");

function listScriptFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listScriptFiles(full));
    else if (entry.endsWith(".ts") || entry.endsWith(".mjs") || entry.endsWith(".js")) out.push(full);
  }
  return out;
}

describe("runOrigin (WTR-0 Part B4)", () => {
  it("classifies a marked run as operator regardless of trigger", () => {
    expect(
      runOrigin({
        trigger: "manual",
        idempotencyKey: "first-pass:s1",
        configSnapshot: { operator: "scripts/onboard-client.ts" },
      }),
    ).toBe("operator");
    expect(
      runOrigin({
        trigger: "event",
        idempotencyKey: "approved:s1",
        configSnapshot: { operator: "scripts/add-events.ts" },
      }),
    ).toBe("operator");
  });

  it("classifies a schedule run as schedule", () => {
    expect(
      runOrigin({
        trigger: "schedule",
        idempotencyKey: "schedule:spec-1:2026-11-09T10:00",
        configSnapshot: {},
      }),
    ).toBe("schedule");
  });

  it("classifies legacy prefix-identifiable runs accurately", () => {
    expect(runOrigin({ trigger: "manual", idempotencyKey: "seed:2026-10-01:s1" })).toBe("operator");
    expect(runOrigin({ trigger: "manual", idempotencyKey: "ads:operator:s1:1" })).toBe("operator");
    expect(runOrigin({ trigger: "event", idempotencyKey: "backfill:s1:90d:2026-09-21" })).toBe("operator");
    expect(runOrigin({ trigger: "manual", idempotencyKey: "ads:manual:s1:1" })).toBe("person");
    expect(runOrigin({ trigger: "manual", idempotencyKey: "manual:s1:2026-10-01T10:00" })).toBe("person");
    expect(runOrigin({ trigger: "manual", idempotencyKey: "add:s1:1" })).toBe("person");
  });

  it("reports an old unmarked manual or event run with an ambiguous key as unknown, never person", () => {
    expect(runOrigin({ trigger: "manual", idempotencyKey: "custom:1" })).toBe("unknown");
    expect(runOrigin({ trigger: "event", idempotencyKey: "first-pass:s1" })).toBe("unknown");
    expect(runOrigin({ trigger: "event", idempotencyKey: "approved:s1" })).toBe("unknown");
  });

  it("classifies unmarked runs after markedSince as person or event", () => {
    const markedSince = new Date("2026-11-09T00:00:00Z");
    expect(
      runOrigin(
        {
          trigger: "event",
          idempotencyKey: "first-pass:s1",
          createdAt: new Date("2026-11-10T00:00:00Z"),
        },
        { markedSince },
      ),
    ).toBe("event");
  });
});

function extractCallBodies(content: string, fnName: string): string[] {
  const bodies: string[] = [];
  const token = `${fnName}(`;
  let idx = 0;
  while ((idx = content.indexOf(token, idx)) !== -1) {
    let depth = 1;
    let pos = idx + token.length;
    const start = pos;
    while (pos < content.length && depth > 0) {
      if (content[pos] === "(") depth += 1;
      else if (content[pos] === ")") depth -= 1;
      pos += 1;
    }
    bodies.push(content.slice(start, pos - 1));
    idx = pos;
  }
  return bodies;
}

describe("operator script guard (WTR-0 Part B3)", () => {
  it("every file under scripts/ that calls createAuditRun passes an operator marker", () => {
    const scripts = listScriptFiles(SCRIPTS_DIR);
    const callers = scripts.filter((f) => readFileSync(f, "utf8").includes("createAuditRun("));
    expect(callers.length).toBeGreaterThanOrEqual(5);
    const unmarked: string[] = [];
    for (const file of callers) {
      const content = readFileSync(file, "utf8");
      for (const body of extractCallBodies(content, "createAuditRun")) {
        if (!/operator:\s*["']scripts\//.test(body)) {
          unmarked.push(file);
        }
      }
    }
    expect(unmarked).toEqual([]);
  });
});
