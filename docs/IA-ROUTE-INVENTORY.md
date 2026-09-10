# 30-Route Information Architecture (IA) Inventory

**Date:** 2026-09-02  
**Branch:** `main`  
**Status:** Live & Implemented (Slice 4)  

---

## Executive Summary

To eliminate sidebar clutter and establish an intuitive operational model, all 30 routes within the workspace (`/w/[ws]/...`) have been categorized across the 4 primary navigation pillars using a **Keep / Nest / Archive** framework.

Per the architectural mandate, **no functional features or routes were deleted**. All 26 live routes remain operational at their canonical paths. Secondary views are nested hierarchically under their parent surfaces in navigation while preserving direct URL compatibility and deep links.

---

## The 4 Navigation Pillars

```
Pillar 1: Operate
├── Overview (/overview)
├── My Work (/my-work)
│   └── Approvals Gate (/approvals)
├── Campaign Sprints (/sprint)
├── Production Board (/production)
│   ├── Plan & Validate (/plan)
│   └── Editorial Calendar (/calendar)
├── Tickets & Tasks (/tickets)
├── SOPs & Runbooks (/sop)
├── Team Hub (/hub)
└── Workspace Docs (/docs)

Pillar 2: Brand & Creative
├── Brand DNA & Vault (/brand-gene)
│   ├── Brand Drift Radar (/drift)
│   └── Asset Library (/assets)
├── Ideation Pool (/ideation)
├── Creative Studio (/studio)
└── Knowledge Base (/kb)
    └── Strategic Decisions Log (/decisions)

Pillar 3: Growth & Performance
├── Command Cockpit (/cockpit)
├── Reports & Analytics (/reports)
└── Meta Ads Engine (/ads)

Pillar 4: Settings & Infrastructure
├── Clients & Accounts (/clients)
│   └── Connected Accounts (/accounts)
├── Workflows & Rules (/workflows)
│   └── Custom Fields (/fields)
└── Automations (/automations)
    └── Harness Scraping Rules (/rules)
```

---

## Detailed 30-Route Inventory

| # | Route Slug | Pillar | Classification | Parent Surface | Canonical Path | Description / Purpose |
|---|---|---|---|---|---|---|
| 1 | `overview` | Operate | **Keep** (Primary) | — | `/w/[ws]/overview` | Workspace cockpit, live digest, and executive metric cards. |
| 2 | `my-work` | Operate | **Keep** (Primary) | — | `/w/[ws]/my-work` | Unified operational queue (tickets, content drafts, SOP steps, rejection feedback). |
| 3 | `approvals` | Operate | **Nest** | `my-work` | `/w/[ws]/approvals` | Gate review surface for creative approval and sign-offs. |
| 4 | `sprint` | Operate | **Keep** (Primary) | — | `/w/[ws]/sprint` | Autopilot campaign production engine backed by canonical `instantiateRun`. |
| 5 | `production` | Operate | **Keep** (Primary) | — | `/w/[ws]/production` | Core kanban production board tracking workflow state transitions. |
| 6 | `plan` | Operate | **Nest** | `production` | `/w/[ws]/plan` | Grid planning and content validation view for upcoming deliverables. |
| 7 | `calendar` | Operate | **Nest** | `production` | `/w/[ws]/calendar` | Editorial calendar view for post scheduling and timeline management. |
| 8 | `tickets` | Operate | **Keep** (Primary) | — | `/w/[ws]/tickets` | Internal task, bug, and client request ticketing system. |
| 9 | `sop` | Operate | **Keep** (Primary) | — | `/w/[ws]/sop` | Standard Operating Procedure templates and active execution runbooks. |
| 10 | `hub` | Operate | **Keep** (Primary) | — | `/w/[ws]/hub` | Realtime team canvas, presence, and direct team chat. |
| 11 | `docs` | Operate | **Keep** (Primary) | — | `/w/[ws]/docs` | Workspace documents, strategy briefs, and collaborative notes. |
| 12 | `brand-gene` | Brand & Creative | **Keep** (Primary) | — | `/w/[ws]/brand-gene` | Brand DNA profile, voice, tone, pillars, and asset vault. |
| 13 | `drift` | Brand & Creative | **Nest** | `brand-gene` | `/w/[ws]/drift` | Realtime brand drift radar and tone variance diagnostic. |
| 14 | `ideation` | Brand & Creative | **Keep** (Primary) | — | `/w/[ws]/ideation` | AI ideation pool, hooks, angles, and content idea drafts. |
| 15 | `studio` | Brand & Creative | **Keep** (Primary) | — | `/w/[ws]/studio` | Creative Studio draft editor, visual cues, and compliance meter. |
| 16 | `kb` | Brand & Creative | **Keep** (Primary) | — | `/w/[ws]/kb` | Competitive intelligence knowledge base and scraper insights. |
| 17 | `decisions` | Brand & Creative | **Nest** | `kb` | `/w/[ws]/decisions` | Strategic architectural and brand decision records log. |
| 18 | `cockpit` | Growth & Performance | **Keep** (Primary) | — | `/w/[ws]/cockpit` | Executive performance dashboard and client budget monitor. |
| 19 | `reports` | Growth & Performance | **Keep** (Primary) | — | `/w/[ws]/reports` | Automated performance reports and analytics exports. |
| 20 | `ads` | Growth & Performance | **Keep** (Primary) | — | `/w/[ws]/ads` | Meta Ads intelligence, ROAS tracker, and paid media manager. |
| 21 | `clients` | Settings & Infrastructure | **Keep** (Primary) | — | `/w/[ws]/clients` | Client accounts, brand assignments, and client goals. |
| 22 | `accounts` | Settings & Infrastructure | **Nest** | `clients` | `/w/[ws]/accounts` | Connected social OAuth integrations (Instagram, Facebook, TikTok). |
| 23 | `workflows` | Settings & Infrastructure | **Keep** (Primary) | — | `/w/[ws]/workflows` | State machine workflow builder, transition rules, and WIP limits. |
| 24 | `fields` | Settings & Infrastructure | **Nest** | `workflows` | `/w/[ws]/fields` | Custom metadata fields schema for content and task models. |
| 25 | `automations` | Settings & Infrastructure | **Keep** (Primary) | — | `/w/[ws]/automations` | Inngest event triggers, webhooks, and background automation rules. |
| 26 | `rules` | Settings & Infrastructure | **Nest** | `automations` | `/w/[ws]/rules` | Harness scraping rules and Apify crawler configurations. |
| 27 | `analytics` | Non-Nav (Utility) | **Archive / Redirect** | — | `/w/[ws]/analytics` | Legacy route — permanently redirects (HTTP 308) to `/w/[ws]/reports`. |
| 28 | `patterns` | Non-Nav (Utility) | **Archive / Redirect** | — | `/w/[ws]/patterns` | Legacy route — permanently redirects (HTTP 308) to `/w/[ws]/kb#scraper-ops`. |
| 29 | `ask` | Non-Nav (Overlay) | **Action Endpoint** | — | — | Server Actions for the `<AskInstamedia />` global command modal. |
| 30 | `chat` | Non-Nav (Overlay) | **Action Endpoint** | — | — | Server Actions for the `<DirectChatDrawer />` slideout chat. |
| 31 | `assets` | Brand & Creative | **Nest** | `brand-gene` | `/w/[ws]/assets` | Workspace file storage — client CSVs, guideline PDFs, briefs, reference images. Private bucket, signed-URL reads, 250 MB per workspace. |

---

## Architectural Guarantees

1. **Zero Route Deletion**: All 26 functional route directories remain live and renderable.
2. **Deep Link Invariance**: Any external link or bookmark to nested routes (`/calendar`, `/plan`, `/approvals`, `/drift`, `/rules`, etc.) continues to function without redirect overhead.
3. **Responsive Visual Hierarchy**:
   - In expanded sidebar mode, parent items display child count badges, and expand smoothly to reveal indented sub-navigation when the parent or any child is active.
   - In collapsed sidebar mode, primary icons render clean tooltips detailing parent name and included sub-surfaces.
4. **Icon Parity**: Missing icons (such as `sprint`'s rocket icon) are fully mapped.
5. **Route count is now 31.** `assets` was added, nothing was removed or renamed.
