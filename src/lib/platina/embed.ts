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
