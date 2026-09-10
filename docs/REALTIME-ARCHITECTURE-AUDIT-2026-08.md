# Real-time architecture audit — Aug 17, 2026

**Branch:** `slice/s1-content-model`
**Trigger:** Owner review — current real-time UI/UX and data flow assessed as below the bar for real-time collaborative use cases, benchmarked against Pomelli (Google Labs) and Microsoft Teams.
**Method:** Code-level audit (4 parallel agents tracing every mutation → `broadcastSignal` → subscriber → poll-fallback chain, plus workspace-isolation and cross-surface coherence checks) + live product research (Pomelli and Microsoft Teams via `/browse`) + live-rendered screenshots of all 6 real-time surfaces in this app.
**Scope:** the 6 surfaces with live/WebSocket behavior today — Hub, Approvals, Calendar, Production, SOP, Cockpit — plus the shared navigation shell.

---

## Verdict

The complaint that "the core logical operations are below par" doesn't hold up surface-by-surface — Production, SOP (run boards), Hub, and Approvals all have a correctly-wired write → broadcast → subscribe → poll-fallback chain, verified against the actual current code (not assumed from the July/Aug QA reports, several of which are now stale). Workspace isolation is clean everywhere audited: no leakage found on any of the 6 surfaces.

What's actually wrong, in priority order:

1. **Calendar has no real-time layer at all** — not degraded, not partial, entirely absent. This is the one finding that matches "not suitable for real-time use cases" literally.
2. **Real-time-ness is invisible even where it works.** Every surface where the code is correct still renders zero visual signal that it's live — no pulse, no "updated Xs ago," no presence outside Hub's bare "1 ONLINE" count. A user can't tell working real-time from broken real-time by looking at the screen. This is very likely the actual source of "feels below par" — the backend works, the UI never says so.
3. **The navigation shell has a cross-cutting affordance (notification bell) that's disconnected from the real real-time system** — it polls every 60s instead of subscribing to the same channel every page already uses.
4. **"Same word, different systems" pattern repeats** — Hub's `hubApprovals` and the Approvals page's `content` pipeline share a broadcast scope name (`"approvals"`) but no data model or state; Calendar and Production silently diverge the same way. This is the concrete shape of "fragmented, bolted together."
5. **Visual language is internally consistent but has no identity.** Every surface uses the same shadcn/Tailwind dark-mode card grammar — this is *not* a coherence bug, it's actually done correctly at the component level. What's missing, compared to Pomelli's immediate visual identity (serif display type, brand-DNA-as-collage) or Teams' persistent chrome, is any distinguishing personality or shell-level real-time presence.

---

## Benchmark research

### Pomelli (Google Labs / DeepMind, public beta, Oct 2025)

Landing page (`labs.google.com/pomelli/about`) is a single-CTA, dark-olive editorial page: large serif logotype, one paragraph, one button ("Let's get started"). Surrounding it, arranged as a loose collage rather than a grid, are the actual artifacts Pomelli extracts: a color-swatch card with hex codes, a typography specimen card ("Aa — Ivypresto Headline"), tone-of-voice word pills ("Inspiring," "Confident," "On-brand," "Authentic"), and generated product photography. The landing page *is* a demonstration of the product's core value prop before you ever click in.

Official 3-step flow (per Google's Oct 28, 2025 announcement):
1. **Build your Business DNA** — paste a URL, Pomelli extracts tone of voice, fonts, images, color palette into one profile.
2. **Generate tailored campaign ideas** — AI proposes campaign directions from that DNA; user can also type a prompt.
3. **Edit and create branded creatives** — browse generated assets, edit text/images inline, download.

**This maps closely to InstaMedia's existing Brand Gene → Ideation → Studio pipeline.** The gap versus Pomelli is not "the core logic is wrong" — it's that Pomelli *shows* its DNA extraction as a visually legible artifact (swatches, tone pills, font specimens) at every step, where our KB/Brand Gene surfaces present the equivalent data as text tables and prose. The full in-app flow was not reachable (Google auth-gated), so this assessment is landing-page + official description only — worth a follow-up pass by someone with Pomelli access before Phase 3 (visual redesign) is scoped in detail.

### Microsoft Teams

Marketing site (microsoft.com) is abstract hero art with no real product screenshots — official messaging confirms the pattern already well-documented: a persistent left-rail shell (Activity / Chat / Teams / Calendar / Calls / Files) that stays present across every context switch, "bring conversations, shared content... together in one place," "customize views... surface what matters most," presence indicators on every avatar, and channel-scoped threaded conversations visually distinct from system/bot messages.

The concrete, transferable pattern: **one persistent shell carries chat, calendar, and presence everywhere; individual work surfaces are views inside that shell, not separate pages you navigate away to.**

---

## Findings by surface

### Calendar — Critical [CLOSED: 2026-08-17 Phase 1]

- *Status: Closed 2026-08-17 (Phase 1 Real-time Nav Shell).* Added `"calendar"` scope to `RealtimeScope`, added `broadcastSignal(workspaceId, "calendar")` to `updatePlanCellAction`, `bulkUpdatePlanCellsAction`, and `addCalendarPostAction`, added `CalendarLive` subscriber with 30s poll fallback, and added visual `LivePulse` indicator to the Calendar page header.
- No `broadcastSignal` call anywhere in `calendar/actions.ts` or the mutation queries it calls (`setPlanSlot`, `createScheduledPost`, `updatePlanCellQuery` in `src/db/queries/schedule.ts`). No `RealtimeScope` for calendar/plan writes exists in `src/lib/realtime.ts`'s type union at all.
- No client component under `calendar/` calls `useWorkspaceRealtime` — zero subscription, so even a signal sent would go nowhere.
- No 30s poll fallback either (every other surface has one). Calendar is pure server-rendered with no live-update mechanism of any kind — a second viewer sees stale data until manual reload.
- Confirmed live: the rendered Calendar (month view) is a plain grid with no presence, no "live" indicator, nothing suggesting it's part of a real-time product — visually consistent with the code finding.
- `transitionContentAction` (Production) calls `revalidatePath('/calendar')`, but that only busts the *caller's own* cache — it does nothing for a second open tab, so Production state changes never reach a live Calendar view either.

### Navigation shell — High [CLOSED: 2026-08-17 Phase 1]

- *Status: Closed 2026-08-17 (Phase 1 Real-time Nav Shell).* Added shell-level `WorkspacePresence` in `w/[ws]/layout.tsx` displaying live member avatars, wired `NotificationBell` directly to `useWorkspaceRealtime`, and upgraded `useWorkspaceRealtime` with multiplexed channel management supporting multiple concurrent subscribers per workspace safely.
- One persistent sidebar (`app-sidebar.tsx`) does wrap every route — this part is solid, not fragmented.
- A `NotificationBell` + `AskInstamedia` launcher render at the shell level (`w/[ws]/layout.tsx`) — genuinely visible on all 30 routes. But the bell polls every 60s (`POLL_MS = 60_000`) and is **not wired to the same Supabase Realtime channel** every page's own live components use (`useWorkspaceRealtime`, which does presence + broadcast). Two disconnected real-time systems exist in this codebase: the "real" one (page-scoped, sub-second) and the shell-level one (bell, 60s poll).
- Presence (`onlineIds`) is computed per-page (Hub, SOP run board, Cockpit, Production, Approvals each call the hook separately) and never surfaced at the shell level — no "who's online in this workspace" indicator exists anywhere outside Hub's own canvas.
- Nav IA is genuinely grouped (`src/lib/nav.ts`: Operate / Intelligence / Business / Infrastructure, 25 real sections), not a flat list — 3 of the 30 route folders are dead redirect stubs (`analytics`, `patterns`) or a non-navigable action backend (`ask`), so the "30 fragmented routes" framing overstates it; the real number is 25 intentionally-grouped sections.
- **Concrete change surface for a unified shell** (from the code audit, no page-level changes needed): `w/[ws]/layout.tsx` (injection point), `app-sidebar.tsx` (if the affordance should live in the rail), `use-workspace-realtime.ts` (promote from page-scoped to shell-scoped so presence computes once), `notification-bell.tsx` (merge onto the real channel instead of polling).

### Hub & Approvals — Low, one Medium

- Every mutation on both surfaces broadcasts correctly and every client subscribes, confirmed against current code — the Aug 4 QA report's open findings for these two surfaces are now stale (already fixed and still holding).
- **Medium — scope collision:** Hub's lightweight `hubApprovals` sign-off requests and the Approvals page's `content` review/schedule pipeline both broadcast under the same scope name, `"approvals"`, despite modeling two unrelated things with two unrelated permission checks (plain membership vs. `approval.decide` capability). Effect today is harmless (an extra idempotent refetch), but it's the clearest evidence in the codebase that "approval" was built twice without reconciling into one model — the literal shape of the "bolted together" complaint.
- Live-rendered Hub reads as a system-activity log (audit-trail-style monospace lines: `PUSHED "..." TO THEMSELVES`) with real chat messages at the same visual weight — no bubble/thread distinction between bot/system events and human messages, unlike Teams' visually distinct system-event styling.

### Production — Working correctly, one dead action

- `transitionContent` → broadcasts `"workflow"` → `production-live.tsx` subscribes → 30s poll fallback. Matches the Aug 4 QA report's measured 689ms latency, unregressed.
- `advanceProductionStageAction` has no broadcast and is dead code (no caller in the UI) — not a live risk today, but a landmine if it's wired up later without adding the broadcast call.
- Live-rendered board is a competent Kanban view (Brief → Shoot day → In progress → Client sign-off → Revision → Done), visually the strongest of the 6 surfaces.

### SOP & Cockpit — Low/Medium, one already-fixed Critical re-verified

- The Aug 5 Cockpit fix (`Promise.allSettled` + degraded-section banner, invalid subquery in `metrics.ts` corrected) is still intact — re-verified against current code and live-rendered without error.
- **Medium** — `assignStepAction` (claiming/reassigning a step) and `materialiseStepAction` (linking a step to content) both write directly without calling `broadcastSignal`, inconsistent with start/complete/skip/reopen/gate-decide, which all correctly broadcast via `moveRunStep`.
- **Low** — the `"cockpit"` broadcast scope is dead: `cockpit-live.tsx` subscribes to it but nothing in the codebase ever emits it. Harmless (Cockpit still refreshes off `sop`/`workflow`/`approvals`), but the same unwired-scope pattern the Aug 4 report already flagged for `tasks`/`reminders`/`plan`.
- **Low** — the SOP list page (`/sop`, not an individual run board) has no live subscriber at all — a user watching the list won't see another tab's run progress without navigating away and back. This was flagged in the Aug 4 report and is still true today.
- The presence `|| 1` masking noted in the Aug 4 report is confirmed **Hub-scoped only** — neither SOP nor Cockpit consumes `onlineIds`, so it doesn't touch either surface.
- Cockpit branding ("LIVE COMMAND CENTRE," "Real-time operational health... in one place") oversells what's rendered — the stat tiles have no live-update visual treatment (no pulse, no "updated Xs ago"), so a user has no way to distinguish a stale number from a fresh one just by looking.

---

## Cross-cutting UX finding (not surface-specific)

**Real-time-ness has no visual grammar anywhere in this app.** Even on the surfaces where the backend is fully correct (Production, SOP run boards, Hub, Approvals), nothing on screen tells a user "this just updated live" versus "this is what was here on page load." No flash-highlight on a changed card, no timestamp, no subtle pulse on a presence dot, no toast. This is very likely the actual substance behind "feels below par for real-time" — the plumbing mostly works; the UI never surfaces that it's working. Both Pomelli (through explicit brand-DNA visualization) and Teams (through persistent presence dots and live typing indicators) make their real-time/dynamic nature *visible*, not just functional.

---

## What this audit does NOT cover

- Pomelli's actual in-app flow beyond the landing page and official description (Google-auth-gated).
- Load/scale behavior of Supabase Realtime under concurrent multi-user load — everything measured here was single or dual-session.
- The 24 non-real-time workspace routes (KB, Brand Gene, Ideation, Studio, Reports, Ads, Accounts, etc.) — out of scope per this sprint's focus.
