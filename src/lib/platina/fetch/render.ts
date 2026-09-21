/**
 * Render escalation (core spine R9). Pure.
 *
 * Most competitor sites are now React/Vue shells. Cheerio executes no
 * JavaScript, so it fetches the shell and gets a document that is technically
 * successful and completely empty of content — which is worse than a failure,
 * because a failure is visible and this is not. The run reports "1 page
 * collected", the analysis skips it as thin, and nobody learns that the site
 * was never actually read.
 *
 * So: when a cheap crawl comes back looking like a shell, the source is
 * escalated once to the rendered (headless browser) crawler, and the decision
 * is remembered on the source so the wasted cheap pass happens only once.
 * Rendering costs roughly 5-10x, which is exactly why it is a reaction to
 * evidence rather than a default.
 *
 * Constitution: this is still Apify — `crawlerType: "playwright:adaptive"` on
 * the same actor, not a second HTTP path and not a new vendor.
 */

/** Below this much text, a "successful" page did not really return content. */
export const SHELL_BODY_CHARS = 250;

/** Phrases a JS shell serves to a client that cannot run scripts. */
const SHELL_MARKERS = [
  "enable javascript",
  "javascript is required",
  "please enable js",
  "loading…",
  "loading...",
  "you need to enable javascript to run this app",
  "this site requires javascript",
];

export type RenderCandidate = { body: string };

export type EscalationDecision = {
  escalate: boolean;
  /** Plain language, recorded on the run and shown to the operator. */
  reason: string;
};

/**
 * True when what came back is a shell rather than a page: nothing at all, or
 * every document thin, or an explicit "enable JavaScript" notice.
 *
 * "Every" matters — one thin page among ten real ones is a thin page, not a
 * rendering problem, and escalating on it would multiply the bill for nothing.
 */
export function looksJsRendered(docs: RenderCandidate[]): boolean {
  if (docs.length === 0) return true;
  return docs.every((doc) => {
    const text = doc.body.replace(/\s+/g, " ").trim();
    if (text.length < SHELL_BODY_CHARS) return true;
    const lower = text.toLowerCase();
    return SHELL_MARKERS.some((marker) => lower.includes(marker));
  });
}

/**
 * Whether to spend a rendered retry on this target.
 *
 * Never escalates a target that already renders (it would loop), one the
 * operator has no budget left for, or one whose failure was the account's
 * fault rather than the page's — a 402 means "out of memory or credits", and
 * a heavier crawl is the last thing that helps.
 */
export function shouldEscalate(input: {
  alreadyRendering: boolean;
  docs: RenderCandidate[];
  /** Error text from the cheap attempt, when it failed outright. */
  error?: string | null;
  remainingPages: number;
}): EscalationDecision {
  if (input.alreadyRendering) {
    return { escalate: false, reason: "already rendered with a browser" };
  }
  if (input.remainingPages <= 0) {
    return { escalate: false, reason: "no collection budget left for a rendered retry" };
  }
  if (input.error) {
    // An account-level refusal is not a rendering problem.
    if (/\b402\b|limit was reached|credits are used up/i.test(input.error)) {
      return { escalate: false, reason: "the collection account refused the run" };
    }
    return {
      escalate: true,
      reason: "the plain fetch failed — retrying with a browser",
    };
  }
  if (looksJsRendered(input.docs)) {
    return {
      escalate: true,
      reason:
        "the page returned almost no text, which is what a JavaScript site gives a plain fetch — retrying with a browser",
    };
  }
  return { escalate: false, reason: "the plain fetch returned real content" };
}
