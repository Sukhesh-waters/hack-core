import { inngest } from "@/inngest/client";
import {
  insertSignalDocuments,
  listApprovedScanSpecs,
} from "@/db/queries/platina";
import { registerApifyAdapter } from "@/lib/platina/fetch/apify";
import { runApprovedScan } from "@/lib/platina/fetch/registry";

registerApifyAdapter();

export const platinaSignalScan = inngest.createFunction(
  {
    id: "platina-signal-scan",
    triggers: [{ cron: "0 */6 * * *" }, { event: "platina/scan.requested" }],
  },
  async ({ event, step }) => {
    const data = (event as { data?: Record<string, unknown> } | undefined)?.data;
    const specs = await step.run("list-approved-specs", () =>
      listApprovedScanSpecs(),
    );
    const requested =
      typeof data?.specId === "string" ? data.specId : null;

    let fetched = 0;
    for (const spec of specs) {
      if (requested && spec.id !== requested) continue;
      const docs = await step.run(`scan-${spec.id}`, () =>
        runApprovedScan({
          id: spec.id,
          workspaceId: spec.workspaceId,
          status: spec.status === "approved" ? "approved" : "approved",
          targets: spec.targets,
        }),
      );
      fetched += await step.run(`store-${spec.id}`, () =>
        insertSignalDocuments(spec.workspaceId, spec.id, docs),
      );
    }
    return { specs: specs.length, fetched };
  },
);
