# InstaMedia — Real-Time Collaboration Roadmap (Developmental Arc) — Design Spec

**Date:** 2026-08-17
**Status:** Approved by owner via brainstorming session (this conversation, 2026-08-17)
**Extends:** `docs/superpowers/specs/2026-07-08-final-shell-ui-first-design.md` (IA groups, per-screen wireframes, Supabase Realtime transport decision all still hold). This spec adds a shell-level real-time layer on top of that IA, closes a data-flow gap it didn't anticipate (Calendar), and adds one new subsystem (personal chat) it did not scope.
**Companion doc:** `docs/REALTIME-ARCHITECTURE-AUDIT-2026-08.md` — the evidence this roadmap is built on. Read that first; this doc is the "what we do about it," not the findings themselves.

## Problem

Owner assessment: the current product is below par for real-time collaborative use, end to end — UI, data flow, and core architecture — benchmarked against Pomelli (Google Labs) and Microsoft Teams. The live audit found the complaint is real but not where it was assumed to be: most of the real-time *transport* is correctly built (Production, SOP, Hub, Approvals all have a verified write → broadcast → subscribe → poll-fallback chain). The actual gaps are (1) Calendar has zero real-time wiring, (2) working real-time is invisible in the UI — nothing on screen signals "this is live," (3) the nav shell's one cross-cutting affordance (the notification bell) runs on a disconnected 60s poll instead of the real channel, and (4) collaboration concepts get built twice under the same name with no shared state (Hub's `hubApprovals` vs. the Approvals page's `content` pipeline).

This sprint's deliverable is this roadmap and the audit it's based on — no phase below ships code this sprint.

## Decisions (locked)

1. **Scope unlock — personal/team chat.** Direct (1:1 and small-group) chat between internal team members is now in scope, planned as Phase 2 below. **This is distinct from Client Portal**, which stays out of scope per the 2026-07-13 owner decision in `CLAUDE.md` — personal chat is internal-team-only, not a client-facing surface. Phase 0 makes this explicit in `CLAUDE.md` so the distinction doesn't blur later.
2. **Audit scope was real-time-relevant surfaces only** (Hub, Calendar, Production, SOP, Cockpit, Approvals + the shell), not a full re-audit of all 30 routes — the other 24 aren't real-time surfaces today and weren't in scope for this pass.
3. **Benchmark sources are Pomelli and Microsoft Teams**, researched live via `/browse` rather than assumed from training knowledge — see the audit doc's "Benchmark research" section for what was actually found versus what's inference.
4. **Phase order is fixed**: nav shell before personal chat, because chat is cheapest to build once there's a shell seam to put it in, and because the shell work is what makes existing real-time features *visible*, which the audit identified as the more load-bearing problem than any single missing feature.
5. **No phase in this roadmap touches the 24 non-real-time routes** (KB, Brand Gene content, Ideation, Studio, Reports, Ads, Accounts, etc.) except where Phase 3 explicitly calls out Brand Gene/Ideation as the closest conceptual analog to Pomelli's DNA-extraction flow.

## Phase 0 — Scope unlock (this sprint, doc-only)

Update `CLAUDE.md`'s scope section to add personal/team chat as in-scope, worded precisely to avoid conflating it with Client Portal (see Decision 1). No code. Done as part of landing this spec.

## Phase 1 — Unified navigation shell + real-time made visible

The highest-leverage phase: it doesn't add a new subsystem, it fixes the seam that makes every other real-time feature (existing and future) actually legible to a user, and it closes the one Critical code gap.

- **Close the Calendar gap.** Add `broadcastSignal` calls to the calendar mutation path (`setPlanSlot`, `createScheduledPost`, `updatePlanCellQuery` in `src/db/queries/schedule.ts` and `calendar/actions.ts`), add a dedicated `calendar` entry to the `RealtimeScope` union in `src/lib/realtime.ts` (not a reused scope name — the audit's own Phase 3 finding is that scope-name reuse across unrelated concepts, as with `hubApprovals`/`content` both using `"approvals"`, is how "bolted together" happens; Calendar gets its own scope from the start), wire a `useWorkspaceRealtime` subscriber into the calendar client components, and add the same 30s poll fallback every other surface already has. This is the one change that directly answers "not suitable for real-time use cases."
- **Promote presence/realtime from page-scoped to shell-scoped.** Currently `useWorkspaceRealtime` is called separately inside Hub, SOP's run board, Cockpit, Production, and Approvals. Call it once in `src/app/(app)/w/[ws]/layout.tsx` and pass state down via context, so presence is computed once and available everywhere, not just on 5 of 25 sections.
- **Fix the notification bell.** `notification-bell.tsx` currently polls every 60s, disconnected from the real Supabase Realtime channel every other live component uses. Wire it onto the same channel so shell-level notifications are actually real-time, not a second, worse system.
- **Add a shell-level presence indicator** (avatar stack + online dots, Teams-style) visible across all 25 sections, not just Hub's bare "1 ONLINE" count.
- **Add a reusable "live" visual grammar**: a small component (pulse dot, flash-highlight on a just-changed card, "updated Xs ago" microcopy) usable on any real-time surface. This is what closes the audit's cross-cutting finding — the backend already works on 5 of 6 surfaces; the UI never says so.

Change surface (per the nav-shell code audit): `w/[ws]/layout.tsx`, `app-sidebar.tsx`, `use-workspace-realtime.ts`, `notification-bell.tsx`, `src/lib/realtime.ts`, plus the calendar files above. No changes needed to any of the other 24 route implementations.

## Phase 2 — Personal chat/DM subsystem

Builds on Phase 1's shell seam rather than bolting on separately.

- New data model: `conversations`, `conversation_participants`, `direct_messages` (or equivalent) — explicitly separate from the existing workspace-scoped `hubApprovals`/Hub-message tables, since those model workspace-channel activity, not 1:1 chat.
- Reuses the proven `broadcastSignal` / `useWorkspaceRealtime` primitives with a new scope (e.g. `"dm"`) rather than inventing new transport — the audit confirmed this pipeline is solid where it's used correctly.
- UI surfaces in the shell built in Phase 1 (persistent chat affordance, not a separate full-page route to navigate away to — this is the specific Teams pattern being borrowed).
- Notifications route through the Phase 1 shell-level notification fix, not a third parallel system.
- `workspace_id` isolation still applies: a DM is between two members of the same workspace; cross-workspace DMs are out of scope unless a future decision explicitly opens that.

## Phase 3 — Visual/IA redesign pass

- **Resolve the "approvals" scope collision** identified in the audit: Hub's `hubApprovals` sign-off requests and the Approvals page's `content` review pipeline currently share a broadcast scope name with no shared data model. Either reconcile into one model or give them distinct scope names and distinct visual treatment so they stop reading as the same feature built twice.
- **Apply Pomelli-informed visual identity where it's actually the right analog**: Brand Gene and Ideation are this app's closest conceptual match to Pomelli's Business-DNA extraction flow. Pomelli makes that data visually legible (color swatches with hex, typography specimens, tone-word pills) where our KB/Brand Gene surfaces currently present it as text/tables. This is the highest-value place to borrow Pomelli's visual language specifically, not a blanket app-wide reskin.
- **Open decision, not resolved here:** the 2026-07-08 shell spec locked "prototype is layout reference only — not colors, not typography, styling is existing Tailwind/shadcn." A Pomelli/Teams-informed visual pass may mean revisiting that constraint. Flag this explicitly for the owner at Phase 3 kickoff rather than deciding it now, since it wasn't part of this sprint's brainstorming.
- Full scoping needs a follow-up live-research pass with actual Pomelli in-app access (this audit only reached the auth-gated landing page).

## Phase 4 — Real-time data-flow hardening

Closes the remaining Medium/Low findings from the audit that aren't worth blocking the higher-leverage phases above:

- `assignStepAction` and `materialiseStepAction` (SOP) don't broadcast — bring them in line with the other SOP mutations that already do.
- Remove the dead `"cockpit"` broadcast scope (subscribed to, never emitted) or wire something to it.
- Add a live subscriber to the SOP list page (`/sop`), not just individual run boards.
- Either wire `advanceProductionStageAction` to broadcast or remove the dead code before anything re-enables it.
- Load/scale testing under concurrent multi-user sessions — everything measured in this audit was single/dual-session; this phase is where that gets verified properly.

## Non-goals for this roadmap

- Client Portal / `org_admin` / `client_viewer` views — still out of scope per the 2026-07-13 decision, unaffected by Phase 2's personal-chat unlock.
- Any change to the 24 non-real-time routes beyond Phase 3's Brand Gene/Ideation visual pass.
- Full Pomelli in-app parity — the tool is auth-gated and this roadmap only had landing-page + official-description access.

## Next step

Each phase above gets its own spec → plan → implementation cycle via `writing-plans`, executed in a future session/sprint — starting with Phase 1 once this roadmap is reviewed.
