/**
 * Embedding through the shared model router — the only call-site. A failure
 * returns null: the row is stored without a vector and retrieval simply
 * cannot surface it semantically. Never a fabricated embedding.
 */
import { routeAI } from "@/lib/ai/router";

export async function embedText(text: string): Promise<number[] | null> {
  try {
    const [embedding] = await routeAI({ kind: "embed", texts: [text] });
    return embedding ?? null;
  } catch {
    return null;
  }
}

/** Texts per embedding request: one request per page instead of one per passage. */
export const EMBED_BATCH = 50;

/**
 * Embeds many texts in batched requests. All or nothing: null when any batch
 * fails, so a caller never stores a partly embedded page.
 */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  const out: number[][] = [];
  try {
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const batch = texts.slice(i, i + EMBED_BATCH);
      const vectors = await routeAI({ kind: "embed", texts: batch });
      if (vectors.length !== batch.length) return null;
      out.push(...vectors);
    }
    return out;
  } catch {
    return null;
  }
}
