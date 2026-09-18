# Platina AI OS for Waters — Vercel Release Runbook

**Date:** 2026-09-17
**Slice:** 13 — hardening and release
**Scope:** the `/p/[ws]` Platina surface on the existing Vercel Pro deployment. InstaMedia `/w/*` is untouched by this release.

## Environment

All existing variables stay as they are. Platina adds one optional variable:

| Variable | Required | Notes |
|---|---|---|
| `PLATINA_REALTIME_SECRET` | Optional | Any 64-char random hex. Mints the opaque Realtime topic tokens. Absence degrades Platina live updates to the 20 s polling fallback — visible in the header as "Polling", never a fake "Live". Rotate by replacing the value; old channels simply stop resolving. |
| `APIFY_TOKEN` | Required for audits | Already used by InstaMedia connectors; the Waters adapter calls the same platform API. |
| `GEMINI_API_KEY` | Required for validation/retrieval | Model router embeds and scores through it. |
| `DATABASE_URL` | Required | Supabase Postgres (transaction-mode pooler). |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Required for Realtime | Publishable by design; payloads are signal-only. |
| `INNGEST_*` | Required for workers | Existing Inngest app; the Platina functions register in the same `serve()` call. |

## Migration order

Migrations are standard Drizzle and run forward only:

```bash
npm run db:generate   # only when schema changes — already committed through 0066
npm run db:migrate    # applies 0058–0066 to the target database
```

Apply `db:migrate` to staging first, run the smoke suite, then production.
Every Platina migration is additive (new tables/columns/enum values) — no
drops, no renames — so rollback is "redeploy the previous build"; the schema
stays compatible with it.

## Rollout

1. Deploy to the Vercel preview environment. Run `npm run test:e2e` against
   the preview with the fixture workspace.
2. Verify the five manual acceptance journeys (governing plan, Journey A–E)
   on staging with a non-production workspace.
3. Production deploy. Platina routes are additive (`/p/*`); no InstaMedia
   route changes ship in this release.
4. Rollback: redeploy the previous Vercel build. No data migration rollback
   is needed (additive schema).

## Observability

- **Job failures**: every audit run records its terminal state and reason in
  `platina_audit_runs` / `platina_audit_run_events`; the Audits run history
  surfaces them. Inngest's dashboard carries worker-level failure detail.
- **Provider fallback**: the model router swaps providers on throttle; a
  full outage leaves runs in `validating` with raw observations stored —
  never a fabricated finding. The Findings validation-health panel shows the
  objection rate; a ceiling breach raises an operational finding.
- **Stale data**: source freshness (fresh/stale/no data) is computed from
  real probe/run timestamps and shown on the Cockpit and Audits. Realtime
  transport state is always truthful in the header pill.
- **Cost**: per-source daily fetch caps and the probe tier keep Apify spend
  proportional to observed changes (R1). The delivery ledger records every
  alert decision.

## Support contacts

Job-level failures: Inngest dashboard. Provider status: Groq / Gemini /
Bedrock / Apify status pages. Database: Supabase dashboard.
