import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Multi-model orchestration policy — WHICH provider a chat call should try
 * first, given who is waiting for it and how much capacity each provider has
 * left. The router (`./router.ts`) owns HOW a provider is called; this module
 * is pure policy so every rule is unit-testable without a network.
 *
 * Measured on this account's keys, 2026-09-21 (scripts/verify-providers.ts):
 *
 *   groq   openai/gpt-oss-120b   ~0.7s  valid JSON  8,000 tokens/MINUTE,
 *                                                   1,000 requests/day
 *                                                   (live x-ratelimit headers)
 *   gemini gemini-2.5-flash      ~1.6s  valid JSON  free tier, no limit headers;
 *                                                   429 when exhausted
 *   nvidia openai/gpt-oss-20b    ~3-4s  valid JSON  no limit headers
 *
 * Groq is the fastest AND the scarcest: one debate prompt is 2-3k tokens, so
 * three background analyses in a minute used to spend its whole minute and
 * the next person to click a button waited on a 429 and a fallback. So:
 *
 *   - a person waiting (interactive) gets the fastest provider first;
 *   - a background job gets NVIDIA first — slower, but nobody is watching,
 *     and it leaves Groq's minute budget for the people who are;
 *   - the quality tier puts the strongest model first (Bedrock when
 *     configured, then Gemini, then Groq's 120b ahead of NVIDIA's 20b).
 *
 * Every provider stays in every ladder: this changes ORDER, never membership,
 * so a policy mistake costs latency, not an answer.
 */

export type Workload = "interactive" | "background";
export type Tier = "fast" | "quality";
type Provider = "groq" | "nvidia" | "gemini" | "bedrock";

export const LADDERS: Record<Tier, Record<Workload, Provider[]>> = {
  fast: {
    interactive: ["groq", "gemini", "nvidia", "bedrock"],
    background: ["nvidia", "gemini", "groq", "bedrock"],
  },
  quality: {
    interactive: ["bedrock", "gemini", "groq", "nvidia"],
    background: ["bedrock", "gemini", "nvidia", "groq"],
  },
};

// ---------------------------------------------------------------------------
// Workload — who is waiting
// ---------------------------------------------------------------------------

const workloadStorage = new AsyncLocalStorage<Workload>();

/**
 * Marks everything inside `fn` as background work. The Inngest route wraps
 * its handler in this once, so every job is background without touching a
 * single call site; a server action is interactive by default.
 */
export function runAsWorkload<T>(workload: Workload, fn: () => T): T {
  return workloadStorage.run(workload, fn);
}

/** The explicit task setting wins, then the ambient context, then interactive. */
export function resolveWorkload(explicit?: Workload): Workload {
  return explicit ?? workloadStorage.getStore() ?? "interactive";
}

// ---------------------------------------------------------------------------
// Capacity — learned from the provider's own rate-limit headers
// ---------------------------------------------------------------------------

/**
 * Tokens a reply is assumed to add on top of the prompt. gpt-oss models spend
 * reasoning tokens before answering, and Groq counts them against the minute.
 */
export const REPLY_TOKEN_ALLOWANCE = 1_200;

type Window = { remaining: number; limit: number; resetAt: number };
type Capacity = { tokens?: Window; requests?: Window };

const capacity = new Map<Provider, Capacity>();

/** "1m26.4s" / "577ms" / "2h3m" / "7.66s" -> milliseconds. Pure. */
export function parseResetDuration(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const pattern = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
  let total = 0;
  let matched = false;
  for (const [, value, unit] of raw.matchAll(pattern)) {
    matched = true;
    const n = Number(value);
    total += unit === "h" ? n * 3_600_000 : unit === "m" ? n * 60_000 : unit === "s" ? n * 1_000 : n;
  }
  return matched ? Math.ceil(total) : null;
}

function readWindow(
  headers: Headers,
  kind: "tokens" | "requests",
  now: number,
): Window | undefined {
  const rawRemaining = headers.get(`x-ratelimit-remaining-${kind}`);
  const rawLimit = headers.get(`x-ratelimit-limit-${kind}`);
  if (rawRemaining === null || rawLimit === null) return undefined;
  const remaining = Number(rawRemaining);
  const limit = Number(rawLimit);
  if (!Number.isFinite(remaining) || !Number.isFinite(limit) || limit <= 0) return undefined;
  const resetMs = parseResetDuration(headers.get(`x-ratelimit-reset-${kind}`));
  return { remaining, limit, resetAt: now + (resetMs ?? 60_000) };
}

export const providerCapacity = {
  /**
   * Records what the provider said it has left. Providers that send no
   * headers (Gemini, NVIDIA today) record nothing and are never gated here —
   * their 429s are handled by the router's cooldown instead.
   */
  observe(provider: Provider, headers: Headers | null | undefined, now: number = Date.now()) {
    if (typeof headers?.get !== "function") return;
    const tokens = readWindow(headers, "tokens", now);
    const requests = readWindow(headers, "requests", now);
    if (!tokens && !requests) return;
    capacity.set(provider, { ...capacity.get(provider), ...(tokens ? { tokens } : {}), ...(requests ? { requests } : {}) });
  },

  /**
   * Whether a call needing `tokens` can succeed right now. False when:
   *   - it is larger than the provider's whole per-minute token limit
   *     (it can never succeed — Groq answers 413), or
   *   - the current window does not have that many tokens left, or
   *   - the request window (Groq: per day) is used up.
   * Unknown capacity is optimistic: no headers seen, no gate.
   */
  canAfford(provider: Provider, tokens: number, now: number = Date.now()): boolean {
    const known = capacity.get(provider);
    if (!known) return true;
    const t = known.tokens;
    if (t) {
      if (tokens > t.limit) return false;
      if (now < t.resetAt && t.remaining < tokens) return false;
    }
    const r = known.requests;
    if (r && now < r.resetAt && r.remaining < 1) return false;
    return true;
  },

  snapshot(now: number = Date.now()) {
    return [...capacity.entries()].map(([provider, c]) => ({
      provider,
      tokensLeft: c.tokens && now < c.tokens.resetAt ? c.tokens.remaining : c.tokens?.limit,
      tokenLimit: c.tokens?.limit,
      requestsLeft: c.requests && now < c.requests.resetAt ? c.requests.remaining : c.requests?.limit,
    }));
  },

  reset() {
    capacity.clear();
  },
};

// ---------------------------------------------------------------------------
// Derailment — a reply that arrived but is not the answer that was asked for
// ---------------------------------------------------------------------------

/**
 * True when `text` holds a parseable JSON object or array — bare, fenced, or
 * wrapped in the reasoning prose some models put around it (the same shapes
 * lib/platina/json.ts's extractJson accepts). Scans balanced brackets while
 * respecting strings, so braces inside string values do not confuse it.
 */
export function containsJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    // fall through to the scan
  }
  for (let start = 0; start < trimmed.length; start++) {
    const open = trimmed[start];
    if (open !== "{" && open !== "[") continue;
    const end = balancedEnd(trimmed, start);
    if (end === -1) continue;
    try {
      JSON.parse(trimmed.slice(start, end + 1));
      return true;
    } catch {
      // not this one; keep scanning
    }
  }
  return false;
}

function balancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Why a reply is unusable, or null when it is fine. An empty reply is never
 * an answer; a JSON call that came back as prose derailed every parser
 * downstream (they fell back to "the raw text is the answer").
 */
export function derailment(text: string, wantsJson: boolean): string | null {
  if (!text.trim()) return "empty reply";
  if (wantsJson && !containsJson(text)) return "prose instead of JSON";
  return null;
}
