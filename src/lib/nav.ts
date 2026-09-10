/** Final-product workspace IA. Pure data — icons live in the sidebar component. */

export const NAV_GROUPS = [
  "Operate",
  "Brand & Creative",
  "Growth & Performance",
  "Settings & Infrastructure",
] as const;

export type NavGroup = (typeof NAV_GROUPS)[number];

/**
 * live    — real backend today, page untouched this slice
 * demo    — final UI on demo provider (wired in Phase B)
 * pending — stub page until its Phase A slice lands
 */
export type SectionStatus = "live" | "demo" | "pending";

export type NavSection = {
  slug: string; // route segment under /w/[ws]/
  label: string;
  group: NavGroup;
  status: SectionStatus;
  parentSlug?: string; // If set, this section is a nested sub-surface under a primary section
};

export const NAV_SECTIONS: NavSection[] = [
  // 1. Operate
  { slug: "overview", label: "Overview", group: "Operate", status: "live" },
  { slug: "my-work", label: "My Work", group: "Operate", status: "live" },
  { slug: "approvals", label: "Approvals", group: "Operate", status: "live", parentSlug: "my-work" },
  { slug: "sprint", label: "Campaign Sprints", group: "Operate", status: "live" },
  { slug: "production", label: "Production Board", group: "Operate", status: "live" },
  { slug: "plan", label: "Plan & Validate", group: "Operate", status: "live", parentSlug: "production" },
  { slug: "calendar", label: "Editorial Calendar", group: "Operate", status: "live", parentSlug: "production" },
  { slug: "tickets", label: "Tickets & Tasks", group: "Operate", status: "live" },
  { slug: "sop", label: "SOPs & Runbooks", group: "Operate", status: "live" },
  { slug: "hub", label: "Team Hub", group: "Operate", status: "live" },
  { slug: "docs", label: "Workspace Docs", group: "Operate", status: "live" },

  // 2. Brand & Creative
  { slug: "brand-gene", label: "Brand DNA & Vault", group: "Brand & Creative", status: "live" },
  { slug: "drift", label: "Brand Drift", group: "Brand & Creative", status: "live", parentSlug: "brand-gene" },
  { slug: "assets", label: "Asset Library", group: "Brand & Creative", status: "live", parentSlug: "brand-gene" },
  { slug: "ideation", label: "Ideation Pool", group: "Brand & Creative", status: "live" },
  { slug: "studio", label: "Creative Studio", group: "Brand & Creative", status: "live" },
  { slug: "kb", label: "Knowledge Base", group: "Brand & Creative", status: "live" },
  { slug: "decisions", label: "Decisions Log", group: "Brand & Creative", status: "live", parentSlug: "kb" },

  // 3. Growth & Performance
  { slug: "cockpit", label: "Command Cockpit", group: "Growth & Performance", status: "live" },
  { slug: "reports", label: "Reports & Analytics", group: "Growth & Performance", status: "live" },
  { slug: "ads", label: "Meta Ads Engine", group: "Growth & Performance", status: "live" },

  // 4. Settings & Infrastructure
  { slug: "clients", label: "Clients & Accounts", group: "Settings & Infrastructure", status: "live" },
  { slug: "accounts", label: "Connected Accounts", group: "Settings & Infrastructure", status: "live", parentSlug: "clients" },
  { slug: "workflows", label: "Workflows & Rules", group: "Settings & Infrastructure", status: "live" },
  { slug: "fields", label: "Custom Fields", group: "Settings & Infrastructure", status: "live", parentSlug: "workflows" },
  { slug: "automations", label: "Automations", group: "Settings & Infrastructure", status: "live" },
  { slug: "rules", label: "Harness Rules", group: "Settings & Infrastructure", status: "live", parentSlug: "automations" },
];

export function isPrimarySection(section: NavSection): boolean {
  return !section.parentSlug;
}

export function getChildSections(parentSlug: string): NavSection[] {
  return NAV_SECTIONS.filter((s) => s.parentSlug === parentSlug);
}

export function getSectionBySlug(slug: string): NavSection | undefined {
  return NAV_SECTIONS.find((s) => s.slug === slug);
}

