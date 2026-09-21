/**
 * What a finding is called (core spine R2). Pure.
 *
 * Round 3 titled every finding with the page's HTML <title>, so the findings
 * list read "Contact sales", "Pricing", "About us" — a sitemap, not
 * intelligence. The order below is the fix: the model's own naming of the
 * move first, the competitor plus what it claimed second, and the page title
 * only as a last resort.
 */

export const MAX_TITLE = 110;
export const UNNAMED = "Unnamed signal";

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** First sentence, or the first clause of a long one. */
export function firstSentence(text: string, max = 90): string {
  const clean = collapse(text);
  if (!clean) return "";
  const stop = clean.search(/[.!?](\s|$)/);
  const sentence = stop > 0 ? clean.slice(0, stop) : clean;
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

const mentions = (text: string, name: string) =>
  text.toLowerCase().includes(name.toLowerCase().split(/\s+/)[0] ?? name.toLowerCase());

export function findingTitleFor(input: {
  /** The proposer's own headline, when it gave a usable one. */
  headline: string | null;
  competitorName: string | null;
  claimText: string;
  pageTitle: string | null;
}): string {
  const competitor = input.competitorName?.trim() || null;

  const headline = input.headline ? collapse(input.headline) : "";
  if (headline) {
    const titled =
      competitor && !mentions(headline, competitor)
        ? `${competitor}: ${headline}`
        : headline;
    return titled.slice(0, MAX_TITLE);
  }

  const claim = firstSentence(input.claimText);
  if (claim) {
    const titled =
      competitor && !mentions(claim, competitor) ? `${competitor}: ${claim}` : claim;
    return titled.slice(0, MAX_TITLE);
  }

  // Last resort: the page's own title, which says nothing about the market.
  const page = collapse(input.pageTitle ?? "");
  if (page) {
    return (competitor ? `${competitor}: ${page}` : page).slice(0, MAX_TITLE);
  }
  return UNNAMED;
}
