/**
 * Platina primary navigation. Owner decision 2026-09-20: campaign planning is
 * the only supported feature, so it is the only destination. Every other
 * Platina route (cockpit, audits, findings, solutions, outcomes, admin and the
 * legacy /brand, /scans, /brain, /ideation, /campaigns, /claims, /receipts,
 * /config) is hidden from navigation but still reachable by URL: hidden, not
 * deleted, until the owner-signed transition matrix says otherwise.
 */
export const PLATINA_NAV = [{ slug: "plan", label: "Plan" }] as const;

export type PlatinaNavSection = (typeof PLATINA_NAV)[number];
