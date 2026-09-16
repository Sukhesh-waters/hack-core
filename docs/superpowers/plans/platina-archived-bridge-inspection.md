# Platina archived-bridge inspection

**Date:** 2026-09-16
**Git commit:** 6fe8d00
**Database host:** aws-1-ap-south-1.pooler.supabase.com
**Operator:** Slice 0 W0.3 script (read-only)

Totals: **0** campaign rows with `sop_run_id`
set; **0** total alert rules.

## Q1 — `sop_run_id` population per workspace

_No rows in `platina_campaigns`._

## Q2 — archived alert action kinds per workspace

_No alert rules use an archived action kind._

**Both bridges are empty.** A zero result is a valid, committable result: the drop migration removes unused surface.

## Decision input

These counts feed the future migration that drops
`platina_campaigns.sop_run_id` and replaces the archived alert action kinds
(`hub_message` / `ticket` / `email`) with `in_app`. That migration is
NOT part of Slice 0 and requires separate owner approval.
