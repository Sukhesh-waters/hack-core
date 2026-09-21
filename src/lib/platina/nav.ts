/**
 * Platina primary navigation — the outcome-oriented destinations, plus the
 * campaign planner ("Plan": two-line brief -> learning planner -> roadmap).
 * Legacy routes (/brand, /scans, /brain, /ideation, /campaigns, /claims,
 * /receipts, /config) stay reachable by URL for owner comparison until their
 * transition slices; they are deliberately absent here.
 */
export const PLATINA_NAV = [
  { slug: "", label: "Cockpit" },
  // The whole flow, live, in 3D (sources -> analysis -> Brain -> use).
  { slug: "live", label: "Live flow" },
  { slug: "brands", label: "Clients" },
  // Campaign intelligence (C5): interest -> campaigns -> plan -> creative.
  { slug: "opportunities", label: "Opportunities" },
  { slug: "plan", label: "Plan" },
  { slug: "audits", label: "Audits" },
  { slug: "findings", label: "Findings" },
  { slug: "solutions", label: "Solutions" },
  { slug: "outcomes", label: "Outcomes" },
  { slug: "admin", label: "Admin" },
] as const;

export type PlatinaNavSection = (typeof PLATINA_NAV)[number];
