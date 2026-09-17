import { inngest } from "@/inngest/client";
import { listAllWorkspaceIds } from "@/db/queries/workspaces";
import {
  getWorkspaceConfig,
  insertBrainChunk,
  listBrainChunks,
} from "@/db/queries/platina";
import { compactedRecord, compactionEligible } from "@/lib/platina/brain";

export const platinaBrainMaintenance = inngest.createFunction(
  {
    id: "platina-brain-maintenance",
    triggers: [{ cron: "0 4 * * 1" }],
  },
  async ({ step }) => {
    const workspaceIds = await step.run("list-workspaces", () =>
      listAllWorkspaceIds(),
    );
    let compacted = 0;
    for (const workspaceId of workspaceIds) {
      // Stored compaction thresholds govern this workspace's pass.
      const config = await step.run(`config-${workspaceId}`, () =>
        getWorkspaceConfig(workspaceId),
      );
      const chunks = await step.run(`chunks-${workspaceId}`, () =>
        listBrainChunks(workspaceId),
      );
      const gen0 = chunks
        .filter((c) => c.generation === 0 && c.status === "active")
        .map((c) => ({
          id: c.id,
          generation: c.generation,
          confidence: c.confidence,
          // step.run serialises timestamps, so staleness needs a real Date back.
          lastRetrievedAt: c.lastRetrievedAt ? new Date(c.lastRetrievedAt) : null,
          absorbedChunkIds: c.absorbedChunkIds,
        }));
      if (gen0.length < 3) continue;
      const verdict = compactionEligible(
        gen0,
        new Date(),
        config?.compactionStaleDays,
        config?.compactionNearDupes,
      );
      if (!verdict.eligible) continue;
      const record = compactedRecord(gen0.slice(0, 3), "Compacted market insight");
      await step.run(`compact-${workspaceId}`, () =>
        insertBrainChunk({
          workspaceId,
          content: record.content,
          confidence: record.confidence,
          agreementState: "qualified",
          sourceSignalIds: [],
          generation: record.generation,
          absorbedChunkIds: record.absorbedChunkIds,
        }),
      );
      compacted += 1;
    }
    return { compacted };
  },
);
