/**
 * Brand-source extraction (Slice 8): chunk, embed, and store an approved
 * source's content as Plane A evidence. Shared by the confirm/refresh
 * actions and the daily brand-refresh worker.
 *
 * Ordering is deliberate: new chunks insert BEFORE the old ones are
 * superseded (excluding the new ids), and the source hash rotates LAST. A
 * failure mid-way leaves the prior hash in place, so the next refresh sees
 * the change and retries — the standard can never be stranded empty.
 */
import {
  recordBrandSourceFetch,
  insertBrandChunk,
  supersedeBrandChunksForSource,
} from "@/db/queries/platina";
import { chunkProse } from "./chunking";
import { embedText } from "./embed";
import { planBrandExtraction } from "./brand-sources";

/** The extraction only needs identity, the content link, and the prior
 *  hash — never the timestamp fields (which Inngest step results serialize
 *  to strings). Keep the input narrow so the worker boundary is clean. */
export type ExtractableSource = {
  id: string;
  workspaceId: string;
  url: string | null;
  title: string;
  contentHash: string | null;
};

/** Chunks link to their source by URL, or by a declared:// ref for pasted
 *  text — never by a bare title. */
export function brandSourceRef(source: ExtractableSource): string {
  return source.url ?? `declared://${source.id}`;
}

export async function runBrandExtraction(
  source: ExtractableSource,
  content: string,
): Promise<{ changed: boolean; chunks: number }> {
  const plan = planBrandExtraction(content, source.contentHash, chunkProse);
  if (!plan.changed) {
    await recordBrandSourceFetch(source.workspaceId, source.id, {
      contentHash: plan.contentHash,
      changed: false,
    });
    return { changed: false, chunks: 0 };
  }

  const ref = brandSourceRef(source);
  const newIds: string[] = [];
  for (const [index, chunk] of plan.chunks.entries()) {
    const embedding = await embedText(chunk);
    const id = await insertBrandChunk({
      workspaceId: source.workspaceId,
      content: chunk,
      sourceUrl: ref,
      title: source.title,
      embedding: embedding ?? undefined,
      chunkIndex: index,
    });
    newIds.push(id);
  }
  await supersedeBrandChunksForSource(source.workspaceId, ref, newIds);
  await recordBrandSourceFetch(source.workspaceId, source.id, {
    contentHash: plan.contentHash,
    changed: true,
  });
  return { changed: true, chunks: newIds.length };
}
