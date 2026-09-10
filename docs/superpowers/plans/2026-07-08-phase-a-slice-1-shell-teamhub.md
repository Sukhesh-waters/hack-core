# Phase A · Slice 1 — Final Shell IA + Data Providers + Overview + Team Hub

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the workspace sidebar to the final 17-section IA, add the swappable demo/live data-provider foundation, and ship the first two final screens — Overview and Team Hub (chat + approvals + tasks + shared reminders) — on demo data.

**Architecture:** A pure-data nav registry drives a grouped sidebar; every new screen reads through a typed provider facade in `src/lib/data/` that resolves demo vs live per section. Demo providers are seeded server modules (no DB). Team Hub interactivity is client-local state in demo mode; Phase B swaps the facade to Drizzle + Supabase Realtime with zero UI changes. Sections whose final UI lands in later slices get stub pages so the nav has no dead links.

**Tech Stack:** Next.js 14 App Router (server components + client islands), TypeScript, Tailwind + shadcn/ui, Vitest, lucide-react.

**Spec:** `docs/superpowers/specs/2026-07-08-final-shell-ui-first-design.md`

## Global Constraints

- workspace_id isolation on every table, every query — demo providers take `workspaceId` in their signature even when unused, so live swap-in never changes call sites.
- Two-layer rule: first-party baseline vs public pattern data, never mixed, never both cited.
- No inline styles; Tailwind + shadcn/ui only. Match existing house classes: `GlassCard`, `label-mono`, `font-display`, `text-brand-teal`, `text-brand-purple`.
- Existing routes and working backends stay untouched. Live sections (kb, clients, accounts, ideation, studio, approvals, calendar, cockpit, patterns→later, analytics→later) keep their current pages this slice.
- Every slice ships with tests; done means `npm run typecheck`, `npm test`, `npm run build` all pass.
- No agent spawns an agent.

## Follow-up plans (written when their turn comes, per constitution's one-slice-at-a-time rule)

- Slice 2: Brand Gene tab + KB/Database merge + Scraper Ops console UI (folds `patterns` into `kb`).
- Slice 3: Plan & Validate + Production kanban + Calendar 3-column upgrade.
- Slice 4: Drift + Reports (remap `analytics`) + Ads + Harness Rules + Ask InstaMedia + OAuth modal + Portal/Admin shells.

---

### Task 1: Nav registry + grouped sidebar

**Files:**
- Create: `src/lib/nav.ts`
- Create: `src/lib/nav.test.ts`
- Modify: `src/components/workspace-nav.tsx` (full rewrite of the items list + rendering)

**Interfaces:**
- Produces: `NAV_SECTIONS: NavSection[]`, `type NavSection = { slug; label; group; status }`, `NAV_GROUPS: readonly ["Operate","Intelligence","Business","Infrastructure"]`. Task 4 reads `NAV_SECTIONS` to know which stub pages to create; Tasks 5–6 use slugs `overview` and `hub`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/nav.test.ts
import { describe, expect, it } from "vitest";
import { NAV_GROUPS, NAV_SECTIONS } from "./nav";

describe("nav registry", () => {
  it("has 17 sections with unique slugs", () => {
    expect(NAV_SECTIONS).toHaveLength(17);
    const slugs = NAV_SECTIONS.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(17);
  });

  it("only uses known groups, and every group is non-empty", () => {
    for (const s of NAV_SECTIONS) {
      expect(NAV_GROUPS).toContain(s.group);
    }
    for (const g of NAV_GROUPS) {
      expect(NAV_SECTIONS.some((s) => s.group === g)).toBe(true);
    }
  });

  it("keeps every pre-existing live route in the registry", () => {
    const live = NAV_SECTIONS.filter((s) => s.status === "live").map(
      (s) => s.slug,
    );
    for (const slug of [
      "kb",
      "clients",
      "accounts",
      "ideation",
      "studio",
      "approvals",
      "calendar",
      "cockpit",
    ]) {
      expect(live).toContain(slug);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/nav.test.ts`
Expected: FAIL — `Cannot find module './nav'`

- [ ] **Step 3: Write the registry**

```ts
// src/lib/nav.ts
/** Final-product workspace IA. Pure data — icons live in the sidebar component. */

export const NAV_GROUPS = [
  "Operate",
  "Intelligence",
  "Business",
  "Infrastructure",
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
};

export const NAV_SECTIONS: NavSection[] = [
  // Operate
  { slug: "overview", label: "Overview", group: "Operate", status: "demo" },
  { slug: "hub", label: "Team Hub", group: "Operate", status: "demo" },
  { slug: "plan", label: "Plan & Validate", group: "Operate", status: "pending" },
  { slug: "production", label: "Production", group: "Operate", status: "pending" },
  { slug: "approvals", label: "Approvals", group: "Operate", status: "live" },
  { slug: "calendar", label: "Calendar", group: "Operate", status: "live" },
  // Intelligence
  { slug: "brand-gene", label: "Brand Gene", group: "Intelligence", status: "pending" },
  { slug: "ideation", label: "Ideation", group: "Intelligence", status: "live" },
  { slug: "studio", label: "Creative Studio", group: "Intelligence", status: "live" },
  { slug: "kb", label: "Knowledge Base", group: "Intelligence", status: "live" },
  { slug: "drift", label: "Brand Drift", group: "Intelligence", status: "pending" },
  // Business
  { slug: "reports", label: "Reports", group: "Business", status: "pending" },
  { slug: "ads", label: "Ads Management", group: "Business", status: "pending" },
  { slug: "cockpit", label: "Cockpit", group: "Business", status: "live" },
  // Infrastructure
  { slug: "accounts", label: "Connected Accounts", group: "Infrastructure", status: "live" },
  { slug: "rules", label: "Harness Rules", group: "Infrastructure", status: "pending" },
  { slug: "clients", label: "Clients", group: "Infrastructure", status: "live" },
];
```

Note: `patterns` and `analytics` stay reachable at their current URLs but leave
the sidebar now — their content merges into `kb` (Slice 2) and `reports`
(Slice 4). Workspaces switching stays on the existing top-level `/hub` link in
`app-sidebar.tsx`, which is untouched.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/nav.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Rewrite the sidebar to render groups**

Replace the body of `src/components/workspace-nav.tsx` with:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpenText,
  Cable,
  CalendarDays,
  CheckCheck,
  Dna,
  Gauge,
  Kanban,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  Megaphone,
  MessagesSquare,
  PenTool,
  Radar,
  Sliders,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import { NAV_GROUPS, NAV_SECTIONS } from "@/lib/nav";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  overview: LayoutDashboard,
  hub: MessagesSquare,
  plan: ListChecks,
  production: Kanban,
  approvals: CheckCheck,
  calendar: CalendarDays,
  "brand-gene": Dna,
  ideation: Lightbulb,
  studio: PenTool,
  kb: BookOpenText,
  drift: Radar,
  reports: TrendingUp,
  ads: Megaphone,
  cockpit: Gauge,
  accounts: Cable,
  rules: Sliders,
  clients: Users,
};

/** Renders workspace links only when inside /w/[ws]/… routes. */
export function WorkspaceNav() {
  const pathname = usePathname();
  const match = pathname.match(/^\/w\/([^/]+)/);
  if (!match) return null;

  const base = `/w/${match[1]}`;

  return (
    <>
      {NAV_GROUPS.map((group) => (
        <div key={group}>
          <p className="label-mono px-3 pb-2 pt-4 text-white/30">{group}</p>
          {NAV_SECTIONS.filter((s) => s.group === group).map((s) => {
            const Icon = ICONS[s.slug];
            const href = `${base}/${s.slug}`;
            return (
              <Link
                key={s.slug}
                href={href}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition hover:bg-white/10 hover:text-white",
                  pathname.startsWith(href)
                    ? "bg-white/10 text-white"
                    : "text-white/75",
                )}
              >
                <Icon className="h-4 w-4 text-brand-teal" aria-hidden />
                {s.label}
                {s.status === "pending" && (
                  <span className="label-mono ml-auto text-[9px] text-white/25">
                    soon
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}
```

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors

```bash
git add src/lib/nav.ts src/lib/nav.test.ts src/components/workspace-nav.tsx
git commit -m "feat: final 17-section workspace IA — grouped nav registry + sidebar"
```

---

### Task 2: Data-provider foundation (types + mode registry)

**Files:**
- Create: `src/lib/data/types.ts`
- Create: `src/lib/data/registry.ts`
- Create: `src/lib/data/registry.test.ts`

**Interfaces:**
- Produces: all Team Hub / Overview data types (exact shapes below); `dataMode(section: string): "demo" | "live"`. Task 3 implements providers returning these types; Tasks 5–6 render them.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/data/registry.test.ts
import { describe, expect, it } from "vitest";
import { dataMode } from "./registry";

describe("dataMode", () => {
  it("returns demo for sections not yet wired", () => {
    expect(dataMode("overview")).toBe("demo");
    expect(dataMode("hub")).toBe("demo");
  });

  it("defaults to live for everything else", () => {
    expect(dataMode("studio")).toBe("live");
    expect(dataMode("nonexistent")).toBe("live");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/data/registry.test.ts`
Expected: FAIL — `Cannot find module './registry'`

- [ ] **Step 3: Write types and registry**

```ts
// src/lib/data/types.ts
/**
 * Section data contracts. Each screen renders exactly these shapes,
 * whether the provider is demo (Phase A) or live (Phase B+).
 */

// ---- Team Hub ----
export type HubMember = {
  id: string;
  name: string;
  initial: string;
  online: boolean;
};

export type HubMessage =
  | { id: string; kind: "system"; time: string; text: string }
  | {
      id: string;
      kind: "text";
      time: string;
      author: string;
      initial: string;
      text: string;
    }
  | {
      id: string;
      kind: "approval";
      time: string;
      author: string;
      initial: string;
      title: string;
      status: "pending" | "approved" | "rejected";
      decidedBy?: string;
    };

export type HubApproval = {
  id: string;
  title: string;
  requestedBy: string;
  time: string;
  status: "pending" | "approved" | "rejected";
  decidedBy?: string;
};

export type HubPriority = "High" | "Medium" | "Low";

export type HubTask = {
  id: string;
  title: string;
  done: boolean;
  priority: HubPriority;
};

export type HubReminder = {
  id: string;
  title: string;
  due: string; // human label in demo mode, ISO once live
  owner: string;
};

export type HubPlanItem = {
  id: string;
  title: string;
  format: string;
  status: "proposed" | "accepted" | "rejected";
};

export type TeamHubData = {
  channel: string;
  members: HubMember[];
  messages: HubMessage[];
  approvals: HubApproval[];
  tasks: HubTask[];
  reminders: HubReminder[];
  planQuickView: HubPlanItem[];
};

// ---- Overview ----
export type OverviewStat = { label: string; value: string; sub: string };

export type OverviewBoardRow = { id: string; title: string; stage: string };

export type OverviewSlot = {
  id: string;
  title: string;
  platform: string;
  day: number;
  status: string;
};

export type OverviewData = {
  stats: OverviewStat[];
  productionBoard: OverviewBoardRow[];
  upcoming: OverviewSlot[];
};
```

```ts
// src/lib/data/registry.ts
export type DataMode = "demo" | "live";

/** Sections still on seeded demo data. Wiring a section = delete its row. */
const DEMO_SECTIONS: Record<string, true> = {
  overview: true,
  hub: true,
};

export function dataMode(section: string): DataMode {
  return DEMO_SECTIONS[section] ? "demo" : "live";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/data/registry.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/types.ts src/lib/data/registry.ts src/lib/data/registry.test.ts
git commit -m "feat: swappable demo/live data-provider foundation"
```

---

### Task 3: Demo providers + facades for Team Hub and Overview

**Files:**
- Create: `src/lib/data/demo/team-hub.ts`
- Create: `src/lib/data/demo/overview.ts`
- Create: `src/lib/data/team-hub.ts`
- Create: `src/lib/data/overview.ts`
- Create: `src/lib/data/demo/demo-data.test.ts`

**Interfaces:**
- Consumes: types from `src/lib/data/types.ts`, `dataMode` from `src/lib/data/registry.ts`.
- Produces: `getTeamHubData(workspaceId: string): Promise<TeamHubData>` and `getOverviewData(workspaceId: string): Promise<OverviewData>` — the only imports pages use. Phase B reimplements the facades' live branch; call sites never change.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/data/demo/demo-data.test.ts
import { describe, expect, it } from "vitest";
import { demoTeamHub } from "./team-hub";
import { demoOverview } from "./overview";

describe("demo team hub dataset", () => {
  it("seeds every panel of the hub", () => {
    const d = demoTeamHub();
    expect(d.members.length).toBeGreaterThanOrEqual(3);
    expect(d.messages.length).toBeGreaterThanOrEqual(4);
    expect(d.approvals.length).toBeGreaterThanOrEqual(1);
    expect(d.tasks.length).toBeGreaterThanOrEqual(3);
    expect(d.reminders.length).toBeGreaterThanOrEqual(2);
    expect(d.planQuickView.length).toBeGreaterThanOrEqual(2);
  });

  it("includes all three message kinds with unique ids", () => {
    const d = demoTeamHub();
    const kinds = new Set(d.messages.map((m) => m.kind));
    expect(kinds).toEqual(new Set(["system", "text", "approval"]));
    const ids = d.messages.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("demo overview dataset", () => {
  it("seeds stats, board, and upcoming slots", () => {
    const d = demoOverview();
    expect(d.stats.length).toBeGreaterThanOrEqual(4);
    expect(d.productionBoard.length).toBeGreaterThanOrEqual(3);
    expect(d.upcoming.length).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/data/demo/demo-data.test.ts`
Expected: FAIL — `Cannot find module './team-hub'`

- [ ] **Step 3: Write demo datasets and facades**

```ts
// src/lib/data/demo/team-hub.ts
import type { TeamHubData } from "../types";

/** Seeded "Aurora Skincare" workspace channel. Fresh copy per call. */
export function demoTeamHub(): TeamHubData {
  return {
    channel: "# aurora-skincare",
    members: [
      { id: "m1", name: "You", initial: "Y", online: true },
      { id: "m2", name: "Priya", initial: "P", online: true },
      { id: "m3", name: "Theo", initial: "T", online: true },
      { id: "m4", name: "Mara", initial: "M", online: false },
    ],
    messages: [
      {
        id: "msg1",
        kind: "system",
        time: "09:00",
        text: "Workspace channel created · Aurora Skincare",
      },
      {
        id: "msg2",
        kind: "text",
        time: "09:12",
        author: "Priya",
        initial: "P",
        text: "Bottling-line reel v2 is up in the studio — hook feels stronger.",
      },
      {
        id: "msg3",
        kind: "approval",
        time: "09:16",
        author: "Theo",
        initial: "T",
        title: "Reel · bottling-line v2",
        status: "pending",
      },
      {
        id: "msg4",
        kind: "text",
        time: "09:21",
        author: "Mara",
        initial: "M",
        text: "Caption needs softening before it goes near the queue.",
      },
    ],
    approvals: [
      {
        id: "ap1",
        title: "Reel · bottling-line v2",
        requestedBy: "Theo",
        time: "09:16",
        status: "pending",
      },
    ],
    tasks: [
      { id: "t1", title: "Approve bottling-line reel v2", done: false, priority: "High" },
      { id: "t2", title: "Refresh ingredient carousel copy", done: false, priority: "Medium" },
      { id: "t3", title: "Collect UGC permissions", done: true, priority: "Low" },
    ],
    reminders: [
      { id: "r1", title: "Founder story post goes live", due: "Tomorrow 10:00", owner: "Priya" },
      { id: "r2", title: "Monthly report draft due", due: "Fri 17:00", owner: "You" },
    ],
    planQuickView: [
      { id: "p1", title: "Ingredient myth-busting carousel", format: "Carousel", status: "proposed" },
      { id: "p2", title: "Behind-the-scenes: cold chain", format: "Reel", status: "proposed" },
      { id: "p3", title: "Customer before/after story", format: "Story", status: "accepted" },
    ],
  };
}
```

```ts
// src/lib/data/demo/overview.ts
import type { OverviewData } from "../types";

/** Seeded workspace overview. Fresh copy per call. */
export function demoOverview(): OverviewData {
  return {
    stats: [
      { label: "Slots this month", value: "18", sub: "12 approved · 3 drafted" },
      { label: "On-time rate", value: "94%", sub: "last 30 days" },
      { label: "Open approvals", value: "1", sub: "oldest 2h" },
      { label: "Baseline freshness", value: "3d", sub: "last first-party sync" },
    ],
    productionBoard: [
      { id: "b1", title: "Bottling-line reel v2", stage: "Internal review" },
      { id: "b2", title: "Ingredient carousel", stage: "In progress" },
      { id: "b3", title: "Founder story post", stage: "Brief" },
    ],
    upcoming: [
      { id: "u1", title: "Founder story post", platform: "Instagram", day: 9, status: "Scheduled" },
      { id: "u2", title: "Ingredient carousel", platform: "Instagram", day: 11, status: "Drafted" },
      { id: "u3", title: "Cold-chain reel", platform: "LinkedIn", day: 14, status: "Proposed" },
    ],
  };
}
```

```ts
// src/lib/data/team-hub.ts
import { dataMode } from "./registry";
import { demoTeamHub } from "./demo/team-hub";
import type { TeamHubData } from "./types";

/**
 * Single entry point for Team Hub data. Phase B replaces the live branch
 * with Drizzle queries + Supabase Realtime; call sites do not change.
 */
export async function getTeamHubData(
  workspaceId: string,
): Promise<TeamHubData> {
  void workspaceId; // used by the live branch in Phase B
  if (dataMode("hub") === "demo") return demoTeamHub();
  throw new Error("Team Hub live provider lands in Phase B");
}
```

```ts
// src/lib/data/overview.ts
import { dataMode } from "./registry";
import { demoOverview } from "./demo/overview";
import type { OverviewData } from "./types";

/** Single entry point for Overview data. Live branch lands in Phase B. */
export async function getOverviewData(
  workspaceId: string,
): Promise<OverviewData> {
  void workspaceId;
  if (dataMode("overview") === "demo") return demoOverview();
  throw new Error("Overview live provider lands in Phase B");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/data/demo/demo-data.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/demo src/lib/data/team-hub.ts src/lib/data/overview.ts
git commit -m "feat: seeded demo providers + facades for Team Hub and Overview"
```

---

### Task 4: Workspace index redirect, demo badge, stub pages for pending sections

**Files:**
- Create: `src/app/(app)/w/[ws]/page.tsx`
- Create: `src/components/demo-badge.tsx`
- Create: `src/components/section-stub.tsx`
- Create: `src/app/(app)/w/[ws]/plan/page.tsx`
- Create: `src/app/(app)/w/[ws]/production/page.tsx`
- Create: `src/app/(app)/w/[ws]/brand-gene/page.tsx`
- Create: `src/app/(app)/w/[ws]/drift/page.tsx`
- Create: `src/app/(app)/w/[ws]/reports/page.tsx`
- Create: `src/app/(app)/w/[ws]/ads/page.tsx`
- Create: `src/app/(app)/w/[ws]/rules/page.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks (stub pages are self-contained).
- Produces: `DemoBadge` (used by Tasks 5–6); `SectionStub({ title, tagline, slice })` shared by the seven stub pages.

- [ ] **Step 1: Workspace index redirects to Overview**

```tsx
// src/app/(app)/w/[ws]/page.tsx
import { redirect } from "next/navigation";

export default function WorkspaceIndex({
  params,
}: {
  params: { ws: string };
}) {
  redirect(`/w/${params.ws}/overview`);
}
```

- [ ] **Step 2: Shared demo badge and stub shell**

```tsx
// src/components/demo-badge.tsx
import { Badge } from "@/components/ui/badge";

/** Marks a screen still running on seeded demo data (pre–Phase B wiring). */
export function DemoBadge() {
  return (
    <Badge
      variant="outline"
      className="label-mono border-brand-purple/40 text-[10px] text-brand-purple"
    >
      Demo data · wiring in Phase B
    </Badge>
  );
}
```

```tsx
// src/components/section-stub.tsx
import { GlassCard } from "@/components/glass-card";
import { Badge } from "@/components/ui/badge";

/** Placeholder page for a section whose final UI lands in a later Phase A slice. */
export function SectionStub({
  title,
  tagline,
  slice,
}: {
  title: string;
  tagline: string;
  slice: number;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center gap-3">
        <h1 className="font-display text-3xl">{title}</h1>
        <Badge
          variant="outline"
          className="label-mono border-white/15 text-[10px] text-white/40"
        >
          UI lands in Slice {slice}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-white/50">{tagline}</p>
      <GlassCard className="mt-8 p-6">
        <p className="text-sm text-white/50">
          This section is part of the final product shell. Its full layout is
          specified in the design spec and ships in Phase A · Slice {slice}.
        </p>
      </GlassCard>
    </div>
  );
}
```

- [ ] **Step 3: Seven stub pages**

Each file follows the identical pattern — exact contents:

```tsx
// src/app/(app)/w/[ws]/plan/page.tsx
import { SectionStub } from "@/components/section-stub";

export const metadata = { title: "Plan & Validate" };

export default function PlanPage() {
  return (
    <SectionStub
      title="Plan & Validate"
      tagline="Every proposed slot cites baseline rows only — accept, edit, or reject with a reason."
      slice={3}
    />
  );
}
```

```tsx
// src/app/(app)/w/[ws]/production/page.tsx
import { SectionStub } from "@/components/section-stub";

export const metadata = { title: "Production" };

export default function ProductionPage() {
  return (
    <SectionStub
      title="Production"
      tagline="Brief → in progress → internal review → revision → done."
      slice={3}
    />
  );
}
```

```tsx
// src/app/(app)/w/[ws]/brand-gene/page.tsx
import { SectionStub } from "@/components/section-stub";

export const metadata = { title: "Brand Gene" };

export default function BrandGenePage() {
  return (
    <SectionStub
      title="Brand Gene"
      tagline="Identity + knowledge vault — every AI brief is filtered through this profile."
      slice={2}
    />
  );
}
```

```tsx
// src/app/(app)/w/[ws]/drift/page.tsx
import { SectionStub } from "@/components/section-stub";

export const metadata = { title: "Brand Drift" };

export default function DriftPage() {
  return (
    <SectionStub
      title="Brand Drift"
      tagline="Tone-signature monitoring against the Brand Gene baseline."
      slice={4}
    />
  );
}
```

```tsx
// src/app/(app)/w/[ws]/reports/page.tsx
import { SectionStub } from "@/components/section-stub";

export const metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <SectionStub
      title="Reports"
      tagline="Auto-drafted monthly, human-edited before it reaches the client."
      slice={4}
    />
  );
}
```

```tsx
// src/app/(app)/w/[ws]/ads/page.tsx
import { SectionStub } from "@/components/section-stub";

export const metadata = { title: "Ads Management" };

export default function AdsPage() {
  return (
    <SectionStub
      title="Ads Management"
      tagline="Paid spend with the same human-approval spine as organic."
      slice={4}
    />
  );
}
```

```tsx
// src/app/(app)/w/[ws]/rules/page.tsx
import { SectionStub } from "@/components/section-stub";

export const metadata = { title: "Harness Rules" };

export default function RulesPage() {
  return (
    <SectionStub
      title="Harness Rules"
      tagline="Constraints-as-data, injected into every planning prompt."
      slice={4}
    />
  );
}
```

- [ ] **Step 4: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors

```bash
git add "src/app/(app)/w/[ws]/page.tsx" src/components/demo-badge.tsx src/components/section-stub.tsx "src/app/(app)/w/[ws]/plan" "src/app/(app)/w/[ws]/production" "src/app/(app)/w/[ws]/brand-gene" "src/app/(app)/w/[ws]/drift" "src/app/(app)/w/[ws]/reports" "src/app/(app)/w/[ws]/ads" "src/app/(app)/w/[ws]/rules"
git commit -m "feat: workspace index redirect + stub pages for later-slice sections"
```

---

### Task 5: Overview screen

**Files:**
- Create: `src/app/(app)/w/[ws]/overview/page.tsx`

**Interfaces:**
- Consumes: `getOverviewData(workspaceId)` from `src/lib/data/overview.ts`; `DemoBadge` from Task 4.

- [ ] **Step 1: Write the page**

```tsx
// src/app/(app)/w/[ws]/overview/page.tsx
import Link from "next/link";
import { getOverviewData } from "@/lib/data/overview";
import { GlassCard } from "@/components/glass-card";
import { DemoBadge } from "@/components/demo-badge";

export const metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

export default async function OverviewPage({
  params,
}: {
  params: { ws: string };
}) {
  const data = await getOverviewData(params.ws);
  const base = `/w/${params.ws}`;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center gap-3">
        <h1 className="font-display text-3xl">Overview</h1>
        <DemoBadge />
      </div>
      <p className="mt-1 text-sm text-white/50">
        Pipeline health at a glance — the workspace's morning screen.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.stats.map((st) => (
          <GlassCard key={st.label} className="p-5">
            <p className="label-mono text-white/40">{st.label}</p>
            <p className="mt-2 font-display text-3xl">{st.value}</p>
            <p className="mt-1 text-xs text-white/40">{st.sub}</p>
          </GlassCard>
        ))}
      </div>

      <GlassCard className="mt-6 p-5">
        <p className="label-mono text-white/40">Quick actions</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Link
            href={`${base}/ideation`}
            className="rounded-xl bg-white/10 px-4 py-2 text-sm transition hover:bg-white/15"
          >
            ✦ Generate ideas
          </Link>
          <Link
            href={`${base}/plan`}
            className="rounded-xl bg-white/10 px-4 py-2 text-sm transition hover:bg-white/15"
          >
            Review month plan
          </Link>
          <Link
            href={`${base}/calendar`}
            className="rounded-xl bg-white/10 px-4 py-2 text-sm transition hover:bg-white/15"
          >
            View calendar
          </Link>
        </div>
      </GlassCard>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <GlassCard className="p-5">
          <p className="label-mono text-brand-teal">Production board</p>
          <div className="mt-3 space-y-2">
            {data.productionBoard.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3"
              >
                <p className="text-sm">{row.title}</p>
                <p className="label-mono text-[10px] text-white/40">
                  {row.stage}
                </p>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <p className="label-mono text-brand-purple">Upcoming on calendar</p>
          <div className="mt-3 space-y-2">
            {data.upcoming.map((slot) => (
              <div key={slot.id} className="rounded-xl bg-white/5 px-4 py-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm">{slot.title}</p>
                  <p className="label-mono text-[10px] text-white/40">
                    {slot.status}
                  </p>
                </div>
                <p className="mt-0.5 text-xs text-white/40">
                  {slot.platform} · Day {slot.day}
                </p>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify in the running app**

Run: `npm run dev` then open `http://localhost:3000/w/<any-workspace-id>/overview`
Expected: stat row, quick actions, both columns render with demo content; sidebar shows grouped nav with Overview active.

- [ ] **Step 3: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors

```bash
git add "src/app/(app)/w/[ws]/overview"
git commit -m "feat: Overview screen — final layout on demo provider"
```

---

### Task 6: Team Hub screen (chat + pinned action rail)

**Files:**
- Create: `src/app/(app)/w/[ws]/hub/page.tsx`
- Create: `src/app/(app)/w/[ws]/hub/team-hub-canvas.tsx`

**Interfaces:**
- Consumes: `getTeamHubData(workspaceId)` from `src/lib/data/team-hub.ts`; all Hub types from `src/lib/data/types.ts`; `DemoBadge` from Task 4.
- Produces: `TeamHubCanvas({ initial: TeamHubData })` — client island. In demo mode all interactions mutate client state only; Phase B replaces state setters with Server Actions + Realtime subscription, layout untouched.

- [ ] **Step 1: Server page**

```tsx
// src/app/(app)/w/[ws]/hub/page.tsx
import { getTeamHubData } from "@/lib/data/team-hub";
import { DemoBadge } from "@/components/demo-badge";
import { TeamHubCanvas } from "./team-hub-canvas";

export const metadata = { title: "Team Hub" };
export const dynamic = "force-dynamic";

export default async function TeamHubPage({
  params,
}: {
  params: { ws: string };
}) {
  const data = await getTeamHubData(params.ws);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-center gap-3">
        <h1 className="font-display text-3xl">Team Hub</h1>
        <DemoBadge />
      </div>
      <p className="mt-1 text-sm text-white/50">
        Workspace channel — chat, sign-offs, shared tasks and reminders in one
        canvas.
      </p>
      <div className="mt-6">
        <TeamHubCanvas initial={data} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Client canvas**

```tsx
// src/app/(app)/w/[ws]/hub/team-hub-canvas.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { GlassCard } from "@/components/glass-card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  HubMessage,
  HubPriority,
  TeamHubData,
} from "@/lib/data/types";

const PRIORITY_ORDER: HubPriority[] = ["High", "Medium", "Low"];

const PRIORITY_STYLES: Record<HubPriority, string> = {
  High: "border-red-400/40 text-red-400",
  Medium: "border-brand-purple/40 text-brand-purple",
  Low: "border-white/20 text-white/40",
};

export function TeamHubCanvas({ initial }: { initial: TeamHubData }) {
  const [messages, setMessages] = useState(initial.messages);
  const [approvals, setApprovals] = useState(initial.approvals);
  const [tasks, setTasks] = useState(initial.tasks);
  const [reminders] = useState(initial.reminders);
  const [plan, setPlan] = useState(initial.planQuickView);
  const [draft, setDraft] = useState("");
  const [taskDraft, setTaskDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const sendMessage = () => {
    const text = draft.trim();
    if (!text) return;
    setMessages((m) => [
      ...m,
      {
        id: `msg${Date.now()}`,
        kind: "text",
        time: "just now",
        author: "You",
        initial: "Y",
        text,
      },
    ]);
    setDraft("");
  };

  const requestApproval = () => {
    const title = draft.trim() || "Untitled asset";
    const id = `ap${Date.now()}`;
    setApprovals((a) => [
      ...a,
      { id, title, requestedBy: "You", time: "just now", status: "pending" },
    ]);
    setMessages((m) => [
      ...m,
      {
        id: `msg${Date.now()}`,
        kind: "approval",
        time: "just now",
        author: "You",
        initial: "Y",
        title,
        status: "pending",
      },
    ]);
    setDraft("");
  };

  const decideApproval = (id: string, status: "approved" | "rejected") => {
    setApprovals((list) =>
      list.map((a) => (a.id === id ? { ...a, status, decidedBy: "You" } : a)),
    );
    setMessages((list) =>
      list.map((m) =>
        m.kind === "approval" && m.title ===
          approvals.find((a) => a.id === id)?.title
          ? { ...m, status, decidedBy: "You" }
          : m,
      ),
    );
  };

  const addTask = () => {
    const title = taskDraft.trim();
    if (!title) return;
    setTasks((t) => [
      ...t,
      { id: `t${Date.now()}`, title, done: false, priority: "Medium" },
    ]);
    setTaskDraft("");
  };

  const toggleTask = (id: string) =>
    setTasks((t) =>
      t.map((tk) => (tk.id === id ? { ...tk, done: !tk.done } : tk)),
    );

  const cyclePriority = (id: string) =>
    setTasks((t) =>
      t.map((tk) => {
        if (tk.id !== id) return tk;
        const next =
          PRIORITY_ORDER[
            (PRIORITY_ORDER.indexOf(tk.priority) + 1) % PRIORITY_ORDER.length
          ];
        return { ...tk, priority: next };
      }),
    );

  const decidePlan = (id: string, status: "accepted" | "rejected") =>
    setPlan((p) => p.map((it) => (it.id === id ? { ...it, status } : it)));

  const openTasks = tasks.filter((t) => !t.done).length;
  const pendingApprovals = approvals.filter(
    (a) => a.status === "pending",
  ).length;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      {/* ---- CHAT PANE ---- */}
      <GlassCard className="flex h-[640px] flex-col p-0">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <p className="text-sm font-medium">{initial.channel}</p>
          <div className="flex items-center gap-2">
            <div className="flex -space-x-2">
              {initial.members.map((mb) => (
                <div
                  key={mb.id}
                  title={mb.name}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-white/10 text-[11px]",
                    mb.online && "ring-1 ring-brand-teal",
                  )}
                >
                  {mb.initial}
                </div>
              ))}
            </div>
            <p className="label-mono text-[10px] text-brand-teal">
              {initial.members.filter((m) => m.online).length} online
            </p>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-5">
          {messages.map((m) => (
            <MessageRow key={m.id} m={m} onDecide={decideApproval} />
          ))}
        </div>

        <div className="flex items-center gap-2 border-t border-white/10 p-4">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="Message the team — or type an asset name and request sign-off"
            className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm outline-none placeholder:text-white/30 focus:border-brand-teal/50"
          />
          <button
            onClick={requestApproval}
            className="label-mono rounded-xl border border-brand-purple/40 px-3 py-2.5 text-[10px] text-brand-purple transition hover:bg-brand-purple/10"
          >
            Approval
          </button>
          <button
            onClick={sendMessage}
            className="rounded-xl bg-white/10 px-4 py-2.5 text-sm transition hover:bg-white/15"
          >
            Send →
          </button>
        </div>
      </GlassCard>

      {/* ---- PINNED ACTION RAIL ---- */}
      <div className="space-y-4">
        <GlassCard className="p-4">
          <div className="flex items-center justify-between">
            <p className="label-mono text-brand-teal">Plan · Validate</p>
          </div>
          <div className="mt-3 space-y-2">
            {plan.map((it) => (
              <div
                key={it.id}
                className="flex items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs">{it.title}</p>
                  <p className="text-[10px] text-white/40">{it.format}</p>
                </div>
                {it.status === "proposed" ? (
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => decidePlan(it.id, "accepted")}
                      className="rounded-lg bg-white/10 px-2 py-1 text-xs text-brand-teal hover:bg-white/15"
                    >
                      ✓
                    </button>
                    <button
                      onClick={() => decidePlan(it.id, "rejected")}
                      className="rounded-lg bg-white/10 px-2 py-1 text-xs text-red-400 hover:bg-white/15"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <Badge
                    variant="outline"
                    className="label-mono shrink-0 border-white/15 text-[9px] text-white/40"
                  >
                    {it.status}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-4">
          <div className="flex items-center justify-between">
            <p className="label-mono text-brand-purple">Approval queue</p>
            <p className="label-mono text-[10px] text-white/40">
              {pendingApprovals} pending
            </p>
          </div>
          <div className="mt-3 space-y-2">
            {approvals.map((aq) => (
              <div key={aq.id} className="rounded-xl bg-white/5 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs">{aq.title}</p>
                  <Badge
                    variant="outline"
                    className={cn(
                      "label-mono shrink-0 text-[9px]",
                      aq.status === "pending"
                        ? "border-brand-purple/40 text-brand-purple"
                        : aq.status === "approved"
                          ? "border-brand-teal/40 text-brand-teal"
                          : "border-red-400/40 text-red-400",
                    )}
                  >
                    {aq.status}
                  </Badge>
                </div>
                <p className="mt-0.5 text-[10px] text-white/40">
                  {aq.requestedBy} · {aq.time}
                </p>
                {aq.status === "pending" && (
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => decideApproval(aq.id, "approved")}
                      className="label-mono rounded-lg bg-white/10 px-2 py-1 text-[10px] text-brand-teal hover:bg-white/15"
                    >
                      ✓ Approve
                    </button>
                    <button
                      onClick={() => decideApproval(aq.id, "rejected")}
                      className="label-mono rounded-lg bg-white/10 px-2 py-1 text-[10px] text-red-400 hover:bg-white/15"
                    >
                      ✕ Reject
                    </button>
                  </div>
                )}
                {aq.status !== "pending" && aq.decidedBy && (
                  <p className="mt-1 text-[10px] text-white/30">
                    {aq.status} by {aq.decidedBy}
                  </p>
                )}
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-4">
          <div className="flex items-center justify-between">
            <p className="label-mono text-white/60">Tasks & priorities</p>
            <p className="label-mono text-[10px] text-white/40">
              {openTasks} open
            </p>
          </div>
          <div className="mt-3 space-y-1.5">
            {tasks.map((tk) => (
              <div key={tk.id} className="flex items-center gap-2">
                <button
                  onClick={() => toggleTask(tk.id)}
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[10px]",
                    tk.done
                      ? "border-brand-teal/50 text-brand-teal"
                      : "border-white/20 text-transparent",
                  )}
                >
                  ✓
                </button>
                <p
                  className={cn(
                    "flex-1 truncate text-xs",
                    tk.done && "text-white/30 line-through",
                  )}
                >
                  {tk.title}
                </p>
                <button
                  onClick={() => cyclePriority(tk.id)}
                  title="Click to change priority"
                  className={cn(
                    "label-mono shrink-0 rounded-md border px-1.5 py-0.5 text-[9px]",
                    PRIORITY_STYLES[tk.priority],
                  )}
                >
                  {tk.priority}
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={taskDraft}
              onChange={(e) => setTaskDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTask()}
              placeholder="Add a task…"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs outline-none placeholder:text-white/30 focus:border-brand-teal/50"
            />
            <button
              onClick={addTask}
              className="label-mono rounded-lg bg-white/10 px-3 py-1.5 text-[10px] hover:bg-white/15"
            >
              Add
            </button>
          </div>
        </GlassCard>

        <GlassCard className="p-4">
          <p className="label-mono text-white/60">Shared reminders</p>
          <div className="mt-3 space-y-2">
            {reminders.map((r) => (
              <div key={r.id} className="rounded-xl bg-white/5 px-3 py-2.5">
                <p className="text-xs">{r.title}</p>
                <p className="mt-0.5 text-[10px] text-white/40">
                  {r.due} · {r.owner}
                </p>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

function MessageRow({
  m,
  onDecide,
}: {
  m: HubMessage;
  onDecide: (approvalId: string, status: "approved" | "rejected") => void;
}) {
  if (m.kind === "system") {
    return (
      <p className="label-mono text-center text-[10px] text-white/30">
        {m.text}
      </p>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-xs">
        {m.initial}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs">
          <span className="font-medium">{m.author}</span>{" "}
          <span className="text-white/30">{m.time}</span>
          {m.kind === "approval" && (
            <span className="text-brand-purple"> · requested sign-off</span>
          )}
        </p>
        {m.kind === "text" ? (
          <p className="mt-1 text-sm text-white/80">{m.text}</p>
        ) : (
          <div className="mt-2 rounded-xl border border-brand-purple/30 bg-brand-purple/5 p-3">
            <div className="flex items-center justify-between">
              <p className="label-mono text-[10px] text-brand-purple">
                Approval request
              </p>
              <p className="label-mono text-[10px] text-white/40">
                {m.status}
              </p>
            </div>
            <p className="mt-1 text-sm">{m.title}</p>
            {m.status !== "pending" && m.decidedBy && (
              <p className="mt-1 text-[10px] text-white/30">
                {m.status} by {m.decidedBy}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

Note for the implementer: approval decisions made from a chat card resolve the
matching queue entry by title inside `decideApproval` — in demo mode titles are
unique. The Phase B live provider replaces this with a shared approval id from
the database, which `HubMessage`'s approval variant will then carry.

- [ ] **Step 3: Verify in the running app**

Run: `npm run dev` then open `http://localhost:3000/w/<any-workspace-id>/hub`
Expected: chat pane with 4 seeded messages incl. one approval card; sending a message appends and autoscrolls; the Approval button turns the draft into a pending card in both chat and queue; approving from either place updates both; tasks toggle/cycle priority/add; reminders panel renders.

- [ ] **Step 4: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors

```bash
git add "src/app/(app)/w/[ws]/hub"
git commit -m "feat: Team Hub — chat, approvals, shared tasks & reminders (demo provider)"
```

---

### Task 7: Full verification gate

**Files:** none new.

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: PASS, including the 3 new test files (nav, registry, demo-data)

- [ ] **Step 2: Typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all pass; build succeeds with the new routes listed
(`/w/[ws]`, `/w/[ws]/overview`, `/w/[ws]/hub`, and the seven stubs).

- [ ] **Step 3: Manual sweep**

Run: `npm run dev` — click through every sidebar item in a workspace.
Expected: no dead links; live sections unchanged; Overview + Team Hub show final layouts with DemoBadge; stubs show their slice number.

- [ ] **Step 4: Commit any fixups**

```bash
git add -A
git commit -m "chore: slice 1 verification fixups" --allow-empty
```
