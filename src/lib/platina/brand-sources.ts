/**
 * Brand source helpers (Slice 8). Pure. A brand source is a declared,
 * approved origin of the standard — a public URL fetched as consented
 * first-party content (Plane A) or pasted text. Freshness is hash-based:
 * unchanged content produces no new chunks, ever.
 */
import { contentHash } from "./fetch/canonical";

export function hashBrandContent(content: string): string {
  // The URL is constant per source; the hash tracks the content.
  return contentHash("brand-source", content);
}

export function hasSourceChanged(
  priorHash: string | null,
  newHash: string,
): boolean {
  return priorHash !== newHash;
}

/** What a confirm/refresh does with fetched or pasted content. */
export type BrandExtraction = {
  contentHash: string;
  changed: boolean;
  chunks: string[];
};

export function planBrandExtraction(
  content: string,
  priorHash: string | null,
  chunk: (text: string) => string[],
): BrandExtraction {
  const hash = hashBrandContent(content);
  const changed = hasSourceChanged(priorHash, hash);
  return {
    contentHash: hash,
    changed,
    chunks: changed ? chunk(content) : [],
  };
}
