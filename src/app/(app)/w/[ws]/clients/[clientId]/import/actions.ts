"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { db } from "@/db";
import { importJobs, posts } from "@/db/schema";
import { getClientById } from "@/db/queries/clients";
import { requireMembership } from "@/db/queries/memberships";
import { getBaselinePoints } from "@/db/queries/posts";
import { actionErrorMessage } from "@/lib/action-errors";
import { MAX_CSV_BYTES, parsePostsCsv } from "@/lib/csv-import";
import { embedPosts } from "@/lib/embed-posts";
import { buildImportPlan } from "@/lib/import-pipeline";
import { normalizeCaptions } from "@/lib/normalize";
import { runWithAiCost } from "@/lib/ai/usage-context";

export type ImportCsvState =
  | { error?: string; skipped?: { line: number; reason: string }[] }
  | undefined;

export async function importCsv(
  _prev: ImportCsvState,
  formData: FormData,
): Promise<ImportCsvState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const clientId = String(formData.get("clientId") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV file to import." };
  }
  if (file.size > MAX_CSV_BYTES) {
    return { error: "That CSV is larger than 5 MB — split it and retry." };
  }

  let jobId: string | undefined;
  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    const client = await getClientById(workspaceId, clientId);
    if (!client) return { error: "Client not found in this workspace." };

    const { rows, skipped } = parsePostsCsv(await file.text());
    if (rows.length === 0) {
      return { error: "No importable rows found in that CSV.", skipped };
    }

    const [job] = await db
      .insert(importJobs)
      .values({
        workspaceId,
        clientId,
        filename: file.name,
        rowCount: rows.length,
        skippedCount: skipped.length,
      })
      .returning({ id: importJobs.id });
    jobId = job.id;

    await runWithAiCost({ workspaceId, purpose: "import" }, async () => {
      const meta = await normalizeCaptions(rows.map((row) => row.caption));
      const existingBaseline = await getBaselinePoints(workspaceId, clientId);
      const planned = buildImportPlan({
        workspaceId,
        clientId,
        importJobId: job.id,
        rows,
        meta,
        existingBaseline,
      });

      const inserted = await db
        .insert(posts)
        .values(planned)
        .returning({ id: posts.id, caption: posts.caption });

      await embedPosts(workspaceId, inserted);
    });
    await db
      .update(importJobs)
      .set({ status: "complete" })
      .where(eq(importJobs.id, job.id));
  } catch (error) {
    if (jobId) {
      await db
        .update(importJobs)
        .set({ status: "failed", error: actionErrorMessage(error) })
        .where(eq(importJobs.id, jobId))
        .catch(() => {});
    }
    return { error: actionErrorMessage(error) };
  }

  redirect(`/w/${workspaceId}/kb`);
}
