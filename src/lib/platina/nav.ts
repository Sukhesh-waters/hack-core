/**
 * Platina primary navigation, grouped by the loop the product runs (C7.9):
 * watch the market -> decide what to do -> make it -> learn from results.
 * Slices add their pages into these groups (Competitors, Events and the
 * Brain map under Watch; Studio under Make; Ads under Watch).
 *
 * Legacy routes (/brand, /scans, /brain, /ideation, /campaigns, /claims,
 * /receipts, /config) stay reachable by URL for owner comparison until their
 * transition slices; they are deliberately absent here.
 */
export const PLATINA_NAV_GROUPS = ["", "Watch", "Decide", "Make", "Learn", "Review", "Admin"] as const;
export type PlatinaNavGroup = (typeof PLATINA_NAV_GROUPS)[number];

export const PLATINA_NAV = [
  { slug: "", label: "Cockpit", group: "" },
  // The whole flow, live, in 3D (sources -> analysis -> Brain -> use).
  { slug: "live", label: "Live flow", group: "Watch" },
  { slug: "brands", label: "Clients", group: "Watch" },
  // Campaign intelligence (C5): interest -> campaigns -> plan -> creative.
  { slug: "opportunities", label: "Opportunities", group: "Decide" },
  { slug: "plan", label: "Plan", group: "Decide" },
  // C6 learning loop: creatives, their numbers, reviews, what they teach.
  { slug: "results", label: "Results", group: "Learn" },
  { slug: "outcomes", label: "Outcomes", group: "Learn" },
  { slug: "audits", label: "Audits", group: "Review" },
  { slug: "findings", label: "Findings", group: "Review" },
  { slug: "solutions", label: "Solutions", group: "Review" },
  { slug: "admin", label: "Admin", group: "Admin" },
] as const satisfies readonly { slug: string; label: string; group: PlatinaNavGroup }[];

export type PlatinaNavSection = (typeof PLATINA_NAV)[number];
