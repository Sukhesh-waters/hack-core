# InstaMedia AI — Master Roadmap (Week-wise, Merged Phases)

> Derived from `WEEKLY_PLAN.md` (W1–W8) on 2026-07-04. Weeks are merged into
> phases only where the work shares a substrate and merging is provably faster
> (WEEKLY_PLAN §7 rule). Each phase = one plan → diff → review cycle, per the
> constitution. This file tracks progress; the per-slice implementation plans
> live alongside it in `docs/superpowers/plans/`.

## Current Status (2026-07-04)

**Phase 0 / W1 code: COMPLETE.** Lint ✅ · typecheck ✅ · 18/18 tests ✅ ·
production build ✅ (the recorded DrizzleAdapter build failure was a stale
`.next` cache — a clean build passes). Repo pushed to
`github.com/Sukheshkanna13/pd-instamedia` with CI (`.github/workflows/ci.yml`).

**W1 remaining — environment only, no code:**
- [ ] Supabase project → set `DATABASE_URL` in `.env.local` → `npm run db:migrate`
- [ ] Google OAuth + Resend credentials (`AUTH_GOOGLE_ID/SECRET`, `AUTH_RESEND_KEY`, `EMAIL_FROM`)
- [ ] Vercel Pro project + env vars + first deploy (Vercel CLI not installed; use the Vercel dashboard GitHub import, or `npm i -g vercel`)
- [ ] Verify live URL: log in, claim org, create workspace

## Phase Map (merges + rationale)

| Phase | Weeks | Ships | Merge rationale |
|---|---|---|---|
| **0 — Foundation** | W1 | Deployed app, auth, schema live | — (code done; env pending) |
| **1 — Ingestion + KB** | W2 + W3's layer schema | CSV import → scored, embedded rows in KB; intake wizard; KB screen | The `source` (`first_party`/`public`) column, `weight`, and the layer-separation guardrail test belong in the ingestion schema from day one — retrofitting them in W3 means a rework migration. Also seeds the model-router skeleton (constitution: *every* AI call goes through the router, and W2 already calls Groq + Gemini). |
| **2 — Connectors + Pattern Layer** | W3 remainder | Meta connector (feature-flagged), Apify pattern ingestion, freshness heartbeat, Connected Accounts screen | Kept separate: gated on Meta app review + signed DPAs (external). Layer-separation test already exists from Phase 1; this phase extends it to live-DB proof. |
| **3 — Intelligence** | W4 + W5 | Brand DNA onboarding → driver brief → ideation → generation → refinement; router completed with Bedrock quality tier | Merged: one continuous vertical pipeline over the same substrate (model router + retrieval). W5's ideation consumes W4's driver brief directly — building them together avoids a throwaway W4-only demo surface. Two review checkpoints inside the phase (after Brand DNA/retrieval, after ideation/generation). |
| **4 — Compliance + Calendar** | W6 | Approve → schedule → remind; Inngest wired | Standalone: introduces Inngest infra; compliance agent needs Phase 3's Brand DNA rules. |
| **5 — Learning Loop + Collab + Cost** | W7 | Publish-back re-weighting, comments, per-workspace cost caps | Standalone: needs Phase 4's published content to learn from. |
| **6 — Harden + Dogfood** | W8 | Golden-set evals, isolation/layer tests in CI, error states, demo, 4 real clients | No new features — hardening only. |

## Review gates

Every phase: **plan → approval → implement as reviewable diff → CI green →
review → next phase.** No phase starts before the previous one's review clears.
Phase 3 gets two internal checkpoints because it merges two weeks.

## External dependency track (start now, parallel to Phase 1)

| Dependency | Action | Gates |
|---|---|---|
| Meta developer app + permissions | File now — longest lead time | Phase 2 |
| Client DPAs (one page, per client) | Draft + send for signature | Phase 2 (before any real account connects) |
| Bedrock model availability in-region | Verify | Phase 3 (router quality tier) |
| Groq/Gemini free-tier RPM/RPD caps | Verify | Phase 1 (ingestion) and Phase 3 (ideation load) |
| Supabase + Vercel Pro + OAuth/Resend creds | Set up now | Phase 0 close-out |
| LinkedIn API | Deprioritized | Post-MVP (CSV covers it) |

## Phase ship criteria (from WEEKLY_PLAN "Done =")

- **0:** Live URL, login works, isolation column in every table. *(code ✅ — env pending)*
- **1:** Import a real client CSV; rows show direction+magnitude; "insufficient baseline" handled, never faked; layer-separation test in CI.
- **2:** Two layers visible and provably non-mixing; heartbeat shows last pull.
- **3:** One brand onboarded; compact on-brand driver brief from real data; topic → scored ideas → full content, on-brand, with "why this idea" citing baseline rows only.
- **4:** Idea → generate → comply → approve → schedule → reminder, unbroken.
- **5:** Second pass visibly improves; cost telemetry live; comments push in real time.
- **6:** 4 clients producing real work; demo runs clean twice in a row.

## Deferred (trigger-gated — from WEEKLY_PLAN §6, unchanged)

Ads Manager, Client Portal, full Owner Cockpit, Brand Drift monitor,
`org_admin` role, AWS-native scale-out. Disabled "Coming soon" nav items only.

## Slice plans

- Phase 1: `2026-07-04-w2-ingestion-kb-slice.md` *(current — awaiting approval)*
- Phase 2+: written when the preceding phase's review clears.
