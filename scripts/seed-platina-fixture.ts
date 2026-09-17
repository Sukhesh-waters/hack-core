/**
 * Platina E2E fixture seed (Slice 6) — adds the Platina rows the smoke suite
 * needs to the existing e2e-fixture workspace: one declared brand standard,
 * one decision receipt, one draft solution, and two board tasks. Without
 * these, the solution detail route has nothing to render.
 *
 * Same discipline as scripts/seed-e2e-fixture.ts: strictly additive,
 * idempotent via stable identities (fixed ids keyed on the fixture), and
 * scoped to the fixture workspace. Nothing else is touched.
 *
 * Run:
 *   npx tsx scripts/seed-platina-fixture.ts
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

const WORKSPACE_ID = "1f3f82d4-470a-494d-8e56-29ac9372e94f"; // e2e fixture
const DEV_USER_EMAIL = "dev@localhost.test";

// Stable fixture ids — reruns resolve to the same rows.
const BRAND_CHUNK_ID = "e2e0a11f-1a1a-4a1a-8a1a-0000000000a1";
const RECEIPT_ID = "e2e0a11f-1a1a-4a1a-8a1a-0000000000b1";
const CAMPAIGN_ID = "e2e0a11f-1a1a-4a1a-8a1a-0000000000c1";
const TASK_PRE_ID = "e2e0a11f-1a1a-4a1a-8a1a-0000000000d1";
const TASK_POST_ID = "e2e0a11f-1a1a-4a1a-8a1a-0000000000d2";

async function main() {
  const { db } = await import("../src/db");
  const {
    platinaBrandChunks,
    platinaReceipts,
    platinaCampaigns,
    platinaSolutionTasks,
  } = await import("../src/db/platina-schema");
  const { users } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");

  const [devUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, DEV_USER_EMAIL))
    .limit(1);
  if (!devUser) {
    console.error("dev bypass user not found — run scripts/seed-e2e-fixture.ts first");
    process.exit(1);
  }

  const exists = async (table: typeof platinaBrandChunks, id: string) =>
    (await db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1))
      .length > 0;

  if (await exists(platinaBrandChunks, BRAND_CHUNK_ID)) {
    console.log("brand chunk: already exists");
  } else {
    await db.insert(platinaBrandChunks).values({
      id: BRAND_CHUNK_ID,
      workspaceId: WORKSPACE_ID,
      content:
        "Waters brand standard (fixture): precise, evidence-led language; no guaranteed outcomes; no superlatives without data.",
      title: "Fixture brand standard",
      chunkIndex: 0,
    });
    console.log("brand chunk: created");
  }

  if (await exists(platinaReceipts as never, RECEIPT_ID)) {
    console.log("receipt: already exists");
  } else {
    await db.insert(platinaReceipts).values({
      id: RECEIPT_ID,
      workspaceId: WORKSPACE_ID,
      title: "Fixture competitor response",
      hypothesis: "A validation-focused response converts QC lab interest",
      expectedOutcome: "20 qualified leads from QC labs within 90 days",
      evidenceBrandIds: [BRAND_CHUNK_ID],
      evidenceBrainIds: [],
      reviewAt: new Date(Date.now() + 90 * 86_400_000),
      ownerId: devUser.id,
      severity: "high",
      urgency: "this_quarter",
      measurementMethod: "CRM import",
    });
    console.log("receipt: created");
  }

  if (await exists(platinaCampaigns as never, CAMPAIGN_ID)) {
    console.log("campaign: already exists");
  } else {
    await db.insert(platinaCampaigns).values({
      id: CAMPAIGN_ID,
      workspaceId: WORKSPACE_ID,
      receiptId: RECEIPT_ID,
      title: "Fixture solution — QC lab validation response",
      durationDays: 90,
      geography: "North America",
      channelMix: ["conference", "email", "web"],
      contentPlan: "Pre / at / post plan for the fixture solution.",
      useCase: "competitor_change",
      status: "draft",
    });
    console.log("campaign: created");
  }

  for (const [id, title, phase] of [
    [TASK_PRE_ID, "Finalize event messaging and talk tracks", "pre"],
    [TASK_POST_ID, "Grade the decision receipt against measured outcomes", "post"],
  ] as const) {
    if (await exists(platinaSolutionTasks as never, id)) {
      console.log(`task "${title}": already exists`);
    } else {
      await db.insert(platinaSolutionTasks).values({
        id,
        workspaceId: WORKSPACE_ID,
        campaignId: CAMPAIGN_ID,
        title,
        eventPhase: phase,
        status: "todo",
      });
      console.log(`task "${title}": created`);
    }
  }

  console.log(`\nPlatina fixture solution: /p/${WORKSPACE_ID}/solutions/${CAMPAIGN_ID}`);
  process.exit(0);
}

main().catch((error) => {
  console.error("platina fixture seed failed:", error);
  process.exit(1);
});
