# Built-vs-Planned Audit + Workspace Assets Design

**Date:** 2026-09-03 · **Status:** DRAFT — awaiting owner approval before any code
**Verified today on `main` @ 72ae88f:** `tsc --noEmit` clean · vitest 146 files / 1336 tests passing · 54 migrations · 60 tables · 28/30 routes render (the 2 soft-404s are action endpoints, already archived in the IA inventory)

---

## 1. Where the product actually stands

| Area | Planned (specs/catalogue) | Built (verified in code) | Verdict |
|---|---|---|---|
| W1–W8 wedge (ingest → KB → Brand DNA → ideation → studio → calendar → learning loop) | Core | All 8 surfaces live; 105 catalogue use-cases Live | ✅ done |
| Ops layer (SOP engine, tickets, workflows, automations, approvals) | S1–S5 + D/A slices | Live, incl. run cancel (E4) and rejection reasons (E3, migration 0053) | ✅ done |
| Real-time roadmap | Phases 0–4 | Phase 0–1 done (workspace channel, Calendar live). Phase 2 DM tables + drawer exist | 🟡 Phase 2 partial, 3–4 open |
| Unblocked 2026-07-13 surfaces (Drift, Reports, Ads, Cockpit) | Live | All render with real data | ✅ done |
| Catalogue gaps still open | 9 Gap + 3 Partial | UC-OPS-25/26/27 (presence everywhere, live indicator, realtime notifications), UC-MEA-09 (plan↔published loop), UC-PAT-08 (pattern embeddings), UC-MEA-08 (ad spend, gap by design) | 🟠 specced, not built |
| Trust gap E2 | "assigned SOP step never notifies the assignee" | Still open — no `notifications` insert on assignment | 🔴 demo-killer |
| **Deployment** | Vercel Pro | **Never deployed.** Env var list exists, Vercel MCP not authorised in this session | 🔴 gap #1 |
| **File / asset storage** | Not in any spec | **Nothing.** `import_jobs.filename` keeps only the name; `direct_messages.attachments` is an empty jsonb stub; KB ingests URL or workspace-doc text only; Brand Vault holds text, no logo/font/guideline files | 🔴 gap #2 (this spec) |
| Billing / plan limits | Not in any spec | None (no Stripe/Razorpay, no seat or usage caps) | 🟠 needed before sales |

**Honest read:** the build is far ahead of the go-to-market. The engine is real (SOP runs, workflow state machine, two-layer knowledge, learning loop, realtime). What is missing is the scaffolding a paying agency touches on day one: a URL, a place to put their files, and a plan to be on.

---

## 2. Owner's suggestion — Workspace Assets (recommended, slice 1 of 3)

### Why this is the right next feature
Agencies live in Drive/Dropbox. Today InstaMedia cannot receive a single file. One primitive — an `assets` table backed by a private bucket — unlocks four existing surfaces at once:

1. **CSV → Insights import** retains the file (today the upload is parsed and discarded).
2. **Brand guideline PDF/MD → Knowledge Base** feeds Brand DNA and the compliance meter. This is the "not an AI wrapper" moment: the client's own guidelines govern generation.
3. **Attachments** on tickets and DMs (the jsonb column already exists, unbacked).
4. **Studio reference picker** for drafts.

### Approaches considered
| | Approach | Trade-off |
|---|---|---|
| **A (recommended)** | **Supabase Storage**, private bucket, server-side upload via `SUPABASE_SERVICE_ROLE_KEY` | Zero new vendor (DB is already Supabase). 1 GB free, scales on Pro. Storage RLS is *not* relied on — isolation stays app-layer, same as the DB rule in CLAUDE.md |
| B | Vercel Blob | Simple, but second vendor + token; billed on Pro |
| C | Postgres `bytea` | Zero infra, fine for ≤1 MB CSVs, wrong for images/PDFs; bloats backups. Reject |

### Data model
```
assets
  id, workspace_id (idx, NOT NULL), client_id (nullable), uploaded_by_id,
  filename, mime, bytes, storage_path,          -- path = ws/{workspace_id}/{asset_id}
  kind: asset_kind enum (csv | doc | image | other),
  linked_type / linked_id (nullable, same polymorphic pattern as tickets),
  created_at, archived_at
```
Isolation: `workspace_id` is in both the row and the object path. Every query filters by it; query tests assert the filter is in the SQL (project rule).

### Limits (app-layer, become plan meters later)
- Per file: 10 MB. Per workspace: 250 MB (constant now, plan-driven later).
- Mime allowlist: csv, txt, md, pdf, docx, xlsx, png, jpg, webp, svg.
- Quota check sums `bytes` where `archived_at IS NULL` before upload.

### Surfaces
- New route `/w/[ws]/assets`, nested under **Brand DNA & Vault** in the sidebar (the IA inventory already calls brand-gene the "asset vault"). Client filter, kind filter, storage-used meter, upload, archive.
- Capabilities: `asset.upload`, `asset.delete` added to `src/lib/permissions.ts`; membership validated before any storage call.
- Server actions: `uploadAssetAction(formData)`, `archiveAssetAction`, `getSignedUrlAction` (60 s TTL). No public URLs, ever.

### Degradation ladder
Missing `SUPABASE_SERVICE_ROLE_KEY` → page renders a "Storage not configured" state, upload disabled, nothing crashes. Bucket error → action returns a user-readable error and writes an `activity` row.

### Tests (ship with the slice)
- Query tests: workspace filter present in every `assets` query.
- Action tests: quota exceeded, mime rejected, oversize rejected, membership rejected, storage client mocked.
- E2E smoke: upload a CSV, see it listed, archive it.

### Follow-on slices (each its own spec → plan)
- **Slice 2:** `knowledge_sources.source_kind = 'asset'` + `asset_id`; existing chunk/embed pipeline ingests PDF/MD/CSV. Adds "Add to Knowledge Base" on any doc-kind asset.
- **Slice 3:** attachments on tickets, DMs, and Studio drafts via `linked_type/linked_id`.

---

## 3. Prioritised roadmap to a sellable SaaS

Ordered by sales impact ÷ effort. Nothing below touches a **Refused** catalogue item (client login, retainer modelling, own scrapers, sentiment scoring, manual metric entry, image/video gen, Canva routing, JQL rules, decision auto-correlation).

| # | Item | Why it sells / saves time | Size |
|---|---|---|---|
| P0-1 | **Deploy to Vercel Pro** with the existing env list; production Supabase | No URL = no demo, no trial, no sale | 0.5 d (owner must authorise Vercel) |
| P0-2 | **Assets slice 1** (§2) | Owner's ask; unlocks 4 surfaces | 2 d |
| P0-3 | **Fix E2** — notify on step assignment and `blocked → ready`; show open run steps in My Work and Calendar | The product's promise is "work becomes visible". Today SOP work is invisible. Breaks every demo | 1 d |
| P1-1 | **Assets slice 2** — KB ingest from PDF/MD/CSV | Client guidelines govern Brand DNA + compliance. Core differentiator | 1.5 d |
| P1-2 | **UC-MEA-09** plan ↔ published loop | Closes W8. Lets Reports say "planned X, shipped Y, Y performed Z" — the report agencies pay for | 2 d |
| P1-3 | **UC-OPS-25/26/27** presence everywhere, live-updated badge, notifications on the realtime channel | Already specced (realtime roadmap Phase 1 leftovers); makes the "real-time" claim visibly true | 2 d |
| P1-4 | **Report export** — Reports currently only emails; add PDF/CSV download of the same digest | Agencies forward reports to clients weekly | 1 d |
| P2-1 | **Billing + plan limits** (Stripe or Razorpay — stack decision, update CLAUDE.md) | Storage quota from P0-2, seats, and AI daily cap become the three plan meters | 3 d |
| P2-2 | **Assets slice 3** — attachments on tickets/DM/Studio | Finishes the Drive replacement story | 1.5 d |
| P2-3 | **UC-PAT-08** pattern-post embeddings | Insight agent stops prompt-stuffing top-12; better ideation | 1 d |

**Explicitly not proposed:** client-facing approval links or any `client_viewer` surface. It is the single largest commercial lever for agencies, and it is refused by owner decision (UC-ID-08 / CLAUDE.md). Only the owner can reopen it.

---

## 4. Decisions needed from the owner
1. Approve Assets slice 1 as specified (Approach A, limits, route placement)?
2. Authorise Vercel (MCP connector or manual) so P0-1 can happen.
3. Billing provider and whether to add it to the locked stack (P2-1). Not needed for P0/P1.
