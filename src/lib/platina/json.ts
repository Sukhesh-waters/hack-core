/**
 * Getting a JSON object out of a model reply. Pure.
 *
 * Every Platina analysis call asks for JSON, and `response_format` is not a
 * guarantee: reasoning models answer with their thinking wrapped around the
 * object ("Okay, the user is asking me to… {\"ok\":true}"), some wrap it in a
 * ```json fence, and some add a closing remark. Live-verified 2026-09-21:
 * nvidia/nemotron-3-super-120b-a12b does exactly this even with
 * response_format set.
 *
 * Without this, those replies fall through every parser's catch block into the
 * "treat the raw text as the answer" path — which does not throw, does not
 * warn, and quietly turns a structured claim into a paragraph of reasoning.
 * That is the silent-degradation class this project keeps paying for.
 *
 * Deliberately narrow: it finds the first BALANCED object or array and parses
 * it. It never repairs broken JSON — a malformed object stays a failure.
 */

/** Strips ```json fences, which several providers add despite being asked not to. */
function unfence(raw: string): string {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  return fence ? fence[1] : raw;
}

/**
 * The first balanced {...} or [...] in the text, respecting strings and
 * escapes — a brace inside "a } here" must not end the object.
 */
export function firstJsonBlock(raw: string): string | null {
  const text = unfence(raw);
  const start = text.search(/[{[]/);
  if (start === -1) return null;

  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === open) depth++;
    else if (char === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parses a model reply as JSON, tolerating prose and fences around it.
 * Returns null rather than throwing: the caller decides what an unparseable
 * reply means, and every caller here already has an honest fallback.
 */
export function extractJson<T = unknown>(raw: string): T | null {
  const direct = tryParse<T>(raw);
  if (direct !== null) return direct;
  const block = firstJsonBlock(raw);
  return block === null ? null : tryParse<T>(block);
}

function tryParse<T>(text: string): T | null {
  try {
    const parsed = JSON.parse(text) as T;
    // A bare string or number is not the object a caller asked for.
    return parsed !== null && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
