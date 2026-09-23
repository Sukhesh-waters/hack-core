import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Platina/InstaMedia dependency boundary (Slice 0, W0.2).
 *
 * The constitution rules Platina a parallel product: it shares auth,
 * workspace membership, the model router, the db client, and Inngest
 * infrastructure with InstaMedia — and nothing else. This test is the
 * automated enforcement. It walks every Platina code root and classifies
 * each import specifier:
 *
 *   1. grandfathered exception (ratchet — may only shrink);
 *   2. forbidden InstaMedia module → fail, even if allowlisted later;
 *   3. internal `@/` specifier not on the allowlist → fail;
 *   4. anything else (packages, relative, allowlisted) → pass.
 *
 * A second scan forbids archived-bridge strings (`sop_run_id`, the archived
 * alert-action kinds) anywhere outside the three named files that own them
 * until the approved drop migration lands.
 *
 * Precedent: src/theme-migration.test.ts, including Windows-separator
 * normalization in relSrc.
 */

const SRC = join(__dirname, "..", "..");

const ROOT_DIRS = [
  join("app", "(platina)"),
  join("components", "platina"),
  join("lib", "platina"),
  join("inngest", "functions", "platina"),
];
const ROOT_FILES = [join("db", "platina-schema.ts"), join("db", "queries", "platina.ts")];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

function relSrc(path: string): string {
  return path.slice(SRC.length + 1).split(sep).join("/");
}

/** All walked files, test files included (the string scan needs them). */
const allFiles = [
  ...ROOT_DIRS.flatMap((d) => walk(join(SRC, d))),
  ...ROOT_FILES.map((f) => join(SRC, f)),
];
/** Import classification skips test files. */
const sourceFiles = allFiles.filter((f) => !f.includes(".test."));

// ---------------------------------------------------------------------------
// Import classification tables
// ---------------------------------------------------------------------------

/** Shared infrastructure Platina may import (exact specifiers). */
const ALLOWED_EXACT = new Set([
  "@/auth",
  "@/db",
  "@/db/schema", // identity tables only (users, orgs, workspaces, memberships)
  "@/db/platina-schema",
  "@/db/queries/platina",
  "@/db/queries/platina-learning", // C6 own-site + learning loop queries
  "@/db/queries/memberships",
  "@/db/queries/workspaces", // identity enumeration for cron fan-out
  "@/lib/permissions",
  "@/lib/ai/router", // the router, plus the neutral infra listed below
  // Neutral infrastructure (owner decision 2026-09-20): the orchestrator
  // sequencer, its context-result types, AI cost tracking, and the safe
  // action-error mapper. None of them carries InstaMedia business logic.
  "@/lib/orchestrator/run",
  "@/lib/ai/context/types",
  "@/lib/ai/usage-context",
  "@/lib/action-errors",
  // Owner decision 2026-09-21 (CLAUDE.md): Firecrawl is the first rung for a
  // single public web page. Its one client is shared infra outside Platina;
  // social and ad-library content stays Apify-only.
  "@/lib/scrape/firecrawl",
  "@/lib/scrape/site", // page picker + section chunker, same decision
  // Owner decision 2026-09-22 (C6): read-only post metrics from connected
  // accounts. The one connector module Platina may import; it never writes.
  "@/lib/connectors/metrics-read",
  // Owner decision 2026-09-22 (C7.0, D6): neutral ingest safety shared by
  // both products — the SSRF-safe fetch, URL clean-up, and the "whose page
  // is this?" check that keeps third-party pages out of first-party stores.
  "@/lib/net/safe-fetch",
  "@/lib/ingest/url",
  "@/lib/ingest/ownership",

  "@/lib/utils",
  "@/inngest/client",
]);
const ALLOWED_PREFIXES = ["@/lib/platina", "@/components/platina"];

/** InstaMedia business modules — the constitution's seven families. */
const FORBIDDEN_EXACT = new Set([
  // Ticket
  "@/db/queries/tickets",
  "@/db/queries/ticket-comments",
  "@/db/queries/ticket-activity",
  "@/lib/tickets",
  "@/lib/ticket-permissions",
  // Hub
  "@/db/queries/hub",
  "@/lib/hub-workflow",
  "@/lib/data/team-hub",
  "@/lib/data/live/team-hub",
  // SOP
  "@/db/queries/sop",
  "@/db/queries/sop-history",
  "@/db/queries/sop-suggestions",
  "@/inngest/functions/sop-reverse-sync",
  "@/inngest/functions/sop-reconciliation",
  // Content
  "@/db/queries/posts",
  "@/db/queries/revisions",
  "@/db/queries/comments",
  "@/lib/embed-posts",
  // Calendar
  "@/db/queries/schedule",
  // Campaign
  "@/db/queries/campaigns",
  "@/lib/ai/agents/strategy",
  // Notification
  "@/db/queries/notifications",
  "@/lib/reminders",
  "@/lib/resend",
]);

/** Catch-all prefixes, each with its carve-out (if any). */
const FORBIDDEN_PREFIXES: { prefix: string; allowed?: string[] }[] = [
  { prefix: "@/app/(app)" },
  { prefix: "@/lib/connectors", allowed: ["@/lib/connectors/metrics-read"] },
  { prefix: "@/lib/sop" },
  { prefix: "@/lib/data" },
  { prefix: "@/lib/plan" },
  { prefix: "@/lib/pipeline" },
  { prefix: "@/lib/workflow" },
  { prefix: "@/lib/events" },
  {
    prefix: "@/lib/ai/",
    allowed: [
      "@/lib/ai/router",
      "@/lib/ai/context/types",
      "@/lib/ai/usage-context",
    ],
  },
  { prefix: "@/inngest/functions/", allowed: ["@/inngest/functions/platina"] },
];

/**
 * Grandfathered exceptions — a ratchet: it may only shrink. Empty since
 * Slice 3: the one historical entry (the Instagram connector behind the
 * Platina Apify adapter) was replaced by the Waters adapter in
 * `fetch/waters.ts`, which talks to the Apify platform API directly.
 */
const EXCEPTIONS: { file: string; specifier: string }[] = [];

function isForbidden(specifier: string): boolean {
  if (FORBIDDEN_EXACT.has(specifier)) return true;
  return FORBIDDEN_PREFIXES.some(
    ({ prefix, allowed }) =>
      specifier.startsWith(prefix) && !(allowed ?? []).includes(specifier),
  );
}

function isAllowlisted(specifier: string): boolean {
  return (
    ALLOWED_EXACT.has(specifier) ||
    ALLOWED_PREFIXES.some((p) => specifier.startsWith(p))
  );
}

const IMPORT_RE =
  /\b(?:import|export)\b[^"';]*?\bfrom\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|\bimport\s*["']([^"']+)["']/g;

function specifiersOf(file: string): string[] {
  const content = readFileSync(file, "utf-8");
  const out: string[] = [];
  for (const match of content.matchAll(IMPORT_RE)) {
    out.push(match[1] ?? match[2] ?? match[3]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Archived-bridge string scan
// ---------------------------------------------------------------------------

/**
 * Files that own archived-bridge strings until the approved drop migration
 * lands: the schema (the column and the action-kind type), the alert test
 * fixtures (updated when the enum migration lands), and this test itself.
 */
const BRIDGE_STRING_OWNERS = new Set([
  "db/platina-schema.ts",
  "lib/platina/alerts.test.ts",
  "lib/platina/boundary.test.ts",
]);

/** `kind:`-qualified so a channelMix value like "email" cannot false-positive. */
const BRIDGE_STRING_RE =
  /sopRunId|sop_run_id|hub_message|kind:\s*"ticket"|kind:\s*"email"/;

// ---------------------------------------------------------------------------

describe("platina/instamedia dependency boundary", () => {
  it("walk roots are non-empty", () => {
    for (const dir of ROOT_DIRS) {
      const files = walk(join(SRC, dir));
      expect(files.length, `${dir} walked empty`).toBeGreaterThan(0);
    }
    for (const file of ROOT_FILES) {
      expect(() => statSync(join(SRC, file))).not.toThrow();
    }
  });

  it("no forbidden InstaMedia module is imported", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const rel = relSrc(file);
      for (const specifier of specifiersOf(file)) {
        const excepted = EXCEPTIONS.some(
          (e) => e.file === rel && e.specifier === specifier,
        );
        if (!excepted && isForbidden(specifier)) {
          offenders.push(`${rel} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every internal import is allowlisted or excepted", () => {
    const unlisted: string[] = [];
    for (const file of sourceFiles) {
      const rel = relSrc(file);
      for (const specifier of specifiersOf(file)) {
        if (!specifier.startsWith("@/")) continue;
        const excepted = EXCEPTIONS.some(
          (e) => e.file === rel && e.specifier === specifier,
        );
        if (!excepted && !isForbidden(specifier) && !isAllowlisted(specifier)) {
          unlisted.push(`${rel} -> ${specifier}`);
        }
      }
    }
    expect(unlisted).toEqual([]);
  });

  it("the exception table does not grow", () => {
    // Zero since Slice 3. Adding an entry requires owner review — the table
    // is a ratchet, not a registry.
    expect(EXCEPTIONS).toHaveLength(0);
    for (const { file, specifier } of EXCEPTIONS) {
      const content = readFileSync(join(SRC, file), "utf-8");
      expect(
        content.includes(`"${specifier}"`),
        `${file} no longer imports ${specifier} — delete the exception entry`,
      ).toBe(true);
    }
  });

  it("no archived-bridge references outside the three named files", () => {
    const offenders: string[] = [];
    for (const file of allFiles) {
      const rel = relSrc(file);
      if (BRIDGE_STRING_OWNERS.has(rel)) continue;
      if (BRIDGE_STRING_RE.test(readFileSync(file, "utf-8"))) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no external call targets except the Apify platform API", () => {
    // The constitution: Platina writes to no Waters system, ever. This scans
    // for host literals in network-call positions — fetch() targets and
    // endpoint constants — not data. Operator-chosen source URLs (audit
    // targets, conference presets) are data fetched THROUGH Apify, never
    // called directly. RFC 2606 example domains are documentation
    // placeholders.
    const HOST_LITERAL = /https:\/\/([a-z0-9.-]+)/i;
    const CALL_SITE = /fetch\(|\b[A-Z][A-Z0-9_]*(?:_BASE|_URL)\s*=/;
    const ALLOWED_HOSTS = new Set(["api.apify.com"]);
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const rel = relSrc(file);
      if (rel === "lib/platina/boundary.test.ts") continue;
      for (const line of readFileSync(file, "utf-8").split("\n")) {
        if (!CALL_SITE.test(line)) continue;
        const match = line.match(HOST_LITERAL);
        if (match && !ALLOWED_HOSTS.has(match[1].toLowerCase())) {
          offenders.push(`${rel} -> ${match[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
