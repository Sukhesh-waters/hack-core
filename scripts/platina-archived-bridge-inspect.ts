/**
 * Platina archived-bridge inspection (Slice 0, W0.3).
 *
 * Measures what the two archived bridges actually contain, so the later drop
 * migration is an informed, owner-approved decision rather than a guess:
 *
 *   - `platina_campaigns.sop_run_id` (archived: never read/written/executed)
 *   - Platina alert actions `hub_message` / `ticket` / `email` (archived: V1
 *     routes `in_app` only)
 *
 * Strictly read-only: three SELECT statements, no writes, no DDL. Same
 * manual .env.local parsing convention as seed-e2e-fixture.ts and
 * drizzle.config.ts — this repo deliberately has no dotenv dependency.
 *
 * Run:
 *   npx tsx scripts/platina-archived-bridge-inspect.ts
 *
 * Output: docs/superpowers/plans/platina-archived-bridge-inspection.md
 * Exits non-zero on any query error.
 */
import * as fs from "fs";
import * as path from "path";

const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      process.env[match[1]] ??= match[2].replace(/^["']|["']$/g, "");
    }
  }
}

const REPORT_PATH = path.resolve(
  process.cwd(),
  "docs/superpowers/plans/platina-archived-bridge-inspection.md",
);

type SopRow = {
  workspace_id: string;
  total_campaigns: string;
  campaigns_with_sop_run_id: string;
};
type AlertRow = { workspace_id: string; kind: string; rule_count: string };
type TotalsRow = {
  total_sop_run_id_rows: string;
  total_alert_rules: string;
};

function table(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.join(" | ")} |`);
  return [head, divider, ...body].join("\n");
}

async function main() {
  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");

  // Q1: sop_run_id population, per workspace
  const sopRows = await db.execute<SopRow>(sql`
    SELECT workspace_id,
           count(*) AS total_campaigns,
           count(*) FILTER (WHERE sop_run_id IS NOT NULL) AS campaigns_with_sop_run_id
    FROM platina_campaigns
    GROUP BY workspace_id
    ORDER BY workspace_id;
  `);

  // Q2: archived alert action kinds, per workspace and kind
  const alertRows = await db.execute<AlertRow>(sql`
    SELECT workspace_id, kind, count(*) AS rule_count
    FROM (
      SELECT workspace_id, action ->> 'kind' AS kind
      FROM platina_alert_rules,
           LATERAL jsonb_array_elements(actions) AS action
    ) AS expanded
    WHERE kind IN ('hub_message', 'ticket', 'email')
    GROUP BY workspace_id, kind
    ORDER BY workspace_id, kind;
  `);

  // Q3: totals row for the report header
  const totalsRows = await db.execute<TotalsRow>(sql`
    SELECT
      (SELECT count(*) FROM platina_campaigns WHERE sop_run_id IS NOT NULL)
        AS total_sop_run_id_rows,
      (SELECT count(*) FROM platina_alert_rules) AS total_alert_rules;
  `);
  const totals = totalsRows[0];

  const dbHost = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "unparseable";
    }
  })();

  const commit = process.env.GIT_COMMIT ?? "unknown";

  const sopTable =
    sopRows.length > 0
      ? table(
          ["workspace_id", "total_campaigns", "campaigns_with_sop_run_id"],
          sopRows.map((r) => [
            r.workspace_id,
            String(r.total_campaigns),
            String(r.campaigns_with_sop_run_id),
          ]),
        )
      : "_No rows in `platina_campaigns`._";

  const alertTable =
    alertRows.length > 0
      ? table(
          ["workspace_id", "kind", "rule_count"],
          alertRows.map((r) => [r.workspace_id, r.kind, String(r.rule_count)]),
        )
      : "_No alert rules use an archived action kind._";

  const bothZero =
    Number(totals.total_sop_run_id_rows) === 0 && alertRows.length === 0;

  const report = `# Platina archived-bridge inspection

**Date:** ${new Date().toISOString().slice(0, 10)}
**Git commit:** ${commit}
**Database host:** ${dbHost}
**Operator:** Slice 0 W0.3 script (read-only)

Totals: **${totals.total_sop_run_id_rows}** campaign rows with \`sop_run_id\`
set; **${totals.total_alert_rules}** total alert rules.

## Q1 — \`sop_run_id\` population per workspace

${sopTable}

## Q2 — archived alert action kinds per workspace

${alertTable}

${
  bothZero
    ? "**Both bridges are empty.** A zero result is a valid, committable result: the drop migration removes unused surface."
    : "**Non-zero counts present.** The drop migration must account for the rows above."
}

## Decision input

These counts feed the future migration that drops
\`platina_campaigns.sop_run_id\` and replaces the archived alert action kinds
(\`hub_message\` / \`ticket\` / \`email\`) with \`in_app\`. That migration is
NOT part of Slice 0 and requires separate owner approval.
`;

  fs.writeFileSync(REPORT_PATH, report);
  console.log(`wrote ${REPORT_PATH}`);
  console.log(
    `sop_run_id rows: ${totals.total_sop_run_id_rows}, alert rules: ${totals.total_alert_rules}, archived-kind rules: ${alertRows.length}`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error("archived-bridge inspection failed:", error);
  process.exit(1);
});
