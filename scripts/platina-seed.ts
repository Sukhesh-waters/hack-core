/**
 * Seed ~18 months of synthetic Platina campaign/outcome history.
 * Usage: npx tsx scripts/platina-seed.ts <workspaceId> <ownerUserId>
 * Synthetic and public data only. No Waters system is contacted.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  platinaBrainChunks,
  platinaCampaigns,
  platinaOutcomes,
  platinaReceipts,
} from "@/db/platina-schema";
import {
  demotionsFromHistory,
  generateSyntheticHistory,
} from "@/lib/platina/synthetic";

async function main() {
  const workspaceId = process.argv[2];
  const ownerId = process.argv[3];
  if (!workspaceId || !ownerId) {
    console.error("usage: platina-seed <workspaceId> <ownerUserId>");
    process.exit(1);
  }

  const history = generateSyntheticHistory();
  const topic = "method-validation";

  for (const month of history) {
    const [receipt] = await db
      .insert(platinaReceipts)
      .values({
        workspaceId,
        title: `${month.month} ${topic}`,
        hypothesis: "Validation-pain campaigns convert conference traffic",
        expectedOutcome: "conversion >= 0.18",
        reviewAt: new Date(`${month.month}-28T00:00:00Z`),
        outcome: month.hypothesisWorked ? "worked" : "did_not_work",
        ownerId,
      })
      .returning({ id: platinaReceipts.id });

    const [campaign] = await db
      .insert(platinaCampaigns)
      .values({
        workspaceId,
        receiptId: receipt.id,
        title: `${month.month} symposium follow-up`,
        durationDays: 90,
        geography: "North America",
        eventLabel: "conference",
        status: "closed",
        channelMix: ["conference", "email"],
        contentPlan: "pre / at / post",
      })
      .returning({ id: platinaCampaigns.id });

    await db.insert(platinaOutcomes).values({
      workspaceId,
      campaignId: campaign.id,
      receiptId: receipt.id,
      leads: month.leads,
      qualifiedLeads: month.qualifiedLeads,
      conversionRate: month.conversionRate,
      pipelineContribution: month.pipelineContribution,
      recordedAt: new Date(`${month.month}-28T00:00:00Z`),
    });
  }

  const [brain] = await db
    .insert(platinaBrainChunks)
    .values({
      workspaceId,
      content: "Conference abstracts show method-validation as a hook",
      confidence: 0.82,
      agreementState: "agreed",
      generation: 0,
    })
    .returning({ id: platinaBrainChunks.id });

  const demotions = demotionsFromHistory(history, topic);
  if (demotions.length > 0) {
    await db
      .update(platinaBrainChunks)
      .set({ status: "demoted" })
      .where(eq(platinaBrainChunks.id, brain.id));
  }

  console.log(`seeded ${history.length} months, ${demotions.length} demotion signals`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
