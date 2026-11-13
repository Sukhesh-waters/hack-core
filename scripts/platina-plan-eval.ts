/**
 * Plan test set (CORE-3): run the live planner and critic on the fixed
 * synthetic briefs and print pass rates per check.
 *
 *   npm run platina:plan-eval -- [--ladder fast|quality] [--runs N]
 *     [--write <report.json>] [--baseline <report.json>] [--tolerance 0.1] [--json]
 *
 * --write records a report (the first one becomes the baseline). --baseline
 * compares against a recorded report and exits 1 when any check drops below
 * it: a planner or critic prompt/model change merges only with a passing run.
 *
 * Needs model provider keys only. It never touches the database (the usage
 * log is switched off for the run) and writes nothing except --write.
 */
import { readFileSync, writeFileSync } from "node:fs";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const pct = (rate: number | null) => (rate === null ? "n/a" : `${Math.round(rate * 100)}%`);

async function main() {
  process.loadEnvFile(".env.local");
  delete process.env.DATABASE_URL;

  const ladder = arg("ladder") === "fast" ? "fast" : "quality";
  const runs = Math.max(1, Number(arg("runs") ?? 1) || 1);
  const tolerance = Number(arg("tolerance") ?? 0) || 0;

  const { generateCampaignPlan, critiquePlan } = await import("@/lib/platina/plan/agent");
  const { PLAN_EVAL_CASES, CRITIC_EVAL_SET } = await import("@/lib/platina/plan/eval-set");
  const { PLAN_CHECKS, runPlanEval, compareToBaseline } = await import("@/lib/platina/plan/eval");

  const report = await runPlanEval({
    cases: PLAN_EVAL_CASES,
    generate: (context) => generateCampaignPlan(context, { tier: ladder }),
    critique: critiquePlan,
    criticSet: CRITIC_EVAL_SET,
    runs,
  });
  const recorded = { recordedAt: new Date().toISOString(), ladder, ...report };

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(recorded, null, 2));
  } else {
    console.log(`\nPlan test set — planner on the ${ladder} ladder, ${PLAN_EVAL_CASES.length} briefs × ${runs} run(s)`);
    for (const check of PLAN_CHECKS) {
      const r = report.byCheck[check];
      console.log(`  ${check.padEnd(32)} ${pct(r.rate).padStart(5)}  (${r.passed}/${r.applicable})`);
    }
    if (report.critic) {
      const a = report.critic.agreement;
      console.log(`  ${"critic agrees with person".padEnd(32)} ${pct(a.rate).padStart(5)}  (${a.passed}/${a.applicable})`);
    }
    const failures = report.cases.filter(
      (c) => !c.unavailable && (c.error || Object.values(c.checks).some((v) => v === false)),
    );
    if (failures.length > 0) {
      console.log("\nFailed cases");
      for (const c of failures) {
        const failed = Object.entries(c.checks).filter(([, v]) => v === false).map(([k]) => k);
        console.log(`  ${c.caseId} (run ${c.run}): ${c.error ?? failed.join(", ")}`);
      }
    }
    const disagreements = report.critic?.results.filter((r) => r.got !== r.expected && r.got !== "unavailable") ?? [];
    if (disagreements.length > 0) {
      console.log("\nCritic disagreed with the person");
      for (const r of disagreements) console.log(`  ${r.itemId}: expected ${r.expected}, got ${r.got}${r.error ? ` (${r.error})` : ""}`);
    }
    if (report.unavailable > 0) {
      console.log(`\nNot scored: ${report.unavailable} call(s) got no answer from any provider.`);
    }
  }

  const out = arg("write");
  if (out && report.unavailable > 0) {
    console.log(`\nNot written to ${out}: a report with provider outages is not a baseline. Run again.`);
  } else if (out) {
    writeFileSync(out, JSON.stringify(recorded, null, 2));
  }

  const baselinePath = arg("baseline");
  if (baselinePath) {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    const drops = compareToBaseline(report, baseline, tolerance);
    if (drops.length > 0) {
      console.log("\nBelow the baseline");
      for (const d of drops) console.log(`  ${d.check}: ${pct(d.baseline)} → ${pct(d.current)}`);
      process.exit(1);
    }
    console.log("\nNo check below the baseline.");
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

export {};
