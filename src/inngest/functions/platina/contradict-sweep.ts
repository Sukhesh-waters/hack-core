import { inngest } from "@/inngest/client";
import { listAllWorkspaceIds } from "@/db/queries/workspaces";
import {
  getScanSpec,
  getWorkspaceConfig,
  insertBrainChunk,
  insertFinding,
  insertTranscript,
  listDebateTranscripts,
  listOpenOperationalFindings,
  listUnresolvedSignals,
  markSignalProcessed,
} from "@/db/queries/platina";
import { runContradictionRound } from "@/lib/platina/debate";
import { embedText } from "@/lib/platina/embed";
import { findingPathFor, findingUseCaseForSourceKind } from "@/lib/platina/findings";
import {
  OBJECTION_RATE_CEILING,
  OBJECTION_WINDOW,
  objectionCeilingExceeded,
  objectionRate,
} from "@/lib/platina/objection-rate";
import { broadcastPlatinaSignal } from "@/lib/platina/realtime-server";

/**
 * Contradiction sweep. Triggered by a new signal batch (event carries the
 * workspace) or by the 6-hour cron backstop over all workspaces. Processes
 * only unprocessed signal documents, marks each after its round, and creates
 * user-facing findings: agreed → visible finding + embedded Brain chunk;
 * contested → finding awaiting a human ruling; refuted → transcript only.
 *
 * R5.1: after each workspace batch, the objection rate over the recent
 * transcript window is computed; a ceiling breach raises one open
 * operational finding against the current prompt version.
 */
export const platinaContradictSweep = inngest.createFunction(
  {
    id: "platina-contradict-sweep",
    triggers: [
      { cron: "30 */6 * * *" },
      { event: "platina/contradict.requested" },
    ],
  },
  async ({ event, step }) => {
    const data = (event as { data?: Record<string, unknown> } | undefined)?.data;
    const requestedWorkspace =
      typeof data?.workspaceId === "string" ? data.workspaceId : null;

    const workspaceIds = requestedWorkspace
      ? [requestedWorkspace]
      : await step.run("list-workspaces", () => listAllWorkspaceIds());

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
          const content = result.result.caveat
            ? `${result.claim.text}\nCaveat: ${result.result.caveat}`
            : result.claim.text;
          // Embed at write time; a router outage stores the chunk without a
          // vector rather than blocking the finding.
          const embedding = await step.run(`embed-${signal.id}`, () =>
            embedText(content),
          );
          brainChunkId = await step.run(`brain-${signal.id}`, () =>
            insertBrainChunk({
              workspaceId,
              content,
              confidence: result.result.score,
              agreementState: result.result.state,
              sourceSignalIds: [signal.id],
              generation: 0,
              transcriptId,
              embedding: embedding ?? undefined,
            }),
          );
          written += 1;
        }

        if (path.finding) {
          // The source kind sets the use case (Slice 7).
          let useCase = "competitor_change";
          if (signal.scanSpecId) {
            const spec = await step.run(`spec-${signal.id}`, () =>
              getScanSpec(workspaceId, signal.scanSpecId!),
            );
            useCase = findingUseCaseForSourceKind(spec?.targets[0]?.kind);
          }
          await step.run(`finding-${signal.id}`, () =>
            insertFinding({
              workspaceId,
              signalDocumentId: signal.id,
              transcriptId,
              brainChunkId,
              useCase,
              title:
                signal.title ??
                result.claim.text.slice(0, 80),
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

      // R5.1 — objection-rate telemetry against the prompt version.
      const rounds = await step.run(`objection-window-${workspaceId}`, () =>
        listDebateTranscripts(workspaceId, OBJECTION_WINDOW),
      );
      if (objectionCeilingExceeded(rounds.map((r) => ({ state: r.state })))) {
        const open = await step.run(`operational-open-${workspaceId}`, () =>
          listOpenOperationalFindings(workspaceId),
        );
        if (open.length === 0) {
          const config = await step.run(`config-${workspaceId}`, () =>
            getWorkspaceConfig(workspaceId),
          );
          const rate = objectionRate(rounds.map((r) => ({ state: r.state })));
          await step.run(`operational-finding-${workspaceId}`, () =>
            insertFinding({
              workspaceId,
              useCase: "operational",
              title: "Validation layer objection rate elevated",
              summary:
                `${Math.round(rate * 100)}% of the last ${rounds.length} ` +
                `validation rounds ended contested or refuted — above the ` +
                `${Math.round(OBJECTION_RATE_CEILING * 100)}% ceiling. This is an ` +
                `operational signal about prompt version ${config?.promptVersion ?? 1}, ` +
                `not about any single claim.`,
              strongestObjection:
                "A challenger that objects to nearly everything carries no information.",
              status: "needs_decision",
            }),
          );
          await broadcastPlatinaSignal(workspaceId, "findings");
        }
      }
    }
    return { written, escalated };
  },
);
