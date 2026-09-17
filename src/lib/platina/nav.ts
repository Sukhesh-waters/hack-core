/**
 * Platina primary navigation — the six outcome-oriented destinations.
 * Legacy routes (/brand, /scans, /brain, /ideation, /campaigns, /claims,
 * /receipts, /config) stay reachable by URL for owner comparison until their
 * transition slices; they are deliberately absent here.
 */
export const PLATINA_NAV = [
  { slug: "", label: "Cockpit" },
  { slug: "audits", label: "Audits" },
  { slug: "findings", label: "Findings" },
  { slug: "solutions", label: "Solutions" },
  { slug: "outcomes", label: "Outcomes" },
  { slug: "admin", label: "Admin" },
] as const;

export type PlatinaNavSection = (typeof PLATINA_NAV)[number];
