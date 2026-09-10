# InstaMedia — Final Shell Rebuild (UI-First) — Design Spec

**Date:** 2026-07-08
**Status:** Approved by owner (conversation, 2026-07-08)
**Supersedes:** incremental nav/scope decisions from Phases 1–5 where they conflict. Existing code stays; we add and remap — no rewrites of working backends.

## Problem

The built product drifted from the final product vision in the reference prototype
(`InstaMedia AI Prototype.dc.html`). The core collaboration layer (workspace chat,
shared to-dos, shared reminders), a first-class Brand Gene tab, a visible scraper
operations console, and several final screens (Overview, Plan & Validate, Production,
Brand Drift, Ads, Harness Rules) were never surfaced. The information architecture
does not match the final product.

## Decisions (locked)

1. **UI-first everything.** All 17 workspace sections get their final UI now; backends
   are wired section by section afterward.
2. **Prototype is a layout/wireframe reference only.** We take structure and flow
   affordances from it — not colors, not typography. Styling is our existing
   Tailwind + shadcn system.
3. **Demo data on unwired screens.** A seeded "Aurora Skincare"-style demo dataset
   makes every screen believable and demoable day one. Screens with working backends
   (Studio, Calendar, Ideation, KB, Approvals, Analytics, Cockpit) stay on **live**
   data — never downgraded to demo.
4. **First wiring wave (Phase B):** Team Hub → Scraper Ops → Brand Gene → Overview.
5. **Real-time transport:** Supabase Realtime (websockets) for Team Hub chat, tasks,
   reminders, and approval events. Channels scoped per workspace.
6. **Current code stays.** Existing routes/components are remapped or extended, not
   deleted. Constitution rules (workspace_id isolation, two-layer rule, minimum-N
   gate, degradation ladder, no agent-spawns-agent) unchanged.

## Information Architecture

Workspace sidebar (`/w/[ws]/…`), grouped:

| Group | Sections (route) |
|---|---|
| Operate | Overview (`overview`) · Team Hub (`hub`) · Plan & Validate (`plan`) · Production (`production`) · Approvals (`approvals`) · Calendar (`calendar`) |
| Intelligence | Brand Gene (`brand-gene`) · Ideation (`ideation`) · Creative Studio (`studio`) · Knowledge Base (`kb`) · Brand Drift (`drift`) |
| Business | Reports (`reports`) · Ads Management (`ads`) · Cockpit (`cockpit`) |
| Infrastructure | Connected Accounts (`accounts`) · Harness Rules (`rules`) · Workspaces (switcher) |

Route remaps (no data loss, old routes redirect):

- `analytics` → `reports`
- `patterns` → folded into `kb` (pattern layer panel + scraper ops console)
- `clients/[id]/brand` → content promoted into top-level `brand-gene` (per-client
  selector inside the tab); client CRUD stays under `clients`
- Global additions: **Ask InstaMedia** floating assistant (role-scoped, per-workspace
  grounding), OAuth consent modal pattern, Client Portal + Admin as UI shells
  reachable from Hub.

## Per-Screen Wireframes (layout from prototype, restyled)

- **Overview:** header → stat cards → quick actions (Generate ideas / Review month
  plan / View calendar) → two columns: production board list + upcoming calendar.
- **Team Hub:** two-pane. Left = workspace channel chat: members header w/ online
  count; message stream with three message types — system, text, approval-request
  card (inline Approve/Reject, decided line after); composer with APPROVAL and SEND.
  Right = pinned rail, four stacked panels: Plan quick-view (accept/reject),
  Approval queue, Tasks & Priorities (toggle done, click-to-cycle priority, add
  input), **Shared Reminders** (who/when/what, workspace-visible; fed manually and
  by calendar escalations).
- **Plan & Validate:** proposed slot list; each card: title, format, "why this idea"
  (baseline citations only); Accept / Edit / Reject-with-reason inline.
- **Production:** kanban Brief → In progress → Internal review → Revision → Done;
  cards: assignee, revision-count flag, advance button.
- **Approvals:** queue cards (Approve / Request changes), timestamped named sign-off,
  "queue clear" empty state.
- **Calendar:** 3-column — category sidebar + mini month; main month grid with event
  chips and "+N more"; day panel with per-post publish checklist
  (Drafted/Approved/Scheduled) and overdue escalation badges.
- **Brand Gene:** tabs Identity / Knowledge. Identity: brand name, mission, tone
  descriptor chips, brand colors, banned words. Knowledge: ingest-URL input,
  sources list (chunks, status badges), vault similarity search box (pgvector).
- **Ideation:** focus-area select + Generate → idea cards (hook, platform, angle,
  predicted score or "insufficient baseline") → send to Studio.
- **Creative Studio:** two-column — brief generator (topic → draft → Analyze
  compliance / Create task) + compliance panel (score, what works, missing).
- **Knowledge Base + Scraper Ops:** stats row; two-layer separation explainer
  (baseline vs pattern); **scraper operations console**: per-actor run triggers,
  live run status, run history table, harvested counts. Public layer only.
- **Brand Drift:** magnitude gauge ring, status narrative, threshold callout.
- **Reports:** stat row → performance-vs-own-baseline bars by format → next-month
  preview → Edit & send report.
- **Cockpit:** morning digest banner; invite code + config toggles; workspace health
  cards (on-time %, cost MTD, status); org spend bar vs cap.
- **Ads Management:** dashboard (summary stats, campaign rows w/ budget, spend,
  impressions, clicks, conversions, ROAS, pause toggle) + 5-step builder
  (Objective → Audience → Budget & schedule → Creative → Review & launch) routed
  through the same approval gate.
- **Harness Rules:** content pillar chips, mandatory dates list, tone dials.
- **Connected Accounts:** platform cards, scope text, Connect/Disconnect via OAuth
  consent modal.
- **Workspaces:** card grid, "+ Onboard a client" → intake wizard.

## Data Layer — Swappable Providers

Each section reads through a typed interface in `src/lib/data/` (e.g. `TeamHubData`,
`ScrapeOpsData`, `BrandGeneData`, `OverviewData`). Two implementations:

- **demo** — seeded demo workspace content (server-side module, no DB writes),
  mirrors prototype content shapes.
- **live** — Drizzle queries + Server Actions, workspace_id-scoped, RLS intact.

A per-section registry decides demo vs live. Wiring a section = implement live
provider + flip registry. Zero UI changes. Live-today sections start live.

Real-time (Phase B): Supabase Realtime channels `ws:{workspace_id}:hub` for
messages/tasks/reminders/approval events. Approval decisions in chat write to the
same approvals tables the Approvals screen reads.

## Dataflow Spine

Ingestion → KB (two layers) → Brand Gene → Ideation → Plan & Validate → Studio →
Production → Approvals → Calendar → publish → learning loop → Reports.
Scraper ops feed only the public pattern layer (source=public, weight=neutral).

## Phasing

- **Phase A — Final shell + all screens' UI.** Sidebar IA, route remaps + redirects,
  all 17 screens at final layout, demo providers, Ask InstaMedia shell, OAuth modal,
  Portal/Admin shells. Demoable end-to-end.
- **Phase B — First wiring wave.** Team Hub (Realtime chat/tasks/reminders/
  approvals), Scraper Ops (real Apify runs + history), Brand Gene (real brand data +
  vault search), Overview (real aggregates).
- **Phase C — Remaining wiring.** Plan & Validate, Production, Drift, Reports, Ads,
  Harness Rules, Portal/Admin — order decided then.

Every slice ships with tests; plan → diff → review workflow unchanged.

## Out of Scope

- Any styling port from the prototype (fonts, colors, inline styles).
- AI image/video generation.
- Cross-workspace data access of any kind.
- Live ad-spend execution (builder UI routes to approval gate only until Phase C).
