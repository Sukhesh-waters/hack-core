/**
 * Chunking (R4.5). Two rules, by content kind:
 *
 * - Records (campaigns, outcomes, any structured row) are atomic. Splitting
 *   a record mid-way lets retrieval return fragments of two unrelated
 *   records; one record is one chunk, always.
 * - Prose (brand declarations, long-form standards) splits on paragraph
 *   boundaries with a size cap — never mid-sentence by byte count.
 */

export const PROSE_CHUNK_TARGET = 1200;

/** One record, one chunk. `label` is a short human key (e.g. campaign title). */
export function chunkRecord(record: {
  label: string;
  fields: Record<string, string | number | null | undefined>;
}): string {
  const lines = Object.entries(record.fields)
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
    .map(([k, v]) => `${k}: ${v}`);
  return `${record.label}\n${lines.join("\n")}`.trim();
}

/**
 * Paragraph-boundary splitting. Paragraphs are packed into chunks up to the
 * target size; a single over-long paragraph is split on sentence boundaries;
 * a single over-long sentence is hard-split as the last resort.
 */
export function chunkProse(text: string, target = PROSE_CHUNK_TARGET): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return [];

  const units: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= target) {
      units.push(paragraph);
      continue;
    }
    // Over-long paragraph: split on sentence boundaries.
    const sentences = paragraph.split(/(?<=[.!?])\s+/);
    let current = "";
    for (const sentence of sentences) {
      if (current && current.length + sentence.length + 1 > target) {
        units.push(current);
        current = sentence;
      } else {
        current = current ? `${current} ${sentence}` : sentence;
      }
    }
    if (current) units.push(current);
  }

  // Pack units toward the target without exceeding it where avoidable.
  const chunks: string[] = [];
  let current = "";
  for (const unit of units) {
    if (current && current.length + unit.length + 2 > target) {
      chunks.push(current);
      current = unit;
    } else {
      current = current ? `${current}\n\n${unit}` : unit;
    }
  }
  if (current) chunks.push(current);

  // Last resort: a unit still over the target is hard-split.
  return chunks.flatMap((chunk) => {
    if (chunk.length <= target * 2) return [chunk];
    const parts: string[] = [];
    for (let i = 0; i < chunk.length; i += target) {
      parts.push(chunk.slice(i, i + target));
    }
    return parts;
  });
}
