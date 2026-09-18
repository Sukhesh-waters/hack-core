# Platina AI OS for Waters — Slice 14 Live Pipeline Trace

**Date:** 2026-09-18
**Slice:** 14, work item 4 ("Live pipeline proof") — with items 5 and 6 verified in
the same session since all three needed the same live Inngest + Next dev + real
provider setup.
**Governing plan:** [2026-09-11-platina-waters-realtime-full-suite.md](./2026-09-11-platina-waters-realtime-full-suite.md)
**Predecessor:** [Slice 13](./2026-09-17-platina-slice-13-hardening.md) (done, `a1f999d`); [Slice 14 plan](./2026-09-18-platina-slice-14-live-verification.md)
**Environment:** `npm run dev` (Turbopack), `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest`, real `APIFY_TOKEN` / `GEMINI_API_KEY` / `GROQ_API_KEY` / Supabase DB from `.env.local`. Fixture workspace `1f3f82d4-470a-494d-8e56-29ac9372e94f`.

## Summary

The first live run surfaced three dead provider model ids that had been
silently breaking AI calls — the model router's own degradation ladder didn't
catch them because it only swapped providers on 429/5xx, never 404. Fixed all
three (commit `7fead3b`) and re-ran; the pipeline then went genuinely
end-to-end: a real Apify fetch of a public Agilent LC/MS product page, through
the contradiction sweep, to a persisted, human-readable finding with an
AI-written objection. Item 5 (realtime two-tab convergence) and item 6 (live
eval re-run) were verified in the same session — see their own sections below.

## Attempt 1 — orchestrator honesty, real bug found

Created an audit source in the fixture workspace targeting a real public
competitor page and approved it (`confirmScanAction`, which fires the first
run immediately). The run reached `completed` — the Apify fetch itself
worked — but the contradiction sweep it triggers threw:

```
AIRouterError: Groq request failed (404)
  at runContradictionRound (src/lib/platina/debate.ts)
```

Confirmed directly against Groq's API (not a code guess):

```
POST api.groq.com/openai/v1/chat/completions  model=llama-3.3-70b-versatile
-> 404 {"error":{"message":"The model `llama-3.3-70b-versatile` does not
    exist or you do not have access to it.","code":"model_not_found"}}
```

`llama-3.1-8b-instant` 404s identically on this key. Tested every other
production model Groq's docs list; only `openai/gpt-oss-120b`,
`openai/gpt-oss-20b`, `groq/compound`, and `groq/compound-mini` returned 200
for this `GROQ_API_KEY`. **This means the entire "fast" tier — every Groq
call across InstaMedia and Platina, not just Platina's contradiction
sweep — had been silently broken**, and nothing caught it because
`fastChat`'s swap-to-Gemini logic only treats 429/5xx as swappable, so the
404 propagated as a hard failure instead of degrading.

Separately, forcing the fallback path exposed a second dead model:
`gemini-2.0-flash` (the chat model) also 404s — Google's own error body
names the successor:

```
POST generativelanguage.googleapis.com/.../gemini-2.0-flash:generateContent
-> 404 "This model models/gemini-2.0-flash is no longer available.
    ... use models/gemini-3.6-flash ..."
```

And the quality-tier default, `gemini-2.5-pro`:

```
-> 404 "This model models/gemini-2.5-pro is no longer available to new
    users. ... use models/gemini-3.1-pro-preview ..."
```

## Fix (commit `7fead3b`)

- `GROQ_MODEL`: `llama-3.3-70b-versatile` → `openai/gpt-oss-120b` (verified
  reachable with the live key).
- `GEMINI_CHAT_MODEL`: `gemini-2.0-flash` → `gemini-3.6-flash`.
- `geminiQualityModel()` default and `.env.local` / `.env.example`
  `GEMINI_QUALITY_MODEL`: `gemini-2.5-pro` → `gemini-3.1-pro-preview`.
- `fastChat`'s degradation ladder: swap on 404 in addition to 429/5xx — a
  dead model id is exactly the provider-unavailability case the ladder
  exists for, not a client error to surface raw.
- Added a router test for the new 404-swap path; fixed the one existing test
  that hardcoded the retired `gemini-2.5-pro` id. Full suite:
  **1724 passed, 10 skipped, 0 failed** after the fix.

## Attempt 2 — end to end, real finding persisted

Re-triggered the contradiction sweep for the already-ingested Agilent signal
(no new Apify fetch needed — `listUnresolvedSignals` still had it queued from
attempt 1). First retry hit a transient Gemini `503` (model overloaded, not a
dead model — the swap logic isn't needed here, Inngest's own step retry
covers it); the next attempt succeeded outright.

Findings page, fixture workspace, after the run:

> **HPLC/UHPLC Systems and Solutions - Liquid Chromatography | Agilent**
> Growing demand for flexible, modular HPLC/UHPLC systems that enhance
> laboratory uptime and support a wide range of budgets and applications
> — Medium · New
> Strongest objection: Promotional product material from a single
> manufacturer highlights advertised features and value propositions, but
> does not provide evidence of actual market-wide demand growth or
> purchasing behavior.

Validation health: 3 rounds run, 0% contested/refuted, ceiling 80% — the
objection-rate gate never engaged, correctly, since nothing exceeded it.

This is the real chain: Apify fetch → `insertSignalDocuments` → contradiction
sweep (`platina/contradict.requested`) → `runContradictionRound` (Gemini) →
`insertFinding` → rendered on `/p/[ws]/findings`. Nothing here is seeded or
fabricated; the finding's title, summary, and objection text are the model's
live output against the real fetched page content.

## Observed operational constraint (not a code bug)

A second attempt at a *new* Apify fetch (different draft source) failed with
`Apify run failed (402)` — Payment Required. The Apify account/token is
out of run credit or has hit a billing limit. Not something fixable in code;
flagged for the owner. It didn't block this trace because the finding above
was produced by reprocessing already-fetched content, but any *new* audit
run will fail the same way until Apify billing is addressed.

## Item 5 — Realtime convergence (`e2e/platina/realtime-convergence.spec.ts`)

Two pages in one authenticated Playwright context, both on `/p/[ws]/audits`,
both reaching the `Live` transport state (`PLATINA_REALTIME_SECRET` set).
Tab A creates and approves a fresh audit source; tab B — untouched, no
reload — picks up the new run in its Run History table via the Supabase
Realtime broadcast. Verified passing: **2/2 tests, ~43s**, convergence
observed in 1-2s (well inside the 12s assertion window, far under the 20s
polling fallback interval, proving the Realtime path and not the poll).

## Item 6 — Live eval re-run

`PLATINA_EVAL_LIVE=1 npx vitest run src/lib/platina/eval.live.test.ts` with
`.env.local` sourced into the shell (real `GEMINI_API_KEY` + `DATABASE_URL`):
**1 passed**, ~77s. Vector-only baseline vs. the full Slice 5 pipeline
(vector + lexical fused, reranked) — pipeline does not regress against
baseline, the R4 done-when gate holds against a clean run.

## Done-when status (from the Slice 14 plan)

- [x] Pipeline trace exists with real rows at every step (this document).
- [x] Two tabs converge without refresh.
- [x] Admin surface contains no control that writes config without changing
      behavior (orchestrator honesty, shipped in `55f5338`).
- [x] Alert rules cover all four sources (shipped in `55f5338`).
- [x] Eval passes clean.
- [x] All gates green (typecheck clean, full vitest suite 1724/1724).

## Non-goals held

No deletions, no redirects — the Slice 12 transition matrix is still
unsigned. No Vercel project changes.
