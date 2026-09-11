import { inngest } from "@/inngest/client";
import { listAllWorkspaceIds } from "@/db/queries/workspaces";
import {
  insertBrainChunk,
  insertTranscript,
  listUnresolvedSignals,
} from "@/db/queries/platina";
import { runContradictionRound } from "@/lib/platina/debate";

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
        if (result.result.state === "contested" || result.result.state === "refuted") {
          escalated += 1;
          continue;
        }
        await step.run(`brain-${signal.id}`, () =>
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
    }
    return { written, escalated };
  },
);
