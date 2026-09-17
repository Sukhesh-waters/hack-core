import { inngest } from "@/inngest/client";
import { listAllWorkspaceIds } from "@/db/queries/workspaces";
import {
  insertBrainChunk,
  insertFinding,
  insertTranscript,
  listUnresolvedSignals,
  markSignalProcessed,
} from "@/db/queries/platina";
import { runContradictionRound } from "@/lib/platina/debate";
import { findingPathFor } from "@/lib/platina/findings";
import { broadcastPlatinaSignal } from "@/lib/platina/realtime-server";

/**
 * Contradiction sweep. Processes only unprocessed signal documents, marks
 * each after its round, and creates user-facing findings: agreed → visible
 * finding + Brain chunk; contested → finding awaiting a human ruling;
 * refuted → transcript retained, nothing retrievable.
 */
export const platinaContradictSweep = inngest.createFunction(
  {
    id: "platina-contradict-sweep",
    triggers: [
      { cron: "30 */6 * * *" },
      { event: "platina/contradict.requested" },
    ],
  },
  async ({ step }) => {
    const workspaceIds = await step.run("list-workspaces", () =>
      listAllWorkspaceIds(),
    );
    let written = 0;
    let escalated = 0;
    for (const workspaceId of workspaceIds) {
      const signals = await step.run(`signals-${workspaceId}`, () =>
        listUnresolvedSignals(workspaceId),
      );
      for (const signal of signals.slice(0, 5)) {
        const result = await step.run(`debate-${signal.id}`, () =>
          runContradictionRound(`${signal.title ?? ""}\n${signal.body}`),
        );
        const transcriptId = await step.run(`transcript-${signal.id}`, () =>
          insertTranscript({
            workspaceId,
            signalIds: [signal.id],
            proposerClaim: result.claim.text,
            challengerAttack: result.attack.text,
            score: result.result.score,
            state: result.result.state,
            strongestObjection: result.result.caveat,
          }),
        );
        const path = findingPathFor(result.result.state);

        let brainChunkId: string | null = null;
        if (path.brainChunk) {
          brainChunkId = await step.run(`brain-${signal.id}`, () =>
            insertBrainChunk({
              workspaceId,
              content: result.result.caveat
                ? `${result.claim.text}\nCaveat: ${result.result.caveat}`
                : result.claim.text,
              confidence: result.result.score,
              agreementState: result.result.state,
              sourceSignalIds: [signal.id],
              generation: 0,
              transcriptId,
            }),
          );
          written += 1;
        }

        if (path.finding) {
          await step.run(`finding-${signal.id}`, () =>
            insertFinding({
              workspaceId,
              signalDocumentId: signal.id,
              transcriptId,
              brainChunkId,
              title:
                signal.title ??
                result.claim.text.slice(0, 80) ??
                "Market change",
              summary: result.claim.text,
              strongestObjection: result.result.caveat ?? result.attack.text,
              status: path.finding === "needs_decision" ? "needs_decision" : "new",
            }),
          );
          if (path.finding === "needs_decision") escalated += 1;
          await broadcastPlatinaSignal(workspaceId, "findings");
        } else if (result.result.state === "contested" || result.result.state === "refuted") {
          escalated += 1;
        }

        await step.run(`processed-${signal.id}`, () =>
          markSignalProcessed(workspaceId, signal.id),
        );
      }
    }
    return { written, escalated };
  },
);
