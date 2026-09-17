import { inngest } from "@/inngest/client";
import { listSchedulableSpecs } from "@/db/queries/platina";
import {
  isDue,
  isProbeCapable,
} from "@/lib/platina/fetch/schedule";

/**
 * Five-minute coordinator (R1). Selects due approved+enabled sources and
 * fans out one probe tick per source. The coordinator itself never fetches
 * content — the probe worker decides between a cheap header check and a
 * paid actor run.
 */
export const platinaScanCoordinator = inngest.createFunction(
  {
    id: "platina-scan-coordinator",
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async ({ step }) => {
    const specs = await step.run("list-schedulable-specs", () =>
      listSchedulableSpecs(),
    );
    const now = new Date();
    // Tick bucket: one fan-out per spec per tick, replay-safe.
    const tick = now.toISOString().slice(0, 16);

    let emitted = 0;
    for (const spec of specs) {
      const kind = spec.targets[0]?.kind ?? "competitor_site";
      const probeCapable = isProbeCapable(kind);
      if (!isDue(spec, probeCapable, now)) continue;
      await step.sendEvent(`tick-${spec.id}`, {
        name: "platina/probe.tick",
        data: {
          specId: spec.id,
          workspaceId: spec.workspaceId,
          tick,
          probeCapable,
        },
      });
      emitted += 1;
    }
    return { due: emitted, total: specs.length };
  },
);
