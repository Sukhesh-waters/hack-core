import { inngest } from "@/inngest/client";
import { getWorkspaceDocBySlug, createWorkspaceDoc, updateWorkspaceDoc } from "@/db/queries/workspace-docs";

export type AutoDocPayload = {
  workspaceId: string;
  actorId: string;
  title: string;
  summary: string;
};

/**
 * E2 · Auto-documentation by trigger.
 * Aggregates workflow activity, decision outcomes, and SOP milestones into
 * human-editable, auto-tagged workspace documentation pages.
 */
export const autoDocGenerator = inngest.createFunction(
  { id: "auto-doc-generator", triggers: [{ event: "workspace/auto_doc.requested" }] },
  async ({ event, step }) => {
    const { workspaceId, actorId, title, summary } = (event.data ?? {}) as AutoDocPayload;
    if (!workspaceId || !title || !summary) return { skipped: "invalid payload" };

    await step.run("upsert-auto-doc", async () => {
      const slug = `auto-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
      const existing = await getWorkspaceDocBySlug(workspaceId, slug);

      if (existing) {
        const updatedBody = `${existing.body}\n\n### ${new Date().toISOString().split("T")[0]}\n${summary}`;
        await updateWorkspaceDoc(workspaceId, existing.id, {
          body: updatedBody,
          updatedById: actorId,
        });
      } else {
        const initialBody = `# ${title}\n\n*Auto-generated workspace documentation*\n\n### ${new Date().toISOString().split("T")[0]}\n${summary}`;
        await createWorkspaceDoc({
          workspaceId,
          slug,
          title,
          body: initialBody,
          kind: "auto",
          createdById: actorId,
        });
      }
    });

    return { success: true };
  },
);
