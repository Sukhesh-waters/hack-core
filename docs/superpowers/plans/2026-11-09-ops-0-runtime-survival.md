# OPS-0 — Stay alive, and say when you were down

Date: 2026-11-09 · Lane: Core (ops) · Status: **DRAFT — plan for owner review; parts C–D need the owner's yes
for a migration**
Evidence: `docs/research/2026-11-09-realtime-operations-analysis.md`.
Owner decisions so far (9 Nov): database stays on the **free plan with a keep-alive**; the runtime runs **only
during demos and development**.

## 0. Why

On 9 Nov the database was found paused and nothing had raised an alarm. The study cannot tell "not useful" from
"not running", and scheduled jobs either skip or replay after the runner was off. Every later slice (WTR-0,
CORE-1, WTR-1, WTR-3) assumes a runtime that is up and an honest record of when it was not.

## 1. Rules

- Plan → diff → review; one part per diff.
- Additive migration with a hand-written down file; `workspace_id` on every new table and query, with `toSQL()`
  tests (the Platina schema test requires it).
- InstaMedia jobs are not touched (constitution); their crons remain unguarded and are listed as a known gap.
- No secret is printed or committed. The keep-alive uses a role that can read one table and nothing else.

## 2. Parts

| Part | What | Size | Needs | Status |
|---|---|---|---|---|
| A | **Restore and back up.** Resume the project in the Supabase dashboard; take `supabase db dump` (schema, data, roles) to a folder outside the repo; record the date in the study log | S | Owner action | waiting on owner |
| B | **Keep-alive** (owner chose this over Pro). A scheduled GitHub Actions workflow, twice a day, runs one real read (`select count(*) from workspaces`) as a dedicated read-only role `keepalive` | S | Owner: create the role (SQL below), add `KEEPALIVE_DATABASE_URL` as a GitHub secret | proposed |
| C | **Runtime heartbeat.** Table `platina_runtime_heartbeats` (`id`, `workspace_id`, `hour` (timestamp truncated to the hour), `created_at`; unique `(workspace_id, hour)`), written by the scan coordinator on its first tick each hour for every workspace (`insert … on conflict do nothing`). A0 = distinct hours per week | M | Migration 0092 + down file → **owner's yes** | proposed |
| D | **Job-ran check.** Table `platina_job_runs` (`id`, `workspace_id`, `job_id`, `ran_at`), one row per workspace at the end of each scheduled job. Ops check `scheduled_jobs`: amber when a daily job missed its day while the runtime was up, red after two | M | Same migration 0092 | proposed |
| E1 | **Replay guard** (catch-up, half 1): after a restart a cron runs once, not once per missed tick | S | — | **built (this diff)** |
| E2 | **Late-start catch-up** (half 2): the coordinator, on each tick, sends the event of any daily job whose time passed today with no row in `platina_job_runs` while the runtime is up. Needs D | S | D | proposed |
| F | Pin the job runner (`inngest-cli@1.51.0` in `dev-all.mjs` and `dev:jobs`) | XS | — | **built (this diff)** |
| G | `platina-outcome-ingest` only counts rows. Remove it, or give it a real job | XS | Deletion follows the constitution's approval rule | proposed |

### Part B — role and workflow (proposal)

```sql
create role keepalive login password '<generated>';
grant usage on schema public to keepalive;
grant select on public.workspaces to keepalive;
```

```yaml
name: db-keepalive
on:
  schedule:
    - cron: "17 3,15 * * *"
  workflow_dispatch: {}
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - run: psql "$KEEPALIVE_DATABASE_URL" -c "select count(*) from workspaces" -t
        env:
          KEEPALIVE_DATABASE_URL: ${{ secrets.KEEPALIVE_DATABASE_URL }}
```

Limits to accept: Supabase does not guarantee that a few requests a day prevent a pause; GitHub disables scheduled
workflows in a **public** repository after 60 days with no repository activity. Supabase e-mails a warning about a
week before pausing. That e-mail stays the backstop.

### Part E1 — what was built

- `src/lib/platina/cron-guard.ts` (+ test): `isReplayedTick({ jobId, eventName, runId, minGapMs })`. A cron run
  stops before any work when another run of the same job started less than `minGapMs` ago in this process. The
  same run (re-invoked per step) always passes; event-triggered runs are never skipped.
- Wired into all 16 cron-triggered Platina jobs. Gaps: coordinator 4 min · all other hourly/daily/weekly/monthly
  jobs `BURST_WINDOW_MS` (15 min) — long enough to swallow Inngest's ~3-minute start-up replay burst, short enough
  that a transient failure on step 1 never locks out a second run later in the day.
- Limits: state is in process memory (one local process, by the runtime decision). If the app restarts while the
  runner keeps replaying, at most one extra run per job happens. A daily job whose time passed while the runner was
  off is still not run that day if the runner skips missed ticks; E2 closes that.

### Verify after build (E1 + F)

1. `npx vitest run src/lib/platina/cron-guard.test.ts` passes; the full suite, `tsc --noEmit` and lint pass.
2. By hand: `npm run dev:all`, wait for one coordinator run, stop for 15 minutes, start again. In the Inngest UI
   (localhost:8288) count the coordinator runs created on start-up: the first does work, any others end with
   "replayed tick after the job runner was down". This also answers whether the dev server replays or skips.

## 3. Order

A (owner) → B (owner + one workflow file) → E1 + F (done, in review) → C + D (one migration, owner's yes) → E2 → G.
Then WTR-0 (migration 0091) with the A0 measure added to Part D. Migration numbers: WTR-0 keeps 0091, OPS-0
takes 0092, CORE-1 moves to 0093.

## 4. Progress

| Part | Status | Commit | Verified |
|---|---|---|---|
| A | waiting on owner | | |
| B | proposed | | |
| C | proposed | | |
| D | proposed | | |
| E1 | built, in review (`BURST_WINDOW_MS = 15m`) | | unit tests + typecheck |
| E2 | proposed | | |
| F | built, in review (`inngest-cli@1.51.0`) | | unit tests + typecheck |
| G | proposed | | |

## 5. Proposed `CLAUDE.md` owner-decision wording (ready for sign-off)

> **Owner decision 2026-11-12 (organic data pooling + read-only reporting connectors):**
> 1. **Plane A (consented first-party, read-only):** InstaMedia and Platina may read a client's own organic and
>    campaign reporting through read-only official API scopes the client grants — Instagram Graph (`views, reach,
>    saved, shares`), LinkedIn Community Management & Marketing reporting, TikTok Display API, Google Analytics
>    Data API, and CRM lead counts — via `src/lib/connectors/metrics-read.ts`. Access tokens are sent only in the
>    `Authorization: Bearer` header, never in URL query strings, and never request write scopes.
> 2. **Plane B (public pattern data):** Alongside Apify and Firecrawl, public pattern collection may use
>    (a) Instagram **Business Discovery** (`business_discovery.username(...)`) for public Business/Creator profile
>    and media counts, (b) **YouTube Data API v3** for public video/channel statistics, and (c) self-hosted
>    **Crawl4AI** (with `check_robots_txt=true`) or **Jina Reader** as free markdown page readers behind
>    `src/lib/net/safe-fetch.ts` and the fetch adapter registry (`src/lib/platina/fetch/registry.ts`). All Plane B
>    rules still apply: tagged `source=public`, `weight=neutral`, company-level only (no named-individual profiles),
>    never embedded into Plane A, never mixed in a phase citation, and every metric records its `scaleVersion`.
