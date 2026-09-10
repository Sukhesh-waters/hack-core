# InstaMedia Platform Architecture & Systems Guide (2026)

This document provides a comprehensive technical overview of the architecture, data schemas, real-time multiplexing engines, AI agents, and core feature pillars implemented across **InstaMedia** — the Real-Time AI Marketing Operating System and SOP Platform.

---

## 1. Executive Product Identity & Architecture

**InstaMedia** is an end-to-end autonomous marketing operating system designed for marketing agencies and modern brand teams. It consolidates:
1. **Brand DNA Intelligence & Multi-Modal Studio**: Automated brand identity extraction, live compliance linting against banned words/topics, multi-modal asset generation (storyboards, image generation prompts, voiceovers), and auto-fix refinement loops.
2. **Agency SOP Execution Engine**: Repeatable process runbooks, dated dependency graphs, autonomous unblocking cascades, multi-stakeholder approval gates, and live cross-tab status synchronization.
3. **Real-Time Collaboration Shell**: Multiplexed single-channel Supabase Realtime communication hub, live presence indicators, notification center, and an embedded 1:1 team direct messaging drawer.

```mermaid
graph TD
    subgraph Shell ["1. Real-Time Collaboration Shell"]
        CH_HUB["WorkspaceChannelHub (Multiplexed 'ws:<id>:hub')"]
        PRESENCE["Workspace Presence (Online Indicators)"]
        NOTIF["Notification Bell"]
        CHAT["Direct Chat Drawer (1:1 DMs)"]
    end

    subgraph Pillar1 ["2. OPERATE (Execution Engine)"]
        OVERVIEW["Command Center Overview"]
        MYWORK["My Work Pipeline"]
        SOP["SOP Templates & Runs (Graph Dependencies)"]
        PROD["Production Kanban (Dual-Write Workflow)"]
        CAL["Editorial Calendar & Plan Grid"]
        APPROVE["Approvals Queue"]
    end

    subgraph Pillar2 ["3. BRAND & CREATIVE (Intelligence)"]
        DNA["Pomelli Brand DNA Collage & Vault"]
        KB_INGEST["Live URL Web Crawler & Vector Store"]
        IDEATION["AI Ideation Pool"]
        STUDIO["Creative Studio (Live Compliance & Multi-Modal)"]
    end

    subgraph Pillar3 ["4. GROWTH & PERFORMANCE"]
        ADS["Meta Ads Campaign Engine"]
        REPORTS["Visual Analytics & Area Curves"]
        COCKPIT["Operational Health & Spend Pacing"]
    end

    subgraph Pillar4 ["5. SETTINGS & INFRASTRUCTURE"]
        SETTINGS["Clients, Workflows & Automations"]
    end

    CH_HUB --> Pillar1
    CH_HUB --> Pillar2
    CH_HUB --> Pillar3
    CH_HUB --> Pillar4
```

---

## 2. Database Schema & Data Models (PostgreSQL + Drizzle ORM)

### A. Team Chat & Direct Messaging Subsystem (`0049_direct_messages.sql`)
- **`conversations`**:
  - `id`: Primary key text UUID.
  - `workspace_id`: Tenant foreign key reference with cascade delete.
  - `type`: Enum `"direct" | "group"`.
  - `title`: Optional thread title for group chats.
  - `created_at`, `updated_at`: Timestamps for conversation sorting.
- **`conversation_participants`**:
  - `conversation_id`: Foreign key reference to `conversations`.
  - `user_id`: Foreign key reference to `users`.
  - `last_read_at`: Timestamp tracking last read point for unread message counters.
  - Primary key: Composite `(conversation_id, user_id)`.
- **`direct_messages`**:
  - `id`: Primary key text UUID.
  - `conversation_id`: Foreign key reference to `conversations`.
  - `sender_id`: User ID of the message author.
  - `body`: Text content of the message.
  - `attachments`: JSONB array of attached media files/links.
  - `created_at`: Timestamp for chronological message streaming.

### B. Brand Knowledge Vault & Embeddings
- **`knowledge_sources`**: Registered URLs/documents with crawl status (`"pending" | "ready" | "failed"`), chunk counts, and error tracking.
- **`knowledge_chunks`**: Semantic text segments (`~600` chars), `chunk_index`, and 768-dimension pgvector `embedding` column for similarity search.

### C. SOP & Process Execution Engine
- **`sop_templates` & `sop_steps`**: Master runbook definitions specifying relative offsets (`dayOffset`), dependent prerequisites (`dependsOn`), materialization types (`creates: "content" | "ticket" | "doc" | "task"`), and review requirements (`gate: "approval" | "compliance" | "none"`).
- **`sop_runs` & `sop_run_steps`**: Instantiated execution instances with absolute calendar dates, live status (`"blocked" | "ready" | "in_progress" | "review" | "done"`), assigned owners, and direct deliverable foreign keys (`contentId`, `ticketId`, `docId`).

---

## 3. Real-Time Multiplexed Signaling Engine

### Problem Solved
`@supabase/realtime-js` throws an exception if multiple components (e.g. `CalendarLive`, `WorkspacePresence`, `NotificationBell`) call `channel.on()` after `channel.subscribe()` has been initiated on the same topic (`ws:<workspaceId>:hub`).

### Architecture Solution
- **`WorkspaceChannelHub`** ([`src/app/(app)/w/[ws]/use-workspace-realtime.ts`](file:///Users/sukheshkannasaravanan/Documents/GitHub/pd-instamedia/src/app/%28app%29/w/%5Bws%5D/use-workspace-realtime.ts)):
  - Manages exactly **one** physical Supabase Realtime channel per workspace across all mounted UI components.
  - Features reference-counted subscription management (`refCount`).
  - Implements lightweight scope-based signaling where the channel payload is signal-only (`{ scope }`). Clients fetch authenticated fresh data through Server Actions, eliminating tenant data leakage over websocket channels.
  - Supported scopes defined in [`src/lib/realtime.ts`](file:///Users/sukheshkannasaravanan/Documents/GitHub/pd-instamedia/src/lib/realtime.ts):
    ```typescript
    export type RealtimeScope =
      | "messages"
      | "approvals"
      | "tasks"
      | "reminders"
      | "plan"
      | "sop"        // run steps, unblocking cascades, gate decisions
      | "workflow"   // kanban state transitions, production board changes
      | "cockpit"    // metrics invalidations
      | "calendar"   // plan grid edits, slot schedules
      | "dm"         // 1:1 team direct messages
      | "kb";        // knowledge base crawls & indexing
    ```

---

## 4. 4-Pillar Consolidated Information Architecture

To eliminate visual clutter, the platform navigation was restructured into 4 core pillars in [`src/lib/nav.ts`](file:///Users/sukheshkannasaravanan/Documents/GitHub/pd-instamedia/src/lib/nav.ts):

| Pillar | Navigation Routes | Operational Purpose |
|---|---|---|
| **1. Operate** | `/overview`, `/my-work`, `/sop`, `/production`, `/calendar`, `/approvals` | Daily execution, SOP run progress, production board, and editorial planning. |
| **2. Brand & Creative** | `/brand-gene`, `/ideation`, `/studio`, `/kb` | Brand DNA vault, brainstorming pool, creative copywriting, and knowledge base. |
| **3. Growth & Performance** | `/ads`, `/reports`, `/cockpit` | Meta Ad campaign deployment, engagement analytics, and AI spend governance. |
| **4. Settings & Infrastructure** | `/clients`, `/workflows`, `/automations` | Client accounts, custom workflow stages, transition rules, and background webhooks. |

---

## 5. Core Feature Subsystems & AI Capabilities

### 1. Direct Messaging (Team Chat Drawer)
- **Files**: [`src/components/direct-chat-drawer.tsx`](file:///Users/sukheshkannasaravanan/Documents/GitHub/pd-instamedia/src/components/direct-chat-drawer.tsx), [`src/app/(app)/w/[ws]/chat/actions.ts`](file:///Users/sukheshkannasaravanan/Documents/GitHub/pd-instamedia/src/app/%28app%29/w/%5Bws%5D/chat/actions.ts), [`src/db/queries/direct-messages.ts`](file:///Users/sukheshkannasaravanan/Documents/GitHub/pd-instamedia/src/db/queries/direct-messages.ts).
- **Features**: Floating slide-out chat drawer in global layout, unread message badges, online presence indicators, optimistic updates, and instant `"dm"` scope broadcasting.

### 2. Pomelli Brand DNA Visual Collage
- **Files**: [`src/components/brand/brand-dna-collage.tsx`](file:///Users/sukheshkannasaravanan/Documents/GitHub/pd-instamedia/src/components/brand/brand-dna-collage.tsx), [`src/app/(app)/w/[ws]/brand-gene/vault-editor.tsx`](file:///Users/sukheshkannasaravanan/Documents/GitHub/pd-instamedia/src/app/%28app%29/w/%5Bws%5D/brand-gene/vault-editor.tsx).
- **Features**: Interactive color swatch cards with one-click HEX copying, typography specimen cards, voice & tone pills, and brand guardrail badges for banned words and topics to avoid.

### 3. Live Brand DNA Compliance Meter & Auto-Fix AI
- **Files**: [`src/lib/brand-compliance.ts`](file:///Users/sukheshkannasaravanan/Documents/GitHub/pd-instamedia/src/lib/brand-compliance.ts), [`src/components/studio/brand-compliance-meter.tsx`](file:///Users/sukheshkannasaravanan/Documents/GitHub/pd-instamedia/src/components/studio/brand-compliance-meter.tsx), [`src/app/(app)/w/[ws]/studio/[contentId]/actions.ts`](file:///Users/sukheshkannasaravanan/Documents/GitHub/pd-instamedia/src/app/%28app%29/w/%5Bws%5D/studio/%5BcontentId%5D/actions.ts).
- **Features**: As-you-type compliance scoring badge (`Emerald` for 90%+, `Amber` for 70–89%, `Rose` for <70%), detailed violation viewer, and a **"✦ Fix with Brand AI"** button that invokes `refineDraft` to rewrite copy while preserving marketing intent.

### 4. Autonomous SOP Progression Engine
- **Files**: [`src/app/(app)/w/[ws]/approvals/actions.ts`](file:///Users/sukheshkannasaravanan/Documents/GitHub/pd-instamedia/src/app/%28app%29/w/%5Bws%5D/approvals/actions.ts), [`src/db/queries/sop.ts`](file:///Users/sukheshkannasaravanan/Documents/GitHub/pd-instamedia/src/db/queries/sop.ts), [`src/app/(app)/w/[ws]/sop/runs/[runId]/run-board.tsx`](file:///Users/sukheshkannasaravanan/Documents/GitHub/pd-instamedia/src/app/%28app%29/w/%5Bws%5D/sop/runs/%5BrunId%5D/run-board.tsx).
- **Features**: Approving content automatically marks linked SOP run steps as `done`, triggers the unblocking cascade (`blocked` ➔ `ready`) for downstream dependent steps, and broadcasts `"sop"` signals across all connected browser tabs.

### 5. Multi-Modal Studio Asset Generator
- **Files**: [`src/lib/ai/multimodal-agent.ts`](file:///Users/sukheshkannasaravanan/Documents/GitHub/pd-instamedia/src/lib/ai/multimodal-agent.ts), [`src/components/studio/multimodal-asset-drawer.tsx`](file:///Users/sukheshkannasaravanan/Documents/GitHub/pd-instamedia/src/components/studio/multimodal-asset-drawer.tsx).
- **Features**: Generates:
  - **4-Scene Video Storyboard**: Visual description, camera framing, and on-screen text.
  - **Midjourney v6 & DALL-E 3 Prompts**: Generated with aspect ratio flags (`1:1`, `9:16`, `16:9`) and brand color accents.
  - **Voiceover Scripts**: Timecoded narration lines with emotional delivery cues.

### 6. Live Web & Social Knowledge Ingestion Pipeline
- **Files**: [`src/app/(app)/w/[ws]/kb/crawl-action.ts`](file:///Users/sukheshkannasaravanan/Documents/GitHub/pd-instamedia/src/app/%28app%29/w/%5Bws%5D/kb/crawl-action.ts), [`src/components/kb/live-url-ingester.tsx`](file:///Users/sukheshkannasaravanan/Documents/GitHub/pd-instamedia/src/components/kb/live-url-ingester.tsx).
- **Features**: One-click URL input card on `/kb` that crawls web/blog pages, strips HTML noise, segments content into ~600-character semantic chunks, inserts into `knowledge_chunks`, and fires a `"kb"` realtime broadcast.

### 7. Interactive Visual Analytics & ROI Curves
- **Files**: [`src/components/charts/performance-chart.tsx`](file:///Users/sukheshkannasaravanan/Documents/GitHub/pd-instamedia/src/components/charts/performance-chart.tsx), [`src/app/(app)/w/[ws]/reports/page.tsx`](file:///Users/sukheshkannasaravanan/Documents/GitHub/pd-instamedia/src/app/%28app%29/w/%5Bws%5D/reports/page.tsx).
- **Features**: Custom SVG area charts with bezier curves, gradient fills, and hover tooltip tracking to plot engagement and performance trajectories.

---

## 6. Directory Structure & Code Mapping

```
src/
├── app/(app)/w/[ws]/
│   ├── use-workspace-realtime.ts       # Multiplexed Realtime Channel Hub
│   ├── layout.tsx                      # Layout with Bell, Presence, and DirectChatDrawer
│   ├── chat/actions.ts                 # 1:1 Team Chat Server Actions
│   ├── brand-gene/vault-editor.tsx     # Brand DNA Vault & Collage
│   ├── studio/[contentId]/page.tsx     # Studio with Compliance Meter & Multi-Modal Drawer
│   ├── studio/[contentId]/actions.ts   # Auto-Fix AI & Refine actions
│   ├── sop/runs/[runId]/run-board.tsx  # SOP Run Board with Deliverable Routing
│   ├── sop/sop-list-live.tsx           # SOP Real-time List Listener
│   ├── kb/crawl-action.ts              # Live Web URL Ingestion Server Action
│   ├── kb/page.tsx                     # KB Page with LiveUrlIngester
│   └── reports/page.tsx                # Reports with PerformanceAreaChart
├── components/
│   ├── direct-chat-drawer.tsx          # Floating 1:1 Team Chat Drawer
│   ├── brand/brand-dna-collage.tsx     # Pomelli Brand DNA Visual Collage
│   ├── studio/brand-compliance-meter.tsx # Live Brand Guardrails Compliance Meter
│   ├── studio/multimodal-asset-drawer.tsx # Storyboard, Image Prompt & Voiceover Drawer
│   ├── kb/live-url-ingester.tsx        # Live URL Ingestion Input Card
│   └── charts/performance-chart.tsx    # Interactive SVG Performance Charts
├── db/
│   ├── schema.ts                       # Drizzle PostgreSQL Schema
│   └── queries/
│       ├── direct-messages.ts          # Conversation & Message DB Queries
│       ├── knowledge.ts                # Knowledge Source & Chunk Queries
│       └── sop.ts                      # SOP Step & Cascade Queries
└── lib/
    ├── realtime.ts                     # Realtime Scope Definitions & Broadcast
    ├── brand-compliance.ts             # Pure Brand Rule Evaluator
    ├── ai/multimodal-agent.ts          # Storyboard, Prompt & Voiceover Generator
    └── nav.ts                          # 4-Pillar Navigation Registry
```

---

## 7. Quality Gate Verification Metrics

| Gate | Status | Details |
|---|---|---|
| **TypeScript** (`npx tsc --noEmit`) | ✅ Pass | 0 type errors |
| **ESLint** (`npx next lint`) | ✅ Pass | 0 warnings, 0 errors |
| **Vitest** (`npm test`) | ✅ Pass | **1,307 unit & integration tests passed** across 138 suites |
| **Production Build** (`npx next build`) | ✅ Pass | **All 47 routes compiled cleanly** |
