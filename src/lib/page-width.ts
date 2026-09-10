/**
 * Width contract for page content. Each page picks the width that fits its
 * layout — boards and grids get the full viewport, prose pages stay narrow
 * and readable, and everything in between gets a sensible cap.
 *
 * This replaces the single `max-w-4xl` that clamped every page to 896px.
 */
export type PageWidth =
  | "prose" // max-w-3xl  — docs, decisions, single-record reads
  | "app"   // max-w-6xl  — standard pages (overview, approvals, hub)
  | "wide"  // max-w-[1600px] — reports, cockpit, KB
  | "full"; // no max-w   — boards and grids that scroll horizontally

export const WIDTH_CLASSES: Record<PageWidth, string> = {
  prose: "max-w-3xl",
  app: "max-w-6xl",
  wide: "max-w-[1600px]",
  full: "", // no constraint — the page fills the available width
};
