import { db } from "@/db";
import { postEmbeddings } from "@/db/schema";
import { routeAI } from "@/lib/ai/router";

const EMBED_BATCH_SIZE = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Embed captions via the router (Gemini) and store them. Embeddings are an
 * enhancement — on failure the KB rows stand without them (degradation
 * ladder), so this returns the embedded count instead of throwing.
 */
export async function embedPosts(
  workspaceId: string,
  rows: { id: string; caption: string | null }[],
): Promise<number> {
  const withCaptions = rows.filter((row) => row.caption?.trim());
  if (withCaptions.length === 0) return 0;

  let embedded = 0;
  try {
    for (const batch of chunk(withCaptions, EMBED_BATCH_SIZE)) {
      const vectors = await routeAI({
        kind: "embed",
        texts: batch.map((row) => row.caption as string),
      });
      await db.insert(postEmbeddings).values(
        batch.map((row, i) => ({
          workspaceId,
          postId: row.id,
          source: "first_party" as const,
          embedding: vectors[i],
        })),
      );
      embedded += batch.length;
    }
  } catch {
    // Partial embeddings are fine; retry/backfill arrives with Inngest in Phase 4.
  }
  return embedded;
}
