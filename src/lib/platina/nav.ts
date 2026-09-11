export const PLATINA_NAV_GROUPS = [
  "Cockpit",
  "Intelligence",
  "Campaigns",
  "Operate",
] as const;

export type PlatinaNavGroup = (typeof PLATINA_NAV_GROUPS)[number];

export type PlatinaNavSection = {
  slug: string;
  label: string;
  group: PlatinaNavGroup;
};

export const PLATINA_NAV: PlatinaNavSection[] = [
  { slug: "", label: "Cockpit", group: "Cockpit" },
  { slug: "brand", label: "Brand Gene", group: "Intelligence" },
  { slug: "scans", label: "Scan specs", group: "Intelligence" },
  { slug: "brain", label: "Brain", group: "Intelligence" },
  { slug: "ideation", label: "Ideation", group: "Campaigns" },
  { slug: "receipts", label: "Receipts", group: "Campaigns" },
  { slug: "campaigns", label: "Campaigns", group: "Campaigns" },
  { slug: "claims", label: "Claims screen", group: "Operate" },
  { slug: "config", label: "Config", group: "Operate" },
];
